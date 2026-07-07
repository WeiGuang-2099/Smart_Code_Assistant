"""Tests for ChromaDB embedding-provider selection (_init_embedding_function).

The real chromadb package is not a CI dependency (it's mocked), so these tests
patch the lazy `_import_chromadb` import and assert which embedding function the
client builds for each provider. No network, no real chromadb.
"""
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.services.code_graph.chromadb_client import ChromaDBClient


def make_config(**overrides):
    """Minimal config object exposing the embedding fields the client reads."""
    base = dict(
        embedding_provider="sentence_transformers",
        embedding_model="BAAI/bge-small-zh-v1.5",
        openai_embedding_model="text-embedding-3-small",
        embedding_api_key="",
        embedding_base_url="",
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def patch_embedding_functions():
    """Patch the lazy chromadb import; returns the fake embedding_functions module."""
    fake_ef = MagicMock(name="embedding_functions")
    return patch(
        "app.services.code_graph.chromadb_client._import_chromadb",
        return_value=(None, None, fake_ef),
    ), fake_ef


class TestEmbeddingProviderSelection:
    def test_default_provider_uses_sentence_transformer(self):
        cfg = make_config(embedding_provider="sentence_transformers")
        ctx, fake_ef = patch_embedding_functions()
        with ctx:
            client = ChromaDBClient(config=cfg)
            client._init_embedding_function()

        fake_ef.SentenceTransformerEmbeddingFunction.assert_called_once_with(
            model_name="BAAI/bge-small-zh-v1.5"
        )
        fake_ef.OpenAIEmbeddingFunction.assert_not_called()
        assert (
            client._embedding_function
            is fake_ef.SentenceTransformerEmbeddingFunction.return_value
        )

    def test_openai_provider_uses_openai_embedding(self):
        cfg = make_config(
            embedding_provider="openai",
            embedding_api_key="sk-test",
            openai_embedding_model="text-embedding-3-small",
        )
        ctx, fake_ef = patch_embedding_functions()
        with ctx:
            client = ChromaDBClient(config=cfg)
            client._init_embedding_function()

        fake_ef.OpenAIEmbeddingFunction.assert_called_once_with(
            api_key="sk-test", model_name="text-embedding-3-small"
        )
        fake_ef.SentenceTransformerEmbeddingFunction.assert_not_called()
        assert (
            client._embedding_function
            is fake_ef.OpenAIEmbeddingFunction.return_value
        )

    def test_openai_provider_passes_base_url(self):
        cfg = make_config(
            embedding_provider="openai",
            embedding_api_key="sk-test",
            embedding_base_url="https://proxy.example/v1",
        )
        ctx, fake_ef = patch_embedding_functions()
        with ctx:
            client = ChromaDBClient(config=cfg)
            client._init_embedding_function()

        fake_ef.OpenAIEmbeddingFunction.assert_called_once_with(
            api_key="sk-test",
            model_name="text-embedding-3-small",
            api_base="https://proxy.example/v1",
        )

    def test_openai_without_key_falls_back_to_default(self):
        cfg = make_config(embedding_provider="openai", embedding_api_key="")
        ctx, fake_ef = patch_embedding_functions()
        with ctx:
            client = ChromaDBClient(config=cfg)
            client._init_embedding_function()

        fake_ef.OpenAIEmbeddingFunction.assert_not_called()
        fake_ef.DefaultEmbeddingFunction.assert_called_once_with()
        assert (
            client._embedding_function
            is fake_ef.DefaultEmbeddingFunction.return_value
        )

    def test_init_error_falls_back_to_default(self):
        cfg = make_config(embedding_provider="sentence_transformers")
        ctx, fake_ef = patch_embedding_functions()
        fake_ef.SentenceTransformerEmbeddingFunction.side_effect = RuntimeError("no model")
        with ctx:
            client = ChromaDBClient(config=cfg)
            client._init_embedding_function()

        fake_ef.DefaultEmbeddingFunction.assert_called_once_with()
        assert (
            client._embedding_function
            is fake_ef.DefaultEmbeddingFunction.return_value
        )
