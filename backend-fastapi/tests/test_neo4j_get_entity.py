"""Unit tests for Neo4jClient.get_entity (offline, execute_query mocked)."""
from unittest.mock import AsyncMock

from app.services.code_graph.neo4j_client import Neo4jClient


async def test_get_entity_returns_function_metadata():
    client = Neo4jClient()
    client.execute_query = AsyncMock(return_value=[{
        "name": "register",
        "module_path": "app/api/auth.py",
        "class_name": None,
        "labels": ["Function"],
        "signature": "def register(data: UserRegister)",
        "docstring": "Register a user.",
    }])
    result = await client.get_entity("register")
    assert result["type"] == "function"
    assert result["name"] == "register"
    assert result["signature"] == "def register(data: UserRegister)"
    assert result["docstring"] == "Register a user."


async def test_get_entity_detects_class_from_labels():
    client = Neo4jClient()
    client.execute_query = AsyncMock(return_value=[{
        "name": "UserService",
        "module_path": "app/services/user.py",
        "class_name": None,
        "labels": ["Class"],
        "signature": None,
        "docstring": "User service.",
    }])
    result = await client.get_entity("UserService")
    assert result["type"] == "class"


async def test_get_entity_missing_returns_none():
    client = Neo4jClient()
    client.execute_query = AsyncMock(return_value=[])
    result = await client.get_entity("does_not_exist")
    assert result is None
