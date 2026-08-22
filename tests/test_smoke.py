"""Guards on the project skeleton itself, so a broken setup fails loudly."""

import subprocess
import sys
from pathlib import Path

from django.core.management import call_command

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
