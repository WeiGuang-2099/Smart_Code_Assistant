"""Transport-agnostic async tool functions for the code-graph MCP server.

Each function wraps the existing code-graph service layer and returns a clean,
labelled plain-text string (no emojis) suitable for an LLM client. A future
HTTP transport can bind the same functions unchanged.
"""
import logging

from app.services.code_graph.neo4j_client import get_neo4j_client
from app.services.code_graph.retriever import get_retriever

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
