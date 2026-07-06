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
