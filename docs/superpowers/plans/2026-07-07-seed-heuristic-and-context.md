# Seed Heuristic + Context Code Bodies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make graph traversal seed from the right node types (Change A) and feed retrieved code bodies to the generator (Change B), each verified by an eval delta.

**Architecture:** Both changes live in `backend-fastapi/app/services/code_graph/retriever.py`. Change A adds a pure scoring function used only for seed ordering (semantic result ordering untouched, so retrieval-metric deltas stay attributable). Change B rewrites `_build_combined_context` to emit truncated code snippets from the `document` field ChromaDB already returns, followed by the existing graph-relations section.

**Tech Stack:** Python 3.12 (`backend-fastapi/venv312`), pytest + unittest.mock, ruff, eval harness `python -m evals.run` against live Neo4j/ChromaDB (docker compose).

**Spec:** `docs/superpowers/specs/2026-07-07-retrieval-seed-and-context-design.md`

## Global Constraints

- Branch: `feat/seed-heuristic-and-context` (already checked out).
- Commits: conventional commits, English, NO Co-Authored-By lines, no emojis.
- Every code commit: `venv312/Scripts/python.exe -m ruff check app tests` clean and `venv312/Scripts/python.exe -m pytest --no-cov -q` green (run from `backend-fastapi/`).
- Eval runs need `docker compose up -d` at repo root (MySQL 3307, Neo4j 7687, ChromaDB 8001) and run from the repo root with `backend-fastapi/venv312/Scripts/python.exe`.
- Baseline to beat (`evals/results/20260706T174408Z.json`): graph_neighbor_recall 0.2867, graph_traversal_correctness 0.24, hybrid_hit_rate@5 0.64. Generation baseline (`evals/results/20260620T040651Z.json`): faithfulness 4.76, answer_relevance 3.66.
- `semantic_results` payload and ordering must NOT change in either task; only seed ordering (A) and `combined_context` (B) change.

---

### Task 1: Type-aware seed scoring

**Files:**
- Modify: `backend-fastapi/app/services/code_graph/retriever.py` (constants near `GRAPH_SEED_COUNT` at ~line 19; `_seed_entities_from_semantic` at ~line 115)
- Test: `backend-fastapi/tests/test_retriever_seed_and_context.py` (create)

**Interfaces:**
- Consumes: chunk dicts shaped `{"metadata": {"name", "module_path", "class_name", "type"}, "relevance_score": float, "document": str}` (what `ChromaDBClient.search_all` returns).
- Produces: module-level `_score_seed(metadata: dict, relevance_score: float) -> float` and constants `SEED_TYPE_WEIGHTS: dict`, `SEED_SCHEMA_PATH_PENALTY: float`, `SEED_EXCEPTION_PENALTY: float`. Seed descriptor shape returned by `_seed_entities_from_semantic` is unchanged: `{"name", "module_path", "class_name", "type", "relevance_score"}` with the RAW relevance_score (Neo4j client contract).

- [ ] **Step 1: Write the failing tests**

Create `backend-fastapi/tests/test_retriever_seed_and_context.py`:

