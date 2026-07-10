"""
Code Graph LangChain Tools - 代码图谱工具

用于 LangChain Agent 调用的代码图谱工具
"""
import asyncio
import logging
from typing import Optional

from langchain_core.tools import tool

from app.services.code_graph.graph_builder import CodeGraphBuilder, get_graph_builder
from app.services.code_graph.retriever import CodeGraphRetriever, get_retriever

logger = logging.getLogger(__name__)


def _run_async(coro):
    """在同步上下文中运行异步函数"""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        # 如果已经在异步上下文中，创建新的线程运行
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor() as executor:
            future = executor.submit(asyncio.run, coro)
            return future.result()
    else:
        return asyncio.run(coro)


@tool
def build_code_graph(code: str, language: str = "python", module_path: str = "unknown") -> str:
    """
    Build a code knowledge graph extracting functions, classes, modules and their relationships.

    Args:
        code: Source code
        language: Programming language (default: python)
        module_path: Module path (default: unknown)

    Returns:
        Graph build result and statistics
    """
    try:
        builder = get_graph_builder()

        async def _build():
            return await builder.build_from_code(
                code=code,
                language=language,
                module_path=module_path
            )

        result = _run_async(_build())

        if result["success"]:
            stats = result["stats"]
            entities = result["entities"]
            return f"""📊 Code knowledge graph built [{language}]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📈 Entities:
  • Functions: {entities['functions']}
  • Classes: {entities['classes']}
  • Imports: {entities['imports']}

🔗 Relationships:
  • Nodes created: {stats['functions_created'] + stats['classes_created']}
  • Relationships created: {stats['relationships_created']}
  • Vector indexed: {stats.get('vector_indexed', 0)}

✅ Graph build complete. Use the query tools to explore dependencies and impact."""
        else:
            return f"❌ Graph build failed: {result.get('error', 'unknown error')}"

    except Exception as e:
        logger.error(f"build_code_graph error: {e}")
        return f"❌ Graph build failed: {str(e)}"


@tool
def query_code_dependencies(entity_name: str, dep_type: str = "all") -> str:
    """
    Query the dependency relationships of a code entity.

    Args:
        entity_name: Entity name (function/class)
        dep_type: Dependency type (callers=who calls it, callees=what it calls, all=both)

    Returns:
        Dependency listing
    """
    try:
        retriever = get_retriever()

        async def _query():
            return await retriever.get_dependencies(entity_name, dep_type)

        result = _run_async(_query())

        output = f"""🔍 Dependency query [{entity_name}]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"""

        callers = result.get("callers", [])
        callees = result.get("callees", [])

        if dep_type in ["callers", "all"] and callers:
            output += f"\n\n📞 Callers ({len(callers)}):"
            for c in callers[:10]:
                output += f"\n  • {c.get('name', '')} ({c.get('module_path', '')})"

        if dep_type in ["callees", "all"] and callees:
            output += f"\n\n📲 Callees ({len(callees)}):"
            for c in callees[:10]:
                output += f"\n  • {c.get('name', '')} ({c.get('module_path', '')})"

        if not callers and not callees:
            output += "\n\n⚠️ No dependencies found"

        return output

    except Exception as e:
        logger.error(f"query_code_dependencies error: {e}")
        return f"❌ Query failed: {str(e)}"


@tool
def analyze_impact(entity_name: str, change_type: str = "modify") -> str:
    """
    Analyze the impact scope of a code change.

    Args:
        entity_name: Name of the changed entity (function/class)
        change_type: Change type (modify, delete, rename)

    Returns:
        List of affected code entities
    """
    try:
        retriever = get_retriever()

        async def _analyze():
            return await retriever.analyze_impact(entity_name, "function", max_depth=3)

        result = _run_async(_analyze())

        impacted = result.get("impacted", [])
        total_count = result.get("total_count", 0)

        output = f"""🎯 Impact analysis [{entity_name}]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 Change type: {change_type}
📊 Impact scope: {total_count} entities
"""

        if impacted:
            output += "\n⚠️ Affected code:"
            for item in impacted[:15]:
                distance = item.get("distance", 1)
                module = item.get("module_path", "")
                class_name = item.get("class_name")
                name = item.get("name", "")

                if class_name:
                    output += f"\n  {'  ' * distance}• {class_name}.{name} ({module})"
                else:
                    output += f"\n  {'  ' * distance}• {name} ({module})"

            if len(impacted) > 15:
                output += f"\n  ... and {len(impacted) - 15} more"

            # Risk assessment
            if total_count > 20:
                output += "\n\n🔴 High risk: large impact scope, test thoroughly before shipping"
            elif total_count > 10:
                output += "\n\n🟡 Medium risk: run regression tests"
            else:
                output += "\n\n🟢 Low risk: limited impact scope"
        else:
            output += "\n✅ No affected code found"

        return output

    except Exception as e:
        logger.error(f"analyze_impact error: {e}")
        return f"❌ Impact analysis failed: {str(e)}"


