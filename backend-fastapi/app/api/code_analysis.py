"""
Code Analysis API Routes - 统一代码分析接口

整合基础代码分析和 GraphRAG 功能，提供一站式代码分析服务
"""
from typing import Optional, List, Dict, Any
from enum import Enum
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, Field

from app.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.services.code_tools import (
    analyze_code_structure,
    detect_code_smells,
    calculate_code_complexity,
    check_security_issues,
    build_code_graph,
    query_code_dependencies,
    analyze_impact,
    find_code_paths,
    search_code_semantic,
)

router = APIRouter()


# ============================================================================
# Enums
# ============================================================================

class AnalysisType(str, Enum):
    """分析类型"""
    STRUCTURE = "structure"          # 结构分析
    SMELLS = "smells"               # 代码坏味道
    COMPLEXITY = "complexity"        # 复杂度
    SECURITY = "security"           # 安全问题
    ALL_BASIC = "all_basic"         # 所有基础分析


class GraphAnalysisType(str, Enum):
    """图谱分析类型"""
    BUILD = "build"                 # 构建图谱
    DEPENDENCIES = "dependencies"   # 依赖查询
    IMPACT = "impact"              # 影响分析
    PATHS = "paths"                # 路径查找
    SEARCH = "search"              # 语义搜索


# ============================================================================
# Request/Response Schemas
# ============================================================================

class CodeAnalysisRequest(BaseModel):
    """代码分析请求"""
    code: str = Field(..., description="要分析的代码")
    language: str = Field(default="python", description="编程语言")
    analysis_types: List[AnalysisType] = Field(
        default=[AnalysisType.ALL_BASIC],
        description="分析类型列表"
    )


class CodeAnalysisResult(BaseModel):
    """单项分析结果"""
    type: str
    success: bool
    result: str
    error: Optional[str] = None


class CodeAnalysisResponse(BaseModel):
    """代码分析响应"""
    language: str
    total_analyses: int
    results: List[CodeAnalysisResult]


class FullAnalysisRequest(BaseModel):
    """完整分析请求（包含基础分析 + GraphRAG）"""
    code: str = Field(..., description="源代码")
    language: str = Field(default="python", description="编程语言")
    module_path: str = Field(default="unknown", description="模块路径")
    project_id: Optional[int] = Field(None, description="项目ID")
    enable_graph: bool = Field(default=True, description="是否启用图谱分析")
    enable_basic: bool = Field(default=True, description="是否启用基础分析")


class FullAnalysisResponse(BaseModel):
    """完整分析响应"""
    # 基础分析结果
    structure: Optional[str] = None
    smells: Optional[str] = None
    complexity: Optional[str] = None
    security: Optional[str] = None

    # 图谱分析结果
    graph_built: bool = False
    graph_stats: Optional[Dict[str, Any]] = None

    # 综合评估
    overall_score: int = 0
    summary: str = ""
    recommendations: List[str] = []


class GraphQueryRequest(BaseModel):
    """图谱查询请求"""
    query: str = Field(..., description="查询内容")
    project_id: int = Field(default=1, description="项目ID")
    query_type: GraphAnalysisType = Field(
        default=GraphAnalysisType.SEARCH,
        description="查询类型"
    )
    # 可选参数
    entity_name: Optional[str] = Field(None, description="实体名称（依赖查询/影响分析）")
    source: Optional[str] = Field(None, description="起始实体（路径查找）")
    target: Optional[str] = Field(None, description="目标实体（路径查找）")
    top_k: int = Field(default=10, description="返回结果数量")


class GraphQueryResponse(BaseModel):
    """图谱查询响应"""
    query_type: str
    success: bool
    result: Any
    error: Optional[str] = None


# ============================================================================
# API Endpoints
# ============================================================================

