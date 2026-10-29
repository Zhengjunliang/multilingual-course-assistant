"""Guards on the project skeleton itself, so a broken setup fails loudly."""

import ast
from pathlib import Path

import pytest
from django.core.management import call_command
from pydantic import SecretStr, ValidationError

from config.env import Settings

BASE_DIR = Path(__file__).resolve().parent.parent


def test_django_system_checks_pass() -> None:
    """Raises SystemCheckError if settings, apps or middleware are misconfigured."""
    call_command("check")


def test_rag_package_stays_free_of_django_and_celery() -> None:
    """The pipeline must run standalone from the CLI — see rag/__init__.py. A
    worker runs it (apps/qa/tasks.py), and the pipeline knows nothing of that
    either. Every module is read rather than imported: importing them all
    would load the models' libraries for a question about two names."""
    imported = {
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
    assert {(path, name) for path, name in imported if name in {"django", "celery"}} == set()


@pytest.mark.parametrize("value", ["", "data/qdrant"], ids=["empty", "directory"])
def test_qdrant_url_takes_a_server_url_only(value: str) -> None:
    """A directory in QDRANT_URL would bring back the embedded lock for every
    process that reads the default, and an empty value would guess; both stop
    the settings from loading instead."""
    with pytest.raises(ValidationError, match="--qdrant"):
        Settings(
            django_secret_key=SecretStr("x"), django_db_password=SecretStr("x"), qdrant_url=value
        )
