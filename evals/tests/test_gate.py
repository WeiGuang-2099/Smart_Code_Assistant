"""Tests for the regression gate (evals/gate.py) and its run.py wiring."""
import asyncio
import json
import sys
import types
from dataclasses import dataclass, field

import pytest

import evals.run as run_mod
from evals.gate import GateConfigError, check_thresholds, load_thresholds
from evals.run import main_async, parse_args


def write_gate_file(tmp_path, payload):
    path = tmp_path / "thresholds.json"
    text = payload if isinstance(payload, str) else json.dumps(payload)
    path.write_text(text, encoding="utf-8")
    return path


class TestLoadThresholds:
    def test_valid_file_round_trips(self, tmp_path):
        path = write_gate_file(tmp_path, {
            "overall": {"hit_rate@5": 0.9, "mrr": 0.7},
            "generation": {"faithfulness": 4.0},
            "max_errors": 0,
        })
        thresholds = load_thresholds(path)
        assert thresholds["overall"]["hit_rate@5"] == 0.9
        assert thresholds["generation"]["faithfulness"] == 4.0
        assert thresholds["max_errors"] == 0

    def test_missing_file_raises(self, tmp_path):
        with pytest.raises(GateConfigError, match="not found"):
            load_thresholds(tmp_path / "nope.json")

    def test_invalid_json_raises(self, tmp_path):
        path = write_gate_file(tmp_path, "{not json")
        with pytest.raises(GateConfigError, match="JSON"):
            load_thresholds(path)

    def test_unknown_top_level_key_raises(self, tmp_path):
        path = write_gate_file(tmp_path, {"overal": {"mrr": 0.5}})
        with pytest.raises(GateConfigError, match="overal"):
            load_thresholds(path)

    def test_non_numeric_floor_raises(self, tmp_path):
        path = write_gate_file(tmp_path, {"overall": {"mrr": "high"}})
        with pytest.raises(GateConfigError, match="mrr"):
            load_thresholds(path)

    def test_boolean_floor_raises(self, tmp_path):
        path = write_gate_file(tmp_path, {"overall": {"mrr": True}})
        with pytest.raises(GateConfigError, match="mrr"):
            load_thresholds(path)

    def test_negative_max_errors_raises(self, tmp_path):
        path = write_gate_file(tmp_path, {"overall": {"mrr": 0.5}, "max_errors": -1})
        with pytest.raises(GateConfigError, match="max_errors"):
            load_thresholds(path)

    def test_empty_config_raises(self, tmp_path):
        path = write_gate_file(tmp_path, {})
        with pytest.raises(GateConfigError, match="no thresholds"):
            load_thresholds(path)

    def test_non_object_root_raises(self, tmp_path):
        path = write_gate_file(tmp_path, [0.5])
        with pytest.raises(GateConfigError, match="object"):
            load_thresholds(path)


AGGREGATE = {
    "overall": {"n": 4, "errors": 0, "hit_rate@5": 0.75, "mrr": 0.6},
    "by_category": {},
}


class TestCheckThresholds:
    def test_all_floors_met_returns_no_failures(self):
        failures = check_thresholds(AGGREGATE, {"overall": {"hit_rate@5": 0.7, "mrr": 0.5}})
        assert failures == []

    def test_value_equal_to_floor_passes(self):
        failures = check_thresholds(AGGREGATE, {"overall": {"hit_rate@5": 0.75}})
        assert failures == []

    def test_value_below_floor_fails_with_details(self):
        failures = check_thresholds(AGGREGATE, {"overall": {"hit_rate@5": 0.9}})
        assert len(failures) == 1
        assert "hit_rate@5" in failures[0]
        assert "0.75" in failures[0]
        assert "0.9" in failures[0]

    def test_metric_missing_from_results_fails(self):
        failures = check_thresholds(AGGREGATE, {"overall": {"recall@5": 0.5}})
        assert len(failures) == 1
        assert "recall@5" in failures[0]
        assert "missing" in failures[0]

    def test_errors_above_max_errors_fails(self):
        agg = {"overall": {"n": 4, "errors": 2, "mrr": 0.6}, "by_category": {}}
        failures = check_thresholds(agg, {"overall": {"mrr": 0.5}, "max_errors": 0})
        assert len(failures) == 1
        assert "max_errors" in failures[0]

    def test_errors_within_max_errors_passes(self):
        agg = {"overall": {"n": 4, "errors": 1, "mrr": 0.6}, "by_category": {}}
        failures = check_thresholds(agg, {"overall": {"mrr": 0.5}, "max_errors": 1})
        assert failures == []

    def test_errors_not_checked_without_max_errors(self):
        agg = {"overall": {"n": 4, "errors": 4, "mrr": 0.6}, "by_category": {}}
        failures = check_thresholds(agg, {"overall": {"mrr": 0.5}})
        assert failures == []

    def test_generation_floor_below_fails(self):
        agg = dict(AGGREGATE, generation={"n": 4, "faithfulness": 3.5})
        failures = check_thresholds(agg, {"generation": {"faithfulness": 4.0}})
        assert len(failures) == 1
        assert "faithfulness" in failures[0]

    def test_generation_thresholds_without_section_fails(self):
        failures = check_thresholds(AGGREGATE, {"generation": {"faithfulness": 4.0}})
        assert len(failures) == 1
        assert "generation" in failures[0]

    def test_multiple_violations_all_reported(self):
        failures = check_thresholds(
            AGGREGATE, {"overall": {"hit_rate@5": 0.9, "mrr": 0.9}}
        )
        assert len(failures) == 2