@router.post("/analyze", response_model=CodeAnalysisResponse)
async def analyze_code(
    request: CodeAnalysisRequest,
    current_user: User = Depends(get_current_user),
):
    """
    基础代码分析

    支持的分析类型：
    - structure: 结构分析
    - smells: 代码坏味道检测
    - complexity: 复杂度分析
    - security: 安全问题检测
    - all_basic: 所有基础分析
    """
    results = []
    code = request.code
    language = request.language

    analysis_types = request.analysis_types
    if AnalysisType.ALL_BASIC in analysis_types:
        analysis_types = [
            AnalysisType.STRUCTURE,
            AnalysisType.SMELLS,
            AnalysisType.COMPLEXITY,
            AnalysisType.SECURITY,
        ]

    for atype in analysis_types:
        try:
            if atype == AnalysisType.STRUCTURE:
                result = analyze_code_structure.invoke({"code": code, "language": language})
                results.append(CodeAnalysisResult(type="structure", success=True, result=result))

            elif atype == AnalysisType.SMELLS:
                result = detect_code_smells.invoke({"code": code, "language": language})
                results.append(CodeAnalysisResult(type="smells", success=True, result=result))

            elif atype == AnalysisType.COMPLEXITY:
                result = calculate_code_complexity.invoke({"code": code, "language": language})
                results.append(CodeAnalysisResult(type="complexity", success=True, result=result))

            elif atype == AnalysisType.SECURITY:
                result = check_security_issues.invoke({"code": code, "language": language})
                results.append(CodeAnalysisResult(type="security", success=True, result=result))

        except Exception as e:
            results.append(CodeAnalysisResult(
                type=atype.value,
                success=False,
                result="",
                error=str(e)
            ))

    return CodeAnalysisResponse(
        language=language,
        total_analyses=len(results),
        results=results
    )


