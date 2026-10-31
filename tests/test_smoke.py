"""Guards on the project skeleton itself, so a broken setup fails loudly."""

import ast
import functools
from pathlib import Path

import pytest
from django.core.management import call_command
from pydantic import SecretStr, ValidationError

from config.env import Settings

BASE_DIR = Path(__file__).resolve().parent.parent


def test_django_system_checks_pass() -> None:
    """Raises SystemCheckError if settings, apps or middleware are misconfigured."""
    call_command("check")


@functools.cache
def rag_imports() -> frozenset[tuple[str, str]]:
    """(module path, top-level package) for every import in rag/. Every module
    is read rather than imported: importing them all would load the models'
    libraries for a question about a few names."""
    return frozenset(
        {
            (path.relative_to(BASE_DIR).as_posix(), name.split(".")[0])
            for path in (BASE_DIR / "rag").rglob("*.py")
            for node in ast.walk(ast.parse(path.read_text(encoding="utf-8")))
            if isinstance(node, (ast.Import, ast.ImportFrom))
            for name in (
                [alias.name for alias in node.names]
                if isinstance(node, ast.Import)
                else [node.module or ""]
            )
        }
    )


def test_rag_package_stays_free_of_django_and_celery() -> None:
    """The pipeline must run standalone from the CLI — see rag/__init__.py. A
    worker runs it (apps/qa/tasks.py), and the pipeline knows nothing of that
    either."""
    imported = rag_imports()
    assert {(path, name) for path, name in imported if name in {"django", "celery"}} == set()


def test_only_the_llm_client_knows_about_tracing() -> None:
    """Recording a call is the client's business (rag/llm.py): a caller opens
    a trace and nothing more, so turning tracing off, or replacing Langfuse,
    touches one module."""
    tracing = {"langfuse", "opentelemetry"}
    assert {path for path, name in rag_imports() if name in tracing} == {"rag/llm.py"}


@pytest.mark.parametrize("value", ["", "data/qdrant"], ids=["empty", "directory"])
def test_qdrant_url_takes_a_server_url_only(value: str) -> None:
    """A directory in QDRANT_URL would bring back the embedded lock for every
    process that reads the default, and an empty value would guess; both stop
    the settings from loading instead."""
    with pytest.raises(ValidationError, match="--qdrant"):
        Settings(
            django_secret_key=SecretStr("x"), django_db_password=SecretStr("x"), qdrant_url=value
        )


@pytest.mark.parametrize("key", [None, SecretStr("")], ids=["unset", "empty"])
def test_tracing_on_needs_the_key_pair(key: SecretStr | None) -> None:
    """Without the pair the SDK records nothing and only logs it, so a switch
    that reads on would leave every run untraced in silence; the settings stop
    loading instead. Empty is unset: .env.example ships the keys empty."""
    with pytest.raises(ValidationError, match="LANGFUSE_PUBLIC_KEY"):
        Settings(
            django_secret_key=SecretStr("x"),
            django_db_password=SecretStr("x"),
            langfuse_tracing_enabled=True,
            langfuse_public_key=key,
            langfuse_secret_key=SecretStr("sk-lf-x"),
        )
