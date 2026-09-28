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

import re
from dataclasses import dataclass
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


def markers(files: Files) -> tuple[dict[tuple[str, int], set[str]], list[Finding]]:
    """Which rules each line silences, and the markers that give no reason."""
    silenced: dict[tuple[str, int], set[str]] = {}
    refused: list[Finding] = []
    for path, text in files.items():
        for number, line in enumerate(text.splitlines(), 1):
            marker = MARKER.search(line)
            if marker is None:
                continue
            if not (marker["reason"] or "").strip():
                refused.append(
                    Finding(path, number, MARKER_RULE, "a guard-ignore needs `: <reason>`")
                )
                continue
            # Nothing before the comment: the marker speaks for the next line.
            target = number + 1 if not line[: marker.start()].strip() else number
            rules = {rule.strip() for rule in marker["rules"].split(",")}
            silenced.setdefault((path, target), set()).update(rules)
    return silenced, refused


def run(guard: Guard, files: Files) -> list[Finding]:
    """Every finding of the guard's rules that no marker silences, in file order."""
    silenced, findings = markers(files)
    for rule in guard.rules:
        findings += [
            finding
            for finding in rule.check(files)
            if finding.rule not in silenced.get((finding.path, finding.line), set())
        ]
    return sorted(findings, key=lambda finding: (finding.path, finding.line, finding.rule))
