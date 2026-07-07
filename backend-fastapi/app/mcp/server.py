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
