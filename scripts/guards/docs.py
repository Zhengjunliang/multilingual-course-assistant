"""The documentation conventions of CLAUDE.md that one file is enough to check.

Promoted from the checker that moved the documents to English (issue #43):
a status marker carries its evidence, status is never told by temporal words,
and a link to another file never points at one of its headings.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

from scripts.guards import Finding, Guard, Rule
from scripts.guards.prose import CITED, FENCE, prose

if TYPE_CHECKING:
    from collections.abc import Iterator

    from scripts.guards import Files

MARKERS = "✅🔜🔶🔒"
CODE = re.compile(r"`([^`]+)`")
MILESTONE = re.compile(r"\bM[3-7]\b")
ISSUE = re.compile(r"#\d+")
TEMPORAL = re.compile(
    r"\b(already|currently|soon|still|not yet|for now|today|now|at the moment|recently)\b",
    re.IGNORECASE,
)
RELATIVE_LINK = re.compile(r"\]\((?![a-z]+:)[^)\s]+")
# A relative link only: another site's headings are not this repository's to keep.
ANCHOR_LINK = re.compile(r"\]\((?![a-z]+:)[^)#\s]+\.md#")


def lines(files: Files) -> Iterator[tuple[str, int, str]]:
    """Every markdown line outside fenced code, with its code spans kept."""
    for path, text in files.items():
        if not path.endswith((".md", ".markdown")):
            continue
        fenced = False
        for number, line in enumerate(text.splitlines(), 1):
            if FENCE.match(line):
                fenced = not fenced
            elif not fenced:
                yield path, number, line


def units(line: str) -> Iterator[tuple[str, str]]:
    """Each (marker, scope): in a table row the whole row, where evidence may sit
    in any cell; elsewhere from the marker to the end of its sentence or to the
    next marker. A marker named rather than used takes a guard-ignore."""
    stripped = line.strip()
    for found in re.finditer(f"[{MARKERS}]", stripped):
        if stripped.startswith("|"):
            yield found.group(), stripped
            continue
        rest = stripped[found.start() :]
        end = re.search(rf"(?<=[.!?])\s+(?=[A-Z])|\s(?=[{MARKERS}])", rest[1:])
        yield found.group(), rest[: end.start() + 1] if end else rest


def _form(marker: str, scope: str) -> str | None:
    """What the scope of this marker lacks, or None."""
    if marker == "✅" and not (CODE.search(scope) or RELATIVE_LINK.search(scope)):
        return "✅ cites no path or command, in backticks or as a link"
    if marker == "🔜" and not MILESTONE.search(scope):
        return "🔜 names no milestone M3-M7"
    if marker == "🔒" and not (ISSUE.search(scope) or "unblock" in scope.lower()):
        return "🔒 names no issue and no one who unblocks it"
    if marker == "🔶" and not (
        CODE.search(scope) or ISSUE.search(scope) or MILESTONE.search(scope)
    ):
        return "🔶 names no path, command, issue or milestone for what is missing"
    return None


def _status_marker(files: Files) -> Iterator[Finding]:
    for path, number, line in lines(files):
        for marker, scope in units(line):
            if (lack := _form(marker, scope)) is not None:
                yield Finding(path, number, "status-marker", lack)


def _temporal_word(files: Files) -> Iterator[Finding]:
    documents = {path: text for path, text in files.items() if path.endswith((".md", ".markdown"))}
    for path, number, text in prose(documents):
        if found := TEMPORAL.search(CITED.sub(" ", text)):
            message = f"`{found.group()}`: status is told by a marker, not by time"
            yield Finding(path, number, "temporal-word", message)


def _anchor_link(files: Files) -> Iterator[Finding]:
    for path, number, line in lines(files):
        if ANCHOR_LINK.search(CODE.sub(" ", line)):
            message = "links a heading of another file; headings change, link the file"
            yield Finding(path, number, "anchor-link", message)


STATUS_RULE = Rule(
    "status-marker",
    _status_marker,
    good=(
        {"docs/a.md": "- ✅ the chain is `scripts/check.py`\n- 🔜 M5: roles\n- 🔒 waits on #44\n"},
        {
            "docs/a.md": "| Parsing | ✅ | `rag/parse.py` |\n"
            "| Cascade | 🔶 exists, not measured | M3 |\n"
        },
        {
            "docs/a.md": "Legend: ✅ is done. <!-- guard-ignore status-marker: names it -->\n"
            "\n```text\n✅ inside code\n```\n"
        },
    ),
    bad=(
        {"docs/a.md": "- ✅ implemented\n"},
        {"docs/a.md": "- **Sparse side** ✅ done, and tested\n"},
        {"docs/a.md": "- 🔜 roles will come\n"},
        {"docs/a.md": "Upload. 🔒 blocked\n"},
        {"docs/a.md": "| Roles | 🔶 partial |\n"},
    ),
)

TEMPORAL_RULE = Rule(
    "temporal-word",
    _temporal_word,
    good=(
        {"docs/a.md": "The chain runs five steps.\n"},
        {"docs/a.md": 'The rule bans "now" and `datetime.now()` in status.\n'},
        {"docs/a.md": "```text\nstill running\n```\n", "rag/a.py": "# still here\n"},
    ),
    bad=(
        {"docs/a.md": "The chain currently runs five steps.\n"},
        {"docs/a.md": "- 🔶 not yet measured\n"},
        {"docs/a.md": "Now the tests pass.\n"},
    ),
)

ANCHOR_RULE = Rule(
    "anchor-link",
    _anchor_link,
    good=(
        {"docs/a.md": "[the log](experiment-log.md), entry of 2026-08-21\n"},
        {"docs/a.md": "[below](#setup), and [the site](https://example.org/a.md#b)\n"},
        {"docs/a.md": "Written as `[x](a.md#b)` in code.\n"},
    ),
    bad=(
        {"docs/a.md": "[setup](README.md#setup)\n"},
        {"docs/a.md": "[x](../docs/a.md#b)\n"},
        {"README.md": "| see [the pipeline](docs/docling-pipeline.md#chunking) |\n"},
    ),
)

DOC_CONVENTIONS = Guard("doc-conventions", (STATUS_RULE, TEMPORAL_RULE, ANCHOR_RULE))
