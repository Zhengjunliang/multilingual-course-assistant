"""Every commit in history keeps the rules of the commit-msg guard, and none is a merge.

The net for what never met the commit-msg hook: a commit made on github.com,
with --no-verify, or pushed past the ruleset by an admin. It reads every commit
on every run, so it needs the whole history; CI's hooks job fetches it. Pull
requests land by rebase, so what the hooks job checked on a branch is exactly
what reaches main.

History is not rewritten, so the commits from before these rules that break
one are frozen in LEGACY, each with its reason; an entry that no commit needs
any more is itself a finding.
"""

from __future__ import annotations

import os
import re
import subprocess
from typing import TYPE_CHECKING

from scripts.guards import Finding, Guard, Rule, git
from scripts.guards.commits import english, header, signature

if TYPE_CHECKING:
    from collections.abc import Iterator, Sequence

    from scripts.guards import Files

LEGACY = {
    "c13a5e2c86ff4b98ddb536477ad46cc9e8ed4c56": "the first commit, with an AI co-author trailer",
    "d9e05bcbf690af0aad3fda1c36fa87732cd9afa0": "shell quoting put a stray quote before the type",
    "20ab9f290e734824cc7b870f0f0b5150bbc63e5e": "a pull request squashed under a milestone label",
    "6182a20115175b32181730ba839a9bdc09ae812e": "shell quoting lost the header of the message",
    "1ab1cc6ffd4005063987462aa6415c644e041421": "a pull request merged with a merge commit",
    "792d893dc751ac81e29a45c9bdacdc4703547fa1": "a pull request merged with a merge commit",
    "04d80caf05d6118f88e4a9686f7a2d879a5c517f": "a pull request merged with a merge commit",
    "fcf63e138361dab18198ef1efd9272157e1f597a": "`git pull` merged main rather than rebasing",
    "3de9663c5090355c543b19ea6ec10939e27939b5": "`git pull` merged main rather than rebasing",
}


def _split(text: str) -> tuple[list[str], str]:
    """A commit's parents and message. It reads as `git log --format=%P%n%B`
    prints it: its parents on the first line, then its message."""
    parents, _, message = text.partition("\n")
    return parents.split(), message


def _broken(parents: list[str], message: str) -> Iterator[tuple[int, str]]:
    """Every rule a commit in history breaks."""
    if len(parents) > 1:
        yield 1, "a merge commit, and history is linear: rebase instead"
        return
    if wrong := header(message, history=True):
        yield 1, wrong
    yield from english(message)
    yield from signature(message)


def _history_commit(files: Files) -> Iterator[Finding]:
    for sha, text in files.items():
        if sha not in LEGACY:
            for number, wrong in _broken(*_split(text)):
                yield Finding(sha, number, "history-commit", wrong)


def _history_frozen(files: Files) -> Iterator[Finding]:
    if not any(sha in files for sha in LEGACY):
        return  # another history altogether: a new repository, an orphan branch
    for sha in LEGACY:
        if sha not in files:
            yield Finding(sha, 1, "history-frozen", "LEGACY names it, and history does not")
        elif not any(_broken(*_split(files[sha]))):
            yield Finding(sha, 1, "history-frozen", "it breaks no rule: drop it from LEGACY")


def read_history(_paths: Sequence[str]) -> Files:
    """Every commit reachable from HEAD, merges included."""
    try:
        head = git("rev-parse", "--verify", "HEAD").strip()
    except subprocess.CalledProcessError:
        return {}  # no commit yet: nothing to read
    if git("rev-parse", "--is-shallow-repository").strip() == "true":
        raise SystemExit(
            "commit-history reads the whole history, and this clone is shallow: "
            "check out with `fetch-depth: 0`, or run `git fetch --unshallow`"
        )
    commits: dict[str, str] = {}
    # --no-show-signature: log.showSignature would print gpg output among the fields.
    log = git("log", "-z", "--no-show-signature", "--format=%H%n%P%n%B")
    for entry in log.split("\0"):
        sha, _, text = entry.partition("\n")
        if sha:
            commits[sha] = text
    # On a pull request, Actions checks out a merge of the branch into main
    # that exists on the runner alone; the commits it joins are the history.
    if (
        re.fullmatch(r"refs/pull/\d+/merge", os.environ.get("GITHUB_REF", ""))
        and os.environ.get("GITHUB_SHA") == head
    ):
        commits.pop(head, None)
    return commits


_ONE = "0f0f0f0f0f0f\n"
_TWO = "0f0f0f0f0f0f 1e1e1e1e1e1e\n"
# Every frozen commit, each still a merge: what LEGACY needs to stay valid.
_FROZEN = dict.fromkeys(LEGACY, _TWO + "Merge branch 'main'\n")
_FIRST = next(iter(_FROZEN))

HISTORY_RULE = Rule(
    "history-commit",
    _history_commit,
    good=(
        {"a1b2c3d4e5f6": _ONE + "build(deps): bump qdrant-client from 1.18.0 to 1.19.0\n"},
        {"a1b2c3d4e5f6": _ONE + 'Revert "feat: x"\n'},
        {"a1b2c3d4e5f6": "\nchore: init repo\n"},
        {"a1b2c3d4e5f6": _ONE + "docs: x\n\n# guard-ignore history-commit: text\n"},
        {_FIRST: _TWO + "Merge pull request #1 from x/y\n"},
        {_FIRST: _ONE + "M2.5a: campus web source\n"},
    ),
    bad=(
        {"a1b2c3d4e5f6": _TWO + "Merge branch 'main' of https://github.com/x/y\n"},
        {"a1b2c3d4e5f6": _ONE + "fixup! docs: say why\n"},
        {"a1b2c3d4e5f6": _ONE + "Update README.md\n"},
        {"a1b2c3d4e5f6": _ONE + "docs: aggiorna la guida della sessione\n"},
        {"a1b2c3d4e5f6": _ONE + "chore: x\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n"},
    ),
)

FROZEN_RULE = Rule(
    "history-frozen",
    _history_frozen,
    good=(
        _FROZEN,
        {**_FROZEN, "a1b2c3d4e5f6": _ONE + "feat: x\n"},
        {"a1b2c3d4e5f6": "\nchore: start the gh-pages branch\n"},
    ),
    bad=(
        {sha: text for sha, text in _FROZEN.items() if sha != _FIRST},
        {**_FROZEN, _FIRST: _ONE + "feat: x\n"},
    ),
)

COMMIT_HISTORY = Guard(
    "commit-history",
    (HISTORY_RULE, FROZEN_RULE),
    repository=True,
    read=read_history,
    ignorable=False,
)
