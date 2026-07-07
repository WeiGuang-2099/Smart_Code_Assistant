"""Transport-agnostic async tool functions for the code-graph MCP server.

Each function wraps the existing code-graph service layer and returns a clean,
labelled plain-text string (no emojis) suitable for an LLM client. A future
HTTP transport can bind the same functions unchanged.
"""
import asyncio
import logging

from app.services.code_graph.chromadb_client import get_chromadb_client
from app.services.code_graph.config import code_graph_config
from app.services.code_graph.neo4j_client import get_neo4j_client
from app.services.code_graph.retriever import get_retriever

logger = logging.getLogger(__name__)

DOCSTRING_MAX_CHARS = 500

# Default project id, resolved from config at import (CODE_GRAPH_DEFAULT_PROJECT_ID).
# The corpus must be indexed under this id; clients can call list_projects to
# discover which ids actually hold vectors.
_DEFAULT_PROJECT_ID = code_graph_config.default_project_id


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


async def search_codebase(query: str, top_k: int = 5, project_id: int = _DEFAULT_PROJECT_ID) -> str:
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
            return (
                f'No matches for "{query}" in project {project_id}. '
                "If this project may not be indexed, call list_projects to see "
                "which project ids hold vectors."
            )
        return context
    except Exception as exc:  # noqa: BLE001 - surfaced to the client as one line
        logger.error("search_codebase failed: %s", exc)
        return f"Error: {exc}"


async def find_callers(
    function_name: str, module_path: str | None = None, project_id: int = _DEFAULT_PROJECT_ID
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
    function_name: str, module_path: str | None = None, project_id: int = _DEFAULT_PROJECT_ID
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


async def impact_analysis(
    entity_name: str,
    entity_type: str = "function",
    max_depth: int = 3,
    project_id: int = _DEFAULT_PROJECT_ID,
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
    source: str, target: str, max_depth: int = 5, project_id: int = _DEFAULT_PROJECT_ID
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
    name: str, module_path: str | None = None, project_id: int = _DEFAULT_PROJECT_ID
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


async def list_projects() -> str:
    """List indexed projects and their entity counts.

    Use this to discover valid project_id values when search_codebase returns no
    matches: the tools use a configured default project id, but the corpus may
    have been indexed under a different id. Pass the right id to search_codebase.
    """
    try:
        chromadb = get_chromadb_client()
        projects = await asyncio.to_thread(chromadb.list_projects)
        if not projects:
            return "No indexed projects found."
        lines = ["Indexed projects:"]
        for project in projects:
            lines.append(
                f"- project_id={project['project_id']}: "
                f"{project.get('functions', 0)} functions, "
                f"{project.get('classes', 0)} classes"
            )
        return "\n".join(lines)
    except Exception as exc:  # noqa: BLE001
        logger.error("list_projects failed: %s", exc)
        return f"Error: {exc}"
