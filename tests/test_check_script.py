"""scripts/check.py: the one check chain, and the workflow that has to call it.

Two halves. The runner's own behaviour — a failing step ends the chain and its
exit code comes back — is tested with throwaway steps, so no real tool runs.
The drift guard reads .github/workflows/ci.yml as text and names the first way
the check job has stopped matching the chain: a command that is not a step, a
step missing or out of place, an action that is not setup, a step made
conditional or allowed to fail, or an environment the workflow sets beyond
credentials and the database. Every one of those has a synthetic workflow below
proving the guard notices it, and each asserts which reason it gives — a guard
whose pattern quietly stopped matching would otherwise pass forever.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest

from scripts import check

WORKFLOW = Path(__file__).resolve().parent.parent / ".github" / "workflows" / "ci.yml"

# What the check job may do besides calling the chain: get the tools it needs.
SETUP_RUNS = frozenset({"uv sync --locked", "npm ci"})
SETUP_ACTIONS = ("actions/checkout@", "astral-sh/setup-uv@", "actions/setup-node@")
STEP_CALL = re.compile(r"uv run python scripts/check\.py (?P<step>[a-z]+)")
# Credentials and the database are the workflow's to set; the mode is the chain's.
WORKFLOW_ENV = re.compile(r"DJANGO_SECRET_KEY|DJANGO_DB_[A-Z]+")
# One `key: value` line of a step, with or without the list dash in front.
STEP_KEY = re.compile(r"(?:-\s+)?(?P<key>[a-z-]+)\s*:\s*(?P<value>.*)")
# Step keys that change what a green step means: an environment of its own, a
# condition that can skip it, or permission to fail.
STEP_FORBIDDEN = frozenset({"env", "if", "continue-on-error"})


def _block(lines: list[str], header: str, indent: int) -> list[str] | None:
    """The lines under `header`, up to the next key at the same indentation."""
    if header not in lines:
        return None
    start = lines.index(header) + 1
    sibling = re.compile(" " * indent + r"[^\s#]")
    end = next((i for i in range(start, len(lines)) if sibling.match(lines[i])), len(lines))
    return lines[start:end]


def _env_drift(block: list[str] | None, where: str) -> str | None:
    for line in block or []:
        key = line.strip().split(":", 1)[0]
        if key and not key.startswith("#") and not WORKFLOW_ENV.fullmatch(key):
            return f"{where} sets {key}, which is neither a credential nor the database"
    return None


def drift(workflow: str) -> str | None:
    """How the check job has stopped matching the chain, or None when it has not."""
    lines = workflow.splitlines()
    job = _block(lines, "  check:", 2)
    if job is None:
        raise ValueError("no `check` job in the workflow")
    if "    continue-on-error: true" in job:
        return "the job is allowed to fail"
    called: list[str] = []
    for line in _block(job, "    steps:", 4) or []:
        entry = STEP_KEY.fullmatch(line.strip())
        if entry is None:
            continue
        key, value = entry["key"], entry["value"].strip()
        if key in STEP_FORBIDDEN:
            return f"a step has `{key}:`, which changes what its green means"
        if key == "uses" and not value.startswith(SETUP_ACTIONS):
            return f"uses an action that is not setup: {value}"
        if key == "run" and value not in SETUP_RUNS:
            call = STEP_CALL.fullmatch(value)
            if call is None:
                return f"runs something that is not a step of the chain: {value!r}"
            called.append(call["step"])
    chain = [step.name for step in check.STEPS]
    if called != chain:
        return f"calls {called}, the chain is {chain}"
    return _env_drift(_block(lines, "env:", 0), "the workflow") or _env_drift(
        _block(job, "    env:", 4), "the job"
    )


# --- the runner -------------------------------------------------------------


@pytest.fixture
def in_venv(monkeypatch: pytest.MonkeyPatch) -> None:
    """Pass the venv guard whatever interpreter runs the suite; the guard has its own test."""
    monkeypatch.setattr(check, "in_project_venv", lambda: True)


def _python(code: str) -> tuple[str, ...]:
    return (sys.executable, "-c", code)


def _touch(path: Path) -> tuple[str, ...]:
    return _python(f"open({str(path)!r}, 'w').close()")


@pytest.mark.usefixtures("in_venv")
def test_a_failing_step_ends_the_chain_with_its_exit_code(tmp_path: Path) -> None:
    after = tmp_path / "after"
    steps = (
        check.Step("boom", (_python("raise SystemExit(3)"),)),
        check.Step("after", (_touch(after),)),
    )

    assert check.main([], steps) == 3
    assert not after.exists()


@pytest.mark.usefixtures("in_venv")
def test_a_passing_chain_runs_every_step(tmp_path: Path) -> None:
    first, second = tmp_path / "first", tmp_path / "second"
    steps = (check.Step("first", (_touch(first),)), check.Step("second", (_touch(second),)))

    assert check.main([], steps) == 0
    assert first.exists()
    assert second.exists()


@pytest.mark.usefixtures("in_venv")
def test_named_steps_run_in_chain_order_not_argument_order(tmp_path: Path) -> None:
    log = tmp_path / "log"
    steps = tuple(
        check.Step(name, (_python(f"open({str(log)!r}, 'a').write({name!r})"),))
        for name in ("a", "b", "c")
    )

    assert check.main(["c", "a"], steps) == 0
    assert log.read_text() == "ac"


@pytest.mark.usefixtures("in_venv")
def test_an_unknown_step_is_refused_and_the_valid_ones_named(
    capsys: pytest.CaptureFixture[str],
) -> None:
    assert check.main(["nope"]) == 2
    assert "frontend, lint, format" in capsys.readouterr().err


@pytest.mark.usefixtures("in_venv")
def test_a_missing_prerequisite_names_its_fix(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    step = check.Step("needy", (_python("pass"),), requires=(tmp_path / "absent", "make it"))

    assert check.main([], (step,)) == 1
    assert "run `make it` first" in capsys.readouterr().err


@pytest.mark.usefixtures("in_venv")
def test_a_program_not_on_path_is_127(capsys: pytest.CaptureFixture[str]) -> None:
    step = check.Step("ghost", (("no-such-program-anywhere",),))

    assert check.main([], (step,)) == 127
    assert "not on PATH" in capsys.readouterr().err


@pytest.mark.usefixtures("in_venv")
def test_a_failing_step_prints_its_hint(capsys: pytest.CaptureFixture[str]) -> None:
    step = check.Step("hinted", (_python("raise SystemExit(1)"),), hint="try the obvious")

    assert check.main([], (step,)) == 1
    assert "try the obvious" in capsys.readouterr().err


@pytest.mark.usefixtures("in_venv")
def test_an_interrupt_is_130(monkeypatch: pytest.MonkeyPatch) -> None:
    def interrupted(step: check.Step) -> int:
        raise KeyboardInterrupt

    monkeypatch.setattr(check, "run", interrupted)

    assert check.main([], (check.Step("any", (_python("pass"),)),)) == 130


def test_outside_the_project_venv_nothing_runs(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(check, "in_project_venv", lambda: False)
    marker = tmp_path / "ran"

    assert check.main([], (check.Step("any", (_touch(marker),)),)) == 2
    assert not marker.exists()
    assert "uv run python scripts/check.py" in capsys.readouterr().err


def test_the_frontend_builds_before_any_django_step() -> None:
    """`deploy` reads frontend/dist, which only the `frontend` step writes."""
    names = [step.name for step in check.STEPS]
    django = [s.name for s in check.STEPS if any("manage.py" in c for c in s.commands)]

    assert django
    assert all(names.index("frontend") < names.index(name) for name in django)


def test_the_mode_is_the_chains_whatever_the_environment_says(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("DJANGO_DEBUG", "true")
    monkeypatch.setenv("DJANGO_BEHIND_TLS", "true")

    for step in check.STEPS:
        env = check.environment(step)
        assert env["DJANGO_DEBUG"] == "false"
        assert env["DJANGO_BEHIND_TLS"] == ("true" if step.name == "deploy" else "false")


# --- the drift guard --------------------------------------------------------


def _workflow(
    runs: list[str],
    job_env: tuple[str, ...] = (),
    extra: str = "",
    top: str = "",
    job_extra: str = "",
) -> str:
    """A check job shaped like the real one, with a second job it must not read."""
    env = "".join(f"      {line}\n" for line in ("DJANGO_SECRET_KEY: k", *job_env))
    steps = "".join(f"      - name: step\n        run: {run}\n" for run in runs)
    return (
        f"{top}"
        "jobs:\n"
        "  check:\n"
        f"{job_extra}"
        "    env:\n"
        f"{env}"
        "    services:\n"
        "      postgres:\n"
        "        env:\n"
        "          POSTGRES_DB: mca\n"
        "    steps:\n"
        "      - uses: actions/checkout@v7\n"
        f"{steps}"
        f"{extra}"
        "  audit:\n"
        "    steps:\n"
        "      - run: uvx pip-audit\n"
    )


CALLS = [f"uv run python scripts/check.py {step.name}" for step in check.STEPS]
IN_ORDER = ["uv sync --locked", "npm ci", *CALLS]


def test_the_synthetic_workflow_is_in_step_with_the_chain() -> None:
    """The baseline every red case below differs from in exactly one way."""
    assert drift(_workflow(IN_ORDER)) is None


@pytest.mark.parametrize(
    ("workflow", "reason"),
    [
        pytest.param(
            _workflow([*IN_ORDER, "uv run mypy"]), "not a step of the chain", id="a-bare-command"
        ),
        pytest.param(
            _workflow([r for r in IN_ORDER if not r.endswith(" types")]),
            "the chain is",
            id="a-step-gone",
        ),
        pytest.param(
            _workflow(["uv sync --locked", "npm ci", *CALLS[::-1]]),
            "the chain is",
            id="steps-reordered",
        ),
        pytest.param(_workflow([*IN_ORDER, "|"]), "not a step of the chain", id="a-block-scalar"),
        pytest.param(
            _workflow([*IN_ORDER[:-1], f"{CALLS[-1]} && echo more"]),
            "not a step of the chain",
            id="a-command-chained-on",
        ),
        pytest.param(
            _workflow(IN_ORDER, extra="      -   run: uv run mypy\n"),
            "not a step of the chain",
            id="a-dash-with-extra-spaces",
        ),
        pytest.param(
            _workflow(IN_ORDER, extra="      - uses: some/lint-action@v1\n"),
            "not setup",
            id="a-check-action",
        ),
        pytest.param(
            _workflow(IN_ORDER, extra="      - name: step\n        env:\n          X: y\n"),
            "`env:`",
            id="a-step-level-env",
        ),
        pytest.param(
            _workflow(IN_ORDER, extra="      - name: step\n        env: { PYTEST_ADDOPTS: x }\n"),
            "`env:`",
            id="an-inline-step-env",
        ),
        pytest.param(
            _workflow(IN_ORDER, extra="      - name: step\n        if: false\n"),
            "`if:`",
            id="a-conditional-step",
        ),
        pytest.param(
            _workflow(IN_ORDER, extra="      - name: step\n        continue-on-error: true\n"),
            "`continue-on-error:`",
            id="a-step-allowed-to-fail",
        ),
        pytest.param(
            _workflow(IN_ORDER, job_extra="    continue-on-error: true\n"),
            "allowed to fail",
            id="a-job-allowed-to-fail",
        ),
        pytest.param(
            _workflow(IN_ORDER, job_env=('DJANGO_DEBUG: "false"',)),
            "the job sets DJANGO_DEBUG",
            id="the-mode-in-the-job",
        ),
        pytest.param(
            _workflow(IN_ORDER, top='env:\n  DJANGO_DEBUG: "false"\n'),
            "the workflow sets DJANGO_DEBUG",
            id="the-mode-in-the-workflow",
        ),
    ],
)
def test_the_drift_guard_names_each_way_of_drifting(workflow: str, reason: str) -> None:
    found = drift(workflow)

    assert found is not None
    assert reason in found


def test_a_workflow_without_a_check_job_is_an_error_not_a_pass() -> None:
    with pytest.raises(ValueError, match="check"):
        drift("jobs:\n  audit:\n    steps:\n      - run: x\n")


def test_ci_runs_exactly_the_chain() -> None:
    assert drift(WORKFLOW.read_text(encoding="utf-8")) is None
