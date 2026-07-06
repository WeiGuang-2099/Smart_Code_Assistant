# Retrieval Seed Heuristic + Generation Context Code Bodies

Date: 2026-07-07
Status: approved (user, 2026-07-07)
Branch: `feat/seed-heuristic-and-context` (based on `feat/embedding-provider`)

## Problem

Two independently measured gaps, both localized by the eval harness (baseline
re-verified 2026-07-06, `evals/results/20260706T174408Z.json`):

1. **Graph traversal seeds from the wrong nodes.**
   `CodeGraphRetriever._seed_entities_from_semantic` picks the top-5 semantic
   hits by `relevance_score` with no type awareness. For "how does X work"
   questions the embedding model often ranks schema/exception classes
   (`UserRegister`, `TokenVersionManager`) above the endpoint or service
   function whose call/import neighbors actually answer the question.
   Hand-verified: seeding `register` directly yields its `get_password_hash` /
   `create_token_pair` neighbors at recall ~1.0.
   Baseline: graph_neighbor_recall 0.2867, graph_traversal_correctness 0.24,
   hybrid_hit_rate@5 0.64 (identical to plain hit_rate@5 at every k -- the
   graph branch has never rescued a semantic miss).

2. **The generation context contains no code.**
   `_build_combined_context` emits only symbol names, file paths, and graph
   relations. ChromaDB hits already carry the chunk text in `document`, but
   the builder drops it. GLM-5.2 correctly answers "context is insufficient"
   (faithfulness stays 5.0), and the judge scores the refusal low on
   relevance. Baseline: answer_relevance 3.66 overall, feature_lookup 2.17.

## Goals and metric targets

| Change | Targets | Explicitly NOT expected to move |
|---|---|---|
| A. Type-aware seed scoring | graph_neighbor_recall (0.2867), graph_traversal_correctness (0.24), hybrid_hit_rate@k (0.64 @5) | hit_rate/recall/precision/mrr (semantic ranking untouched by design, so the delta is attributable) |
| B. Code bodies in combined_context | answer_relevance (3.66 overall, 2.17 feature_lookup) | faithfulness acts as a guard: must not drop materially below 4.76 |

Non-goals this round: cross-encoder reranking (only if A's delta is
insufficient), BM25 hybrid search, instantiation/usage edges in the graph,
MCP server (separate task).

## Design

### Change A: type-aware seed scoring (`retriever.py`)

New module-level pure function:

```
def _score_seed(metadata: dict, relevance_score: float) -> float:
    return relevance_score * TYPE_WEIGHT * PATH_PENALTY
```

- `SEED_TYPE_WEIGHTS`: `function` 1.0, `class` 0.7 (classes remain eligible,
  functions win ties).
- `SEED_PATH_PENALTIES`: `module_path` under `app/schemas/` -> x0.3
  (Pydantic request/response models are poor traversal seeds); entity name
  ending in `Error`/`Exception` or `module_path` containing `exceptions`
  -> x0.4.
- Constants live at module top next to `GRAPH_SEED_COUNT`, with a comment
  explaining the eval evidence.
- `_seed_entities_from_semantic` re-scores the full candidate pool (all
  returned hits, up to 2 x top_k) and picks the top `GRAPH_SEED_COUNT` by
  seed score. The `semantic_results` payload and its ordering are NOT
  touched.
- Target case: for the register question, `register` (function,
  `app/api/auth.py`) must outscore `UserRegister` (class,
  `app/schemas/user.py`).

### Change B: code bodies in combined context (`retriever.py`)

`_build_combined_context` changes:

- For the merged, deduped (by `name` + `module_path`) top
  `CONTEXT_SNIPPET_COUNT` (5) hits across functions/classes, ranked by
  `relevance_score`: emit `### {name} ({module_path})` followed by a fenced
  code block containing `document` truncated to `CONTEXT_SNIPPET_MAX_CHARS`
  (1500). When `CONTEXT_TOTAL_MAX_CHARS` (8000) would be exceeded, the
  current snippet is truncated to the remaining budget and iteration stops.
- The existing graph-relations section is preserved after the code blocks.
- The name-only lists are removed (names now appear in snippet headers).
- Affects the production agent/chat path as well as evals -- intended; the
  same gap exists in the product. Prompt growth is bounded by the total cap.
- Truncation is plain character slicing with a `\n... [truncated]` marker;
  token-aware budgeting is out of scope (YAGNI until evals show a need).

## Eval protocol (one change, one delta)

1. Land A -> retrieval-only run (free, deterministic) + one generation run
   (GLM-5.2 generator / GLM-5.1 judge, ~150 calls). Record deltas.
2. Land B -> one generation run. Record delta vs step 1.
3. Update README Evaluation section with both deltas (existing task #4).

All runs: `python -m evals.run --golden evals/golden_set/backend_fastapi.jsonl`
(with `--index-corpus backend-fastapi/app` after code changes, since the
corpus is this repo's own source), venv312, live Neo4j + ChromaDB via
`docker compose up -d`.

## Testing (TDD)

- `_score_seed`: schema class demoted below function at equal relevance;
  exception penalty; plain class keeps 0.7 weight; missing metadata fields
  default sanely.
- `_seed_entities_from_semantic`: register-vs-UserRegister ordering; pool
  wider than top-5 considered; output descriptor shape unchanged
  (name/module_path/class_name/type/relevance_score keys -- Neo4j client
  contract).
- `_build_combined_context`: snippets present with headers; per-snippet and
  total caps enforced; dedup across functions/classes; graph section
  preserved; empty/missing `document` falls back to header-only entry.
- Existing suites must stay green (`test_retriever_parallel.py` asserts on
  retrieve() shape and may assert on context format -- update alongside).
- Ruff on changed files; full `pytest --no-cov` before each eval run.

## Risks

- Heuristic overfit to the golden set: weights are two round numbers and one
  path rule, derived from a failure mode (schema-over-function), not tuned
  per-case. Acceptable; documented in README limitations if the delta lands.
- Bigger production prompts (B): bounded by 8000-char cap, roughly ~2k
  tokens -- well within GLM-5.2 context.
- faithfulness could dip if snippets are truncated mid-logic and the model
  extrapolates: the guard metric catches this; if it drops below ~4.5 the
  truncation length gets revisited before merging.
