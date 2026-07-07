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
