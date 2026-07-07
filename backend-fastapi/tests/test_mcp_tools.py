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
