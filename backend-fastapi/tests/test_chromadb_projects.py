"""Tests for ChromaDB project discovery + read-only search collections (offline).

No real chromadb, no network: a fake `_client` is injected directly so the
collection-name parsing and the 'do not create empty stubs on search' behavior
can be asserted without connecting."""
from types import SimpleNamespace
from unittest.mock import MagicMock

from app.services.code_graph.chromadb_client import ChromaDBClient


def make_config(**overrides):
    base = dict(
        embedding_provider="sentence_transformers",
        embedding_model="BAAI/bge-small-zh-v1.5",
        openai_embedding_model="text-embedding-3-small",
        embedding_api_key="",
        embedding_base_url="",
    )
    base.update(overrides)
    return SimpleNamespace(**base)


class _FakeCollection:
    def __init__(self, name, count):
        self.name = name
        self._count = count

    def count(self):
        return self._count


def test_list_projects_parses_names_and_counts():
    client = ChromaDBClient(config=make_config())
    fake_client = MagicMock()
    fake_client.list_collections.return_value = [
        _FakeCollection("project_1_functions", 0),
        _FakeCollection("project_1_classes", 0),
        _FakeCollection("project_99999_functions", 333),
        _FakeCollection("project_99999_classes", 199),
        _FakeCollection("not_a_project_collection", 5),  # ignored
    ]
    client._client = fake_client

    assert client.list_projects() == [
        {"project_id": 1, "functions": 0, "classes": 0},
        {"project_id": 99999, "functions": 333, "classes": 199},
    ]


def test_list_projects_ignores_non_integer_ids():
    client = ChromaDBClient(config=make_config())
    fake_client = MagicMock()
    fake_client.list_collections.return_value = [
        _FakeCollection("project_abc_functions", 7),
    ]
    client._client = fake_client

    assert client.list_projects() == []


def test_search_functions_missing_collection_returns_empty_without_creating():
    client = ChromaDBClient(config=make_config())
    fake_client = MagicMock()
    fake_client.get_collection.side_effect = Exception("collection does not exist")
    client._client = fake_client
    client._embedding_function = MagicMock()

    assert client.search_functions("q", project_id=1) == []
    # Must not silently create an empty stub collection on the search path.
    fake_client.get_or_create_collection.assert_not_called()


def test_search_classes_missing_collection_returns_empty_without_creating():
    client = ChromaDBClient(config=make_config())
    fake_client = MagicMock()
    fake_client.get_collection.side_effect = Exception("collection does not exist")
    client._client = fake_client
    client._embedding_function = MagicMock()

    assert client.search_classes("q", project_id=1) == []
    fake_client.get_or_create_collection.assert_not_called()


def test_search_functions_queries_existing_collection():
    client = ChromaDBClient(config=make_config())
    collection = MagicMock()
    collection.query.return_value = {
        "ids": [["app/core/security.py::create_access_token"]],
        "documents": [["create_access_token Create a JWT access token."]],
        "metadatas": [[{"name": "create_access_token", "type": "function"}]],
        "distances": [[0.12]],
    }
    fake_client = MagicMock()
    fake_client.get_collection.return_value = collection
    client._client = fake_client
    client._embedding_function = MagicMock()

    hits = client.search_functions("jwt token", project_id=99999)
    assert len(hits) == 1
    assert hits[0]["metadata"]["name"] == "create_access_token"
    assert round(hits[0]["relevance_score"], 2) == 0.88