```python
"""Tests for type-aware seed scoring and code-body context building."""


def _hit(name, module_path, type_, score, class_name=None, document=""):
    return {"metadata": {"name": name, "module_path": module_path,
                         "class_name": class_name, "type": type_},
            "relevance_score": score, "document": document}


class TestScoreSeed:
    def test_function_outranks_schema_class_at_higher_relevance(self):
        # The register case from the eval harness: UserRegister (schema class)
        # has the higher semantic score but must lose to the endpoint function.
        from app.services.code_graph.retriever import _score_seed
        schema = _score_seed({"name": "UserRegister",
                              "module_path": "app/schemas/user.py",
                              "type": "class"}, 0.9)
        func = _score_seed({"name": "register",
                            "module_path": "app/api/auth.py",
                            "type": "function"}, 0.6)
        assert func > schema

    def test_plain_class_keeps_type_weight_only(self):
        from app.services.code_graph.retriever import (
            _score_seed, SEED_TYPE_WEIGHTS)
        got = _score_seed({"name": "CacheManager",
                           "module_path": "app/core/cache.py",
                           "type": "class"}, 1.0)
        assert got == SEED_TYPE_WEIGHTS["class"]

    def test_exception_class_penalized(self):
        from app.services.code_graph.retriever import _score_seed
        exc = _score_seed({"name": "TokenError",
                           "module_path": "app/core/token_blacklist.py",
                           "type": "class"}, 1.0)
        plain = _score_seed({"name": "TokenVersionManager",
                             "module_path": "app/core/token_blacklist.py",
                             "type": "class"}, 1.0)
        assert exc < plain

    def test_missing_fields_default_sanely(self):
        from app.services.code_graph.retriever import _score_seed
        assert _score_seed({}, 0.5) > 0


class TestSeedSelection:
    def test_register_beats_userregister_in_seeds(self):
        from app.services.code_graph.retriever import CodeGraphRetriever
        retriever = CodeGraphRetriever()
        semantic = {
            "classes": [_hit("UserRegister", "app/schemas/user.py", "class", 0.9)],
            "functions": [_hit("register", "app/api/auth.py", "function", 0.6)],
        }
        seeds = retriever._seed_entities_from_semantic(semantic, 1)
        assert seeds[0]["name"] == "register"
        # Descriptor carries the RAW semantic score, not the seed score.
        assert seeds[0]["relevance_score"] == 0.6

    def test_pool_wider_than_n_is_considered(self):
        from app.services.code_graph.retriever import CodeGraphRetriever
        retriever = CodeGraphRetriever()
        # Six schema classes outscore one function on raw relevance; the
        # function must still make the top-5 seeds after re-scoring.
        classes = [_hit(f"Schema{i}", "app/schemas/user.py", "class", 0.9)
                   for i in range(6)]
        semantic = {"classes": classes,
                    "functions": [_hit("login", "app/api/auth.py", "function", 0.5)]}
        seeds = retriever._seed_entities_from_semantic(semantic, 5)
        assert any(s["name"] == "login" for s in seeds)

    def test_descriptor_shape_unchanged(self):
        from app.services.code_graph.retriever import CodeGraphRetriever
        retriever = CodeGraphRetriever()
        semantic = {"functions": [_hit("f", "app/m.py", "function", 0.5,
                                       class_name="Svc")], "classes": []}
        seeds = retriever._seed_entities_from_semantic(semantic, 5)
        assert set(seeds[0].keys()) == {"name", "module_path", "class_name",
                                        "type", "relevance_score"}
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `backend-fastapi/`):
`venv312/Scripts/python.exe -m pytest tests/test_retriever_seed_and_context.py --no-cov -q`
Expected: FAIL / ERROR with `ImportError: cannot import name '_score_seed'` (the two TestSeedSelection ordering tests fail on ordering instead).

- [ ] **Step 3: Implement scoring and wire into seed selection**

In `backend-fastapi/app/services/code_graph/retriever.py`, below `GRAPH_SEED_COUNT = 5` add:

```python
# Seed-scoring priors. Eval evidence (spec 2026-07-07): for "how does X work"
# questions the embedding model ranks schema/exception classes above the
# entry-point function whose call/import neighbors answer the question, so
# traversal seeds from the wrong nodes. Discount those node types for seed
# ordering only -- semantic_results ordering is never touched.
SEED_TYPE_WEIGHTS = {"function": 1.0, "class": 0.7}
SEED_SCHEMA_PATH_PENALTY = 0.3   # Pydantic request/response models
SEED_EXCEPTION_PENALTY = 0.4     # *Error / *Exception names, exceptions modules


def _score_seed(metadata: Dict[str, Any], relevance_score: float) -> float:
    """Seed priority = semantic relevance discounted by how unlikely the
    node type is to have useful call/import neighbors."""
    score = relevance_score * SEED_TYPE_WEIGHTS.get(
        metadata.get("type"), SEED_TYPE_WEIGHTS["class"])
    module_path = (metadata.get("module_path") or "").replace("\\", "/")
    name = metadata.get("name") or ""
    if "app/schemas/" in module_path:
        score *= SEED_SCHEMA_PATH_PENALTY
    if name.endswith(("Error", "Exception")) or "exceptions" in module_path:
        score *= SEED_EXCEPTION_PENALTY
    return score
