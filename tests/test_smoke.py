"""Guards on the project skeleton itself, so a broken setup fails loudly."""

import subprocess
import sys
from pathlib import Path

import pytest
from django.core.management import call_command
from pydantic import SecretStr, ValidationError

from config.env import Settings

BASE_DIR = Path(__file__).resolve().parent.parent


def test_django_system_checks_pass() -> None:
    """Raises SystemCheckError if settings, apps or middleware are misconfigured."""
    call_command("check")


def test_rag_package_stays_free_of_django() -> None:
    """The pipeline must run standalone from the CLI — see rag/__init__.py."""
    probe = subprocess.run(
        [sys.executable, "-c", "import rag, sys; print('django' in sys.modules)"],
        cwd=BASE_DIR,
        capture_output=True,
        text=True,
        check=True,
    )
    assert probe.stdout.strip() == "False"


@pytest.mark.parametrize("value", ["", "data/qdrant"], ids=["empty", "directory"])
def test_qdrant_url_takes_a_server_url_only(value: str) -> None:
    """A directory in QDRANT_URL would bring back the embedded lock for every
    process that reads the default, and an empty value would guess; both stop
    the settings from loading instead."""
    with pytest.raises(ValidationError, match="--qdrant"):
        Settings(
            django_secret_key=SecretStr("x"), django_db_password=SecretStr("x"), qdrant_url=value
        )
