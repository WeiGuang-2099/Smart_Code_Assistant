# Code-Graph MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the existing GraphRAG code-graph engine as six MCP tools over stdio so any MCP client (Claude Code, Claude Desktop) can query it directly.

**Architecture:** A new `backend-fastapi/app/mcp/` package. `tools.py` holds six transport-agnostic async functions that wrap the existing service layer (`CodeGraphRetriever`, `Neo4jClient`) and return clean labelled plain-text strings. `server.py` builds a `FastMCP` instance, registers those functions, and manages the Neo4j connection via a lifespan, running over stdio.

**Tech Stack:** Python 3.12, official `mcp` SDK (`mcp.server.fastmcp.FastMCP`), existing async Neo4j/ChromaDB service layer, pytest + pytest-asyncio (`asyncio_mode = auto`), unittest.mock.

## Global Constraints

- No emojis anywhere — tool output is labelled plain text (user global rule).
- No Co-Authored-By / AI attribution in any commit message (user global rule).
- Dependency: official `mcp` SDK, floor `mcp>=1.9.0`, added to BOTH `backend-fastapi/requirements.txt` and `backend-fastapi/requirements-ci.txt`.
- stdout is reserved for the MCP protocol: all logging goes to stderr; no `print` in `app/mcp/*`.
- Tests are offline/mocked (no Docker, no live DB); `pytest asyncio_mode = auto` (no `@pytest.mark.asyncio` decorator needed); mock with `unittest.mock.AsyncMock` / `patch`.
- Reuse the existing services; do not duplicate retrieval or Cypher logic that already exists (the one new query is `Neo4jClient.get_entity`, Task 2).
- Package location: `backend-fastapi/app/mcp/`.
- Every tool takes an optional `project_id: int = 1`; on any exception returns `Error: <reason>`; on an empty result returns a friendly sentence (never an empty string, never a stack trace).
- All commands below run from the `backend-fastapi/` directory using the project venv `./venv312/Scripts/python.exe`.

---

## File Structure

- `backend-fastapi/app/mcp/__init__.py` — package marker (empty).
- `backend-fastapi/app/mcp/tools.py` — six async tool functions + two private formatting helpers. Transport-agnostic core.
- `backend-fastapi/app/mcp/server.py` — FastMCP instance, lifespan, tool registration, `python -m app.mcp.server` entry point.
- `backend-fastapi/app/services/code_graph/neo4j_client.py` — add one method `get_entity` (exact-name resolver).
- `backend-fastapi/tests/test_mcp_tools.py` — unit tests for helpers + six tools (mocked).
- `backend-fastapi/tests/test_neo4j_get_entity.py` — unit tests for `get_entity` (mocked).
- `backend-fastapi/tests/test_mcp_server.py` — registration smoke test.
- `backend-fastapi/requirements.txt`, `backend-fastapi/requirements-ci.txt` — add `mcp>=1.9.0`.
- `README.md` — new `## MCP Server` section.

---

## Task 1: Dependency + package + formatting helpers

**Files:**
- Create: `backend-fastapi/app/mcp/__init__.py`
- Create: `backend-fastapi/app/mcp/tools.py`
- Modify: `backend-fastapi/requirements.txt` (add `mcp>=1.9.0`)
- Modify: `backend-fastapi/requirements-ci.txt` (add `mcp>=1.9.0`)
- Test: `backend-fastapi/tests/test_mcp_tools.py`

**Interfaces:**
- Produces: `_format_entity_list(entities: list[dict], name_key: str = "name", path_key: str = "module_path") -> str` and `_truncate_docstring(text: str, max_chars: int = 500) -> str` in `app.mcp.tools`, plus module-level constant `DOCSTRING_MAX_CHARS = 500`. Tasks 3-4 add the six tools to this same module.

- [ ] **Step 1: Install the dependency into the venv**

Run:
```bash
./venv312/Scripts/python.exe -m pip install "mcp>=1.9.0"
```
Expected: installs `mcp` (latest, currently 1.28.x) and its deps.

- [ ] **Step 2: Add `mcp` to both requirements files**

Append this line to `backend-fastapi/requirements.txt` and to `backend-fastapi/requirements-ci.txt`:
```
mcp>=1.9.0
```

- [ ] **Step 3: Create the package marker**

Create `backend-fastapi/app/mcp/__init__.py` as an empty file.

