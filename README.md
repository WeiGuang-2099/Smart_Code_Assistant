# Smart Code Assistant

[![CI](https://github.com/WeiGuang-2099/Smart_Code_Assistant/actions/workflows/ci.yml/badge.svg)](https://github.com/WeiGuang-2099/Smart_Code_Assistant/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/badge/backend%20coverage-60%25-brightgreen)](./backend-fastapi/htmlcov)
[![Python](https://img.shields.io/badge/python-3.11-blue.svg)](https://www.python.org/)
[![React](https://img.shields.io/badge/react-19-61dafb.svg)](https://react.dev/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

An AI-powered code generation, review, and analysis platform built with FastAPI, React, and LangChain. Combines LLM-driven code intelligence with a code knowledge graph (GraphRAG) for deep structural understanding of your codebase.

## Screenshots

A visual tour of the platform (dark, cyberpunk-themed UI):

| Home dashboard | AI code generation |
|:---:|:---:|
| ![Home dashboard](docs/screenshots/02-dashboard.png) | ![AI code generation](docs/screenshots/03-generate.png) |
| **Code editor (Monaco)** | **Code analysis + GraphRAG** |
| ![Code editor](docs/screenshots/09-editor.png) | ![Code analysis](docs/screenshots/06-code-analysis.png) |
| **Code review** | **AI agents ("digital humans")** |
| ![Code review](docs/screenshots/04-review.png) | ![AI agents](docs/screenshots/05-agents.png) |
| **Documents** | **Projects** |
| ![Documents](docs/screenshots/07-documents.png) | ![Projects](docs/screenshots/08-projects.png) |
| **Profile & settings** | **Login** |
| ![Profile](docs/screenshots/10-profile.png) | ![Login](docs/screenshots/01-login.png) |

## Features

### AI Code Intelligence
- **Code Generation** - Generate code from natural language descriptions using ZhipuAI GLM-5 series models
- **Code Review** - Automated code review with scoring, issue detection, and improvement suggestions
- **AI Chat** - Multi-turn conversational assistant for code-related questions with context history
- **Streaming Responses** - Real-time SSE streaming for AI responses with heartbeat and tool events

### LangChain Agent System
- Configurable AI agents ("digital humans") with custom domains and system prompts
- Agents invoke multiple code analysis tools in parallel (structure, smells, complexity, security)
- Persistent conversation history with token tracking and summarization
- Agent lifecycle management: draft, active, inactive, and training states

### Code Knowledge Graph (GraphRAG)
- AST-based code parsing and entity extraction (functions, classes, imports, variables)
- Neo4j-powered dependency graph with relationship types: CALLS, IMPORTS, INHERITS, CONTAINS
- Hybrid retrieval: parallel ChromaDB semantic search + Neo4j graph traversal
- Dependency analysis, impact analysis, path finding, and semantic code search

### Code Analysis
- Structure analysis (line counts, functions, classes, imports)
- Code smell detection
- Cyclomatic complexity calculation
- Security vulnerability scanning
- Run analyses individually or combined

### Document Management
- Full document CRUD with categories and project association
- Version control with change tracking and diff viewing
- PDF-to-Markdown conversion via Datalab Marker API
- Rich text editing with TipTap (images, links, code blocks)

### Project & Code File Management
- User-owned projects with code file organization
- Monaco Editor integration with syntax highlighting
- Multi-language support

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, Vite 7, Tailwind CSS 4 |
| Backend | Python, FastAPI, SQLAlchemy 2.0 (async), Alembic |
| AI/LLM | LangChain, ZhipuAI GLM-5.2 / GLM-5.1 / GLM-4.7 or OpenAI (switchable provider); LangGraph agent rewrite planned |
| Relational DB | MySQL 8.0 (via aiomysql) |
| Graph DB | Neo4j 5.15 (code knowledge graph) |
| Vector DB | ChromaDB (semantic search) |
| Auth | JWT (access + refresh tokens), Argon2 password hashing |
| Observability | OpenTelemetry, Jaeger, Prometheus metrics, Sentry (optional) |
| Testing | pytest + pytest-cov (backend, 60%+ coverage), Vitest + RTL (frontend), k6 (HTTP load) |
| Deployment | Docker Compose, GitHub Actions CI |

## Architecture

```mermaid
flowchart TB
    subgraph Client["Client"]
        UI["React 19 + Vite 7<br/>Monaco / TipTap / Tailwind"]
    end

    subgraph API["FastAPI Backend"]
        direction TB
        MW["Middleware<br/>JWT auth · rate limiting · OpenTelemetry · perf metrics"]
        subgraph Services["Domain services"]
            direction LR
            Auth["Auth & Users<br/>(Argon2 + JWT rotate)"]
            CodeGen["Code Gen / Review<br/>(LangChain agent)"]
            Analyze["Static Analysis<br/>(AST + smells + security)"]
            Docs["Documents<br/>(PDF -> MD + versions)"]
            Graph["GraphRAG retriever<br/>(parallel semantic + graph)"]
        end
    end

    subgraph Stores["Data stores"]
        direction LR
        MySQL["MySQL 8.0<br/>(business data)"]
        Neo4j["Neo4j 5.15<br/>(code dependency graph)"]
        Chroma["ChromaDB<br/>(code embeddings)"]
    end

    subgraph External["External"]
        GLM["ZhipuAI GLM-5<br/>(via OpenAI-compatible API)"]
        Datalab["Datalab Marker<br/>(PDF -> MD)"]
    end

    subgraph Obs["Observability"]
        Jaeger["Jaeger<br/>(OTLP traces)"]
        Prom["Prometheus<br/>(/metrics)"]
        Sentry["Sentry<br/>(optional)"]
    end

    UI -- "HTTPS / SSE" --> MW
    MW --> Services

    Auth --> MySQL
    CodeGen --> GLM
    CodeGen --> Analyze
    Docs --> MySQL
    Docs --> Datalab
    Analyze --> Graph
    Graph --> Neo4j
    Graph --> Chroma
    Graph -. "embed" .-> GLM

    API --> Jaeger
    API --> Prom
    API -.-> Sentry
```

### Key flows

- **Streaming chat** — `POST /api/v1/agent/chat/stream` returns a typed SSE stream (`metadata` -> `content`* -> `tool_*` -> `done`) with heartbeat events and session-scoped metrics.
- **Hybrid GraphRAG retrieval** — `CodeGraphRetriever.retrieve()` fans out a ChromaDB semantic query and a Neo4j subgraph traversal in parallel via `asyncio.gather`, then caches the merged result in the L1 LRU layer.
- **Layered cache** — `CacheManager` is L1 (in-process LRU with TTL + LRU eviction) with an optional L2 Redis backend gated by `REDIS_URL`. The `@cached` decorator keys on stable hashes of the call arguments.
- **Token revocation** — Logout pushes the token onto a deterministic-keyed in-memory blacklist; `revoke_all_user_tokens` bumps a per-user token version so every previously issued token fails decode without DB hit.

## Performance

Numbers from `python scripts/benchmark.py` on a developer laptop (no real Neo4j / ChromaDB / LLM - external stores mocked). All hot paths sit comfortably in the low-millisecond range so the request budget is dominated by the LLM call, not local orchestration.

| Hot path | avg | p50 | p95 |
|---|---:|---:|---:|
| Static analysis pipeline (4 tools) | 1.4 ms | 1.3 ms | 2.8 ms |
| GraphRAG retrieval (semantic + graph in parallel) | 0.6 ms | 0.5 ms | 0.9 ms |
| Conversation compression (100-message history) | 0.01 ms | 0.01 ms | 0.02 ms |
| AST parsing (260 lines of Python) | 2.1 ms | 2.1 ms | 2.2 ms |
| LRU cache (1000 sequential GETs) | 0.5 ms | 0.5 ms | 0.5 ms |

Re-run anytime with:

```bash
cd backend-fastapi
python scripts/benchmark.py
```

For HTTP-level load testing see [`load-tests/README.md`](./load-tests/README.md) (k6 scenarios with built-in latency/error-rate thresholds).

## Evaluation

The repo ships a runnable eval harness (`evals/`) that measures the GraphRAG pipeline against a hand-written golden set of 50 questions about this codebase. Retrieval is scored automatically against expected files and graph neighbors; generation is scored by an LLM-as-judge using two reference-free metrics (faithfulness to the retrieved context, and answer relevance to the question). The numbers below are a real run against live Neo4j and ChromaDB, not mocked.

### Retrieval (golden set, n=50, 0 errors)

Before is the pre-traversal regex graph path (git `0d297e4`, 2026-06-18); after is real graph-neighbor traversal seeded from the top semantic hits, plus import-name indexing and the module-level CALLS fix (2026-06-20); "after seed scoring" adds type-aware seed scoring (git `cb60747`, 2026-07-07), which prefers function/method nodes over schema/exception classes when picking traversal seeds. All three are re-indexed against live Neo4j and ChromaDB.

| Metric | Before (2026-06-18) | After (2026-06-20) | After seed scoring (2026-07-07) |
|---|---:|---:|---:|
| hit_rate@1 | 0.42 | 0.44 | 0.44 |
| hit_rate@5 | 0.60 | 0.64 | 0.66 |
| recall@5 | 0.50 | 0.52 | 0.53 |
| mrr | 0.50 | 0.53 | 0.54 |
| hybrid_hit_rate@5 | 0.60 | 0.64 | 0.68 |
| graph_neighbor_recall | 0.10 | 0.29 | 0.36 |
| graph_traversal_correctness | 0.08 | 0.24 | 0.28 |

graph_neighbor_recall went 0.10 -> 0.29 with real traversal (2026-06-20), then -> 0.36 once seeds were re-scored with node-type priors (2026-07-07); graph_traversal_correctness went 0.08 -> 0.24 -> 0.28. hybrid_hit_rate@5 moved above plain hit_rate@5 for the first time -- 0.64 -> 0.68, while hit_rate@5 itself only reached 0.66 -- meaning the graph branch is now surfacing correct hits the semantic branch alone misses (evals/results/20260706T212812Z.json). These numbers were measured in isolation, on the corpus as it stood before the document-text context change below re-indexed it. That re-index re-embedded the ~60 lines the change added to `retriever.py`; since the golden set asks about this repo's own code, semantic hits shifted on a few cases and seeds followed, pushing graph_neighbor_recall further to 0.4333, graph_traversal_correctness to 0.32, hybrid_hit_rate@5 to 0.72, and hit_rate@5 to 0.68 on the current corpus (evals/results/20260706T215010Z.json). That further movement is corpus self-reference drift from re-indexing, not a second retrieval improvement -- the document-text context change itself only touches `_build_combined_context`, which sits downstream of seed selection.

### Generation (GLM-5.2 generator, GLM-5.1 judge, prompt v1, n=50 per run)

| Metric | Baseline (2026-06-20) | After seed scoring only (2026-07-06) | After document-text context (2026-07-06) |
|---|---:|---:|---:|
| faithfulness | 4.76 (92%) | 4.88 (94%) | 4.72 (92%) |
| answer_relevance | 3.66 (56%) | 3.34 (42%) | 4.20 (68%) |

Seed scoring alone (commit `cb60747`) moved answer_relevance the wrong way at first -- 3.66 -> 3.34 (evals/results/20260706T213622Z.json) -- because better graph seeds surfaced more code the generator still had no document text for; the context carried names only. Adding each hit's indexed document text (signature + docstring) to the combined context (commit `54b6ba8`) moved it to 4.20, above both prior runs (evals/results/20260706T215528Z.json); per category, feature_lookup answer_relevance went 2.17 (2026-06-20) -> 2.50 (seed scoring only) -> 3.83 (document text). Faithfulness stays above the 4.5 guard throughout (4.76 -> 4.88 -> 4.72); the small dip on the final run is the expected cost of the model actually answering instead of refusing. The run had 0 generation errors and 0 judge parse failures. The judge (GLM-5.1) is deliberately a different model from the generator (GLM-5.2) to reduce self-grading bias. An earlier GLM-4 generator / GLM-4-plus judge baseline (2026-06-18) scored 4.64 / 3.48; since both generator and judge changed, that run is not directly comparable to any of these.

### By category

Retrieval columns (hit_rate@5, recall@5, mrr) are the 2026-06-20 traversal run, re-verified 2026-07-06 against a freshly re-indexed corpus and reproduced within noise (evals/results/20260706T174408Z.json) -- they predate the seed-scoring and document-text-context work above. faithfulness and answer_relevance are the 2026-07-06 run with each hit's indexed document text (signature + docstring) in the generation context (evals/results/20260706T215528Z.json; GLM-5.2 generator, GLM-5.1 judge).

| Category | n | hit_rate@5 | recall@5 | mrr | faithfulness | answer_relevance |
|---|---:|---:|---:|---:|---:|---:|
| definition_lookup | 12 | 0.50 | 0.50 | 0.47 | 4.83 | 4.67 |
| feature_lookup | 12 | 0.75 | 0.75 | 0.63 | 5.00 | 3.83 |
| dependency_trace | 10 | 0.40 | 0.35 | 0.29 | 4.60 | 4.20 |
| impact_analysis | 8 | 1.00 | 0.54 | 0.78 | 4.50 | 4.00 |
| cross_file_flow | 8 | 0.63 | 0.42 | 0.50 | 4.50 | 4.25 |

The breakdown is the point of the harness: `impact_analysis` retrieves cleanly (hit_rate@5 1.00) and answers well, while `dependency_trace` remains the weakest retrieval category (recall@5 0.35, mrr 0.29). On the generation side, `feature_lookup` used to score lowest on answer_relevance (2.17, 2026-06-20 run) despite strong retrieval, and the transcripts showed exactly why: the combined context passed to the generator contained only symbol names, file paths, and graph relations -- no indexed document text -- so for "how does X work" questions GLM-5.2 correctly answered that the context was insufficient, and the judge scored that refusal low on relevance (while faithfulness stayed 5.00 -- the model refused rather than hallucinated). Feeding each hit's indexed document text (signature + docstring) that the retrieval layer already returns (commit `54b6ba8`) flipped every category above 3.8 relevance -- feature_lookup moved 2.17 -> 3.83, and no category is now below 3.83 -- while keeping overall faithfulness above the 4.5 guard (4.72, evals/results/20260706T215528Z.json).

Graph-neighbor metrics rose sharply after the traversal rework (graph_neighbor_recall 0.10 -> 0.29, graph_traversal_correctness 0.08 -> 0.24, 2026-06-20), and the harness then localized the remaining ceiling precisely: for "how does X work" questions the embedding model often ranked schema/exception classes (e.g. `UserRegister`, `TokenVersionManager`) above the endpoint or service function whose call/import neighbors actually answer the question, so the graph traversal seeded from the wrong nodes. Type-aware seed scoring (commit `cb60747`, 2026-07-07) addressed that by preferring function/method nodes over schema/exception classes when picking traversal seeds: graph_neighbor_recall rose to 0.36 and graph_traversal_correctness to 0.28, measured in isolation on the pre-document-text-context corpus (evals/results/20260706T212812Z.json). See Known limitations below for what that did not fix.

**Known limitations.**
- *Seeding dominated the graph-neighbor ceiling (partially addressed).* Traversal is seeded from the top semantic hits, so when semantic search surfaced the wrong node type (a schema class instead of the calling function), the right neighbors were never reached even though they existed in the graph. Type-aware seed scoring (commit `cb60747`, 2026-07-07) raised graph_neighbor_recall 0.2867 -> 0.36 and graph_traversal_correctness 0.24 -> 0.28 in isolation, and moved hybrid_hit_rate@5 above plain hit_rate@5 for the first time (0.64 -> 0.68; evals/results/20260706T174408Z.json -> evals/results/20260706T212812Z.json). It did not close the ceiling: recall is still well under 1.0, plain hit_rate@5 itself barely moved (0.64 -> 0.66), and reranking on the semantic branch remains open as the next lever.
- *Combined context indexes signatures and docstrings, not function bodies.* Full function source is already extracted by the AST parser (`ast_parser.py`, `source_code` field) but dropped before indexing; indexing real code bodies is the queued next retrieval iteration.
- *Class instantiation and same-file usage are not edges.* Neighbors reachable only through instantiation (`Neo4jClient()`, `ChromaDBClient()`) or a class defined and used in the same file (`MetricsCollector`) are not yet modeled, so those expectations stay at zero by design. Modeling instantiation/usage is the next graph iteration.
- *Eval isolation.* Graph nodes are indexed under `project_id=99999`; unlike ChromaDB collections, cross-project node isolation in Neo4j is not enforced.

Reproduce: `docker compose up -d`, index the corpus once, then run with generation:

```bash
python -m evals.run --golden evals/golden_set/backend_fastapi.jsonl --index-corpus backend-fastapi/app
python -m evals.run --golden evals/golden_set/backend_fastapi.jsonl --with-generation
```

Generation evals are opt-in (they need `ZHIPUAI_API_KEY` and cost a few GLM calls) and never run in CI; retrieval-only runs are cheap and deterministic. The eval index is isolated under `project_id=99999` in ChromaDB so it never mixes with dev data. By default the generator and judge are the same model family (GLM); the switchable provider abstraction (`LLM_PROVIDER=openai`) allows re-judging with a disjoint family as a cross-check.

## Getting Started

### Prerequisites

- Docker and Docker Compose
- Python 3.11+
- Node.js 18+
- ZhipuAI API key

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/Smart_Code_Assistant.git
cd Smart_Code_Assistant
```

### 2. Start Infrastructure Services

```bash
docker compose up -d
```

This starts MySQL (port 3307), Neo4j (ports 7474, 7687), and ChromaDB (port 8001).

### 3. Configure Backend

```bash
cp backend-fastapi/.env.example backend-fastapi/.env
```

Edit `backend-fastapi/.env` and set your ZhipuAI API key and other configuration values.

### 4. Start the Backend

```bash
cd backend-fastapi
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### 5. Start the Frontend

```bash
cd frontend
npm install
npm run dev
```

The frontend runs at `http://localhost:5173` and proxies API requests to the backend.

### 6. Default User

A demo user is seeded on first startup:

| Field | Value |
|-------|-------|
| Username | `demo` |
| Password | `demo123456` |

## API Overview

| Endpoint Group | Path Prefix | Description |
|---------------|-------------|-------------|
| Auth | `/api/v1/auth` | Login, register, token refresh |
| Projects | `/api/v1/projects` | Project CRUD |
| Code Files | `/api/v1/code-files` | Code file management |
| AI Code Gen | `/api/v1/ai` | Code generation, review, chat |
| Agent | `/api/v1/agent` | LangChain agent analysis, generation, chat |
| Agent Stream | `/api/v1/agent/chat/stream` | SSE streaming chat |
| Agents | `/api/v1/agents` | Agent CRUD, conversations, training |
| Code Analysis | `/api/v1/code-analysis` | Structure, smells, complexity, security |
| Code Graph | `/api/v1/code-graph` | Knowledge graph build and queries |
| Documents | `/api/v1/documents` | Document CRUD and PDF parsing |
| Versions | `/api/v1/versions` | Document versioning |
| Health | `/api/v1/health` | Service health check |
| Metrics | `/metrics` | Prometheus metrics |

## MCP Server

The code-graph engine is also exposed as a [Model Context Protocol](https://modelcontextprotocol.io)
server, so MCP clients such as Claude Code and Claude Desktop can query the
indexed codebase directly. It runs over stdio and reuses the same Neo4j +
ChromaDB services as the backend.

**Tools**

| Tool | Purpose |
|---|---|
| `search_codebase` | Hybrid semantic + graph search (GraphRAG) |
| `find_callers` | Functions that call a given function |
| `find_callees` | Functions a given function calls |
| `impact_analysis` | Blast radius of changing a symbol |
| `find_call_path` | Call paths between two functions |
| `explain_symbol` | Signature, docstring, and graph neighbors of a symbol |
| `list_projects` | Indexed project ids and their entity counts (discovery) |

**Prerequisites:** the Docker infrastructure services running (see Getting
Started) and the corpus indexed. The server runs in its own virtualenv
(isolated from the web stack, which pins an older pydantic):

```bash
cd backend-fastapi
python -m venv venv-mcp
venv-mcp/Scripts/pip install -r requirements-mcp.txt
```

**Project id:** the semantic tools query the project set by
`CODE_GRAPH_DEFAULT_PROJECT_ID` (default `1`). Point it at the id you indexed the
corpus under; if `search_codebase` returns "No matches", call `list_projects` to
see which ids actually hold vectors. On first start the server warms the local
embedding model (~15s, downloads from HuggingFace once); set
`CODE_GRAPH_EMBEDDING_OFFLINE=true` afterwards to load it from cache only and skip
all HuggingFace network calls (which can otherwise stall startup when the Hub is
slow).

**Claude Code**

```bash
cd backend-fastapi
claude mcp add code-graph -- ./venv-mcp/Scripts/python.exe -m app.mcp.server
```

**Claude Desktop** — add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "code-graph": {
      "command": "D:\\codeproject\\Smart_Code_Assistant\\backend-fastapi\\venv-mcp\\Scripts\\python.exe",
      "args": ["-m", "app.mcp.server"],
      "cwd": "D:\\codeproject\\Smart_Code_Assistant\\backend-fastapi"
    }
  }
}
```

## Configuration

### Environment Variables

Key configuration options (set in `backend-fastapi/.env`):

| Variable | Description | Default |
|----------|-------------|---------|
| `ZHIPU_API_KEY` | ZhipuAI API key | - |
| `LLM_PROVIDER` | LLM provider: `zhipuai` or `openai` | `zhipuai` |
| `LLM_API_KEY` | Provider API key (falls back to `ZHIPUAI_API_KEY`) | _(unset)_ |
| `LLM_MODEL` | Override default-tier model (else provider preset) | _(unset)_ |
| `DATABASE_URL` | MySQL connection string | `mysql+aiomysql://...` |
| `NEO4J_URI` | Neo4j Bolt URI | `bolt://localhost:7687` |
| `CHROMA_HOST` | ChromaDB host | `localhost` |
| `SECRET_KEY` | JWT signing key | - |
| `CODE_GRAPH_EMBEDDING_MODEL` | Local SentenceTransformer embedding model | `BAAI/bge-small-zh-v1.5` |
| `CODE_GRAPH_EMBEDDING_PROVIDER` | Embedding provider: `sentence_transformers` (local) or `openai` | `sentence_transformers` |
| `CODE_GRAPH_OPENAI_EMBEDDING_MODEL` | OpenAI embedding model (when provider is `openai`; reuses `LLM_API_KEY` / `LLM_BASE_URL`) | `text-embedding-3-small` |
| `RATE_LIMIT_GENERAL` | General rate limit | `100/minute` |
| `RATE_LIMIT_LOGIN` | Login rate limit | `20/minute` |
| `SENTRY_DSN` | Sentry DSN - error tracking disabled if blank | _(unset)_ |
| `SENTRY_TRACES_SAMPLE_RATE` | Sentry performance sampling | `0.0` |
| `VITE_SENTRY_DSN` | Frontend Sentry DSN - tracking disabled if blank | _(unset)_ |

> **Switching to OpenAI:** set `LLM_PROVIDER=openai` and `LLM_API_KEY=sk-...` in `backend-fastapi/.env` for chat/agents (models resolve from presets). For OpenAI embeddings, also set `CODE_GRAPH_EMBEDDING_PROVIDER=openai`. Because OpenAI and the local model produce different vector dimensions, **existing project collections must be re-indexed after changing the embedding provider** (delete and rebuild them); the two cannot be mixed in one collection.

## Project Structure

```
Smart_Code_Assistant/
├── backend-fastapi/          # Python/FastAPI backend
│   ├── app/
│   │   ├── api/              # Route handlers
│   │   ├── core/             # Config, security, middleware
│   │   ├── models/           # SQLAlchemy models
│   │   ├── schemas/          # Pydantic schemas
│   │   └── services/         # Business logic
│   │       ├── langchain_glm_service.py  # LLM integration
│   │       ├── conversation_manager.py   # Chat history management
│   │       └── code_graph/               # GraphRAG subsystem
│   ├── alembic/              # Database migrations
│   ├── tests/                # Test suite
│   └── scripts/              # Utility scripts
├── frontend/                 # React/TypeScript frontend
│   └── src/
│       ├── components/       # UI components
│       ├── contexts/         # React contexts (auth, document, toast)
│       ├── hooks/            # Custom hooks
│       ├── pages/            # Page components
│       ├── services/         # API client services
│       └── types/            # TypeScript type definitions
├── docker-compose.yml        # Infrastructure services
└── init-scripts/             # Database initialization SQL
```

## Testing

The backend has ~300 tests covering 60%+ of statements: auth, caching, rate
limiting, alerting, query analysis, code-analysis tools, AST parsing, the
GraphRAG builder, Markdown/TipTap conversion, and the optional Sentry layer.

The frontend has 54+ tests (Vitest + Testing Library) covering the auth
context, toast context, error boundary, empty-state primitives, loading
skeletons, and Sentry initialisation.

HTTP-level load testing lives under [`load-tests/`](./load-tests/) (k6
scenarios with built-in latency/error-rate thresholds).

### Run the backend tests locally

```bash
cd backend-fastapi

# install dev dependencies (includes pytest, pytest-asyncio, pytest-cov)
pip install -r requirements.txt

# run the full suite with coverage
pytest

# faster: skip the coverage instrumentation
pytest --no-cov

# generate an HTML coverage report (written to htmlcov/)
pytest --cov --cov-report=html
open htmlcov/index.html
```

### Lint the backend

```bash
cd backend-fastapi
pip install ruff
ruff check app tests
```

### Run the frontend tests locally

```bash
cd frontend
npm install

# single run, CI-style
npm test

# watch mode while developing
npm run test:watch

# generate coverage report (writes to coverage/)
npm run test:coverage
```

### HTTP load tests

```bash
# install k6 first - https://k6.io/docs/get-started/installation/

# 30s smoke test
k6 run load-tests/smoke.js

# 3-min baseline against the seeded demo user
k6 run load-tests/baseline.js
```

See [`load-tests/README.md`](./load-tests/README.md) for the full scenario
catalogue and the embedded thresholds.

### Continuous integration

Every push and pull request to `main` runs the [CI workflow](.github/workflows/ci.yml):

| Job | Steps |
|-----|-------|
| `backend` | `ruff check` -> `pytest --cov --cov-fail-under=55` -> uploads HTML report + Codecov XML |
| `frontend` | `npm ci` -> `npm run lint` -> `tsc --noEmit` -> `npm test` -> `npm run build` |

Builds fail if backend coverage drops below 55% or any lint / type / test step regresses.

## License

This project is licensed under the MIT License.
