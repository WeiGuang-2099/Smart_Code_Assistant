"""
Code Graph Retriever - 代码图谱检索器

结合向量搜索和图遍历的混合检索
"""
import asyncio
import hashlib
import logging
from typing import Optional, List, Dict, Any

from app.services.code_graph.config import CodeGraphConfig, code_graph_config
from app.services.code_graph.neo4j_client import Neo4jClient, get_neo4j_client
from app.services.code_graph.chromadb_client import ChromaDBClient, get_chromadb_client
from app.core.cache import global_cache_manager

logger = logging.getLogger(__name__)

RETRIEVAL_CACHE_TTL = 300
GRAPH_SEED_COUNT = 5  # number of top semantic hits used to seed graph traversal

# Seed-scoring priors. Eval evidence (spec 2026-07-07): for "how does X work"
# questions the embedding model ranks schema/exception classes above the
# entry-point function whose call/import neighbors answer the question, so
# traversal seeds from the wrong nodes. Discount those node types for seed
# ordering only -- semantic_results ordering is never touched.
SEED_TYPE_WEIGHTS = {"function": 1.0, "class": 0.7}
SEED_SCHEMA_PATH_PENALTY = 0.3   # Pydantic request/response models
SEED_EXCEPTION_PENALTY = 0.4     # *Error / *Exception names, exceptions modules


def _score_seed(metadata: Dict[str, Any], relevance_score: float) -> float:
    """Seed priority = semantic relevance discounted by how unlikely the
    node type is to have useful call/import neighbors."""
    score = relevance_score * SEED_TYPE_WEIGHTS.get(
        metadata.get("type"), SEED_TYPE_WEIGHTS["class"])
    module_path = (metadata.get("module_path") or "").replace("\\", "/")
    name = metadata.get("name") or ""
    if "app/schemas/" in module_path:
        score *= SEED_SCHEMA_PATH_PENALTY
    if name.endswith(("Error", "Exception")) or "exceptions" in module_path:
        score *= SEED_EXCEPTION_PENALTY
    return score