- [ ] **Step 4: Write the failing test for the helpers**

Create `backend-fastapi/tests/test_mcp_tools.py`:
```python
"""Unit tests for the MCP tool layer (offline, mocked service calls)."""
from app.mcp.tools import _format_entity_list, _truncate_docstring


def test_format_entity_list_basic():
    entities = [{"name": "register", "module_path": "app/api/auth.py"}]
    assert _format_entity_list(entities) == "- register (app/api/auth.py)"


def test_format_entity_list_missing_keys_use_placeholder():
    assert _format_entity_list([{}]) == "- ? (?)"


def test_format_entity_list_multiple():
    entities = [
        {"name": "a", "module_path": "m1"},
        {"name": "b", "module_path": "m2"},
    ]
    assert _format_entity_list(entities) == "- a (m1)\n- b (m2)"


def test_truncate_docstring_short_unchanged():
    assert _truncate_docstring("hello") == "hello"


def test_truncate_docstring_empty_returns_empty():
    assert _truncate_docstring("") == ""


def test_truncate_docstring_long_gets_marker():
    result = _truncate_docstring("x" * 600, max_chars=500)
    assert result.endswith("... [truncated]")
    assert len(result) <= 500 + len(" ... [truncated]")
```

- [ ] **Step 5: Run the test to verify it fails**

Run:
```bash
./venv312/Scripts/python.exe -m pytest tests/test_mcp_tools.py -q --no-cov
```
Expected: FAIL with `ModuleNotFoundError: No module named 'app.mcp.tools'`.

- [ ] **Step 6: Implement the helpers**

Create `backend-fastapi/app/mcp/tools.py`:
```python
"""Transport-agnostic async tool functions for the code-graph MCP server.

Each function wraps the existing code-graph service layer and returns a clean,
labelled plain-text string (no emojis) suitable for an LLM client. A future
HTTP transport can bind the same functions unchanged.
"""
import logging

logger = logging.getLogger(__name__)

DOCSTRING_MAX_CHARS = 500


def _format_entity_list(
    entities: list[dict],
    name_key: str = "name",
    path_key: str = "module_path",
) -> str:
    """Render entity dicts as '- name (module_path)' lines, one per entity."""
    lines = []
    for entity in entities:
        name = entity.get(name_key) or "?"
        path = entity.get(path_key) or "?"
        lines.append(f"- {name} ({path})")
    return "\n".join(lines)


def _truncate_docstring(text: str, max_chars: int = DOCSTRING_MAX_CHARS) -> str:
    """Trim a docstring to max_chars, appending a marker when truncated."""
    if not text:
        return ""
    text = text.strip()
    if len(text) <= max_chars:
        return text
    return text[:max_chars].rstrip() + " ... [truncated]"
```

- [ ] **Step 7: Run the test to verify it passes**

Run:
```bash
./venv312/Scripts/python.exe -m pytest tests/test_mcp_tools.py -q --no-cov
```
Expected: PASS (6 passed).

- [ ] **Step 8: Lint**

Run:
```bash
./venv312/Scripts/python.exe -m ruff check app/mcp/ tests/test_mcp_tools.py
```
Expected: `All checks passed!`

- [ ] **Step 9: Commit**

```bash
git add app/mcp/__init__.py app/mcp/tools.py tests/test_mcp_tools.py requirements.txt requirements-ci.txt
git commit -m "chore(mcp): add mcp dependency and app/mcp package with formatting helpers"
```

---

## Task 2: Neo4j exact-name symbol resolver

**Files:**
- Modify: `backend-fastapi/app/services/code_graph/neo4j_client.py` (add `get_entity` method to `Neo4jClient`, after `search_entities`)
- Test: `backend-fastapi/tests/test_neo4j_get_entity.py`

**Interfaces:**
- Consumes: `Neo4jClient.execute_query(query, params) -> List[Dict[str, Any]]` (existing).
- Produces: `async Neo4jClient.get_entity(name: str, module_path: Optional[str] = None) -> Optional[Dict[str, Any]]` returning `{name, module_path, class_name, type, signature, docstring}` for the first exact-name Function/Class match (deterministic `ORDER BY e.module_path`), or `None`. `type` is `"class"` when the node's labels include `Class`, else `"function"`. Task 4's `explain_symbol` consumes this.

- [ ] **Step 1: Write the failing test**

