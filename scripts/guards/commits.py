"""Commit messages are Conventional Commits, in English, and carry no AI signature.

The commit-msg guard reads the message a commit is about to get, at the
commit-msg stage of pre-commit; scripts/guards/history.py holds the same rules
to every commit already made. The header follows commitlint's
config-conventional (outside the repository: @commitlint/config-conventional):
its eleven types, at most 100 characters, no full stop, and a subject that does
not start with a capital letter.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import TYPE_CHECKING

from scripts.guards import Finding, Guard, Rule
from scripts.guards.language import HAN, ITALIAN
from scripts.guards.prose import CITED

if TYPE_CHECKING:
    from collections.abc import Iterator, Sequence

    from scripts.guards import Files

# config-conventional's type-enum.
TYPES = (
    *("build", "chore", "ci", "docs", "feat", "fix"),
    *("perf", "refactor", "revert", "style", "test"),
)
HEADER = re.compile(rf"(?:{'|'.join(TYPES)})(?:\([a-z0-9._/, -]+\))?!?: (?P<subject>\S.*)")
# A commit waiting for `rebase --autosquash`: fine to make, wrong to keep.
AUTOSQUASH = ("fixup! ", "squash! ", "amend! ")
# What `git revert` writes, and since git 2.43 for the revert of a revert.
REVERTS = ('Revert "', 'Reapply "')
# Where `git commit --verbose` starts the diff that git cuts off the message.
SCISSORS = "# ------------------------ >8 ------------------------"
AI = r"claude|anthropic|copilot|chatgpt|openai|codex|gemini|cursor|aider"
# A trailer naming Qwen is a signature; a line saying what Qwen generated is
# about this project, whose own models are Qwen's.
SIGNATURE = re.compile(
    rf"(?:co-authored|assisted|generated)-by:.*\b(?:{AI}|qwen)\b"
    rf"|\W*generated (?:with|by)\W+(?:{AI}|qwen code)\b",
    re.IGNORECASE,
)
# A git trailer naming a person (`Reported-by: …`, `Name <mail>`) is not prose.
TRAILER = re.compile(r"[A-Za-z]+(?:-[A-Za-z]+)*-by: |[A-Za-z-]+: [^<\n]*<[^>\n]*@[^>\n]*>$")


def header(message: str, history: bool) -> str | None:
    """What is wrong with the first line, or None."""
    first = message.split("\n", 1)[0]
    if first.startswith(REVERTS):
        return None
    if first.startswith("Merge "):
        return "a merge, and history is linear: `git merge --abort`, then rebase instead"
    if first.startswith(AUTOSQUASH):
        return "a fixup left for an autosquash that never ran" if history else None
    found = HEADER.fullmatch(first)
    if found is None:
        return f"`{first[:50]}` is not `type(scope): subject`, a type of {', '.join(TYPES)}"
    if len(first) > 100:
        return f"the header is {len(first)} characters, 100 at most"
    if found["subject"].endswith("."):
        return "the subject ends with a full stop"
    if found["subject"][0].isupper():
        return "the subject starts with a capital letter"
    return None


def english(message: str) -> Iterator[tuple[int, str]]:
    for number, line in enumerate(message.splitlines(), 1):
        if TRAILER.match(line.strip()):
            continue
        text = CITED.sub(" ", line)
        for pattern, language in ((HAN, "Chinese"), (ITALIAN, "Italian")):
            if found := pattern.search(text):
                yield number, f"{language} `{found.group()}` in the message"


def signature(message: str) -> Iterator[tuple[int, str]]:
    for number, line in enumerate(message.splitlines(), 1):
        if SIGNATURE.match(line):
            yield number, f"an AI tool's signature: {line.strip()[:60]}"


def _commit_header(files: Files) -> Iterator[Finding]:
    for path, message in files.items():
        if wrong := header(message, history=False):
            yield Finding(path, 1, "commit-header", wrong)


def _commit_english(files: Files) -> Iterator[Finding]:
    for path, message in files.items():
        for number, wrong in english(message):
            yield Finding(path, number, "commit-english", wrong)


def _commit_signature(files: Files) -> Iterator[Finding]:
    for path, message in files.items():
        for number, wrong in signature(message):
            yield Finding(path, number, "commit-signature", wrong)


def read_message(paths: Sequence[str]) -> Files:
    """The message as git will store it.

    When git opened an editor, it drops the comment lines, and the diff of
    `commit --verbose`, only after this hook has run; with `-m` or `-F` it
    keeps them, and tells the hook so by setting GIT_EDITOR to `:`. Either way
    it trims trailing whitespace and the blank lines around the message.
    """
    edited = os.environ.get("GIT_EDITOR") != ":"
    files: dict[str, str] = {}
    for path in paths:
        text = Path(path).read_bytes().decode("utf-8", errors="replace")
        kept: list[str] = []
        for line in text.splitlines():
            if edited and line == SCISSORS:
                break
            if not (edited and line.startswith("#")):
                kept.append(line.rstrip())
        files[Path(path).as_posix()] = "\n".join(kept).strip("\n") + "\n"
    return files


_MSG = ".git/COMMIT_EDITMSG"
_BODY = "fix(rag): answer in the student's language\n\n"

HEADER_RULE = Rule(
    "commit-header",
    _commit_header,
    good=(
        {_MSG: "feat(guards): check commit messages\n"},
        {_MSG: "build(deps-dev): bump ruff from 0.16.1 to 0.16.7\n"},
        {_MSG: "fix(api, ui): agree on the error shape\n"},
        {_MSG: 'Revert "feat: x"\n\nThis reverts commit 1ab1cc6.\n'},
        {_MSG: 'Reapply "feat: x"\n'},
        {_MSG: "fixup! docs: say why\n"},
        {_MSG: "feat!: drop the v1 API\n"},
    ),
    bad=(
        {_MSG: "M2.5a: campus web source\n"},
        {_MSG: "Feat: x\n"},
        {_MSG: "feat(Guards): x\n"},
        {_MSG: "feat:add x\n"},
        {_MSG: "feat: Add the guard\n"},
        {_MSG: "docs: README in English\n"},
        {_MSG: "feat: add the guard.\n"},
        {_MSG: "feat: " + "x" * 100 + "\n"},
        {_MSG: '"feat: a stray quote\n'},
        {_MSG: "Merge branch 'main' of https://github.com/x/y\n"},
        {_MSG: "Merge the two readers\n"},
    ),
)

ENGLISH_RULE = Rule(
    "commit-english",
    _commit_english,
    good=(
        {_MSG: _BODY + 'A query such as "quando sono gli appelli" is answered in Italian.\n'},
        {_MSG: _BODY + "`della` and `学费` are data.\n"},
        {_MSG: _BODY + "Co-authored-by: Carlo Della Rocca <carlo@example.org>\n"},
        {_MSG: _BODY + "Reported-by: Paolo Della Rocca\n"},
    ),
    bad=(
        {_MSG: "docs: aggiorna la guida della sessione\n"},
        {_MSG: _BODY + "Il router sbaglia quando manca il contesto.\n"},
        {_MSG: _BODY + "Note: il router sbaglia.\n"},
        {_MSG: _BODY + "Follow-up: il router sbaglia.\n"},
        {_MSG: _BODY + "修复了路由的错误\n"},
    ),
)

SIGNATURE_RULE = Rule(
    "commit-signature",
    _commit_signature,
    good=(
        {_MSG: _BODY + "Co-authored-by: dependabot[bot] <49699333+dependabot[bot]@github.com>\n"},
        {_MSG: "docs: say which answers are generated with claude-like models\n"},
        {_MSG: _BODY + "Generated with care: the fixtures come from the live site.\n"},
        {_MSG: _BODY + "Generated by Qwen/Qwen3-4B on MICC, then corrected by hand.\n"},
    ),
    bad=(
        {_MSG: _BODY + "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>\n"},
        {_MSG: _BODY + "\U0001f916 Generated with [Claude Code](https://claude.com/claude-code)\n"},
        {_MSG: _BODY + "Co-authored-by: Copilot <copilot@github.com>\n"},
        {_MSG: _BODY + "Co-authored-by: Qwen-Coder <qwen-coder@alibabacloud.com>\n"},
        {_MSG: _BODY + "Assisted-by: Claude\n"},
    ),
)

COMMIT_MSG = Guard(
    "commit-msg",
    (HEADER_RULE, ENGLISH_RULE, SIGNATURE_RULE),
    read=read_message,
    ignorable=False,
)
