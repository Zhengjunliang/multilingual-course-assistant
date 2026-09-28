"""python -m scripts.guards <guard> [file ...]: run one guard and print what it finds.

A guard that names its own paths reads those, whatever it is passed; the others
read the files given. Exit code 1 when there is a finding, so a pre-commit hook
fails on it.
"""

from __future__ import annotations

import argparse
import io
import shutil
import subprocess
import sys
from pathlib import Path

from scripts.guards import run
from scripts.guards.registry import GUARDS, RULE_IDS


def _tracked() -> list[str]:
    git = shutil.which("git")
    if git is None:
        raise SystemExit("git is not on PATH, and this guard reads every tracked file")
    listed = subprocess.run(
        [git, "ls-files", "-z"], capture_output=True, text=True, encoding="utf-8", check=True
    )
    return [path for path in listed.stdout.split("\0") if path]


def _text(path: Path) -> str:
    """The file's text; a binary file is there to be linked to, not read."""
    try:
        return path.read_bytes().decode("utf-8")
    except (UnicodeDecodeError, OSError):
        return ""


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m scripts.guards", description=__doc__)
    parser.add_argument("guard", choices=sorted(GUARDS))
    parser.add_argument("files", nargs="*")
    args = parser.parse_args(argv)

    guard = GUARDS[args.guard]
    paths = _tracked() if guard.repository else (guard.paths or args.files)
    files = {Path(path).as_posix(): _text(Path(path)) for path in paths}
    findings = run(guard, files, RULE_IDS)
    # A finding quotes the file, and on Windows the pipe pre-commit reads this
    # through is encoded in the ANSI code page unless told otherwise.
    if isinstance(sys.stdout, io.TextIOWrapper):
        sys.stdout.reconfigure(encoding="utf-8")
    for finding in findings:
        print(finding)
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