Create `backend-fastapi/tests/test_neo4j_get_entity.py`:
```python
"""Unit tests for Neo4jClient.get_entity (offline, execute_query mocked)."""
from unittest.mock import AsyncMock

from app.services.code_graph.neo4j_client import Neo4jClient


async def test_get_entity_returns_function_metadata():
    client = Neo4jClient()
    client.execute_query = AsyncMock(return_value=[{
        "name": "register",
        "module_path": "app/api/auth.py",
        "class_name": None,
        "labels": ["Function"],
        "signature": "def register(data: UserRegister)",
        "docstring": "Register a user.",
    }])
    result = await client.get_entity("register")
    assert result["type"] == "function"
    assert result["name"] == "register"
    assert result["signature"] == "def register(data: UserRegister)"
    assert result["docstring"] == "Register a user."


async def test_get_entity_detects_class_from_labels():
    client = Neo4jClient()
    client.execute_query = AsyncMock(return_value=[{
        "name": "UserService",
        "module_path": "app/services/user.py",
        "class_name": None,
        "labels": ["Class"],
        "signature": None,
        "docstring": "User service.",
    }])
    result = await client.get_entity("UserService")
    assert result["type"] == "class"


async def test_get_entity_missing_returns_none():
    client = Neo4jClient()
    client.execute_query = AsyncMock(return_value=[])
    result = await client.get_entity("does_not_exist")
    assert result is None
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
./venv312/Scripts/python.exe -m pytest tests/test_neo4j_get_entity.py -q --no-cov
```
Expected: FAIL with `AttributeError: 'Neo4jClient' object has no attribute 'get_entity'`.

- [ ] **Step 3: Implement `get_entity`**

In `backend-fastapi/app/services/code_graph/neo4j_client.py`, add this method to the `Neo4jClient` class immediately after the `search_entities` method (around line 410):
```python
    async def get_entity(
        self,
        name: str,
        module_path: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Fetch a single Function/Class node's core metadata by exact name.

        Returns {name, module_path, class_name, type, signature, docstring}
        for the first match (deterministic ORDER BY module_path), or None if
        no Function/Class node has that exact name. ``type`` is "class" when
        the node carries the Class label, else "function".
        """
        if module_path:
            query = """
            MATCH (e)
            WHERE (e:Function OR e:Class)
              AND e.name = $name AND e.module_path = $module_path
            RETURN e.name AS name, e.module_path AS module_path,
                   e.class_name AS class_name, labels(e) AS labels,
                   e.signature AS signature, e.docstring AS docstring
            ORDER BY e.module_path
            LIMIT 1
            """
        else:
            query = """
            MATCH (e)
            WHERE (e:Function OR e:Class) AND e.name = $name
            RETURN e.name AS name, e.module_path AS module_path,
                   e.class_name AS class_name, labels(e) AS labels,
                   e.signature AS signature, e.docstring AS docstring
            ORDER BY e.module_path
            LIMIT 1
            """
        rows = await self.execute_query(
            query, {"name": name, "module_path": module_path}
        )
        if not rows:
            return None
        row = rows[0]
        labels = row.get("labels") or []
        entity_type = "class" if "Class" in labels else "function"
        return {
            "name": row.get("name"),
            "module_path": row.get("module_path"),
            "class_name": row.get("class_name"),
            "type": entity_type,
            "signature": row.get("signature"),
            "docstring": row.get("docstring"),
        }
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
./venv312/Scripts/python.exe -m pytest tests/test_neo4j_get_entity.py -q --no-cov
```
Expected: PASS (3 passed).

- [ ] **Step 5: Lint**

Run:
```bash
./venv312/Scripts/python.exe -m ruff check app/services/code_graph/neo4j_client.py tests/test_neo4j_get_entity.py
```
Expected: `All checks passed!`

- [ ] **Step 6: Commit**

```bash
git add app/services/code_graph/neo4j_client.py tests/test_neo4j_get_entity.py
git commit -m "feat(graph): add Neo4jClient.get_entity exact-name resolver"
```

---

## Task 3: Tools — search_codebase, find_callers, find_callees

**Files:**
- Modify: `backend-fastapi/app/mcp/tools.py` (add service imports + three tool functions)
- Test: `backend-fastapi/tests/test_mcp_tools.py` (extend)

