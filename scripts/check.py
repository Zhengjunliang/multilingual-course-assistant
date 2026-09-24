"""The one check chain: what CI runs, runnable here under the same names.

    uv run python scripts/check.py              # every step, in order
    uv run python scripts/check.py lint types   # only these, still in chain order

CI calls this script once per step (.github/workflows/ci.yml) instead of
spelling the commands out a second time, and tests/test_check_script.py fails
when the workflow runs anything else, skips a step or reorders one. That is
what keeps "green here" and "green in CI" the same statement.

The mode variables travel with the steps for the same reason: CI tests with
DEBUG off, so this chain does too, whatever the local .env says. Credentials
and connection settings do not travel — CI sets them in the workflow, a
checkout reads them from .env.

Standard library only, and nothing newer than 3.10 in this file (ruff holds it
to that): the first thing it does is refuse to run outside the project venv,
and that refusal has to parse under the system interpreter it is refusing.
Why a script and not a task runner: docs/decisioni.md, 2026-09-24.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "frontend"
PYTHON = sys.executable

# DEBUG off is what CI tests and what would be deployed. BEHIND_TLS is pinned
# off as well rather than left to .env: with DEBUG off, a .env that sets it
# turns on SECURE_SSL_REDIRECT (config/settings.py) and every request a test
# makes comes back as a 301. The one step that wants it on says so itself.
MODE = {"DJANGO_DEBUG": "false", "DJANGO_BEHIND_TLS": "false"}


@dataclass(frozen=True)
class Step:
    name: str
    commands: tuple[tuple[str, ...], ...]
    cwd: Path = ROOT
    env: dict[str, str] = field(default_factory=dict)
    # A path that has to exist before the step can mean anything, and what to
    # run when it does not — so the failure names its fix instead of surfacing
    # as some tool's error three layers down.
    requires: tuple[Path, str] | None = None
    # Printed when the step fails: the one cause worth naming in advance.
    hint: str = ""


def _npm(script: str) -> tuple[str, ...]:
    return ("npm", "run", script)


STEPS: tuple[Step, ...] = (
    # First, ahead of every Django step: frontend/dist is a build artefact that
    # is not in git, and `check --deploy --fail-level WARNING` fails on the
    # STATICFILES_DIRS entry pointing at it (staticfiles.W004) when it is absent.
    # Inside the step, the static gates run first because they are the cheapest
    # to fail, `test` next, and `build` last — it writes the directory `deploy`
    # reads, and a failing test should not first wait for a bundle it invalidates.
    Step(
        "frontend",
        tuple(
            _npm(script)
            for script in ("lint", "typecheck", "check:i18n", "check:contrast", "test", "build")
        ),
        cwd=FRONTEND,
        requires=(FRONTEND / "node_modules", "npm ci --prefix frontend"),
    ),
    Step("lint", ((PYTHON, "-m", "ruff", "check", "."),)),
    Step("format", ((PYTHON, "-m", "ruff", "format", "--check", "."),)),
    Step("types", ((PYTHON, "-m", "pyright"),)),
    Step("django", ((PYTHON, "manage.py", "check"),)),
    Step("migrations", ((PYTHON, "manage.py", "makemigrations", "--check", "--dry-run"),)),
    # --fail-level WARNING is what makes this a gate: without it the command
    # prints its findings and exits 0. BEHIND_TLS only here: it turns on
    # SECURE_SSL_REDIRECT, which would make the test client follow a 301 out
    # of every request in `tests`.
    Step(
        "deploy",
        ((PYTHON, "manage.py", "check", "--deploy", "--fail-level", "WARNING"),),
        env={"DJANGO_BEHIND_TLS": "true"},
        requires=(FRONTEND / "dist", "uv run python scripts/check.py frontend"),
        hint=(
            "security.W009 means the SECRET_KEY in .env is too short or insecure: "
            "generate one with the command at the top of .env.example."
        ),
    ),
    Step("tests", ((PYTHON, "-m", "pytest", "--cov"),)),
)


def environment(step: Step) -> dict[str, str]:
    """The environment a step runs in: this process's, then the mode, then the step's own."""
    return {**os.environ, **MODE, **step.env}


def _display(command: tuple[str, ...]) -> str:
    return " ".join("python" if part == PYTHON else part for part in command)


def run(step: Step) -> int:
    """Run one step's commands in order; the first non-zero exit code ends it."""
    if step.requires is not None and not step.requires[0].exists():
        missing, fix = step.requires
        print(f"FAILED: {step.name}: {missing} is missing; run `{fix}` first")
        return 1
    env = environment(step)
    for command in step.commands:
        print(f"==> {step.name}: {_display(command)}", flush=True)
        # npm is npm.cmd on Windows, which a bare "npm" does not reach without a
        # shell; resolving it here keeps shell=True, and its quoting, out of it.
        program = shutil.which(command[0])
        if program is None:
            print(f"FAILED: {step.name}: `{command[0]}` is not on PATH")
            return 127
        code = subprocess.run(
            (program, *command[1:]), cwd=step.cwd, env=env, check=False
        ).returncode
        if code != 0:
            print(f"FAILED: {step.name}: `{_display(command)}` exited {code}")
            if step.hint:
                print(step.hint)
            return code
    return 0


def main(argv: list[str] | None = None, steps: tuple[Step, ...] = STEPS) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "steps",
        nargs="*",
        metavar="step",
        help=f"any of: {', '.join(step.name for step in steps)} (default: all)",
    )
    args = parser.parse_args(argv)

    if Path(sys.prefix).resolve() != (ROOT / ".venv").resolve():
        print("Run it inside the project venv: uv run python scripts/check.py", file=sys.stderr)
        return 2
    unknown = sorted(set(args.steps) - {step.name for step in steps})
    if unknown:
        valid = ", ".join(step.name for step in steps)
        print(f"unknown step(s): {', '.join(unknown)}; valid: {valid}", file=sys.stderr)
        return 2

    # Chain order, not command-line order: `deploy` before `frontend` would read
    # a dist that the same invocation was about to rebuild.
    selected = [step for step in steps if not args.steps or step.name in args.steps]
    try:
        for step in selected:
            code = run(step)
            if code != 0:
                return code
    except KeyboardInterrupt:
        return 130
    return 0


if __name__ == "__main__":
    sys.exit(main())
