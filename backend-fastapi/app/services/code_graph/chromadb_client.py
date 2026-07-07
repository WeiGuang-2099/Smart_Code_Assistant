"""
ChromaDB Client - 向量数据库客户端

提供代码实体的向量存储和语义搜索功能
"""
import logging
from typing import Optional, List, Dict, Any
from functools import lru_cache

from app.services.code_graph.config import CodeGraphConfig, code_graph_config

logger = logging.getLogger(__name__)


def _import_chromadb():
    """Lazy-import chromadb to avoid pulling in heavy deps (torch, onnxruntime) at module load."""
    import chromadb
    from chromadb.config import Settings as ChromaSettings
    from chromadb.utils import embedding_functions
    return chromadb, ChromaSettings, embedding_functions


class ChromaDBClient:
    """ChromaDB 客户端"""

    def __init__(self, config: Optional[CodeGraphConfig] = None):
        self.config = config or code_graph_config
        self._client = None
        self._embedding_function = None
        self._collections: Dict[str, Any] = {}

    def connect(self) -> None:
        """建立连接"""
        if self._client is not None:
            return

        try:
            chromadb, ChromaSettings, embedding_functions = _import_chromadb()

            # 连接到 ChromaDB 服务器
            self._client = chromadb.HttpClient(
                host=self.config.chromadb_host,
                port=self.config.chromadb_port,
                settings=ChromaSettings(
                    anonymized_telemetry=False
                )
            )
            # 测试连接
            self._client.heartbeat()
            logger.info(f"Connected to ChromaDB at {self.config.chromadb_host}:{self.config.chromadb_port}")

            # 初始化嵌入函数
            self._init_embedding_function()

        except Exception as e:
            logger.error(f"Failed to connect to ChromaDB: {e}")
            raise

    def _init_embedding_function(self) -> None:
        """初始化嵌入函数

        Provider is selected via config.embedding_provider:
        - "openai": hosted OpenAI-compatible embeddings (reuses LLM_API_KEY /
          LLM_BASE_URL); model from config.openai_embedding_model.
        - anything else (default): local SentenceTransformers model.

        Any failure (missing key, model load error) downgrades to ChromaDB's
        bundled DefaultEmbeddingFunction so the graph feature keeps working.

        NOTE: different providers produce different vector dimensions, so
        switching providers requires re-indexing existing project collections.
        """
        provider = (getattr(self.config, "embedding_provider", "") or "sentence_transformers").lower()
        try:
            _, _, embedding_functions = _import_chromadb()

            if provider == "openai":
                self._embedding_function = self._build_openai_embedding_function(embedding_functions)
                logger.info(
                    f"Initialized OpenAI embedding model: "
                    f"{getattr(self.config, 'openai_embedding_model', '')}"
                )
            else:
                # 使用 Sentence Transformers 本地模型
                self._embedding_function = embedding_functions.SentenceTransformerEmbeddingFunction(
                    model_name=self.config.embedding_model
                )
                logger.info(f"Initialized embedding model: {self.config.embedding_model}")
        except Exception as e:
            logger.warning(f"Failed to initialize {provider} embedding function: {e}")
            # 降级使用默认模型
            _, _, embedding_functions = _import_chromadb()
            self._embedding_function = embedding_functions.DefaultEmbeddingFunction()
            logger.info("Using default embedding function")

    def _build_openai_embedding_function(self, embedding_functions) -> Any:
        """Build ChromaDB's OpenAIEmbeddingFunction from config.

        Raises ValueError when no API key is configured so the caller downgrades
        to the default embedding function (rather than failing silently).
        """
        api_key = getattr(self.config, "embedding_api_key", "") or ""
        if not api_key:
            raise ValueError(
                "OpenAI embedding provider selected but no API key configured "
                "(set LLM_API_KEY or ZHIPUAI_API_KEY)."
            )
        kwargs: Dict[str, Any] = {
            "api_key": api_key,
            "model_name": getattr(self.config, "openai_embedding_model", "text-embedding-3-small"),
        }
        base_url = getattr(self.config, "embedding_base_url", "") or ""
        if base_url:
            kwargs["api_base"] = base_url
        return embedding_functions.OpenAIEmbeddingFunction(**kwargs)

    def close(self) -> None:
        """关闭连接"""
        self._client = None
        self._collections.clear()
        logger.info("ChromaDB connection closed")

    def _get_collection(self, collection_name: str) -> Any:
        """获取或创建集合"""
        if self._client is None:
            self.connect()

        if collection_name not in self._collections:
            self._collections[collection_name] = self._client.get_or_create_collection(
                name=collection_name,
                embedding_function=self._embedding_function,
                metadata={"hnsw:space": "cosine"}
            )
            logger.info(f"Got/Created collection: {collection_name}")

        return self._collections[collection_name]

    # ==================== 代码实体索引 ====================

    def index_functions(
        self,
        functions: List[Dict[str, Any]],
        project_id: int
    ) -> int:
        """
        索引函数实体

        Args:
            functions: 函数列表，每个包含 name, signature, docstring, module_path, class_name
            project_id: 项目ID

        Returns:
            索引的实体数量
        """
        collection = self._get_collection(f"project_{project_id}_functions")

        if not functions:
            return 0

        ids = []
        documents = []
        metadatas = []

        for func in functions:
            # 构建文档文本（用于语义搜索）
            doc_text = f"{func.get('name', '')}"
            if func.get('signature'):
                doc_text += f" {func['signature']}"
            if func.get('docstring'):
                doc_text += f" {func['docstring']}"

            # 唯一ID
            entity_id = f"{func.get('module_path', '')}:{func.get('class_name', '')}:{func.get('name', '')}"

            ids.append(entity_id)
            documents.append(doc_text)
            metadatas.append({
                "name": func.get('name', ''),
                "module_path": func.get('module_path', ''),
                "class_name": func.get('class_name', ''),
                "signature": func.get('signature', ''),
                "line_start": func.get('line_start', 0),
                "line_end": func.get('line_end', 0),
                "type": "function"
            })

        # 批量添加
        collection.upsert(
            ids=ids,
            documents=documents,
            metadatas=metadatas
        )

        logger.info(f"Indexed {len(ids)} functions for project {project_id}")
        return len(ids)

    def index_classes(
        self,
        classes: List[Dict[str, Any]],
        project_id: int
    ) -> int:
        """索引类实体"""
        collection = self._get_collection(f"project_{project_id}_classes")

        if not classes:
            return 0

        ids = []
        documents = []
        metadatas = []

        for cls in classes:
            doc_text = f"class {cls.get('name', '')}"
            if cls.get('docstring'):
                doc_text += f" {cls['docstring']}"

            entity_id = f"{cls.get('module_path', '')}:{cls.get('name', '')}"

            ids.append(entity_id)
            documents.append(doc_text)
            metadatas.append({
                "name": cls.get('name', ''),
                "module_path": cls.get('module_path', ''),
                "docstring": cls.get('docstring', ''),
                "line_start": cls.get('line_start', 0),
                "line_end": cls.get('line_end', 0),
                "type": "class"
            })

        collection.upsert(
            ids=ids,
            documents=documents,
            metadatas=metadatas
        )

        logger.info(f"Indexed {len(ids)} classes for project {project_id}")
        return len(ids)

    # ==================== 语义搜索 ====================

    def search_functions(
        self,
        query: str,
        project_id: int,
        top_k: int = 10,
        where_filter: Optional[Dict] = None
    ) -> List[Dict[str, Any]]:
        """
        语义搜索函数

        Args:
            query: 查询文本
            project_id: 项目ID
            top_k: 返回结果数量
            where_filter: 元数据过滤条件

        Returns:
            匹配的函数列表
        """
        collection = self._get_collection(f"project_{project_id}_functions")

        results = collection.query(
            query_texts=[query],
            n_results=top_k,
            where=where_filter,
            include=["documents", "metadatas", "distances"]
        )

        if not results['ids'] or not results['ids'][0]:
            return []

        # 格式化结果
        formatted_results = []
        for i, doc_id in enumerate(results['ids'][0]):
            formatted_results.append({
                "id": doc_id,
                "document": results['documents'][0][i] if results['documents'] else "",
                "metadata": results['metadatas'][0][i] if results['metadatas'] else {},
                "distance": results['distances'][0][i] if results['distances'] else 0,
                "relevance_score": 1 - (results['distances'][0][i] if results['distances'] else 0)
            })

        return formatted_results

    def search_classes(
        self,
        query: str,
        project_id: int,
        top_k: int = 10
    ) -> List[Dict[str, Any]]:
        """语义搜索类"""
        collection = self._get_collection(f"project_{project_id}_classes")

        results = collection.query(
            query_texts=[query],
            n_results=top_k,
            include=["documents", "metadatas", "distances"]
        )

        if not results['ids'] or not results['ids'][0]:
            return []

        formatted_results = []
        for i, doc_id in enumerate(results['ids'][0]):
            formatted_results.append({
                "id": doc_id,
                "document": results['documents'][0][i] if results['documents'] else "",
                "metadata": results['metadatas'][0][i] if results['metadatas'] else {},
                "distance": results['distances'][0][i] if results['distances'] else 0,
                "relevance_score": 1 - (results['distances'][0][i] if results['distances'] else 0)
            })

        return formatted_results

    def search_all(
        self,
        query: str,
        project_id: int,
        top_k: int = 10
    ) -> Dict[str, List[Dict[str, Any]]]:
        """搜索所有类型的代码实体"""
        return {
            "functions": self.search_functions(query, project_id, top_k),
            "classes": self.search_classes(query, project_id, top_k)
        }

    # ==================== 集合管理 ====================

    def delete_project_collections(self, project_id: int) -> None:
        """删除项目的所有集合"""
        if self._client is None:
            self.connect()

        collection_names = [
            f"project_{project_id}_functions",
            f"project_{project_id}_classes"
        ]

        for name in collection_names:
            try:
                self._client.delete_collection(name)
                if name in self._collections:
                    del self._collections[name]
                logger.info(f"Deleted collection: {name}")
            except Exception as e:
                logger.warning(f"Failed to delete collection {name}: {e}")

    def get_collection_stats(self, project_id: int) -> Dict[str, int]:
        """获取集合统计信息"""
        stats = {}

        for collection_type in ["functions", "classes"]:
            collection_name = f"project_{project_id}_{collection_type}"
            try:
                collection = self._get_collection(collection_name)
                stats[f"{collection_type}_count"] = collection.count()
            except Exception:
                stats[f"{collection_type}_count"] = 0

        return stats


# 全局客户端实例
_chromadb_client: Optional[ChromaDBClient] = None


def get_chromadb_client() -> ChromaDBClient:
    """获取 ChromaDB 客户端单例"""
    global _chromadb_client
    if _chromadb_client is None:
        _chromadb_client = ChromaDBClient()
        _chromadb_client.connect()
    return _chromadb_client


def close_chromadb_client() -> None:
    """关闭 ChromaDB 客户端"""
    global _chromadb_client
    if _chromadb_client:
        _chromadb_client.close()
        _chromadb_client = None