**Interfaces:**
- Consumes: `get_retriever() -> CodeGraphRetriever` and `CodeGraphRetriever.retrieve(query, project_id, top_k) -> dict` with a `"combined_context"` str key (existing); `get_neo4j_client() -> Neo4jClient` (async, existing) and `Neo4jClient.get_function_callers(function_name, module_path) -> list[dict]`, `Neo4jClient.get_function_callees(function_name, module_path) -> list[dict]` (each dict has `name`, `module_path`); `_format_entity_list` (Task 1).
- Produces: `async search_codebase(query, top_k=5, project_id=1) -> str`, `async find_callers(function_name, module_path=None, project_id=1) -> str`, `async find_callees(function_name, module_path=None, project_id=1) -> str`. Task 5 registers these on the FastMCP instance.

- [ ] **Step 1: Write the failing tests**

Append to `backend-fastapi/tests/test_mcp_tools.py`:
```python
from unittest.mock import AsyncMock, MagicMock, patch

import app.mcp.tools as tools


async def test_search_codebase_returns_combined_context():
    retriever = MagicMock()
    retriever.retrieve = AsyncMock(
        return_value={"combined_context": "### register\ncode"}
    )
    with patch.object(tools, "get_retriever", return_value=retriever):
        out = await tools.search_codebase("how does register work")
    assert "### register" in out


async def test_search_codebase_empty_returns_no_matches():
    retriever = MagicMock()
    retriever.retrieve = AsyncMock(return_value={"combined_context": ""})
    with patch.object(tools, "get_retriever", return_value=retriever):
        out = await tools.search_codebase("nothing here")
    assert out == 'No matches for "nothing here".'


async def test_search_codebase_error_returns_clean_line():
    retriever = MagicMock()
    retriever.retrieve = AsyncMock(side_effect=RuntimeError("neo4j down"))
    with patch.object(tools, "get_retriever", return_value=retriever):
        out = await tools.search_codebase("q")
    assert out.startswith("Error:")


async def test_find_callers_formats_list():
    neo4j = MagicMock()
    neo4j.get_function_callers = AsyncMock(
        return_value=[{"name": "handler", "module_path": "app/api/auth.py"}]
    )
    with patch.object(tools, "get_neo4j_client", AsyncMock(return_value=neo4j)):
        out = await tools.find_callers("register")
    assert "Callers of register (1):" in out
    assert "- handler (app/api/auth.py)" in out


async def test_find_callers_empty_returns_sentence():
    neo4j = MagicMock()
    neo4j.get_function_callers = AsyncMock(return_value=[])
    with patch.object(tools, "get_neo4j_client", AsyncMock(return_value=neo4j)):
        out = await tools.find_callers("register")
    assert out == "No callers found for register."


async def test_find_callees_formats_list():
    neo4j = MagicMock()
    neo4j.get_function_callees = AsyncMock(
        return_value=[{"name": "get_password_hash", "module_path": "app/core/security.py"}]
    )
    with patch.object(tools, "get_neo4j_client", AsyncMock(return_value=neo4j)):
        out = await tools.find_callees("register")
    assert "Callees of register (1):" in out
    assert "- get_password_hash (app/core/security.py)" in out


async def test_find_callees_empty_returns_sentence():
    neo4j = MagicMock()
    neo4j.get_function_callees = AsyncMock(return_value=[])
    with patch.object(tools, "get_neo4j_client", AsyncMock(return_value=neo4j)):
        out = await tools.find_callees("register")
    assert out == "No callees found for register."
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
./venv312/Scripts/python.exe -m pytest tests/test_mcp_tools.py -q --no-cov -k "search_codebase or find_call"
```
Expected: FAIL with `AttributeError: module 'app.mcp.tools' has no attribute 'search_codebase'`.

- [ ] **Step 3: Add the service imports**

In `backend-fastapi/app/mcp/tools.py`, add these imports directly below `import logging`:
```python
from app.services.code_graph.neo4j_client import get_neo4j_client
from app.services.code_graph.retriever import get_retriever
```

- [ ] **Step 4: Implement the three tools**

