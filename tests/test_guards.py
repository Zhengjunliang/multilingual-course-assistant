"""scripts/guards: every rule proven by its own examples, every hook wired to a guard.

One module for every guard, on purpose: the examples live next to each rule, so
adding a rule adds its proof here without a new test — the pattern zulip uses
for its custom lint rules (outside the repository:
tools/tests/test_zulint_custom_rules.py). A rule whose good examples start to
fail, or whose bad examples stop failing, turns this module red.
"""

from __future__ import annotations

import ast
import re
import sys
from pathlib import Path
from typing import TYPE_CHECKING

import pytest

from scripts.guards import MARKER_RULE, Guard, markers, run
from scripts.guards.__main__ import main
from scripts.guards.registry import GUARDS

if TYPE_CHECKING:
    from scripts.guards import Rule

ROOT = Path(__file__).resolve().parent.parent
CONFIG = (ROOT / ".pre-commit-config.yaml").read_text(encoding="utf-8")
RULES = [(guard, rule) for guard in GUARDS.values() for rule in guard.rules]


@pytest.mark.parametrize(("guard", "rule"), RULES, ids=[rule.id for _, rule in RULES])
def test_rule_patterns(guard: Guard, rule: Rule) -> None:
    """Good examples pass untouched; each bad one is flagged by this very rule."""
    alone = Guard(guard.name, (rule,))

    assert rule.good
    assert rule.bad
    for files in rule.good:
        assert run(alone, files) == [], files
    for files in rule.bad:
        assert rule.id in {finding.rule for finding in run(alone, files)}, files


def test_a_marker_without_a_reason_is_refused() -> None:
    guard = GUARDS["env-example-parity"]
    files = dict(guard.rules[0].good[0])
    files[".env.example"] += "# guard-ignore env-parity\nEXTRA=1\n"

    assert {finding.rule for finding in run(guard, files)} == {MARKER_RULE, "env-parity"}


def test_a_marker_at_the_end_of_a_line_silences_that_line_only() -> None:
    guard = GUARDS["env-example-parity"]
    files = dict(guard.rules[0].good[0])
    files[".env.example"] += "EXTRA=1  # guard-ignore env-parity: read by compose only\nMORE=2\n"

    assert [(f.line, f.rule) for f in run(guard, files)] == [(6, "env-parity")]


@pytest.mark.parametrize(
    "line",
    [
        pytest.param("a guard-ignore needs a reason", id="prose"),
        pytest.param('message = "a guard-ignore env-parity needs `: <reason>`"', id="a-string"),
        pytest.param(
            "# the guard-ignore env-parity marker takes a reason", id="a-comment-about-it"
        ),
    ],
)
def test_mentioning_a_marker_is_not_one(line: str) -> None:
    assert markers({"x.py": line}) == ({}, [])


def test_rule_ids_are_unique() -> None:
    ids = [rule.id for _, rule in RULES]

    assert len(ids) == len(set(ids))


@pytest.mark.parametrize("guard", [g for g in GUARDS.values() if g.paths], ids=lambda g: g.name)
def test_a_guard_reading_fixed_paths_runs_whenever_one_of_them_changes(guard: Guard) -> None:
    """Its hook passes no file names, and its `files:` pattern covers every path it reads."""
    hook = _hook(guard.name)
    files = re.search(r"files: (?P<pattern>\S+)", hook)

    assert "pass_filenames: false" in hook
    assert files is not None
    assert all(re.search(files["pattern"], path) for path in guard.paths)


def test_the_command_line_exits_1_and_names_the_finding(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    guard = GUARDS["env-example-parity"]
    for path, text in guard.rules[0].bad[0].items():
        (tmp_path / path).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / path).write_bytes(text.encode("utf-8"))
    monkeypatch.chdir(tmp_path)

    assert main([guard.name]) == 1
    assert ".env.example:5: env-parity EXTRA" in capsys.readouterr().out


def _hook(hook_id: str) -> str:
    """The lines of one hook in .pre-commit-config.yaml, from its id to the next."""
    match = re.search(rf"- id: {re.escape(hook_id)}\n(?P<body>(?:(?!\s*- id:).*\n)*)", CONFIG)
    assert match is not None, f"no hook {hook_id}"
    return match["body"]


def test_every_guard_has_a_hook_and_every_guard_hook_a_guard() -> None:
    entries = set(re.findall(r"entry: python -m scripts\.guards ([a-z-]+)", CONFIG))

    assert entries == set(GUARDS)
    for name in GUARDS:
        assert f"entry: python -m scripts.guards {name}" in _hook(name)


PARALLEL_GOOD = (
    "scripts/check.py",
    "apps/qa/migrations/0001_initial.py",
    "frontend/src/i18n/zh-hans.json",
    "apps/api/v1/views.py",
    "docs/api_v1.md",
    "gold/campus_v1.jsonl",
    "docs/v2-notes.md",
    "tests/test_backup.py",
    "rag/news.py",
    "rag/deep_copy.py",
    "frontend/src/code-copy.tsx",
    "docs/whats-new.md",
)
PARALLEL_BAD = (
    "rag/answer.py.bak",
    "rag/answer.py.orig",
    "docs/notes.md.old",
    "NOTES.OLD",
    "rag/answer_old.py",
    "rag/answer-v2.py",
    "rag/answer_v3.py",
    "rag_v2/answer.py",
    "README copy.md",
    "README copy 2.md",
    "answer - Copy.py",
    "answer - Copy (2).py",
)


def test_parallel_version_names() -> None:
    files = re.search(r"files: '(?P<pattern>[^']+)'", _hook("no-parallel-versions"))
    assert files is not None
    pattern = re.compile(files["pattern"])

    assert [name for name in PARALLEL_GOOD if pattern.search(name)] == []
    assert [name for name in PARALLEL_BAD if not pattern.search(name)] == []


def _imports(path: Path) -> list[str]:
    tree = ast.parse(path.read_bytes().decode("utf-8"))
    names: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names += [alias.name for alias in node.names]
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            names.append(node.module)
    return names


def test_guards_parse_as_the_oldest_python_pre_commit_runs_on() -> None:
    """A hook's virtualenv is built on whichever Python runs pre-commit, 3.9 at the oldest."""
    for path in sorted((ROOT / "scripts" / "guards").glob("*.py")):
        ast.parse(path.read_bytes().decode("utf-8"), feature_version=(3, 9))


def test_guards_import_only_the_standard_library() -> None:
    """pre-commit runs them from a virtualenv that holds none of the project's packages."""
    foreign = [
        f"{path.name}: {name}"
        for path in sorted((ROOT / "scripts" / "guards").glob("*.py"))
        for name in _imports(path)
        if name.split(".")[0] not in sys.stdlib_module_names
        and not name.startswith("scripts.guards")
    ]

    assert foreign == []