@tool
def find_code_paths(source: str, target: str, max_depth: int = 5) -> str:
    """
    Find call paths between two code entities.

    Args:
        source: Starting entity name
        target: Target entity name
        max_depth: Maximum search depth (default: 5)

    Returns:
        List of call paths
    """
    try:
        retriever = get_retriever()

        async def _find():
            return await retriever.find_paths(source, target, max_depth)

        paths = _run_async(_find())

        output = f"""🛤️ Call path search [{source}] → [{target}]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"""

        if paths:
            output += f"\n\nFound {len(paths)} path(s):\n"
            for i, path in enumerate(paths[:5], 1):
                output += f"\nPath {i}:"
                for j, node in enumerate(path):
                    name = node.get("name", "unknown")
                    class_name = node.get("class_name")
                    if class_name:
                        output += f" → {class_name}.{name}"
                    else:
                        output += f" → {name}"

            if len(paths) > 5:
                output += f"\n\n... and {len(paths) - 5} more paths"
        else:
            output += "\n\n❌ No connecting path found"

        return output

    except Exception as e:
        logger.error(f"find_code_paths error: {e}")
        return f"❌ Path search failed: {str(e)}"


@tool
def search_code_semantic(query: str, project_id: int = 1, top_k: int = 10) -> str:
    """
    Semantic search over code entities.

    Args:
        query: Natural-language query (e.g. "functions that handle user auth")
        project_id: Project id (default: 1)
        top_k: Number of results to return (default: 10)

    Returns:
        List of matching code entities
    """
    try:
        retriever = get_retriever()

        async def _search():
            return await retriever.retrieve(
                query=query,
                project_id=project_id,
                top_k=top_k,
                include_graph_context=False
            )

        result = _run_async(_search())

        output = f"""🔎 Semantic search results [{query}]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"""

        semantic_results = result.get("semantic_results", {})

        # semantic_results may be a list (failed / empty search) or a dict
        if isinstance(semantic_results, list):
            if not semantic_results:
                output += "\n\n⚠️ No matching code entities found (ChromaDB may be unavailable or empty)"
                return output
            semantic_results = {}

        functions = semantic_results.get("functions", [])
        classes = semantic_results.get("classes", [])

        if functions:
            output += f"\n\n🔧 Related functions ({len(functions)}):"
            for func in functions[:8]:
                metadata = func.get("metadata", {})
                name = metadata.get("name", "unknown")
                module = metadata.get("module_path", "")
                score = func.get("relevance_score", 0)
                output += f"\n  • {name} ({module}) - relevance: {score:.2f}"

        if classes:
            output += f"\n\n📦 Related classes ({len(classes)}):"
            for cls in classes[:8]:
                metadata = cls.get("metadata", {})
                name = metadata.get("name", "unknown")
                module = metadata.get("module_path", "")
                score = cls.get("relevance_score", 0)
                output += f"\n  • {name} ({module}) - relevance: {score:.2f}"

        if not functions and not classes:
            output += "\n\n⚠️ No matching code entities found"

        return output

    except Exception as e:
        logger.error(f"search_code_semantic error: {e}")
        return f"❌ Search failed: {str(e)}"


# Exported tool registry
code_graph_tools = [
    build_code_graph,
    query_code_dependencies,
    analyze_impact,
    find_code_paths,
    search_code_semantic,
]

# Tool description map
code_graph_tool_descriptions = {
    "build_code_graph": "Build a code knowledge graph of functions, classes, modules and their relationships",
    "query_code_dependencies": "Query the dependencies of a code entity (callers/callees)",
    "analyze_impact": "Analyze the impact scope of a code change",
    "find_code_paths": "Find call paths between two code entities",
    "search_code_semantic": "Search code entities with a natural-language query",
}
