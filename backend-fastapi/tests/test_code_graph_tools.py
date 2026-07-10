"""
Tests for the LangChain code-graph tool wrappers.

These tools internally invoke the async builder/retriever singletons; we
patch those singletons to return canned responses so tests are pure.
"""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.code_graph.tools import (
    analyze_impact,
    build_code_graph,
    code_graph_tool_descriptions,
    code_graph_tools,
    find_code_paths,
    query_code_dependencies,
    search_code_semantic,
)


def _run(tool, **kwargs):
    """Invoke a LangChain @tool via the new .invoke API."""
    return tool.invoke(kwargs)


# ----- build_code_graph -----

class TestBuildCodeGraph:
    def test_success_path_renders_stats(self):
        builder = MagicMock()
        builder.build_from_code = AsyncMock(return_value={
            "success": True,
            "stats": {
                "functions_created": 3,
                "classes_created": 1,
                "imports_created": 2,
                "relationships_created": 5,
                "vector_indexed": 4,
            },
            "entities": {"functions": 3, "classes": 1, "imports": 2},
        })
        with patch("app.services.code_graph.tools.get_graph_builder", return_value=builder):
            out = _run(build_code_graph, code="x", language="python", module_path="m")
        assert "Code knowledge graph built" in out
        assert "Functions: 3" in out
        assert "Classes: 1" in out

    def test_failure_path_returns_error_text(self):
        builder = MagicMock()
        builder.build_from_code = AsyncMock(return_value={
            "success": False,
            "error": "parse exploded",
            "stats": {},
        })
        with patch("app.services.code_graph.tools.get_graph_builder", return_value=builder):
            out = _run(build_code_graph, code="x", language="python")
        assert "Graph build failed" in out
        assert "parse exploded" in out

    def test_exception_caught_and_reported(self):
        with patch("app.services.code_graph.tools.get_graph_builder", side_effect=RuntimeError("boom")):
            out = _run(build_code_graph, code="x", language="python")
        assert "failed" in out
        assert "boom" in out


# ----- query_code_dependencies -----

class TestQueryDependencies:
    def test_renders_callers_and_callees(self):
        retriever = MagicMock()
        retriever.get_dependencies = AsyncMock(return_value={
            "callers": [{"name": "a", "module_path": "ma"}],
            "callees": [{"name": "b", "module_path": "mb"}],
        })
        with patch("app.services.code_graph.tools.get_retriever", return_value=retriever):
            out = _run(query_code_dependencies, entity_name="foo", dep_type="all")
        assert "Dependency query" in out
        assert "a (ma)" in out
        assert "b (mb)" in out

    def test_empty_result_shows_warning(self):
        retriever = MagicMock()
        retriever.get_dependencies = AsyncMock(return_value={"callers": [], "callees": []})
        with patch("app.services.code_graph.tools.get_retriever", return_value=retriever):
            out = _run(query_code_dependencies, entity_name="foo", dep_type="all")
        assert "No dependencies found" in out

    def test_exception_path(self):
        with patch("app.services.code_graph.tools.get_retriever", side_effect=RuntimeError("nope")):
            out = _run(query_code_dependencies, entity_name="foo", dep_type="all")
        assert "failed" in out


# ----- analyze_impact -----

class TestAnalyzeImpact:
    def test_low_risk_classification(self):
        retriever = MagicMock()
        retriever.analyze_impact = AsyncMock(return_value={
            "total_count": 2,
            "impacted": [{"name": "x", "distance": 1, "module_path": "m"}],
        })
        with patch("app.services.code_graph.tools.get_retriever", return_value=retriever):
            out = _run(analyze_impact, entity_name="f", change_type="modify")
        assert "Low risk" in out
        assert "Impact scope: 2" in out

    def test_high_risk_classification(self):
        retriever = MagicMock()
        retriever.analyze_impact = AsyncMock(return_value={
            "total_count": 30,
            "impacted": [{"name": f"x{i}", "distance": 1, "module_path": "m"} for i in range(20)],
        })
        with patch("app.services.code_graph.tools.get_retriever", return_value=retriever):
            out = _run(analyze_impact, entity_name="f")
        assert "High risk" in out

    def test_no_impact_shows_clean_message(self):
        retriever = MagicMock()
        retriever.analyze_impact = AsyncMock(return_value={"total_count": 0, "impacted": []})
        with patch("app.services.code_graph.tools.get_retriever", return_value=retriever):
            out = _run(analyze_impact, entity_name="f")
        assert "No affected code found" in out


# ----- find_code_paths -----

class TestFindCodePaths:
    def test_paths_rendered(self):
        retriever = MagicMock()
        retriever.find_paths = AsyncMock(return_value=[
            [{"name": "a"}, {"name": "b"}, {"name": "c"}],
        ])
        with patch("app.services.code_graph.tools.get_retriever", return_value=retriever):
            out = _run(find_code_paths, source="a", target="c")
        assert "Path 1" in out
        assert "a" in out and "b" in out and "c" in out

    def test_no_paths_message(self):
        retriever = MagicMock()
        retriever.find_paths = AsyncMock(return_value=[])
        with patch("app.services.code_graph.tools.get_retriever", return_value=retriever):
            out = _run(find_code_paths, source="a", target="z")
        assert "No connecting path found" in out


# ----- search_code_semantic -----

class TestSearchSemantic:
    def test_renders_functions_and_classes(self):
        retriever = MagicMock()
        retriever.retrieve = AsyncMock(return_value={
            "semantic_results": {
                "functions": [{"metadata": {"name": "f", "module_path": "m"}, "relevance_score": 0.9}],
                "classes": [{"metadata": {"name": "C", "module_path": "m"}, "relevance_score": 0.8}],
            }
        })
        with patch("app.services.code_graph.tools.get_retriever", return_value=retriever):
            out = _run(search_code_semantic, query="auth")
        assert "Related functions" in out
        assert "f (m)" in out
        assert "C (m)" in out

    def test_empty_results_renders_warning(self):
        retriever = MagicMock()
        retriever.retrieve = AsyncMock(return_value={
            "semantic_results": {"functions": [], "classes": []}
        })
        with patch("app.services.code_graph.tools.get_retriever", return_value=retriever):
            out = _run(search_code_semantic, query="auth")
        assert "No matching code entities found" in out

    def test_list_shape_means_no_chroma(self):
        retriever = MagicMock()
        retriever.retrieve = AsyncMock(return_value={"semantic_results": []})
        with patch("app.services.code_graph.tools.get_retriever", return_value=retriever):
            out = _run(search_code_semantic, query="auth")
        assert "ChromaDB" in out or "No matching" in out


# ----- Registry -----

class TestRegistry:
    def test_all_tools_have_descriptions(self):
        for tool in code_graph_tools:
            assert tool.name in code_graph_tool_descriptions

    def test_descriptions_are_non_empty(self):
        for desc in code_graph_tool_descriptions.values():
            assert isinstance(desc, str) and len(desc) > 0
