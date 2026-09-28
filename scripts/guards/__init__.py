"""Repository rules that no off-the-shelf linter checks, each proven by examples.

A rule reads a set of files and reports findings. Every rule carries good and
bad examples — small sets of files it must pass and must flag — and
tests/test_guards.py runs all of them, so a rule whose pattern quietly stopped
matching fails the suite instead of passing forever.

A guard is a named group of rules, and one pre-commit hook runs one guard:

    python -m scripts.guards <guard> [file ...]

Standard library only, and no syntax newer than Python 3.9, the oldest that
pre-commit runs on: a local hook runs from a virtualenv of its own, built on
whatever Python runs pre-commit, holding none of the project's packages.
tests/test_guards.py enforces both.

An exception is written where it applies, in a comment, with its reason: at the
end of the line it silences, or alone on the line above it.

    # guard-ignore env-parity: read by docker-compose.yml, not by Django

A marker without a reason is itself a finding.
"""

from __future__ import annotations

import io
import re
import tokenize
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Callable, Iterator, Mapping

    # Repository-relative POSIX path -> the file's text.
    Files = Mapping[str, str]

MARKER_RULE = "guard-marker"
# Only in a comment, and only as the whole comment: prose that mentions the
# marker is not one.
MARKER = re.compile(
    r"(?:#|//|<!--)\s*guard-ignore\s+(?P<rules>[a-z0-9-]+(?:\s*,\s*[a-z0-9-]+)*)"
    r"\s*(?::(?P<reason>.*?))?\s*(?:-->)?\s*$"
)


@dataclass(frozen=True)
class Finding:
    path: str
    line: int
    rule: str
    message: str

    def __str__(self) -> str:
        return f"{self.path}:{self.line}: {self.rule} {self.message}"


@dataclass(frozen=True)
class Rule:
    id: str
    check: Callable[[Files], Iterator[Finding]]
    good: tuple[Files, ...]
    bad: tuple[Files, ...]


@dataclass(frozen=True)
class Guard:
    name: str
    rules: tuple[Rule, ...]
    # The files the guard reads, when it reads a fixed set rather than the
    # files its hook passes it.
    paths: tuple[str, ...] = ()


@dataclass(frozen=True)
class Marker:
    path: str
    line: int
    # The line it silences: its own, or the next when it stands alone.
    target: int
    rules: frozenset[str]
    reason: str


def _opener(path: str) -> str:
    """The comment opener a marker must use in this kind of file."""
    suffix = PurePosixPath(path).suffix
    if suffix in (".md", ".markdown"):
        return "<!--"
    return "//" if suffix in (".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs") else "#"


def _lines(path: str, text: str) -> Iterator[tuple[int, str, int]]:
    """Where a marker may sit: each line, and the column its comment starts at.

    In Python only a real comment counts, so a marker quoted in a string or a
    docstring is not one; in markdown, not one shown in a fenced code block.
    """
    if not path.endswith(".py"):
        fenced = False
        for number, line in enumerate(text.splitlines(), 1):
            if _opener(path) == "<!--" and line.lstrip().startswith(("```", "~~~")):
                fenced = not fenced
            elif not fenced:
                yield number, line, 0
        return
    try:
        tokens = list(tokenize.generate_tokens(io.StringIO(text).readline))
    except (SyntaxError, tokenize.TokenError):
        return
    for token in tokens:
        if token.type == tokenize.COMMENT:
            yield token.start[0], token.line.rstrip("\r\n"), token.start[1]


def markers(files: Files) -> list[Marker]:
    found: list[Marker] = []
    for path, text in files.items():
        for number, line, column in _lines(path, text):
            marker = MARKER.search(line, column)
            if marker is None or not marker.group().startswith(_opener(path)):
                continue
            target = number if line[: marker.start()].strip() else number + 1
            rules = frozenset(rule.strip() for rule in marker["rules"].split(","))
            found.append(Marker(path, number, target, rules, (marker["reason"] or "").strip()))
    return found


def run(guard: Guard, files: Files, known: frozenset[str] = frozenset()) -> list[Finding]:
    """Every finding no marker silences, and every marker that gives no reason,
    names a rule that does not exist, or silences nothing of this guard's.

    `known` is every rule id of every guard; left empty, names go unchecked.
    """
    findings: list[Finding] = []
    silenced: dict[tuple[str, int], set[str]] = {}
    valid: list[Marker] = []
    for marker in markers(files):
        unknown = sorted(marker.rules - known) if known else []
        if not marker.reason:
            findings.append(Finding(marker.path, marker.line, MARKER_RULE, "needs `: <reason>`"))
        elif unknown:
            message = f"no rule is called {', '.join(unknown)}"
            findings.append(Finding(marker.path, marker.line, MARKER_RULE, message))
        else:
            silenced.setdefault((marker.path, marker.target), set()).update(marker.rules)
            valid.append(marker)
    used: set[tuple[str, int, str]] = set()
    for rule in guard.rules:
        for finding in rule.check(files):
            if finding.rule in silenced.get((finding.path, finding.line), set()):
                used.add((finding.path, finding.line, finding.rule))
            else:
                findings.append(finding)
    own = {rule.id for rule in guard.rules}
    for marker in valid:
        for rule in sorted(marker.rules & own):
            if (marker.path, marker.target, rule) not in used:
                message = f"silences no {rule} finding: delete it"
                findings.append(Finding(marker.path, marker.line, MARKER_RULE, message))
    return sorted(findings, key=lambda finding: (finding.path, finding.line, finding.rule))
