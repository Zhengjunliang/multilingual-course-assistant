"""scripts/guards: every rule proven by its own examples, every hook wired to a guard.

One module for every guard, on purpose: the examples live next to each rule, so
adding a rule adds its proof here without a new test — the pattern zulip uses
for its custom lint rules (outside the repository:
tools/tests/test_zulint_custom_rules.py). A rule whose good examples start to
fail, or whose bad examples stop failing, turns this module red. The last
section checks the configuration the hooks run under.
"""

from __future__ import annotations

import ast
import dataclasses
import re
import subprocess
import sys
import tomllib
from pathlib import Path
from typing import TYPE_CHECKING

import pytest

from scripts.guards import MARKER_RULE, Guard, commits, git, history, markers, run
from scripts.guards.__main__ import main
from scripts.guards.registry import GUARDS

if TYPE_CHECKING:
    from collections.abc import Callable

    from scripts.guards import Rule

ROOT = Path(__file__).resolve().parent.parent
CONFIG = (ROOT / ".pre-commit-config.yaml").read_text(encoding="utf-8")
RULES = [(guard, rule) for guard in GUARDS.values() for rule in guard.rules]


@pytest.mark.parametrize(("guard", "rule"), RULES, ids=[rule.id for _, rule in RULES])
def test_rule_patterns(guard: Guard, rule: Rule) -> None:
    """Good examples pass untouched; each bad one is flagged by this very rule."""
    alone = dataclasses.replace(guard, rules=(rule,))

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
    ("path", "text"),
    [
        pytest.param("x.md", "a guard-ignore needs a reason\n", id="prose"),
        pytest.param("x.md", "the guard-ignore env-parity: marker\n", id="prose-with-a-colon"),
        pytest.param("x.md", "# guard-ignore lang-han: a heading\n", id="a-heading"),
        pytest.param(
            "x.md", "Write `<!-- guard-ignore lang-han: why -->` after it.\n", id="inline-code"
        ),
        pytest.param(
            "x.md", "```\n<!-- guard-ignore lang-han: shown -->\n```\n", id="a-fenced-example"
        ),
        pytest.param("x.ts", "# guard-ignore lang-han: not a TS comment\n", id="a-wrong-opener"),
        pytest.param("x.py", 'm = "# guard-ignore env-parity: in a string"\n', id="a-string"),
        pytest.param("x.py", '"""\n# guard-ignore env-parity: in a docstring\n"""\n', id="a-doc"),
        pytest.param(
            "x.py", "# the guard-ignore env-parity marker takes a reason\n", id="a-mention"
        ),
    ],
)
def test_mentioning_a_marker_is_not_one(path: str, text: str) -> None:
    assert markers({path: text}) == []


def test_a_marker_naming_no_rule_is_refused() -> None:
    guard = GUARDS["env-example-parity"]
    files = dict(guard.rules[0].good[0])
    files[".env.example"] += "EXTRA=1  # guard-ignore env-parity, env-party: a typo in it\n"

    found = run(guard, files, frozenset({"env-parity"}))

    # Refused whole: a marker that names a missing rule silences nothing either.
    assert [(f.rule, f.message) for f in found] == [
        ("env-parity", "EXTRA is not read by config/env.py"),
        (MARKER_RULE, "no rule is called env-party"),
    ]


def test_a_marker_that_silences_nothing_is_refused() -> None:
    guard = GUARDS["env-example-parity"]
    files = dict(guard.rules[0].good[0])
    files[".env.example"] += "# guard-ignore env-parity: a variable deleted since\n"

    assert [f.rule for f in run(guard, files)] == [MARKER_RULE]


def test_rule_ids_are_unique() -> None:
    ids = [rule.id for _, rule in RULES]

    assert len(ids) == len(set(ids))


@pytest.mark.parametrize(
    "guard", [g for g in GUARDS.values() if g.repository], ids=lambda g: g.name
)
def test_a_guard_reading_the_repository_runs_on_every_commit(guard: Guard) -> None:
    """A reference breaks in a commit that stages only its target, so no file filter."""
    hook = _hook(guard.name)

    assert "pass_filenames: false" in hook
    assert "always_run: true" in hook


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


def test_the_rule_table_of_claude_md_names_real_hooks_and_every_local_one() -> None:
    """CLAUDE.md, section 5: a guard it names exists, and every rule of this
    repository's own hooks is in it, so the table cannot promise a check nobody runs."""
    claude_md = (ROOT / "CLAUDE.md").read_text(encoding="utf-8")
    guards = re.findall(r"^\| [^|]+ \| [^|]+ \| ([^|]+) \|$", claude_md, re.MULTILINE)
    named = {name for cell in guards for name in re.findall(r"`([a-z-]+)`", cell)} - {"review"}
    hooks = set(re.findall(r"- id: (\S+)", CONFIG))
    local = set(re.findall(r"- id: (\S+)", CONFIG.split("- repo: local", 1)[1]))

    assert named - hooks == set()
    assert local - named == set()