```

In `_seed_entities_from_semantic`, replace the sort line

```python
        chunks.sort(key=lambda c: c.get("relevance_score", 0), reverse=True)
```

with

```python
        chunks.sort(
            key=lambda c: _score_seed(c.get("metadata") or {},
                                      c.get("relevance_score", 0)),
            reverse=True,
        )
```

and update the method docstring to:

```python
        """Pick the top-n graph-traversal seeds from all semantic hits.

        Ordering uses _score_seed (relevance discounted by node-type priors);
        the semantic_results payload itself is never reordered. Descriptors
        keep the raw relevance_score (Neo4j ranking contract)."""
```

- [ ] **Step 4: Run tests to verify they pass**

Run (from `backend-fastapi/`):
`venv312/Scripts/python.exe -m pytest tests/test_retriever_seed_and_context.py --no-cov -q`
Expected: all PASS.

- [ ] **Step 5: Full suite + lint**

Run (from `backend-fastapi/`):
`venv312/Scripts/python.exe -m pytest --no-cov -q` -- expected: all pass (existing `test_retriever_parallel.py` seeds still come from top hits, unaffected by re-scoring of single-hit fixtures).
`venv312/Scripts/python.exe -m ruff check app tests` -- expected: `All checks passed!`

- [ ] **Step 6: Commit**

```bash
git add backend-fastapi/app/services/code_graph/retriever.py backend-fastapi/tests/test_retriever_seed_and_context.py
git commit -m "feat(graph): type-aware seed scoring for graph traversal

