from pydantic_settings import BaseSettings
from typing import Optional, List
from functools import lru_cache
from pathlib import Path

# Absolute path to backend-fastapi/.env so settings load identically whether
# the app is launched from backend-fastapi/ or a tool (e.g. the evals harness)
# runs from the repo root.
_ENV_FILE = str(Path(__file__).resolve().parents[2] / ".env")


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # Environment
    FASTAPI_ENV: str = "development"

    # Database Configuration
    DATABASE_URL: str = ""
    DB_HOST: str = "localhost"
    DB_PORT: int = 3307
    DB_USER: str = ""
    DB_PASSWORD: str = ""  # 必须从环境变量读取
    DB_NAME: str = "smart_code_assistant"

    # FastAPI Configuration
    FASTAPI_PORT: int = 8000
    FASTAPI_HOST: str = "0.0.0.0"
    API_V1_PREFIX: str = "/api/v1"

    # Security
    SECRET_KEY: str = ""  # 必须从环境变量读取
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7  # Refresh token expires in 7 days

    # Rate Limiting
    RATE_LIMIT_REQUESTS: int = 100  # Max requests per minute
    RATE_LIMIT_LOGIN_REQUESTS: int = 20  # Max login attempts per minute (increased for dev)

    # CORS Configuration
    # 开发环境允许的源
    CORS_ORIGINS_DEV: List[str] = [
        "http://localhost:5173",
        "http://localhost:3000",
        "http://localhost:8080",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
    ]
    # 生产环境允许的源（必须通过环境变量配置）
    CORS_ORIGINS_PROD: List[str] = []

    @property
    def CORS_ORIGINS(self) -> List[str]:
        """
        根据环境返回 CORS 允许的源列表

        - 开发环境: 使用 CORS_ORIGINS_DEV
        - 生产环境: 必须通过 CORS_ORIGINS_PROD 环境变量配置
        """
        if self.FASTAPI_ENV == "production":
            if not self.CORS_ORIGINS_PROD:
                # 生产环境必须显式配置，否则为空（最安全）
                return []
            return self.CORS_ORIGINS_PROD
        return self.CORS_ORIGINS_DEV

    @property
    def is_production(self) -> bool:
        """是否为生产环境"""
        return self.FASTAPI_ENV == "production"

    # ZhipuAI Configuration
    ZHIPUAI_API_KEY: str = ""

    # LLM Provider Configuration
    # LLM_PROVIDER: "zhipuai" (default) or "openai".
    # LLM_API_KEY falls back to ZHIPUAI_API_KEY when empty (backward compat).
    # Empty model/base_url fields resolve to per-provider presets (app/core/llm_config.py).
    LLM_PROVIDER: str = "zhipuai"
    LLM_API_KEY: str = ""
    LLM_BASE_URL: str = ""
    LLM_MODEL: str = ""
    LLM_MODEL_FAST: str = ""
    LLM_MODEL_QUALITY: str = ""
    LLM_MODEL_LIGHT: str = ""

    # Datalab (Marker) API Configuration
    DATALAB_API_KEY: str = ""
    DATALAB_API_URL: str = "https://www.datalab.to/api/v1/marker"

    # Neo4j Configuration - 代码知识图谱
    NEO4J_URI: str = "bolt://localhost:7687"
    NEO4J_USER: str = "neo4j"
    NEO4J_PASSWORD: str = "codegraph123"
    NEO4J_DATABASE: str = "neo4j"
    NEO4J_MAX_CONNECTION_POOL_SIZE: int = 50
    NEO4J_CONNECTION_TIMEOUT: int = 30

    # ChromaDB Configuration - 代码向量搜索
    CHROMADB_HOST: str = "localhost"
    CHROMADB_PORT: int = 8001
    CHROMADB_PERSIST_DIR: str = "./data/chroma"

    # Code Graph Configuration
    CODE_GRAPH_MAX_DEPTH: int = 5                    # 图遍历最大深度
    CODE_GRAPH_EMBEDDING_MODEL: str = "BAAI/bge-small-zh-v1.5"  # 本地 SentenceTransformer 嵌入模型
    # Embedding provider: "sentence_transformers" (default, local) or "openai".
    # OpenAI embeddings reuse LLM_API_KEY / LLM_BASE_URL. Switching providers
    # changes vector dimensions, so existing project collections must be re-indexed.
    CODE_GRAPH_EMBEDDING_PROVIDER: str = "sentence_transformers"
    CODE_GRAPH_OPENAI_EMBEDDING_MODEL: str = "text-embedding-3-small"
    CODE_GRAPH_MAX_ENTITIES: int = 100               # 单次最大实体数
    CODE_GRAPH_ENABLE_SEMANTIC_SEARCH: bool = True   # 启用语义搜索

    class Config:
        env_file = _ENV_FILE
        env_file_encoding = "utf-8"
        case_sensitive = True


settings = Settings()
