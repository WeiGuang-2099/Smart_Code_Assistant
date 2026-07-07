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
