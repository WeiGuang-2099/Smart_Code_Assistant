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
        "list_projects",
    }