Append to `backend-fastapi/app/mcp/tools.py`:
```python
async def search_codebase(query: str, top_k: int = 5, project_id: int = 1) -> str:
    """Hybrid semantic + graph search over the indexed codebase.

    Args:
        query: Natural-language or code question.
        top_k: Number of top semantic hits to seed context (default 5).
        project_id: Indexed project id (default 1).
    """
    try:
        retriever = get_retriever()
        result = await retriever.retrieve(query, project_id=project_id, top_k=top_k)
        context = (result.get("combined_context") or "").strip()
        if not context:
            return f'No matches for "{query}".'
        return context
    except Exception as exc:  # noqa: BLE001 - surfaced to the client as one line
        logger.error("search_codebase failed: %s", exc)
        return f"Error: {exc}"


async def find_callers(
    function_name: str, module_path: str | None = None, project_id: int = 1
) -> str:
    """List functions that call the given function.

    Args:
        function_name: Target function name.
        module_path: Optional module path to disambiguate.
        project_id: Indexed project id (default 1).
    """
    try:
        neo4j = await get_neo4j_client()
        callers = await neo4j.get_function_callers(function_name, module_path)
        if not callers:
            return f"No callers found for {function_name}."
        return f"Callers of {function_name} ({len(callers)}):\n" + _format_entity_list(callers)
    except Exception as exc:  # noqa: BLE001
        logger.error("find_callers failed: %s", exc)
        return f"Error: {exc}"


async def find_callees(
    function_name: str, module_path: str | None = None, project_id: int = 1
) -> str:
    """List functions that the given function calls.

    Args:
        function_name: Source function name.
        module_path: Optional module path to disambiguate.
        project_id: Indexed project id (default 1).
    """
    try:
        neo4j = await get_neo4j_client()
        callees = await neo4j.get_function_callees(function_name, module_path)
        if not callees:
            return f"No callees found for {function_name}."
        return f"Callees of {function_name} ({len(callees)}):\n" + _format_entity_list(callees)
    except Exception as exc:  # noqa: BLE001
        logger.error("find_callees failed: %s", exc)
        return f"Error: {exc}"
```

- [ ] **Step 5: Run the tests to verify they pass**

Run:
```bash
./venv312/Scripts/python.exe -m pytest tests/test_mcp_tools.py -q --no-cov
```
Expected: PASS (13 passed: 6 helper + 7 tool).

- [ ] **Step 6: Lint**

Run:
```bash
./venv312/Scripts/python.exe -m ruff check app/mcp/tools.py tests/test_mcp_tools.py
```
Expected: `All checks passed!`

- [ ] **Step 7: Commit**

```bash
git add app/mcp/tools.py tests/test_mcp_tools.py
git commit -m "feat(mcp): search_codebase, find_callers, find_callees tools"
```

---

## Task 4: Tools — impact_analysis, find_call_path, explain_symbol

**Files:**
- Modify: `backend-fastapi/app/mcp/tools.py` (add three tool functions)
- Test: `backend-fastapi/tests/test_mcp_tools.py` (extend)

**Interfaces:**
- Consumes: `CodeGraphRetriever.analyze_impact(entity_name, entity_type, max_depth) -> dict` with `"impacted"` (list of `{name, module_path}`) and `"total_count"` keys; `CodeGraphRetriever.find_paths(source, target, max_depth) -> list[list[dict]]` (each inner list is a path of nodes with a `name` key); `Neo4jClient.get_entity(name, module_path) -> Optional[dict]` (Task 2); `Neo4jClient.get_entity_neighbors(seeds, max_depth) -> list[dict]` (each `{name, module_path, relation, source}`, existing); `_format_entity_list`, `_truncate_docstring`, `get_retriever`, `get_neo4j_client` (Tasks 1/3).
- Produces: `async impact_analysis(entity_name, entity_type="function", max_depth=3, project_id=1) -> str`, `async find_call_path(source, target, max_depth=5, project_id=1) -> str`, `async explain_symbol(name, module_path=None, project_id=1) -> str`.

- [ ] **Step 1: Write the failing tests**

