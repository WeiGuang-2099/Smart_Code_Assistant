# Code-Graph MCP Server

Date: 2026-07-07
Status: approved (user, 2026-07-07)
Branch: `feat/mcp-server` (based on `main` after `feat/seed-heuristic-and-context` lands)

## Problem

The Smart Code Assistant has a working GraphRAG code-graph layer (hybrid
ChromaDB semantic search + Neo4j graph traversal), but its capabilities are
reachable only through the in-app LangChain agent and the FastAPI HTTP
endpoints. They cannot be used from an MCP client such as Claude Code or
Claude Desktop. Exposing them over the Model Context Protocol turns the
existing retrieval/graph engine into a reusable tool server any MCP host can
call directly.

This is also a portfolio signal: a correctly built MCP server over an
existing async service layer demonstrates fluency with Anthropic's current
integration protocol.

## Goals

- Expose six code-graph capabilities as MCP tools over stdio:
  `search_codebase`, `find_callers`, `find_callees`, `impact_analysis`,
  `find_call_path`, `explain_symbol`.
- Reuse the existing async service layer (`CodeGraphRetriever`,
  `Neo4jClient`, `ChromaDBClient`) with no duplication of retrieval logic.
- Ship offline/mocked unit tests (no Docker) consistent with the project's
  CI norm.
- Provide copy-paste client configuration for Claude Code and Claude Desktop.

## Non-goals (this round)

- Streamable-HTTP transport and cloud (AWS) deploy — documented follow-up.
- Authentication / authorization — the server is a local stdio tool.
- Multi-project switching beyond an optional `project_id` parameter.
- Wiring MCP tool output back into the in-app LangChain agent.

## Approach

A fresh async tool layer over the existing services, rejected alternatives:

- **(A) Fresh async tool layer (chosen).** New `app/mcp/` package whose tool
  functions `await` the service layer directly. The services are already
  async, so no sync bridge is needed; output is clean and emoji-free.
- **(B) Wrap the existing `services/code_graph/tools.py` LangChain tools.**
  Rejected: those return emoji-decorated Chinese display strings via a
  `_run_async` sync bridge, built for the in-app agent. Reusing them couples
  MCP output to agent formatting and violates the no-emoji constraint.
- **(C) Scaffold via a generator.** Rejected: six thin async wrappers over an
  existing service layer is smaller than adapting generated boilerplate.

## Architecture

New package `backend-fastapi/app/mcp/` (distinct from the LangChain
`services/code_graph/tools.py`):

| File | Responsibility |
|---|---|
| `app/mcp/__init__.py` | Package marker. |
| `app/mcp/tools.py` | Six transport-agnostic async functions. Each takes plain args, calls the service layer, and returns a clean labelled plain-text string (no emojis). This is the reusable core; a future HTTP transport binds the same functions. |
| `app/mcp/server.py` | Builds a `FastMCP` instance, registers the six tools via `@mcp.tool()`, manages the Neo4j connection via a FastMCP lifespan. Entry point `python -m app.mcp.server` runs stdio transport. |

- **Dependency:** the official `mcp` Python SDK (bundles `FastMCP`, imported
  as `from mcp.server.fastmcp import FastMCP`), added to `requirements.txt`
  and `requirements-ci.txt` with a version floor. Exact floor pinned in the
  plan against the currently released version.
- **Connections:** reuse `CodeGraphConfig` / `settings` — the same Docker
  Neo4j + ChromaDB the app already uses. Retriever/ChromaDB singletons stay
  lazy; the lifespan warms the Neo4j client on startup and closes all clients
  on shutdown.
- **Project scoping:** every tool takes an optional `project_id: int = 1`
  (the indexed corpus), matching the existing service default, so a client
  can call `search_codebase("...")` with no ceremony.

## Tool contracts

All six are async, take an optional `project_id: int = 1`, and return
labelled plain text (no emojis, LLM-friendly). Every tool catches service
errors and returns a clean one-line message instead of a stack trace; the
empty-result case is a friendly sentence, never an empty string.

### 1. `search_codebase(query: str, top_k: int = 5, project_id: int = 1) -> str`
- Calls `CodeGraphRetriever.retrieve(query, project_id, top_k)`.
- Returns the hybrid `combined_context`: ranked code-body snippets (signature
  + docstring) followed by the graph-relations section.
- Empty: `No matches for "<query>".`