@router.post("/full-analysis", response_model=FullAnalysisResponse)
async def full_analysis(
    request: FullAnalysisRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    完整代码分析（基础分析 + GraphRAG）

    一次性执行所有分析并返回综合报告
    """
    response = FullAnalysisResponse()
    code = request.code
    language = request.language

    scores = []

    # 1. 基础分析
    if request.enable_basic:
        try:
            response.structure = analyze_code_structure.invoke({
                "code": code,
                "language": language
            })
        except Exception as e:
            response.structure = f"Structure analysis failed: {str(e)}"

        try:
            response.smells = detect_code_smells.invoke({
                "code": code,
                "language": language
            })
            # 根据坏味道数量评分
            if "✅" in response.smells:
                scores.append(100)
            elif "⚠️" in response.smells:
                warning_count = response.smells.count("⚠️")
                scores.append(max(50, 100 - warning_count * 10))
            else:
                scores.append(70)
        except Exception as e:
            response.smells = f"Code smell detection failed: {str(e)}"
            scores.append(50)

        try:
            response.complexity = calculate_code_complexity.invoke({
                "code": code,
                "language": language
            })
            # 根据复杂度评分
            if "🟢" in response.complexity:
                scores.append(100)
            elif "🟡" in response.complexity:
                scores.append(75)
            elif "🟠" in response.complexity:
                scores.append(50)
            elif "🔴" in response.complexity:
                scores.append(25)
            else:
                scores.append(70)
        except Exception as e:
            response.complexity = f"Complexity analysis failed: {str(e)}"
            scores.append(50)

        try:
            response.security = check_security_issues.invoke({
                "code": code,
                "language": language
            })
            # 根据安全问题评分
            if "✅" in response.security:
                scores.append(100)
            elif "🔴" in response.security:
                scores.append(20)
            elif "🟠" in response.security:
                scores.append(50)
            elif "🟡" in response.security:
                scores.append(70)
            else:
                scores.append(80)
        except Exception as e:
            response.security = f"Security check failed: {str(e)}"
            scores.append(50)

    # 2. 构建图谱
    if request.enable_graph:
        try:
            graph_result = build_code_graph.invoke({
                "code": code,
                "language": language,
                "module_path": request.module_path
            })
            response.graph_built = "✅" in graph_result or "📊" in graph_result

            stats = _extract_graph_stats(graph_result)
            if stats is not None:
                response.graph_stats = stats
        except Exception as e:
            response.graph_built = False
            response.graph_stats = {"error": str(e)}

    # 3. 综合评估
    if scores:
        response.overall_score = sum(scores) // len(scores)

    response.summary = _generate_summary(response)
    response.recommendations = _generate_recommendations(response)

    return response


@router.post("/graph/query", response_model=GraphQueryResponse)
async def query_code_graph(
    request: GraphQueryRequest,
    current_user: User = Depends(get_current_user),
):
    """
    图谱查询接口

    支持的查询类型：
    - search: 语义搜索
    - dependencies: 依赖查询
    - impact: 影响分析
    - paths: 路径查找
    """
    try:
        if request.query_type == GraphAnalysisType.SEARCH:
            result = search_code_semantic.invoke({
                "query": request.query,
                "project_id": request.project_id,
                "top_k": request.top_k
            })
            return GraphQueryResponse(
                query_type="semantic_search",
                success=True,
                result=result
            )

        elif request.query_type == GraphAnalysisType.DEPENDENCIES:
            entity = request.entity_name or request.query
            result = query_code_dependencies.invoke({
                "entity_name": entity,
                "dep_type": "all"
            })
            return GraphQueryResponse(
                query_type="dependencies",
                success=True,
                result=result
            )

        elif request.query_type == GraphAnalysisType.IMPACT:
            entity = request.entity_name or request.query
            result = analyze_impact.invoke({
                "entity_name": entity,
                "change_type": "modify"
            })
            return GraphQueryResponse(
                query_type="impact_analysis",
                success=True,
                result=result
            )

        elif request.query_type == GraphAnalysisType.PATHS:
            if not request.source or not request.target:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Path finding requires 'source' and 'target' parameters"
                )
            result = find_code_paths.invoke({
                "source": request.source,
                "target": request.target,
                "max_depth": 5
            })
            return GraphQueryResponse(
                query_type="path_finding",
                success=True,
                result=result
            )

        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unknown query type: {request.query_type}"
            )

    except HTTPException:
        raise
    except Exception as e:
        return GraphQueryResponse(
            query_type=request.query_type.value,
            success=False,
            result=None,
            error=str(e)
        )


# ============================================================================
# Helper Functions
# ============================================================================

def _extract_graph_stats(graph_result: str) -> Optional[Dict[str, int]]:
    """Parse node/relationship counts out of build_code_graph's text output."""
    if "Nodes created:" not in graph_result:
        return None
    import re
    nodes_match = re.search(r"Nodes created:\s*(\d+)", graph_result)
    rels_match = re.search(r"Relationships created:\s*(\d+)", graph_result)
    return {
        "nodes": int(nodes_match.group(1)) if nodes_match else 0,
        "relationships": int(rels_match.group(1)) if rels_match else 0,
    }


def _generate_summary(response: FullAnalysisResponse) -> str:
    """Build the one-line analysis summary shown above the results."""
    parts = []

    if response.overall_score >= 80:
        parts.append("✅ Good code quality")
    elif response.overall_score >= 60:
        parts.append("⚠️ Average code quality - room for improvement")
    else:
        parts.append("❌ Poor code quality - refactoring recommended")

    if response.security and "🔴" in response.security:
        parts.append("Security issues need immediate attention")
    elif response.security and "🟠" in response.security:
        parts.append("Potential security risks present")

    if response.complexity and "🔴" in response.complexity:
        parts.append("Code complexity is too high")

    if response.graph_built:
        parts.append("Code knowledge graph built")

    return ". ".join(parts) + "."


def _generate_recommendations(response: FullAnalysisResponse) -> List[str]:
    """Build the improvement recommendations list."""
    recommendations = []

    if response.security and "🔴" in response.security:
        recommendations.append("🔴 Fix high-severity security issues first")

    if response.complexity and "🔴" in response.complexity:
        recommendations.append("Reduce code complexity by splitting large functions")

    if response.smells and "⚠️" in response.smells:
        warning_count = response.smells.count("⚠️")
        if warning_count > 5:
            recommendations.append("Refactor to reduce code smells")

    if response.overall_score < 60:
        recommendations.append("Consider a broader refactor")

    if response.graph_built:
        recommendations.append("Use the knowledge graph to explore code dependencies")

    if not recommendations:
        recommendations.append("Keep up the good coding practices")

    return recommendations[:5]