Append to `backend-fastapi/tests/test_mcp_tools.py`:
```python
async def test_impact_analysis_lists_affected():
    retriever = MagicMock()
    retriever.analyze_impact = AsyncMock(return_value={
        "impacted": [{"name": "login", "module_path": "app/api/auth.py"}],
        "total_count": 1,
    })
    with patch.object(tools, "get_retriever", return_value=retriever):
        out = await tools.impact_analysis("get_password_hash")
    assert "Impact of changing get_password_hash - 1 affected:" in out
    assert "- login (app/api/auth.py)" in out


async def test_impact_analysis_empty_returns_sentence():
    retriever = MagicMock()
    retriever.analyze_impact = AsyncMock(
        return_value={"impacted": [], "total_count": 0}
    )
    with patch.object(tools, "get_retriever", return_value=retriever):
        out = await tools.impact_analysis("x")
    assert out == "No downstream impact found for x."


async def test_find_call_path_numbers_paths():
    retriever = MagicMock()
    retriever.find_paths = AsyncMock(return_value=[
        [{"name": "register"}, {"name": "get_password_hash"}],
    ])
    with patch.object(tools, "get_retriever", return_value=retriever):
        out = await tools.find_call_path("register", "get_password_hash")
    assert "1. register -> get_password_hash" in out


async def test_find_call_path_empty_returns_sentence():
    retriever = MagicMock()
    retriever.find_paths = AsyncMock(return_value=[])
    with patch.object(tools, "get_retriever", return_value=retriever):
        out = await tools.find_call_path("a", "b", max_depth=5)
    assert out == "No call path from a to b within depth 5."


async def test_explain_symbol_composes_signature_and_neighbors():
    neo4j = MagicMock()
    neo4j.get_entity = AsyncMock(return_value={
        "name": "register", "module_path": "app/api/auth.py", "class_name": None,
        "type": "function", "signature": "def register(data)", "docstring": "Reg.",
    })
    neo4j.get_entity_neighbors = AsyncMock(return_value=[{
        "name": "get_password_hash", "module_path": "app/core/security.py",
        "relation": "callee", "source": "register",
    }])
    with patch.object(tools, "get_neo4j_client", AsyncMock(return_value=neo4j)):
        out = await tools.explain_symbol("register")
    assert "function register (app/api/auth.py)" in out
    assert "def register(data)" in out
    assert "Related:" in out
    assert "- callee: get_password_hash (app/core/security.py)" in out


async def test_explain_symbol_not_found_returns_sentence():
    neo4j = MagicMock()
    neo4j.get_entity = AsyncMock(return_value=None)
    with patch.object(tools, "get_neo4j_client", AsyncMock(return_value=neo4j)):
        out = await tools.explain_symbol("does_not_exist")
    assert out == "Symbol does_not_exist not found in the code graph."
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
./venv312/Scripts/python.exe -m pytest tests/test_mcp_tools.py -q --no-cov -k "impact or call_path or explain_symbol"
```
Expected: FAIL with `AttributeError: module 'app.mcp.tools' has no attribute 'impact_analysis'`.

- [ ] **Step 3: Implement the three tools**

Append to `backend-fastapi/app/mcp/tools.py`:
```python
async def impact_analysis(
    entity_name: str,
    entity_type: str = "function",
    max_depth: int = 3,
    project_id: int = 1,
) -> str:
    """Report the blast radius of changing a function or class.

    Args:
        entity_name: The symbol being changed.
        entity_type: "function" or "class" (default "function").
        max_depth: Traversal depth for downstream dependents (default 3).
        project_id: Indexed project id (default 1).
    """
    try:
        retriever = get_retriever()
        result = await retriever.analyze_impact(entity_name, entity_type, max_depth)
        impacted = result.get("impacted") or []
        total = result.get("total_count", len(impacted))
        if not impacted:
            return f"No downstream impact found for {entity_name}."
        return (
            f"Impact of changing {entity_name} - {total} affected:\n"
            + _format_entity_list(impacted)
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("impact_analysis failed: %s", exc)
        return f"Error: {exc}"


async def find_call_path(
    source: str, target: str, max_depth: int = 5, project_id: int = 1
) -> str:
    """Show call paths from a source function to a target function.

    Args:
        source: Starting function name.
        target: Destination function name.
        max_depth: Maximum call-chain length to search (default 5).
        project_id: Indexed project id (default 1).
    """
    try:
        retriever = get_retriever()
        paths = await retriever.find_paths(source, target, max_depth)
        if not paths:
            return f"No call path from {source} to {target} within depth {max_depth}."
        lines = []
        for index, path in enumerate(paths, start=1):
            chain = " -> ".join((node.get("name") or "?") for node in path)
            lines.append(f"{index}. {chain}")
        return f"Call paths from {source} to {target}:\n" + "\n".join(lines)
    except Exception as exc:  # noqa: BLE001
        logger.error("find_call_path failed: %s", exc)
        return f"Error: {exc}"


async def explain_symbol(
    name: str, module_path: str | None = None, project_id: int = 1
) -> str:
    """Summarize a symbol: its signature, docstring, and graph neighbors.

    Args:
        name: Function or class name.
        module_path: Optional module path to disambiguate.
        project_id: Indexed project id (default 1).
    """
    try:
        neo4j = await get_neo4j_client()
        entity = await neo4j.get_entity(name, module_path)
        if entity is None:
            return f"Symbol {name} not found in the code graph."
        seed = {
            "name": entity["name"],
            "module_path": entity["module_path"],
            "class_name": entity.get("class_name"),
            "type": entity["type"],
            "relevance_score": 1.0,
        }
        neighbors = await neo4j.get_entity_neighbors([seed], max_depth=2)
        lines = [f"{entity['type']} {entity['name']} ({entity['module_path']})"]
        if entity.get("signature"):
            lines.append(entity["signature"])
        docstring = _truncate_docstring(entity.get("docstring") or "")
        if docstring:
            lines.append(docstring)
        if neighbors:
            lines.append("Related:")
            for neighbor in neighbors:
                lines.append(
                    f"- {neighbor.get('relation')}: {neighbor.get('name')} "
                    f"({neighbor.get('module_path')})"
                )
        return "\n".join(lines)
    except Exception as exc:  # noqa: BLE001
        logger.error("explain_symbol failed: %s", exc)
        return f"Error: {exc}"
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
./venv312/Scripts/python.exe -m pytest tests/test_mcp_tools.py -q --no-cov
```
Expected: PASS (19 passed).

