"""
Neo4j Client - 图数据库客户端

提供代码知识图谱的存储和查询功能
"""
import logging
from typing import Optional, List, Dict, Any
from contextlib import asynccontextmanager

from neo4j import AsyncGraphDatabase, AsyncDriver, AsyncSession
from neo4j.exceptions import ServiceUnavailable, AuthError
from tenacity import retry, stop_after_attempt, wait_exponential

from app.services.code_graph.config import CodeGraphConfig, code_graph_config

logger = logging.getLogger(__name__)


class Neo4jClient:
    """Neo4j 异步客户端"""

    def __init__(self, config: Optional[CodeGraphConfig] = None):
        self.config = config or code_graph_config
        self._driver: Optional[AsyncDriver] = None

    async def connect(self) -> None:
        """建立连接"""
        if self._driver is not None:
            return

        try:
            self._driver = AsyncGraphDatabase.driver(
                self.config.neo4j_uri,
                auth=(self.config.neo4j_user, self.config.neo4j_password),
                max_connection_pool_size=50,
                connection_timeout=30,
            )
            # 验证连接
            await self._driver.verify_connectivity()
            logger.info(f"Connected to Neo4j at {self.config.neo4j_uri}")
        except AuthError as e:
            logger.error(f"Neo4j authentication failed: {e}")
            raise
        except ServiceUnavailable as e:
            logger.error(f"Neo4j service unavailable: {e}")
            raise

    async def close(self) -> None:
        """关闭连接"""
        if self._driver:
            await self._driver.close()
            self._driver = None
            logger.info("Neo4j connection closed")

    @asynccontextmanager
    async def session(self) -> AsyncSession:
        """获取会话上下文管理器"""
        if self._driver is None:
            await self.connect()
        async with self._driver.session(database=self.config.neo4j_database) as session:
            yield session

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def execute_query(
        self,
        query: str,
        parameters: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        """执行 Cypher 查询"""
        async with self.session() as session:
            result = await session.run(query, parameters or {})
            records = await result.data()
            return records

    # ==================== 节点操作 ====================

    async def create_project(
        self,
        project_id: int,
        name: str,
        language: str
    ) -> Dict[str, Any]:
        """创建项目节点"""
        query = """
        MERGE (p:Project {id: $project_id})
        SET p.name = $name, p.language = $language
        RETURN p
        """
        result = await self.execute_query(query, {
            "project_id": project_id,
            "name": name,
            "language": language
        })
        return result[0] if result else None

    async def create_module(
        self,
        project_id: int,
        module_name: str,
        module_path: str
    ) -> Dict[str, Any]:
        """创建模块节点并关联到项目"""
        # 使用 OPTIONAL MATCH 使得即使 Project 不存在也能创建 Module
        query = """
        MERGE (m:Module {path: $module_path})
        SET m.name = $module_name, m.project_id = $project_id
        WITH m
        OPTIONAL MATCH (p:Project {id: $project_id})
        WITH m, p
        FOREACH (_ IN CASE WHEN p IS NOT NULL THEN [1] ELSE [] END |
            MERGE (p)-[:CONTAINS]->(m)
        )
        RETURN m
        """
        result = await self.execute_query(query, {
            "project_id": project_id,
            "module_name": module_name,
            "module_path": module_path
        })
        return result[0] if result else None

    async def create_class(
        self,
        module_path: str,
        class_name: str,
        docstring: Optional[str] = None,
        line_start: Optional[int] = None,
        line_end: Optional[int] = None
    ) -> Dict[str, Any]:
        """创建类节点"""
        # 使用 MERGE 确保即使 Module 不存在也能创建 Class
        query = """
        MERGE (c:Class {name: $class_name, module_path: $module_path})
        SET c.docstring = $docstring,
            c.line_start = $line_start,
            c.line_end = $line_end
        WITH c
        MERGE (m:Module {path: $module_path})
        MERGE (m)-[:CONTAINS]->(c)
        RETURN c
        """
        result = await self.execute_query(query, {
            "module_path": module_path,
            "class_name": class_name,
            "docstring": docstring,
            "line_start": line_start,
            "line_end": line_end
        })
        return result[0] if result else None

    async def create_function(
        self,
        module_path: str,
        function_name: str,
        class_name: Optional[str] = None,
        signature: Optional[str] = None,
        docstring: Optional[str] = None,
        line_start: Optional[int] = None,
        line_end: Optional[int] = None,
        complexity: Optional[int] = None
    ) -> Dict[str, Any]:
        """创建函数节点"""
        if class_name:
            # 类方法 - 使用 MERGE 确保即使 Class 不存在也能创建 Function
            query = """
            MERGE (f:Function {name: $function_name, module_path: $module_path, class_name: $class_name})
            SET f.signature = $signature,
                f.docstring = $docstring,
                f.line_start = $line_start,
                f.line_end = $line_end,
                f.complexity = $complexity
            WITH f
            MERGE (c:Class {name: $class_name, module_path: $module_path})
            MERGE (c)-[:HAS_METHOD]->(f)
            RETURN f
            """
        else:
            # 模块级函数 - 使用 MERGE 确保即使 Module 不存在也能创建 Function
            query = """
            MERGE (f:Function {name: $function_name, module_path: $module_path})
            SET f.signature = $signature,
                f.docstring = $docstring,
                f.line_start = $line_start,
                f.line_end = $line_end,
                f.complexity = $complexity
            WITH f
            MERGE (m:Module {path: $module_path})
            MERGE (m)-[:CONTAINS]->(f)
            RETURN f
            """
        result = await self.execute_query(query, {
            "module_path": module_path,
            "function_name": function_name,
            "class_name": class_name,
            "signature": signature,
            "docstring": docstring,
            "line_start": line_start,
            "line_end": line_end,
            "complexity": complexity
        })
        return result[0] if result else None

    async def create_import(
        self,
        module_path: str,
        import_module: str,
        alias: Optional[str] = None,
        names: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """创建导入节点"""
        # Neo4j refuses MERGE on a null property; imports without an alias
        # (the common case) merge on an empty-string alias instead so that
        # ``import os`` and ``import os as o`` remain distinct nodes.
        # ``names`` are the symbols of ``from X import a, b`` and are stored so
        # the retriever can surface imported symbols as graph neighbors.
        query = """
        MERGE (i:Import {module: $import_module, alias: $alias, module_path: $module_path})
        SET i.names = $names
        WITH i
        MERGE (m:Module {path: $module_path})
        MERGE (m)-[:HAS_IMPORT]->(i)
        RETURN i
        """
        result = await self.execute_query(query, {
            "module_path": module_path,
            "import_module": import_module,
            "alias": alias or "",
            "names": names or [],
        })
        return result[0] if result else None

    # ==================== 关系操作 ====================

    async def create_call_relationship(
        self,
        caller_module: str,
        caller_function: str,
        caller_class: Optional[str],
        callee_function: str,
        callee_class: Optional[str] = None
    ) -> None:
        """创建函数调用关系"""
        # ``class_name`` is NULL for module-level functions, and Cypher refuses to
        # match a null inside a property map (``{class_name: null}`` matches
        # nothing). The old query carried class_name in the caller map, so every
        # CALLS edge whose caller was a top-level function (register, login, ...)
        # was silently dropped while methods worked. Match the caller by
        # name+module and compare class_name with null-coalescing so both methods
        # and module-level functions resolve. (The old callee WHERE was a
        # tautology and is removed.)
        query = """
        MATCH (caller:Function {name: $caller_function, module_path: $caller_module})
        WHERE coalesce(caller.class_name, '') = coalesce($caller_class, '')
        MATCH (callee:Function {name: $callee_function})
        MERGE (caller)-[:CALLS]->(callee)
        """
        await self.execute_query(query, {
            "caller_module": caller_module,
            "caller_function": caller_function,
            "caller_class": caller_class,
            "callee_function": callee_function,
            "callee_class": callee_class
        })

    async def create_inheritance_relationship(
        self,
        child_class: str,
        parent_class: str,
        module_path: str
    ) -> None:
        """创建类继承关系"""
        query = """
        MATCH (child:Class {name: $child_class, module_path: $module_path})
        MATCH (parent:Class {name: $parent_class})
        MERGE (child)-[:INHERITS_FROM]->(parent)
        """
        await self.execute_query(query, {
            "child_class": child_class,
            "parent_class": parent_class,
            "module_path": module_path
        })

    # ==================== 查询操作 ====================

    async def get_function_callers(
        self,
        function_name: str,
        module_path: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """获取调用指定函数的所有函数"""
        if module_path:
            query = """
            MATCH (caller:Function)-[:CALLS]->(callee:Function {name: $function_name, module_path: $module_path})
            RETURN caller.name as name, caller.module_path as module_path, caller.class_name as class_name
            """
        else:
            query = """
            MATCH (caller:Function)-[:CALLS]->(callee:Function {name: $function_name})
            RETURN caller.name as name, caller.module_path as module_path, caller.class_name as class_name
            """
        return await self.execute_query(query, {"function_name": function_name, "module_path": module_path})

    async def get_function_callees(
        self,
        function_name: str,
        module_path: Optional[str] = None,
        class_name: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """获取指定函数调用的所有函数"""
        query = """
        MATCH (caller:Function {name: $function_name})-[:CALLS]->(callee:Function)
        RETURN callee.name as name, callee.module_path as module_path, callee.class_name as class_name
        """
        return await self.execute_query(query, {"function_name": function_name})

    async def get_class_methods(self, class_name: str, module_path: str) -> List[Dict[str, Any]]:
        """获取类的所有方法"""
        query = """
        MATCH (c:Class {name: $class_name, module_path: $module_path})-[:HAS_METHOD]->(m:Function)
        RETURN m.name as name, m.signature as signature, m.docstring as docstring, m.complexity as complexity
        """
        return await self.execute_query(query, {"class_name": class_name, "module_path": module_path})

    async def get_impact_analysis(
        self,
        entity_name: str,
        entity_type: str = "function",
        max_depth: int = 3
    ) -> Dict[str, Any]:
        """
        影响范围分析

        Args:
            entity_name: 实体名称
            entity_type: 实体类型 (function, class)
            max_depth: 最大搜索深度

        Returns:
            受影响的实体列表
        """
        if entity_type == "function":
            query = f"""
            MATCH path = (caller:Function)-[:CALLS*1..{max_depth}]->(target:Function {{name: $entity_name}})
            RETURN DISTINCT caller.name as name,
                   caller.module_path as module_path,
                   caller.class_name as class_name,
                   length(path) as distance
            ORDER BY distance
            """
        else:
            query = f"""
            MATCH path = (child:Class)-[:INHERITS_FROM*1..{max_depth}]->(target:Class {{name: $entity_name}})
            RETURN DISTINCT child.name as name,
                   child.module_path as module_path,
                   length(path) as distance
            ORDER BY distance
            """
        results = await self.execute_query(query, {"entity_name": entity_name})
        return {
            "source": entity_name,
            "type": entity_type,
            "impacted": results,
            "total_count": len(results)
        }

    async def find_call_paths(
        self,
        source_function: str,
        target_function: str,
        max_depth: int = 5
    ) -> List[List[Dict[str, Any]]]:
        """查找两个函数之间的调用路径"""
        query = f"""
        MATCH path = shortestPath(
            (source:Function {{name: $source}})-[:CALLS*1..{max_depth}]->(target:Function {{name: $target}})
        )
        RETURN [node in nodes(path) | {{name: node.name, module_path: node.module_path, class_name: node.class_name}}] as path
        LIMIT 10
        """
        results = await self.execute_query(query, {
            "source": source_function,
            "target": target_function
        })
        return [r["path"] for r in results]

    async def search_entities(
        self,
        search_term: str,
        entity_type: Optional[str] = None,
        limit: int = 20
    ) -> List[Dict[str, Any]]:
        """搜索实体"""
        if entity_type:
            query = f"""
            MATCH (e:{entity_type})
            WHERE e.name CONTAINS $search_term OR e.docstring CONTAINS $search_term
            RETURN e.name as name, e.module_path as module_path, e.class_name as class_name,
                   e.docstring as docstring, labels(e) as labels
            LIMIT $limit
            """
        else:
            query = """
            MATCH (e)
            WHERE (e:Function OR e:Class OR e:Module)
            AND (e.name CONTAINS $search_term OR e.docstring CONTAINS $search_term)
            RETURN e.name as name, e.module_path as module_path, e.class_name as class_name,
                   e.docstring as docstring, labels(e) as labels
            LIMIT $limit
            """
        return await self.execute_query(query, {"search_term": search_term, "limit": limit})

    async def get_entity(
        self,
        name: str,
        module_path: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Fetch a single Function/Class node's core metadata by exact name.

        Returns {name, module_path, class_name, type, signature, docstring}
        for the first match (deterministic ORDER BY module_path), or None if
        no Function/Class node has that exact name. ``type`` is "class" when
        the node carries the Class label, else "function".
        """
        if module_path:
            query = """
            MATCH (e)
            WHERE (e:Function OR e:Class)
              AND e.name = $name AND e.module_path = $module_path
            RETURN e.name AS name, e.module_path AS module_path,
                   e.class_name AS class_name, labels(e) AS labels,
                   e.signature AS signature, e.docstring AS docstring
            ORDER BY e.module_path
            LIMIT 1
            """
        else:
            query = """
            MATCH (e)
            WHERE (e:Function OR e:Class) AND e.name = $name
            RETURN e.name AS name, e.module_path AS module_path,
                   e.class_name AS class_name, labels(e) AS labels,
                   e.signature AS signature, e.docstring AS docstring
            ORDER BY e.module_path
            LIMIT 1
            """
        rows = await self.execute_query(
            query, {"name": name, "module_path": module_path}
        )
        if not rows:
            return None
        row = rows[0]
        labels = row.get("labels") or []
        entity_type = "class" if "Class" in labels else "function"
        return {
            "name": row.get("name"),
            "module_path": row.get("module_path"),
            "class_name": row.get("class_name"),
            "type": entity_type,
            "signature": row.get("signature"),
            "docstring": row.get("docstring"),
        }


    async def batch_get_entity_context(
        self,
        entity_names: List[str],
        limit: int = 5
    ) -> List[Dict[str, Any]]:
        """
        Batch get context for multiple entities using UNWIND for efficient queries.

        Args:
            entity_names: List of entity names to search for
            limit: Maximum number of related entities to return per entity

        Returns:
            List of entity context dictionaries
        """
        if not entity_names:
            return []

        entity_names = entity_names[:5]
        graph_context = []

        try:
            entities_query = """
            UNWIND $entity_names AS name
            MATCH (e)
            WHERE (e:Function OR e:Class OR e:Module)
            AND e.name CONTAINS name
            RETURN e.name as name, e.module_path as module_path, e.class_name as class_name,
                   e.docstring as docstring, labels(e) as labels, name as search_term
            LIMIT $limit
            """
            entities_result = await self.execute_query(
                entities_query,
                {"entity_names": entity_names, "limit": limit * len(entity_names)}
            )
            graph_context.extend(entities_result)

            callers_query = """
            UNWIND $entity_names AS name
            MATCH (caller:Function)-[:CALLS]->(callee:Function {name: name})
            WITH name, count(caller) as callers_count
            RETURN name, callers_count
            """
            callers_result = await self.execute_query(
                callers_query,
                {"entity_names": entity_names}
            )
            callers_map = {r["name"]: r["callers_count"] for r in callers_result}

            callees_query = """
            UNWIND $entity_names AS name
            MATCH (caller:Function {name: name})-[:CALLS]->(callee:Function)
            WITH name, count(callee) as callees_count
            RETURN name, callees_count
            """
            callees_result = await self.execute_query(
                callees_query,
                {"entity_names": entity_names}
            )
            callees_map = {r["name"]: r["callees_count"] for r in callees_result}

            for entity_name in entity_names:
                callers_count = callers_map.get(entity_name, 0)
                callees_count = callees_map.get(entity_name, 0)
                if callers_count > 0 or callees_count > 0:
                    graph_context.append({
                        "entity": entity_name,
                        "callers_count": callers_count,
                        "callees_count": callees_count
                    })

        except Exception as e:
            logger.warning(f"Batch entity context query failed: {e}")

        return graph_context

    async def get_entity_neighbors(
        self,
        seeds: List[Dict[str, Any]],
        max_depth: int = 2,
        limit: int = 20,
    ) -> List[Dict[str, Any]]:
        """Return real graph neighbors of semantic-hit seed entities.

        ``seeds`` are descriptors {name, module_path, class_name, type,
        relevance_score} taken from the top semantic hits. Returns flat records
        {name, module_path, relation, source} where ``relation`` is one of
        callee/caller/method/parent/child/import. Results are deduped by name,
        ranked by the seeding hit's relevance_score (then relation priority),
        and capped at ``limit``.
        """
        relation_priority = {
            "callee": 0, "caller": 1, "import": 2,
            "method": 3, "parent": 4, "child": 5,
        }
        candidates: List[tuple] = []  # (score, priority, record)

        def add(score, relation, name, module_path, source):
            if not name:
                return
            candidates.append((
                score, relation_priority[relation],
                {"name": name, "module_path": module_path,
                 "relation": relation, "source": source},
            ))

        for seed in seeds:
            name = seed.get("name")
            module_path = seed.get("module_path")
            stype = seed.get("type")
            score = seed.get("relevance_score") or 0.0
            if not name:
                continue

            try:
                if stype == "function":
                    class_name = seed.get("class_name")
                    if class_name:
                        fkey = "{name: $name, module_path: $module_path, class_name: $class_name}"
                        fparams = {"name": name, "module_path": module_path, "class_name": class_name}
                    else:
                        fkey = "{name: $name, module_path: $module_path}"
                        fparams = {"name": name, "module_path": module_path}

                    callees = await self.execute_query(
                        f"""
                        MATCH (f:Function {fkey})
                              -[:CALLS*1..{max_depth}]->(callee:Function)
                        RETURN DISTINCT callee.name AS name, callee.module_path AS module_path
                        """,
                        fparams,
                    )
                    for r in callees:
                        add(score, "callee", r.get("name"), r.get("module_path"), name)

                    callers = await self.execute_query(
                        f"""
                        MATCH (caller:Function)-[:CALLS*1..{max_depth}]->
                              (f:Function {fkey})
                        RETURN DISTINCT caller.name AS name, caller.module_path AS module_path
                        """,
                        fparams,
                    )
                    for r in callers:
                        add(score, "caller", r.get("name"), r.get("module_path"), name)

                elif stype == "class":
                    methods = await self.execute_query(
                        """
                        MATCH (c:Class {name: $name, module_path: $module_path})-[:HAS_METHOD]->(m:Function)
                        RETURN DISTINCT m.name AS name, m.module_path AS module_path
                        """,
                        {"name": name, "module_path": module_path},
                    )
                    for r in methods:
                        add(score, "method", r.get("name"), r.get("module_path"), name)

                    parents = await self.execute_query(
                        f"""
                        MATCH (c:Class {{name: $name, module_path: $module_path}})
                              -[:INHERITS_FROM*1..{max_depth}]->(p:Class)
                        RETURN DISTINCT p.name AS name, p.module_path AS module_path
                        """,
                        {"name": name, "module_path": module_path},
                    )
                    for r in parents:
                        add(score, "parent", r.get("name"), r.get("module_path"), name)

                    children = await self.execute_query(
                        f"""
                        MATCH (child:Class)-[:INHERITS_FROM*1..{max_depth}]->
                              (c:Class {{name: $name, module_path: $module_path}})
                        RETURN DISTINCT child.name AS name, child.module_path AS module_path
                        """,
                        {"name": name, "module_path": module_path},
                    )
                    for r in children:
                        add(score, "child", r.get("name"), r.get("module_path"), name)

                if module_path:
                    imports = await self.execute_query(
                        """
                        MATCH (m:Module {path: $module_path})-[:HAS_IMPORT]->(i:Import)
                        RETURN i.names AS names
                        """,
                        {"module_path": module_path},
                    )
                    for r in imports:
                        for sym in (r.get("names") or []):
                            add(score, "import", sym, None, name)
            except Exception as e:  # pragma: no cover - defensive per-seed isolation
                logger.warning(f"Neighbor query failed for seed {name}: {e}")

        candidates.sort(key=lambda t: (-t[0], t[1]))
        # Dedup by bare name (not name+module_path) on purpose: downstream the
        # eval metric and the generation context treat neighbors as bare symbol
        # names, so keeping distinct names maximizes coverage under `limit`.
        out: List[Dict[str, Any]] = []
        seen = set()
        for _, _, rec in candidates:
            if rec["name"] in seen:
                continue
            seen.add(rec["name"])
            out.append(rec)
            if len(out) >= limit:
                break
        return out

    async def get_graph_stats(self, project_id: Optional[int] = None) -> Dict[str, int]:
        """获取图谱统计信息"""
        stats = {}

        # 统计各类节点数量
        node_types = ["Project", "Module", "Class", "Function", "Import"]
        for node_type in node_types:
            query = f"MATCH (n:{node_type}) RETURN count(n) as count"
            result = await self.execute_query(query)
            stats[f"{node_type.lower()}_count"] = result[0]["count"] if result else 0

        # 统计关系数量
        rel_query = "MATCH ()-[r]->() RETURN count(r) as count"
        result = await self.execute_query(rel_query)
        stats["relationship_count"] = result[0]["count"] if result else 0

        return stats

    async def clear_project_graph(self, project_id: int) -> None:
        """清除项目的所有图谱数据"""
        query = """
        MATCH (p:Project {id: $project_id})-[r]-()
        DELETE r
        WITH p
        MATCH (m:Module {project_id: $project_id})-[r2]-()
        DELETE r2
        WITH m
        DETACH DELETE m
        """
        await self.execute_query(query, {"project_id": project_id})

    async def clear_module_graph(self, module_path: str) -> None:
        """清除指定模块的所有图谱数据（包括相关的函数、类、导入）"""
        query = """
        // 删除模块的所有关系和节点
        MATCH (m:Module {path: $module_path})
        OPTIONAL MATCH (m)-[:CONTAINS]->(c:Class)
        OPTIONAL MATCH (m)-[:CONTAINS]->(f:Function)
        OPTIONAL MATCH (m)-[:HAS_IMPORT]->(i:Import)
        OPTIONAL MATCH (c)-[:HAS_METHOD]->(mf:Function)

        // 删除所有相关节点
        DETACH DELETE c
        DETACH DELETE f
        DETACH DELETE i
        DETACH DELETE mf
        DETACH DELETE m
        """
        await self.execute_query(query, {"module_path": module_path})
        logger.info(f"Cleared graph data for module: {module_path}")


# 全局客户端实例
_neo4j_client: Optional[Neo4jClient] = None


async def get_neo4j_client() -> Neo4jClient:
    """获取 Neo4j 客户端单例"""
    global _neo4j_client
    if _neo4j_client is None:
        _neo4j_client = Neo4jClient()
        await _neo4j_client.connect()
    return _neo4j_client


async def close_neo4j_client() -> None:
    """关闭 Neo4j 客户端"""
    global _neo4j_client
    if _neo4j_client:
        await _neo4j_client.close()
        _neo4j_client = None