PARALLEL_GOOD = (
    "scripts/check.py",
    "apps/qa/migrations/0001_initial.py",
    "frontend/src/i18n/zh-hans.json",
    "apps/api/v1/views.py",
    "docs/api_v1.md",
    "gold/campus_v1.jsonl",
    "notes/v2-notes.md",
    "tests/test_backup.py",
    "rag/news.py",
    "rag/deep_copy.py",
    "frontend/src/code-copy.tsx",
    "notes/whats-new.md",
)
PARALLEL_BAD = (
    "rag/answer.py.bak",
    "rag/answer.py.orig",
    "notes/notes.md.old",
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


# --- the configuration the hooks run under -----------------------------------

TYPOS = ROOT / "_typos.toml"


def test_every_hook_repository_is_pinned_by_commit() -> None:
    """A tag can be moved under a pin, a SHA cannot; `# frozen:` is the readable half."""
    repos = re.findall(r"- repo: (https://\S+)\n\s+rev: (.*)", CONFIG)

    assert len(repos) == CONFIG.count("- repo: https://")
    assert [r for r, rev in repos if not re.fullmatch(r"[0-9a-f]{40}\s+# frozen: \S+", rev)] == []


def _tracked() -> set[str]:
    # -z: without it git quotes and escapes any path that is not plain ASCII.
    return set(git("-C", str(ROOT), "ls-files", "-z").split("\0"))


def test_every_spelling_exclusion_names_tracked_files() -> None:
    """An exclusion that matches nothing in git is a leftover, or a typo of its own."""
    excluded = tomllib.loads(TYPOS.read_text(encoding="utf-8"))["files"]["extend-exclude"]
    tracked = _tracked()

    assert [
        pattern
        for pattern in excluded
        if not any(path.relative_to(ROOT).as_posix() in tracked for path in ROOT.glob(pattern))
    ] == []


def test_everything_the_spell_checker_lets_through_says_why() -> None:
    """Each exclusion, ignore pattern and accepted word sits under a comment with its reason."""
    unexplained: list[str] = []
    explained, section = False, ""
    for line in TYPOS.read_text(encoding="utf-8").splitlines():
        text = line.strip()
        if text.startswith("#"):
            explained = True
        elif text.startswith("[") and text.endswith("]"):
            section, explained = text, False
        elif not text or text.endswith("[") or text == "]":
            explained = False
        elif not explained and (
            text.startswith('"') or "extend-words" in section or "extend-identifiers" in section
        ):
            unexplained.append(text)

    assert unexplained == []


# --- commit messages ------------------------------------------------------------


def test_the_message_hook_is_staged_on_the_message_and_the_rest_at_commit_time() -> None:
    """What the configuration asks of pre-commit; `pre-commit install` sets up both."""
    assert "stages: [commit-msg]" in _hook("commit-msg")
    assert "default_stages: [pre-commit]" in CONFIG
    assert "default_install_hook_types: [pre-commit, commit-msg]" in CONFIG


VERBOSE = (
    "{header}\n"
    "# Please enter the commit message for your changes.\n"
    "# ------------------------ >8 ------------------------\n"
    "+x = 1  # guard-ignore lang-han\n"
    "+# una nota della sessione\n"
)


@pytest.mark.parametrize(("header", "code"), [("feat: check it", 0), ("Check it", 1)])
def test_a_message_from_the_editor_is_read_as_git_will_store_it(
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
    monkeypatch: pytest.MonkeyPatch,
    header: str,
    code: int,
) -> None:
    """Git drops the comment lines and the diff of `commit --verbose` after the hook."""
    monkeypatch.delenv("GIT_EDITOR", raising=False)
    message = tmp_path / "COMMIT_EDITMSG"
    message.write_bytes(VERBOSE.format(header=header).encode("utf-8"))

    assert main(["commit-msg", str(message)]) == code
    assert ("commit-header" in capsys.readouterr().out) == bool(code)


def test_a_message_given_on_the_command_line_keeps_its_comment_lines(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`git commit -m` stores a `#` line as written, and says so with GIT_EDITOR=:."""
    monkeypatch.setenv("GIT_EDITOR", ":")
    message = tmp_path / "COMMIT_EDITMSG"
    message.write_bytes(b"fix: x  \n\n#48 is open\n\n")

    assert list(commits.read_message([str(message)]).values()) == ["fix: x\n\n#48 is open\n"]


LOG = "m\nb p\nMerge p into b\n\0p\n\nfeat: x\n\0"


def _git(shallow: str = "false") -> Callable[..., str]:
    """git as read_history asks it: for HEAD, whether the clone is shallow, the log."""

    def answer(*args: str) -> str:
        return {"--verify": "m\n", "--is-shallow-repository": f"{shallow}\n"}.get(args[1], LOG)

    return answer


@pytest.mark.parametrize(
    ("ref", "held"), [("refs/pull/110/merge", ["p"]), ("refs/heads/main", ["m", "p"])]
)
def test_the_merge_actions_makes_to_test_a_pull_request_is_not_history(
    monkeypatch: pytest.MonkeyPatch, ref: str, held: list[str]
) -> None:
    monkeypatch.setattr(history, "git", _git())
    monkeypatch.setenv("GITHUB_REF", ref)
    monkeypatch.setenv("GITHUB_SHA", "m")

    assert list(history.read_history([])) == held


def test_a_shallow_clone_is_refused_with_the_fix(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(history, "git", _git(shallow="true"))

    with pytest.raises(SystemExit, match="fetch-depth: 0"):
        history.read_history([])


def test_a_repository_without_a_commit_has_no_history(monkeypatch: pytest.MonkeyPatch) -> None:
    def unborn(*args: str) -> str:
        raise subprocess.CalledProcessError(128, ["git", *args])

    monkeypatch.setattr(history, "git", unborn)

    assert history.read_history([]) == {}