- [ ] **Step 5: Lint**

Run:
```bash
./venv312/Scripts/python.exe -m ruff check app/mcp/tools.py tests/test_mcp_tools.py
```
Expected: `All checks passed!`

- [ ] **Step 6: Commit**

```bash
git add app/mcp/tools.py tests/test_mcp_tools.py
git commit -m "feat(mcp): impact_analysis, find_call_path, explain_symbol tools"
```

---

## Task 5: FastMCP stdio server + README section

**Files:**
- Create: `backend-fastapi/app/mcp/server.py`
- Modify: `README.md` (add `## MCP Server` section before `## Configuration`)
- Test: `backend-fastapi/tests/test_mcp_server.py`

**Interfaces:**
- Consumes: the six tool functions from `app.mcp.tools` (Tasks 3-4); `get_neo4j_client`, `close_neo4j_client` from `app.services.code_graph.neo4j_client`; `close_chromadb_client` from `app.services.code_graph.chromadb_client` (all existing).
- Produces: module-level `mcp: FastMCP` in `app.mcp.server` with the six tools registered, and `main()` running stdio transport. `python -m app.mcp.server` is the entry point.

- [ ] **Step 1: Write the failing registration test**

Create `backend-fastapi/tests/test_mcp_server.py`:
```python
"""Registration smoke test for the FastMCP server (offline, no transport)."""


async def test_all_six_tools_registered():
    from app.mcp.server import mcp

    registered = await mcp.list_tools()
    names = {tool.name for tool in registered}
    assert names == {
        "search_codebase",
        "find_callers",
        "find_callees",
        "impact_analysis",
        "find_call_path",
        "explain_symbol",
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
./venv312/Scripts/python.exe -m pytest tests/test_mcp_server.py -q --no-cov
```
Expected: FAIL with `ModuleNotFoundError: No module named 'app.mcp.server'`.

- [ ] **Step 3: Implement the server**

Create `backend-fastapi/app/mcp/server.py`:
```python
"""FastMCP server exposing the code-graph tools over stdio.

Run:  python -m app.mcp.server

stdout is reserved for the MCP protocol; all logging goes to stderr.
"""
import logging
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from mcp.server.fastmcp import FastMCP

from app.mcp import tools
from app.services.code_graph.chromadb_client import close_chromadb_client
from app.services.code_graph.neo4j_client import close_neo4j_client, get_neo4j_client

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(server: FastMCP) -> AsyncIterator[None]:
    """Warm the Neo4j driver on startup; close all clients on shutdown."""
    try:
        await get_neo4j_client()
    except Exception as exc:  # noqa: BLE001 - warmup is best-effort; tools retry lazily
        logger.warning("Neo4j warmup failed (tools will retry lazily): %s", exc)
    try:
        yield
    finally:
        await close_neo4j_client()
        close_chromadb_client()


mcp = FastMCP("code-graph", lifespan=lifespan)

mcp.add_tool(tools.search_codebase)
mcp.add_tool(tools.find_callers)
mcp.add_tool(tools.find_callees)
mcp.add_tool(tools.impact_analysis)
mcp.add_tool(tools.find_call_path)
mcp.add_tool(tools.explain_symbol)


def main() -> None:
    logging.basicConfig(level=logging.INFO, stream=sys.stderr)
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
./venv312/Scripts/python.exe -m pytest tests/test_mcp_server.py -q --no-cov
```
Expected: PASS (1 passed).