### 2. `find_callers(function_name: str, module_path: str | None = None, project_id: int = 1) -> str`
- Calls `Neo4jClient.get_function_callers(function_name, module_path)`.
- Returns: header `Callers of <function_name> (<n>):` then one
  `- <name> (<module_path>)` per caller.
- Empty: `No callers found for <function_name>.`

### 3. `find_callees(function_name: str, module_path: str | None = None, project_id: int = 1) -> str`
- Calls `Neo4jClient.get_function_callees(function_name, module_path)`.
- Returns: header `Callees of <function_name> (<n>):` then one
  `- <name> (<module_path>)` per callee.
- Empty: `No callees found for <function_name>.`

### 4. `impact_analysis(entity_name: str, entity_type: str = "function", max_depth: int = 3, project_id: int = 1) -> str`
- Calls `CodeGraphRetriever.analyze_impact(entity_name, entity_type, max_depth)`.
- Returns: header `Impact of changing <entity_name> - <total_count> affected:`
  then one `- <name> (<module_path>)` per impacted entity.
- Empty: `No downstream impact found for <entity_name>.`

### 5. `find_call_path(source: str, target: str, max_depth: int = 5, project_id: int = 1) -> str`
- Calls `CodeGraphRetriever.find_paths(source, target, max_depth)`.
- Returns each path as a numbered arrow chain:
  `1. <source> -> <intermediate> -> <target>`, one path per line.
- Empty: `No call path from <source> to <target> within depth <max_depth>.`

### 6. `explain_symbol(name: str, module_path: str | None = None, project_id: int = 1) -> str`
- Resolves the symbol in the graph to obtain its type, signature, and
  docstring, then calls `Neo4jClient.get_entity_neighbors([seed], max_depth=2)`
  where `seed` is `{name, module_path, class_name, type, relevance_score}`.
- Returns a summary block: `<type> <name> (<module_path>)`, the signature,
  the docstring truncated to a fixed cap, then a `Related:` list of
  `- <relation>: <name> (<module_path>)`.
- Not found: `Symbol <name> not found in the code graph.`
- The exact symbol-resolver query/method (reading `type`, `signature`,
  `docstring`, `class_name` for one entity) is pinned in the plan; the graph
  already stores these properties on Function/Class nodes.

## Connection lifecycle

`server.py` uses a FastMCP lifespan async context manager: on startup it
`await neo4j_client.connect()` (warms the singleton); on shutdown it calls
`await close_neo4j_client()` and `close_chromadb_client()`. One process, one
Neo4j driver, reused across tool calls, clean teardown.

## Error handling

- Each tool wraps its service call in `try/except`. Service/DB errors are
  logged to stderr and returned to the client as a single clean line:
  `Error: <short reason>.` Never a stack trace, never a silent empty result.
- stdio constraint: nothing may write to stdout except the MCP protocol.
  All logging goes to stderr; the tools contain no stray `print` calls.

## Testing (TDD, offline/mocked)

- `tests/test_mcp_tools.py`: unit-test each of the six tool functions with the
  service layer mocked (`AsyncMock` for Neo4j/retriever, mock for ChromaDB).
  Assert output formatting, the empty-result sentence, and the error-path
  one-liner. No Docker, no live DB.
- `tests/test_mcp_server.py`: registration smoke test — build the `FastMCP`
  app and assert all six tools are registered with the expected names and
  parameter schemas.
- Ruff on all new files; full `pytest --no-cov` stays green (existing 361
  plus the new tests).

## Packaging and client config

- Entry point: `python -m app.mcp.server` (stdio). Add the `mcp` dependency
  floor to `requirements.txt` and `requirements-ci.txt`.
- README gains a short "MCP Server" section: what it exposes, the six tools,
  prerequisites (Docker DBs up, corpus indexed), and copy-paste client config
  for Claude Code (`claude mcp add code-graph -- python -m app.mcp.server`)
  and Claude Desktop (`claude_desktop_config.json` with `command` / `args` /
  `cwd`).

## Risks

- **stdout contamination breaks the transport.** Any library that prints to
  stdout (e.g. a warmup banner) corrupts the MCP stream. Mitigated by routing
  all logging to stderr and by the registration smoke test; verified manually
  against a real client during packaging.
- **DB availability.** The server assumes Docker Neo4j + ChromaDB are up and
  the corpus is indexed; otherwise tools return the clean error line. This is
  the existing dev norm, documented in the README prerequisites.
- **Symbol resolution ambiguity in `explain_symbol`.** A name may exist in
  multiple modules; when `module_path` is omitted the resolver picks the
  first match deterministically and the summary shows which module it chose.