class CodeGraphRetriever:
    """代码图谱混合检索器"""

    def __init__(
        self,
        config: Optional[CodeGraphConfig] = None,
        neo4j_client: Optional[Neo4jClient] = None,
        chromadb_client: Optional[ChromaDBClient] = None
    ):
        self.config = config or code_graph_config
        self._neo4j = neo4j_client
        self._chromadb = chromadb_client

    async def _get_neo4j(self) -> Neo4jClient:
        if self._neo4j is None:
            self._neo4j = await get_neo4j_client()
        return self._neo4j

    def _get_chromadb(self) -> ChromaDBClient:
        if self._chromadb is None:
            self._chromadb = get_chromadb_client()
        return self._chromadb

    async def retrieve(
        self,
        query: str,
        project_id: Optional[int] = None,
        top_k: int = 10,
        include_graph_context: bool = True,
        max_depth: int = 2
    ) -> Dict[str, Any]:
        """
        Hybrid retrieval with parallel semantic and graph queries and caching.

        Args:
            query: 查询文本
            project_id: 项目ID
            top_k: 返回结果数量
            include_graph_context: 是否包含图遍历上下文
            max_depth: 图遍历最大深度

        Returns:
            检索结果
        """
        cache_key_data = f"{query}:{project_id}:{top_k}:{include_graph_context}:{max_depth}"
        cache_key = f"retrieval:{hashlib.sha256(cache_key_data.encode()).hexdigest()[:32]}"

        cached_result = await global_cache_manager.get(cache_key)
        if cached_result is not None:
            logger.debug(f"Retrieval cache hit for query: {query[:30]}")
            return cached_result

        result = {
            "query": query,
            "semantic_results": [],
            "graph_context": None,
            "combined_context": ""
        }

        async def semantic_search():
            if project_id and self.config.enable_semantic_search:
                try:
                    chromadb = self._get_chromadb()
                    return await asyncio.to_thread(
                        chromadb.search_all, query, project_id, top_k
                    )
                except Exception as e:
                    logger.warning(f"Semantic search failed: {e}")
            return {}

        # Semantic search first; the graph branch seeds from its hits.
        semantic_results = await semantic_search()
        result["semantic_results"] = semantic_results

        graph_context = None
        if include_graph_context:
            try:
                neo4j = await self._get_neo4j()
                seeds = self._seed_entities_from_semantic(semantic_results, GRAPH_SEED_COUNT)
                graph_context = await neo4j.get_entity_neighbors(seeds, max_depth=max_depth)
            except Exception as e:
                logger.warning(f"Graph traversal failed: {e}")
                graph_context = None
        result["graph_context"] = graph_context

        result["combined_context"] = self._build_combined_context(result)

        await global_cache_manager.set(cache_key, result, ttl=RETRIEVAL_CACHE_TTL)
        logger.debug(f"Retrieval result cached for query: {query[:30]}")

        return result


    def _seed_entities_from_semantic(self, semantic_results, n: int) -> list:
        """Pick the top-n graph-traversal seeds from all semantic hits.

        Ordering uses _score_seed (relevance discounted by node-type priors);
        the semantic_results payload itself is never reordered. Descriptors
        keep the raw relevance_score (Neo4j ranking contract)."""
        chunks = []
        if isinstance(semantic_results, dict):
            for lst in semantic_results.values():
                if isinstance(lst, list):
                    chunks.extend(c for c in lst if isinstance(c, dict))
        elif isinstance(semantic_results, list):
            chunks = [c for c in semantic_results if isinstance(c, dict)]
        chunks.sort(
            key=lambda c: _score_seed(c.get("metadata") or {},
                                      c.get("relevance_score", 0)),
            reverse=True,
        )

        seeds = []
        for c in chunks[:n]:
            md = c.get("metadata") or {}
            seeds.append({
                "name": md.get("name"),
                "module_path": md.get("module_path"),
                "class_name": md.get("class_name"),
                "type": md.get("type"),
                "relevance_score": c.get("relevance_score", 0),
            })
        return seeds

    def _build_combined_context(self, result: Dict[str, Any]) -> str:
        """构建组合上下文字符串"""
        context_parts = []

        # 添加语义搜索结果
        semantic = result.get("semantic_results", {})
        if semantic:
            if semantic.get("functions"):
                context_parts.append("相关函数:")
                for func in semantic["functions"][:5]:
                    metadata = func.get("metadata", {})
                    context_parts.append(
                        f"  - {metadata.get('name', 'unknown')} "
                        f"({metadata.get('module_path', '')})"
                    )

            if semantic.get("classes"):
                context_parts.append("相关类:")
                for cls in semantic["classes"][:5]:
                    metadata = cls.get("metadata", {})
                    context_parts.append(
                        f"  - {metadata.get('name', 'unknown')} "
                        f"({metadata.get('module_path', '')})"
                    )

        # 添加图上下文
        graph_ctx = result.get("graph_context")
        if graph_ctx:
            context_parts.append("图谱关系:")
            for ctx in graph_ctx[:10]:
                relation = ctx.get("relation", "related")
                module_path = ctx.get("module_path") or ""
                context_parts.append(
                    f"  - {ctx.get('name')} [{relation}] ({module_path})"
                )

        return "\n".join(context_parts) if context_parts else ""

    async def get_dependencies(
        self,
        entity_name: str,
        dep_type: str = "all"
    ) -> Dict[str, Any]:
        """
        获取实体的依赖关系

        Args:
            entity_name: 实体名称
            dep_type: 依赖类型 (callers, callees, imports, all)

        Returns:
            依赖关系
        """
        neo4j = await self._get_neo4j()
        result = {"entity": entity_name, "type": dep_type}

        if dep_type in ["callers", "all"]:
            result["callers"] = await neo4j.get_function_callers(entity_name)

        if dep_type in ["callees", "all"]:
            result["callees"] = await neo4j.get_function_callees(entity_name)

        return result

    async def analyze_impact(
        self,
        entity_name: str,
        entity_type: str = "function",
        max_depth: int = 3
    ) -> Dict[str, Any]:
        """
        分析代码变更的影响范围

        Args:
            entity_name: 实体名称
            entity_type: 实体类型
            max_depth: 最大搜索深度

        Returns:
            影响分析结果
        """
        neo4j = await self._get_neo4j()
        return await neo4j.get_impact_analysis(entity_name, entity_type, max_depth)

    async def find_paths(
        self,
        source: str,
        target: str,
        max_depth: int = 5
    ) -> List[List[Dict[str, Any]]]:
        """
        查找两个实体之间的调用路径

        Args:
            source: 起始实体
            target: 目标实体
            max_depth: 最大搜索深度

        Returns:
            路径列表
        """
        neo4j = await self._get_neo4j()
        return await neo4j.find_call_paths(source, target, max_depth)


# 全局检索器实例
_retriever: Optional[CodeGraphRetriever] = None


def get_retriever() -> CodeGraphRetriever:
    """获取检索器单例"""
    global _retriever
    if _retriever is None:
        _retriever = CodeGraphRetriever()
    return _retriever
