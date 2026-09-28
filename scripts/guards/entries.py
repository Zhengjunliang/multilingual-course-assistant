"""References to a decision entry, an experiment-log entry or a section resolve.

After a mention of `docs/<name>.md` in prose, the text that follows (and the
next line, where a reference wraps) is read the way this repository writes its
references: a decision by date, told apart by its *title* when a date holds
several, with its `point N`; `entry of DATE` in the experiment log; `section
N.N` of the pipeline notes; and `section on <name>` of any document.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import TYPE_CHECKING

from scripts.guards import Finding, Rule
from scripts.guards.prose import FENCE, prose

if TYPE_CHECKING:
    from collections.abc import Iterator

    from scripts.guards import Files

DECISIONS, LOG, PIPELINE = "docs/decisions.md", "docs/experiment-log.md", "docs/docling-pipeline.md"
MENTION = re.compile(r"(?<![\w-])([a-z0-9-]+)\.md")
DATE = r"\d{4}-\d{2}-\d{2}"
DATES = rf"((?:{DATE}(?:,? and |, )?)+)"


def _norm(text: str) -> str:
    """Lower case, without emphasis, one space wherever a title wrapped."""
    return re.sub(r"\s+", " ", re.sub(r"[`*_]", "", text)).strip().lower()


def _headings(text: str) -> list[str]:
    found: list[str] = []
    fenced = False
    for line in text.splitlines():
        if FENCE.match(line):
            fenced = not fenced
        elif line.startswith("#") and not fenced:
            found.append(_norm(line.lstrip("#")))
    return found


@dataclass
class _Entry:
    title: str
    points: int = 0


def _entries(text: str) -> dict[str, list[_Entry]]:
    """The decision entries, by date: several may share one."""
    entries: dict[str, list[_Entry]] = {}
    current: _Entry | None = None
    for line in text.splitlines():
        if heading := re.match(rf"## ({DATE}) — (.+)", line):
            current = _Entry(_norm(heading[2]))
            entries.setdefault(heading[1], []).append(current)
        elif current is not None and (point := re.match(r"(\d+)\. ", line)):
            current.points = max(current.points, int(point[1]))
    return entries


def _decision(entries: dict[str, list[_Entry]], date: str, rest: str) -> str | None:
    """What is wrong with a reference to the decision of `date`, or None."""
    candidates = entries.get(date, [])
    if not candidates:
        return f"no decision entry is dated {date}"
    rest = re.split(DATE, rest, maxsplit=1)[0]
    if title := re.match(r"[\s,]*\*([^*]+)\*", rest):
        named = _norm(title[1])
        candidates = [c for c in candidates if named in c.title]
        if not candidates:
            return f"no decision of {date} is titled {named}"
        if len(candidates) > 1:
            return f"*{named}* fits {len(candidates)} entries of {date}: quote more of the title"
        rest = rest[title.end() :]
    elif len(candidates) > 1:
        return f"{date} has {len(candidates)} entries: name the one meant by its title"
    point = re.match(r"[\s,]*points? (\d+)", rest)
    if point and int(point[1]) > candidates[0].points:
        return f"the decision of {date} has no point {point[1]}"
    return None


def _resolve(files: Files, document: str, after: str) -> Iterator[str]:
    if document == DECISIONS:
        entries = _entries(files[DECISIONS])
        if many := re.match(rf"(?:the (?:two )?)?entries of {DATES}", after):
            yield from (
                f"no decision entry is dated {d}"
                for d in re.findall(DATE, many[1])
                if d not in entries
            )
        elif (one := re.match(rf"(?:the entry of )?({DATE})", after)) and (
            wrong := _decision(entries, one[1], after[one.end() :])
        ):
            yield wrong
    elif document == LOG and (dates := re.match(rf"entr(?:y|ies) of {DATES}", after)):
        held = {heading[:10] for heading in _headings(files[LOG])}
        yield from (
            f"the experiment log has no entry {d}"
            for d in re.findall(DATE, dates[1])
            if d not in held
        )
    elif document == PIPELINE and (section := re.match(r"(?:section |§)(\d+(?:\.\d+)?)", after)):
        if not any(
            re.match(rf"{re.escape(section[1])}[. ]", h) for h in _headings(files[PIPELINE])
        ):
            yield f"{PIPELINE} has no section {section[1]}"
    if named := re.match(r"(?:the )?section on ([^,.;()]+)", after):
        wanted = _norm(named[1])
        # The name may run on into the sentence: a heading it starts with counts.
        if not any(
            h and (wanted in h or re.match(re.escape(h) + r"\b", wanted))
            for h in _headings(files[document])
        ):
            yield f"{document} has no section on {named[1].strip()}"


def _decision_ref(files: Files) -> Iterator[Finding]:
    found = list(prose(files))
    for k, (path, number, text) in enumerate(found):
        # A reference may wrap onto the next line, and only onto the next line.
        adjacent = k + 1 < len(found) and found[k + 1][:2] == (path, number + 1)
        following = found[k + 1][2] if adjacent else ""
        for mention in MENTION.finditer(text):
            document = f"docs/{mention[1]}.md"
            if document in files:
                joined = re.sub(r"\s+", " ", f"{text[mention.end() :]} {following}")
                after = re.sub(r"^[\s`\]),]*", "", joined)[:240]
                for wrong in _resolve(files, document, after):
                    yield Finding(path, number, "decision-ref", wrong)


_LOG = "## 2026-08-21 — Live ingest\n"
_PIPELINE = "# Pipeline\n\n## 4.1 Chunking\n"
_DECISIONS = (
    "## 2026-09-25 — The data model is decided on paper\n\n1. a\n2. b\n\n"
    "## 2026-09-25 — PPM read from Moodle\n\n1. a\n\n"
    "## 2026-09-24 — One chain\n\n1. a\n"
)
_DOCS = {
    DECISIONS: _DECISIONS,
    LOG: _LOG,
    PIPELINE: _PIPELINE,
    "docs/architecture.md": "## Compute strategy\n",
}

DECISION_RULE = Rule(
    "decision-ref",
    _decision_ref,
    good=(
        {**_DOCS, "docs/a.md": "([decisions.md](decisions.md), 2026-09-24, point 1)\n"},
        {**_DOCS, "docs/a.md": "decisions.md, 2026-09-25, *PPM read from Moodle*, point 1.\n"},
        {**_DOCS, "docs/a.md": "decisions.md, the two entries of 2026-09-25 and 2026-09-24.\n"},
        {**_DOCS, "rag/a.py": "# experiment-log.md, entry of 2026-08-21\n"},
        {**_DOCS, "docs/a.md": "[docling-pipeline.md](docling-pipeline.md), section 4.1.\n"},
        {**_DOCS, "docs/a.md": "[architecture.md](architecture.md), section on compute strategy\n"},
        {**_DOCS, "docs/a.md": "architecture.md, section on compute strategy (and why it holds)\n"},
        {
            **_DOCS,
            "rag/a.py": "# docs/decisions.md, 2026-09-25, *PPM read\n# from Moodle*, point 1.\n",
        },
        {**_DOCS, "docs/a.md": "- decisions.md, 2026-09-24.\n- the cut-off point 9\n"},
    ),
    bad=(
        {**_DOCS, "docs/a.md": "decisions.md, 2026-09-23.\n"},
        {**_DOCS, "docs/a.md": "decisions.md, 2026-09-25, point 1.\n"},
        {**_DOCS, "docs/a.md": "decisions.md, 2026-09-25, *Roles are built first*.\n"},
        {**_DOCS, "docs/a.md": "decisions.md, 2026-09-24, *One chain*, point 4.\n"},
        {**_DOCS, "docs/a.md": "experiment-log.md, entry of 2026-08-22\n"},
        {**_DOCS, "docs/a.md": "docling-pipeline.md, section 3.6\n"},
        {**_DOCS, "docs/a.md": "architecture.md, section on deployment\n"},
        {**_DOCS, "docs/a.md": "architecture.md, section on computers\n"},
    ),
)
