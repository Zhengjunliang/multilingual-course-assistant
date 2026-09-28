"""python -m scripts.guards <guard> [file ...]: run one guard and print what it finds.

A guard that names its own paths reads those, whatever it is passed; the others
read the files given. Exit code 1 when there is a finding, so a pre-commit hook
fails on it.
"""

from __future__ import annotations

import argparse
import io
import sys
from pathlib import Path

from scripts.guards import run
from scripts.guards.registry import GUARDS


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m scripts.guards", description=__doc__)
    parser.add_argument("guard", choices=sorted(GUARDS))
    parser.add_argument("files", nargs="*")
    args = parser.parse_args(argv)

    guard = GUARDS[args.guard]
    paths = guard.paths or args.files
    files = {Path(path).as_posix(): Path(path).read_bytes().decode("utf-8") for path in paths}
    findings = run(guard, files)
    # A finding quotes the file, and on Windows the pipe pre-commit reads this
    # through is encoded in the ANSI code page unless told otherwise.
    if isinstance(sys.stdout, io.TextIOWrapper):
        sys.stdout.reconfigure(encoding="utf-8")
    for finding in findings:
        print(finding)
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