Seeds are now ordered by relevance discounted with node-type priors
(function 1.0 / class 0.7, app/schemas/ x0.3, exception-like x0.4)
instead of raw semantic score, so schema and exception classes no longer
crowd out the entry-point functions whose neighbors answer the question.
semantic_results ordering is untouched, keeping eval deltas attributable
to the seed change alone."
```

---

### Task 2: Eval run A -- measure the seed-scoring delta

**Files:**
- No code changes. Produces two new files under `evals/results/` (timestamps assigned at run time).

**Interfaces:**
- Consumes: Task 1 merged into the working tree; docker services healthy.
- Produces: retrieval-run JSON and generation-run JSON paths, recorded for Task 5's README update. Note both filenames in the task-completion report.

- [ ] **Step 1: Ensure services are up**

Run (repo root): `docker compose up -d && docker ps --format "{{.Names}}: {{.Status}}"`
Expected: mysql/neo4j/chromadb all `Up` (healthy).

- [ ] **Step 2: Re-index + retrieval-only run**

Run (repo root):
`backend-fastapi/venv312/Scripts/python.exe -m evals.run --golden evals/golden_set/backend_fastapi.jsonl --index-corpus backend-fastapi/app`
Expected: `Overall (n=50, errors=0)` table. Success criteria vs baseline `20260706T174408Z.json`: graph_neighbor_recall > 0.2867, graph_traversal_correctness > 0.24, hybrid_hit_rate@5 >= 0.64; hit_rate@5 and mrr within +/-0.02 of 0.64 / 0.5305 (they must NOT move materially -- if they do, semantic ordering leaked; stop and investigate `_seed_entities_from_semantic`).

- [ ] **Step 3: Generation run (uses the index from Step 2)**

Run (repo root):
`backend-fastapi/venv312/Scripts/python.exe -m evals.run --golden evals/golden_set/backend_fastapi.jsonl --with-generation`
Expected: generation aggregate printed; gen_errors 0. Record faithfulness / answer_relevance (attribution point between seed fix and context fix).

- [ ] **Step 4: Record the outputs**

`evals/results/*.json` is gitignored by design -- do NOT commit the files.
Record in the task-completion report: both JSON filenames, the full printed
overall table, and the generation aggregate. Task 5 writes these numbers
into the README.

---

### Task 3: Code bodies in combined context

**Files:**
- Modify: `backend-fastapi/app/services/code_graph/retriever.py` (`_build_combined_context`, ~line 139)
- Test: `backend-fastapi/tests/test_retriever_seed_and_context.py` (extend)

**Interfaces:**
- Consumes: `result` dict with `semantic_results` (chunks carry `document`) and `graph_context` (records `{"name", "module_path", "relation", "source"}`).
- Produces: `combined_context` string: up to `CONTEXT_SNIPPET_COUNT` blocks of `### name (module_path)` + fenced code, then the graph-relations section. Constants `CONTEXT_SNIPPET_COUNT = 5`, `CONTEXT_SNIPPET_MAX_CHARS = 1500`, `CONTEXT_TOTAL_MAX_CHARS = 8000`.

- [ ] **Step 1: Write the failing tests**

Append to `backend-fastapi/tests/test_retriever_seed_and_context.py`:

```python
class TestCombinedContextWithCode:
    def _result(self, functions=None, classes=None, graph=None):
        return {"semantic_results": {"functions": functions or [],
                                     "classes": classes or []},
                "graph_context": graph}

    def test_includes_code_body_and_header(self):
        from app.services.code_graph.retriever import CodeGraphRetriever
        r = CodeGraphRetriever()
        ctx = r._build_combined_context(self._result(
            functions=[_hit("register", "app/api/auth.py", "function", 0.9,
                            document="async def register(data):\n    return await create_user(data)")]))
        assert "### register (app/api/auth.py)" in ctx
        assert "async def register(data):" in ctx

    def test_snippet_truncated_with_marker(self):
        from app.services.code_graph.retriever import (
            CodeGraphRetriever, CONTEXT_SNIPPET_MAX_CHARS)
        r = CodeGraphRetriever()
        long_doc = "x" * (CONTEXT_SNIPPET_MAX_CHARS + 500)
        ctx = r._build_combined_context(self._result(
            functions=[_hit("f", "app/m.py", "function", 0.9, document=long_doc)]))
        assert "[truncated]" in ctx
        assert "x" * (CONTEXT_SNIPPET_MAX_CHARS + 1) not in ctx

    def test_total_budget_enforced(self):
        from app.services.code_graph.retriever import (
            CodeGraphRetriever, CONTEXT_TOTAL_MAX_CHARS)
        r = CodeGraphRetriever()
        hits = [_hit(f"f{i}", "app/m.py", "function", 0.9 - i * 0.01,
                     document="y" * 3000) for i in range(8)]
        ctx = r._build_combined_context(self._result(functions=hits))
        assert len(ctx) <= CONTEXT_TOTAL_MAX_CHARS + 200  # graph/header slack

    def test_top_five_by_relevance_deduped(self):
        from app.services.code_graph.retriever import CodeGraphRetriever
        r = CodeGraphRetriever()
        dup = _hit("f0", "app/m.py", "function", 0.95, document="body0")
        hits = [dup, dup] + [_hit(f"f{i}", "app/m.py", "function", 0.9 - i * 0.1,
                                  document=f"body{i}") for i in range(1, 7)]
        ctx = r._build_combined_context(self._result(functions=hits))
        assert ctx.count("### f0 ") == 1
        assert "### f5 " not in ctx  # only 5 snippets total

    def test_graph_section_preserved_after_snippets(self):
        from app.services.code_graph.retriever import CodeGraphRetriever
        r = CodeGraphRetriever()
        ctx = r._build_combined_context(self._result(
            functions=[_hit("f", "app/m.py", "function", 0.9, document="body")],
            graph=[{"name": "Helper", "module_path": "app/h.py",
                    "relation": "import", "source": "f"}]))
        assert "Helper" in ctx and "[import]" in ctx
        assert ctx.index("body") < ctx.index("Helper")

    def test_missing_document_falls_back_to_header_only(self):
        from app.services.code_graph.retriever import CodeGraphRetriever
        r = CodeGraphRetriever()
        ctx = r._build_combined_context(self._result(
            functions=[_hit("f", "app/m.py", "function", 0.9)]))
        assert "### f (app/m.py)" in ctx
        assert "```" not in ctx
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `backend-fastapi/`):
`venv312/Scripts/python.exe -m pytest tests/test_retriever_seed_and_context.py::TestCombinedContextWithCode --no-cov -q`
Expected: FAIL (ImportError for `CONTEXT_SNIPPET_MAX_CHARS`; header assertions fail against the name-list format).

- [ ] **Step 3: Implement the new context builder**

In `retriever.py`, next to the seed constants add:

```python
CONTEXT_SNIPPET_COUNT = 5        # code snippets included in combined_context
CONTEXT_SNIPPET_MAX_CHARS = 1500
CONTEXT_TOTAL_MAX_CHARS = 8000   # hard cap on the snippet section
```

Replace the body of `_build_combined_context` with:

```python
    def _build_combined_context(self, result: Dict[str, Any]) -> str:
        """Build the generation context: top-hit code snippets, then graph
        relations. Eval evidence (spec 2026-07-07): names alone made the
        generator refuse "how does X work" questions; the document field the
        retrieval layer already returns is what answers them."""
        parts = []

        semantic = result.get("semantic_results") or {}
        chunks = []
        if isinstance(semantic, dict):
            for lst in semantic.values():
                if isinstance(lst, list):
                    chunks.extend(c for c in lst if isinstance(c, dict))
        chunks.sort(key=lambda c: c.get("relevance_score", 0), reverse=True)

        seen = set()
        total = 0
        for chunk in chunks:
            if len(seen) >= CONTEXT_SNIPPET_COUNT:
                break
            md = chunk.get("metadata") or {}
            name = md.get("name")
            key = (name, md.get("module_path"))
            if not name or key in seen:
                continue
            header = f"### {name} ({md.get('module_path') or ''})"
            doc = (chunk.get("document") or "").strip()
            if doc:
                budget = min(CONTEXT_SNIPPET_MAX_CHARS,
                             CONTEXT_TOTAL_MAX_CHARS - total)
                if budget <= 0:
                    break
                snippet = doc[:budget]
                if len(doc) > budget:
                    snippet += "\n... [truncated]"
                block = f"{header}\n```\n{snippet}\n```"
            else:
                block = header
            parts.append(block)
            seen.add(key)
            total += len(block)
            if total >= CONTEXT_TOTAL_MAX_CHARS:
                break

        graph_ctx = result.get("graph_context")
        if graph_ctx:
            lines = ["图谱关系:"]
            for ctx in graph_ctx[:10]:
                relation = ctx.get("relation", "related")
                module_path = ctx.get("module_path") or ""
                lines.append(
                    f"  - {ctx.get('name')} [{relation}] ({module_path})"
                )
            parts.append("\n".join(lines))

        return "\n\n".join(parts) if parts else ""
```

- [ ] **Step 4: Run new tests, full suite, lint**

Run (from `backend-fastapi/`):
`venv312/Scripts/python.exe -m pytest tests/test_retriever_seed_and_context.py --no-cov -q` -- expected: all PASS.
`venv312/Scripts/python.exe -m pytest --no-cov -q` -- expected: all pass. (Verified up front: the `相关函数` assertions in `test_code_graph_tools.py` exercise `tools.py`'s own formatter, not `_build_combined_context`; `test_returns_combined_context_string` only checks the graph name. No existing assertion depends on the old list format.)
`venv312/Scripts/python.exe -m ruff check app tests` -- expected: `All checks passed!`

- [ ] **Step 5: Commit**

```bash
git add backend-fastapi/app/services/code_graph/retriever.py backend-fastapi/tests/test_retriever_seed_and_context.py
git commit -m "feat(graph): include retrieved code bodies in combined_context

The generation context previously carried only symbol names, paths and
graph relations, so the generator (correctly) refused how-does-X-work
questions: answer_relevance 2.17 on feature_lookup with faithfulness 5.0.
ChromaDB hits already return the chunk text; the builder now emits up to
5 deduped snippets (1500 chars each, 8000 total) ahead of the preserved
graph-relations section."
```

---

### Task 4: Eval run B -- measure the context delta

**Files:**
- No code changes. Produces two new files under `evals/results/`.

**Interfaces:**
- Consumes: Task 3 merged; docker services healthy; index from Task 2 acceptable but re-index anyway (retriever.py itself is part of the corpus).
- Produces: retrieval-run and generation-run JSON paths for Task 5. Note both filenames in the task-completion report.

- [ ] **Step 1: Re-index + retrieval sanity run**

Run (repo root):
`backend-fastapi/venv312/Scripts/python.exe -m evals.run --golden evals/golden_set/backend_fastapi.jsonl --index-corpus backend-fastapi/app`
Expected: retrieval metrics within +/-0.02 of Task 2's run (combined_context does not feed retrieval metrics; movement means a bug).

- [ ] **Step 2: Generation run**

Run (repo root):
`backend-fastapi/venv312/Scripts/python.exe -m evals.run --golden evals/golden_set/backend_fastapi.jsonl --with-generation`
Expected: gen_errors 0. Success criteria: answer_relevance > Task 2's value (baseline direction: 3.66 overall, feature_lookup 2.17 -> up); faithfulness >= 4.5 (guard). If faithfulness < 4.5, per spec: raise `CONTEXT_SNIPPET_MAX_CHARS` to 2500, re-run this task, and note the change; do not merge below the guard.

- [ ] **Step 3: Record the outputs**

`evals/results/*.json` is gitignored by design -- do NOT commit the files.
Record in the task-completion report: both JSON filenames, the retrieval
table, and the generation aggregate (overall + by_category, especially
feature_lookup).

---

### Task 5: README Evaluation section update with both deltas

**Files:**
- Modify: `README.md` (Evaluation section: retrieval table, generation table, by-category table, narrative, Known limitations)

**Interfaces:**
- Consumes: the four result JSONs from Tasks 2 and 4 (aggregate keys: `overall.graph_neighbor_recall`, `overall.graph_traversal_correctness`, `overall.hybrid_hit_rate@5`, `generation.faithfulness`, `generation.answer_relevance`, `generation.by_category`).
- Produces: README that tells the three-step story (baseline -> seed heuristic -> code-body context) with real numbers.

- [ ] **Step 1: Extract the numbers**

Run (repo root, replace file names with the actual Task 2 / Task 4 outputs):
```bash
python -c "import json,io;d=json.load(io.open('evals/results/<RUN>.json',encoding='utf-8'));a=d['aggregate'];print({k:a['overall'][k] for k in ['hit_rate@5','hybrid_hit_rate@5','graph_neighbor_recall','graph_traversal_correctness','mrr']});print(a.get('generation',{}))"
```

- [ ] **Step 2: Update README**

In the Retrieval table add one column `After seed scoring (2026-07-07)` filled from Task 2's retrieval run for every existing metric row. Below the table, replace the sentence beginning `graph_neighbor_recall nearly tripled` so the narrative covers both steps, in this shape (numbers from the runs):

```
graph_neighbor_recall went 0.10 -> 0.29 with real traversal (2026-06-20), then -> <A> once seeds were re-scored with node-type priors (2026-07-07); graph_traversal_correctness 0.08 -> 0.24 -> <B>. hybrid_hit_rate@5 <moved above plain hit_rate@5 for the first time: 0.64 -> <C> | stayed at 0.64>, ...
```

In the Generation section update the table to Task 4's run and state the attribution explicitly: seed scoring alone moved answer_relevance 3.66 -> <Task 2 gen value>; adding code bodies moved it -> <Task 4 gen value> (and per-category feature_lookup 2.17 -> <value>). Update the by-category table's generation columns from Task 4's `generation.by_category`.

In **Known limitations**, rewrite the *Seeding dominates the graph-neighbor ceiling* bullet to past tense with the measured delta, and state what remains (e.g. instantiation/usage edges still unmodeled; reranking still open if hit_rate@5 is unchanged).

- [ ] **Step 3: Self-check and commit**

Every number in the edited section must trace to a named JSON in `evals/results/`. No emojis, ASCII only.

```bash
git add README.md
git commit -m "docs(readme): seed-scoring and code-body context eval deltas"
```
