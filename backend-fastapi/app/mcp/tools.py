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