- [ ] **Step 5: Manual stdio smoke check (optional, no client needed)**

Optional verification of the stdout-cleanliness guarantee. The stdio server
exits by itself when stdin reaches EOF, so this command terminates on its own
(the piped `echo` closes stdin after one line) — it does not hang. Skip this
step if running fully headless; the registration test plus stderr-only
logging already cover the guarantee structurally.

Run (from `backend-fastapi/`):
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' | ./venv312/Scripts/python.exe -m app.mcp.server
```
Expected: exactly one JSON-RPC response line on stdout containing `"serverInfo"`
with `"name":"code-graph"`; any log lines appear on stderr only; the process
then exits. If it does not return within a few seconds, press Ctrl-C — that
indicates the transport is waiting and is not a failure of this check.

- [ ] **Step 6: Add the README section**

In `README.md`, insert a new section immediately before the `## Configuration` line (currently line 287):
```markdown
## MCP Server

The code-graph engine is also exposed as a [Model Context Protocol](https://modelcontextprotocol.io)
server, so MCP clients such as Claude Code and Claude Desktop can query the
indexed codebase directly. It runs over stdio and reuses the same Neo4j +
ChromaDB services as the backend.

**Tools**

| Tool | Purpose |
|---|---|
| `search_codebase` | Hybrid semantic + graph search (GraphRAG) |
| `find_callers` | Functions that call a given function |
| `find_callees` | Functions a given function calls |
| `impact_analysis` | Blast radius of changing a symbol |
| `find_call_path` | Call paths between two functions |
| `explain_symbol` | Signature, docstring, and graph neighbors of a symbol |

**Prerequisites:** the Docker infrastructure services running (see Getting
Started) and the corpus indexed. Start from the `backend-fastapi/` directory.

**Claude Code**

```bash
cd backend-fastapi
claude mcp add code-graph -- ./venv312/Scripts/python.exe -m app.mcp.server
```

**Claude Desktop** — add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "code-graph": {
      "command": "D:\\codeproject\\Smart_Code_Assistant\\backend-fastapi\\venv312\\Scripts\\python.exe",
      "args": ["-m", "app.mcp.server"],
      "cwd": "D:\\codeproject\\Smart_Code_Assistant\\backend-fastapi"
    }
  }
}
```
```

- [ ] **Step 7: Full suite + lint**

Run:
```bash
./venv312/Scripts/python.exe -m pytest -q --no-cov
./venv312/Scripts/python.exe -m ruff check app/mcp/ tests/test_mcp_tools.py tests/test_mcp_server.py tests/test_neo4j_get_entity.py
```
Expected: all tests pass (existing 361 + 23 new = 384), `All checks passed!`.

- [ ] **Step 8: Commit**

```bash
git add app/mcp/server.py tests/test_mcp_server.py ../README.md
git commit -m "feat(mcp): FastMCP stdio server + README MCP section"
```

---

## Notes for the executor

- `mcp.add_tool(fn)` registers a function using its name and docstring as the
  MCP tool schema; type hints (including `str | None` and `int` defaults)
  drive the input schema. Do not rename the tool functions — the registration
  test and the README table pin the six names.
- `get_neo4j_client()` is async and returns a connected singleton; tools
  `await` it. `get_retriever()` is sync and returns a lazy singleton whose
  `retrieve`/`analyze_impact`/`find_paths` are async.
- The `# noqa: BLE001` on the broad `except Exception` is intentional: each
  tool must convert any failure into a single clean `Error:` line for the MCP
  client rather than raising. Keep it.
- Test counts in the "Expected" lines assume no other test files change; if
  the real totals differ by a known amount, that is fine as long as the new
  tests pass and nothing regresses.
