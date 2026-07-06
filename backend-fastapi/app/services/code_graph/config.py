"""
Code Graph Configuration - 代码图谱配置
"""
from dataclasses import dataclass, field
from typing import List, Optional
from app.core.config import settings


@dataclass
class CodeGraphConfig:
    """代码图谱配置"""

    # Neo4j 配置
    neo4j_uri: str = field(default_factory=lambda: settings.NEO4J_URI)
    neo4j_user: str = field(default_factory=lambda: settings.NEO4J_USER)
    neo4j_password: str = field(default_factory=lambda: settings.NEO4J_PASSWORD)
    neo4j_database: str = field(default_factory=lambda: settings.NEO4J_DATABASE)

    # ChromaDB 配置
    chromadb_host: str = field(default_factory=lambda: settings.CHROMADB_HOST)
    chromadb_port: int = field(default_factory=lambda: settings.CHROMADB_PORT)
    chromadb_persist_dir: str = field(default_factory=lambda: settings.CHROMADB_PERSIST_DIR)

    # 图谱配置
    max_depth: int = field(default_factory=lambda: settings.CODE_GRAPH_MAX_DEPTH)
    embedding_model: str = field(default_factory=lambda: settings.CODE_GRAPH_EMBEDDING_MODEL)
    max_entities: int = field(default_factory=lambda: settings.CODE_GRAPH_MAX_ENTITIES)
    enable_semantic_search: bool = field(
        default_factory=lambda: settings.CODE_GRAPH_ENABLE_SEMANTIC_SEARCH
    )

    # 嵌入提供方配置 (embedding provider)
    embedding_provider: str = field(
        default_factory=lambda: settings.CODE_GRAPH_EMBEDDING_PROVIDER
    )
    openai_embedding_model: str = field(
        default_factory=lambda: settings.CODE_GRAPH_OPENAI_EMBEDDING_MODEL
    )
    # OpenAI embeddings reuse the chat LLM credentials (same precedence as
    # resolve_llm_config: LLM_API_KEY > ZHIPUAI_API_KEY).
    embedding_api_key: str = field(
        default_factory=lambda: settings.LLM_API_KEY or settings.ZHIPUAI_API_KEY
    )
    embedding_base_url: str = field(default_factory=lambda: settings.LLM_BASE_URL)

    # 支持的编程语言
    supported_languages: List[str] = field(
        default_factory=lambda: ["python", "javascript", "typescript"]
    )


# 全局配置实例
code_graph_config = CodeGraphConfig()
