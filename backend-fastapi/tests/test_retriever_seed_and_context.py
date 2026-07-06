"""Tests for type-aware seed scoring and code-body context building."""


def _hit(name, module_path, type_, score, class_name=None, document=""):
    return {"metadata": {"name": name, "module_path": module_path,
                         "class_name": class_name, "type": type_},
            "relevance_score": score, "document": document}


class TestScoreSeed:
    def test_function_outranks_schema_class_at_higher_relevance(self):
        # The register case from the eval harness: UserRegister (schema class)
        # has the higher semantic score but must lose to the endpoint function.
        from app.services.code_graph.retriever import _score_seed
        schema = _score_seed({"name": "UserRegister",
                              "module_path": "app/schemas/user.py",
                              "type": "class"}, 0.9)
        func = _score_seed({"name": "register",
                            "module_path": "app/api/auth.py",
                            "type": "function"}, 0.6)
        assert func > schema

    def test_plain_class_keeps_type_weight_only(self):
        from app.services.code_graph.retriever import (
            _score_seed, SEED_TYPE_WEIGHTS)
        got = _score_seed({"name": "CacheManager",
                           "module_path": "app/core/cache.py",
                           "type": "class"}, 1.0)
        assert got == SEED_TYPE_WEIGHTS["class"]

    def test_exception_class_penalized(self):
        from app.services.code_graph.retriever import _score_seed
        exc = _score_seed({"name": "TokenError",
                           "module_path": "app/core/token_blacklist.py",
                           "type": "class"}, 1.0)
        plain = _score_seed({"name": "TokenVersionManager",
                             "module_path": "app/core/token_blacklist.py",
                             "type": "class"}, 1.0)
        assert exc < plain

    def test_missing_fields_default_sanely(self):
        from app.services.code_graph.retriever import _score_seed
        assert _score_seed({}, 0.5) > 0


class TestSeedSelection:
    def test_register_beats_userregister_in_seeds(self):
        from app.services.code_graph.retriever import CodeGraphRetriever
        retriever = CodeGraphRetriever()
        semantic = {
            "classes": [_hit("UserRegister", "app/schemas/user.py", "class", 0.9)],
            "functions": [_hit("register", "app/api/auth.py", "function", 0.6)],
        }
        seeds = retriever._seed_entities_from_semantic(semantic, 1)
        assert seeds[0]["name"] == "register"
        # Descriptor carries the RAW semantic score, not the seed score.
        assert seeds[0]["relevance_score"] == 0.6

    def test_pool_wider_than_n_is_considered(self):
        from app.services.code_graph.retriever import CodeGraphRetriever
        retriever = CodeGraphRetriever()
        # Six schema classes outscore one function on raw relevance; the
        # function must still make the top-5 seeds after re-scoring.
        classes = [_hit(f"Schema{i}", "app/schemas/user.py", "class", 0.9)
                   for i in range(6)]
        semantic = {"classes": classes,
                    "functions": [_hit("login", "app/api/auth.py", "function", 0.5)]}
        seeds = retriever._seed_entities_from_semantic(semantic, 5)
        assert any(s["name"] == "login" for s in seeds)

    def test_descriptor_shape_unchanged(self):
        from app.services.code_graph.retriever import CodeGraphRetriever
        retriever = CodeGraphRetriever()
        semantic = {"functions": [_hit("f", "app/m.py", "function", 0.5,
                                       class_name="Svc")], "classes": []}
        seeds = retriever._seed_entities_from_semantic(semantic, 5)
        assert set(seeds[0].keys()) == {"name", "module_path", "class_name",
                                        "type", "relevance_score"}


class TestCombinedContextWithCode:
    def _result(self, functions=None, classes=None, graph=None):
        return {"semantic_results": {"functions": functions or [],
                                     "classes": classes or []},
                "graph_context": graph}

    def test_includes_code_body_and_header(self):
        from app.services.code_graph.retriever import CodeGraphRetriever
        r = CodeGraphRetriever()
        ctx = r._build_combined_context(self._result(
            functions=[_hit("register", "app/api/auth.py", "function", 0.9,
                            document="async def register(data):\n    return await create_user(data)")]))
        assert "### register (app/api/auth.py)" in ctx
        assert "async def register(data):" in ctx

    def test_snippet_truncated_with_marker(self):
        from app.services.code_graph.retriever import (
            CodeGraphRetriever, CONTEXT_SNIPPET_MAX_CHARS)
        r = CodeGraphRetriever()
        long_doc = "x" * (CONTEXT_SNIPPET_MAX_CHARS + 500)
        ctx = r._build_combined_context(self._result(
            functions=[_hit("f", "app/m.py", "function", 0.9, document=long_doc)]))
        assert "[truncated]" in ctx
        assert "x" * (CONTEXT_SNIPPET_MAX_CHARS + 1) not in ctx

    def test_total_budget_enforced(self):
        from app.services.code_graph.retriever import (
            CodeGraphRetriever, CONTEXT_TOTAL_MAX_CHARS)
        r = CodeGraphRetriever()
        hits = [_hit(f"f{i}", "app/m.py", "function", 0.9 - i * 0.01,
                     document="y" * 3000) for i in range(8)]
        ctx = r._build_combined_context(self._result(functions=hits))
        assert len(ctx) <= CONTEXT_TOTAL_MAX_CHARS + 200  # graph/header slack

    def test_top_five_by_relevance_deduped(self):
        from app.services.code_graph.retriever import CodeGraphRetriever
        r = CodeGraphRetriever()
        dup = _hit("f0", "app/m.py", "function", 0.95, document="body0")
        hits = [dup, dup] + [_hit(f"f{i}", "app/m.py", "function", 0.9 - i * 0.1,
                                  document=f"body{i}") for i in range(1, 7)]
        ctx = r._build_combined_context(self._result(functions=hits))
        assert ctx.count("### f0 ") == 1
        assert "### f5 " not in ctx  # only 5 snippets total

    def test_graph_section_preserved_after_snippets(self):
        from app.services.code_graph.retriever import CodeGraphRetriever
        r = CodeGraphRetriever()
        ctx = r._build_combined_context(self._result(
            functions=[_hit("f", "app/m.py", "function", 0.9, document="body")],
            graph=[{"name": "Helper", "module_path": "app/h.py",
                    "relation": "import", "source": "f"}]))
        assert "Helper" in ctx and "[import]" in ctx
        assert ctx.index("body") < ctx.index("Helper")

    def test_missing_document_falls_back_to_header_only(self):
        from app.services.code_graph.retriever import CodeGraphRetriever
        r = CodeGraphRetriever()
        ctx = r._build_combined_context(self._result(
            functions=[_hit("f", "app/m.py", "function", 0.9)]))
        assert "### f (app/m.py)" in ctx
        assert "```" not in ctx
