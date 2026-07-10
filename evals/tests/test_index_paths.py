"""_do_index must store module paths that match the golden-set convention:
repo-root-relative (golden_set.validate resolves 'evals/...' paths from repo
root), otherwise retrieval metrics silently compare mismatched strings.
"""
import asyncio
import sys
import types

from evals.run import REPO_ROOT, _do_index


class FakeBuilder:
    captured: list | None = None

    async def build_from_files(self, files, project_id):
        FakeBuilder.captured = files
        return {"success": True}


def stub_graph_builder(monkeypatch):
    stub = types.ModuleType("graph_builder_stub")
    stub.CodeGraphBuilder = FakeBuilder
    monkeypatch.setitem(sys.modules, "app.services.code_graph.graph_builder", stub)


def test_corpus_inside_repo_stores_repo_root_relative_paths(monkeypatch):
    stub_graph_builder(monkeypatch)
    corpus = REPO_ROOT / "evals" / "fixtures" / "mini_repo"

    asyncio.run(_do_index(corpus, project_id=1))

    paths = [f["path"] for f in FakeBuilder.captured]
    assert "evals/fixtures/mini_repo/errors.py" in paths
    assert all(p.startswith("evals/fixtures/mini_repo/") for p in paths)


def test_corpus_outside_repo_falls_back_to_parent_relative(monkeypatch, tmp_path):
    stub_graph_builder(monkeypatch)
    corpus = tmp_path / "somewhere"
    corpus.mkdir()
    (corpus / "one.py").write_text("x = 1\n", encoding="utf-8")

    asyncio.run(_do_index(corpus, project_id=1))

    paths = [f["path"] for f in FakeBuilder.captured]
    assert paths == ["somewhere/one.py"]
