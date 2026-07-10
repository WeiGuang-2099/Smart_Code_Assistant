"""English-output contract for the code-analysis summary layer.

The UI is English; these tests pin the user-visible strings produced by
app/api/code_analysis.py (summary, recommendations, graph-stats parsing)
and guard against Chinese text regressing into API responses.
"""
import re

from unittest.mock import AsyncMock, MagicMock, patch

from app.api.code_analysis import (
    FullAnalysisResponse,
    _extract_graph_stats,
    _generate_recommendations,
    _generate_summary,
)
from app.services.code_graph.tools import build_code_graph

CJK = re.compile(r"[一-鿿]")


def make_response(**kwargs) -> FullAnalysisResponse:
    return FullAnalysisResponse(**kwargs)


class TestGenerateSummary:
    def test_high_score_reads_good_quality(self):
        out = _generate_summary(make_response(overall_score=90))
        assert "Good code quality" in out

    def test_low_score_recommends_refactor(self):
        out = _generate_summary(make_response(overall_score=30))
        assert "refactor" in out.lower()

    def test_graph_built_mentioned(self):
        out = _generate_summary(make_response(overall_score=90, graph_built=True))
        assert "knowledge graph" in out.lower()

    def test_security_flag_surfaces(self):
        out = _generate_summary(
            make_response(overall_score=90, security="🔴 sql injection")
        )
        assert "Security" in out

    def test_no_chinese_in_any_band(self):
        for score in (90, 70, 30):
            out = _generate_summary(
                make_response(overall_score=score, graph_built=True,
                              security="🟠 risk", complexity="🔴 deep nesting")
            )
            assert not CJK.search(out), f"Chinese text leaked into summary: {out}"


class TestGenerateRecommendations:
    def test_defaults_to_positive_note(self):
        recs = _generate_recommendations(make_response(overall_score=95))
        assert len(recs) >= 1

    def test_graph_recommendation_present_when_built(self):
        recs = _generate_recommendations(
            make_response(overall_score=95, graph_built=True)
        )
        assert any("knowledge graph" in r.lower() for r in recs)

    def test_no_chinese_in_recommendations(self):
        recs = _generate_recommendations(
            make_response(overall_score=30, graph_built=True,
                          security="🔴 bad", complexity="🔴 worse",
                          smells="⚠️" * 8)
        )
        for r in recs:
            assert not CJK.search(r), f"Chinese text leaked into recommendation: {r}"


class TestExtractGraphStats:
    def test_parses_real_build_tool_output(self):
        """Contract test: the parser must understand build_code_graph's text."""
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
            graph_result = build_code_graph.invoke(
                {"code": "x", "language": "python", "module_path": "m"}
            )
        stats = _extract_graph_stats(graph_result)
        assert stats == {"nodes": 4, "relationships": 5}

    def test_returns_none_when_no_stats_present(self):
        assert _extract_graph_stats("❌ Graph build failed: boom") is None