@dataclass
class FakeCaseResult:
    """Mirrors runner.CaseResult shape just enough for run.py wiring tests."""
    id: str
    category: str
    expected_files: list = field(default_factory=list)
    expected_graph_neighbors: list | None = None
    retrieved_files_ranked: list = field(default_factory=list)
    retrieved_graph_neighbors: list = field(default_factory=list)
    metrics: dict = field(default_factory=dict)
    error: str | None = None


class TestGateWiring:
    def wire(self, monkeypatch, tmp_path, metrics):
        """Stub the heavy pipeline so main_async runs offline; record calls."""
        calls = {"run_corpus": 0}
        monkeypatch.setattr(run_mod, "validate_golden_set", lambda p, root: ([], []))
        monkeypatch.setattr(run_mod, "load_golden_set",
                            lambda p: [{"category": "feature_lookup"}])

        async def fake_run_corpus(cases, retriever, **kwargs):
            calls["run_corpus"] += 1
            return [FakeCaseResult(id="c1", category="feature_lookup", metrics=metrics)]

        monkeypatch.setattr(run_mod, "run_corpus", fake_run_corpus)
        stub = types.ModuleType("retriever_stub")
        stub.CodeGraphRetriever = lambda: object()
        monkeypatch.setitem(sys.modules, "app.services.code_graph.retriever", stub)
        return calls

    def make_args(self, tmp_path, gate_path):
        return parse_args([
            "--golden", str(tmp_path / "golden.jsonl"),
            "--gate", str(gate_path),
            "--output-dir", str(tmp_path / "out"),
        ])

    def test_parse_args_gate_defaults_to_none(self, tmp_path):
        args = parse_args(["--golden", str(tmp_path / "golden.jsonl")])
        assert args.gate is None

    def test_gate_pass_returns_zero(self, monkeypatch, tmp_path, capsys):
        self.wire(monkeypatch, tmp_path, {"hit_rate@5": 1.0, "mrr": 1.0})
        gate = write_gate_file(tmp_path, {"overall": {"hit_rate@5": 0.9}})
        rc = asyncio.run(main_async(self.make_args(tmp_path, gate)))
        assert rc == 0
        assert "GATE: PASSED" in capsys.readouterr().out

    def test_gate_failure_returns_one(self, monkeypatch, tmp_path, capsys):
        self.wire(monkeypatch, tmp_path, {"hit_rate@5": 0.0, "mrr": 0.0})
        gate = write_gate_file(tmp_path, {"overall": {"hit_rate@5": 0.9}})
        rc = asyncio.run(main_async(self.make_args(tmp_path, gate)))
        assert rc == 1
        err = capsys.readouterr().err
        assert "hit_rate@5" in err
        assert "GATE: FAILED" in err

    def test_invalid_gate_file_fails_fast(self, monkeypatch, tmp_path, capsys):
        calls = self.wire(monkeypatch, tmp_path, {"hit_rate@5": 1.0})
        gate = write_gate_file(tmp_path, "{not json")
        rc = asyncio.run(main_async(self.make_args(tmp_path, gate)))
        assert rc == 2
        assert calls["run_corpus"] == 0
        assert "gate" in capsys.readouterr().err.lower()

    def test_no_gate_flag_keeps_current_behavior(self, monkeypatch, tmp_path, capsys):
        self.wire(monkeypatch, tmp_path, {"hit_rate@5": 0.0})
        args = parse_args([
            "--golden", str(tmp_path / "golden.jsonl"),
            "--output-dir", str(tmp_path / "out"),
        ])
        rc = asyncio.run(main_async(args))
        assert rc == 0
        assert "GATE" not in capsys.readouterr().out
