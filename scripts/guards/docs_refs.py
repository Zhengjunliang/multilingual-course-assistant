"""References between files resolve: links, document paths and what a ✅ cites.

Promoted from the checker that moved the documents to English (issue #43). A
reference breaks when what it points at is renamed or deleted, in a commit
that never touches the reference, so the doc-references guard reads every
tracked file on every run (Guard.repository) rather than the files a commit
stages. Its third rule, on entries and sections, is scripts/guards/entries.py.
"""

from __future__ import annotations

import posixpath
import re
from typing import TYPE_CHECKING
from urllib.parse import unquote

from scripts.guards import Finding, Guard, Rule
from scripts.guards.docs import CODE, lines, units
from scripts.guards.entries import DECISION_RULE
from scripts.guards.prose import prose

if TYPE_CHECKING:
    from collections.abc import Iterator

    from scripts.guards import Files

LINK = re.compile(r"\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
DOC_PATH = re.compile(r"(?<![\w/.-])((?:\.\./)?docs/[a-z0-9-]+\.md|gold/README\.md)")
COMMANDS = (
    *("uv ", "uvx ", "python", ".venv/", "npm ", "npx ", "pytest", "pre-commit"),
    *("ruff ", "docker ", "git ", "gh ", "ssh "),
)


def _exists(files: Files, path: str) -> bool:
    """A tracked file, or a directory holding one; `.` is the repository itself."""
    path = posixpath.normpath(unquote(path)).rstrip("/")
    return path in ("", ".") or path in files or any(n.startswith(path + "/") for n in files)


def _link_target(files: Files) -> Iterator[Finding]:
    for path, number, line in lines(files):
        for target in LINK.findall(CODE.sub(" ", line)):
            relative = target.split("#")[0]
            if re.match(r"[a-z]+:", target) or not relative:
                continue
            # A leading `/` is the repository root, as GitHub renders it.
            base = "" if relative.startswith("/") else posixpath.dirname(path)
            if not _exists(files, posixpath.join(base, relative.lstrip("/"))):
                yield Finding(
                    path, number, "link-target", f"links {target}, which git does not hold"
                )
    for path, number, text in prose(files):
        for found in DOC_PATH.finditer(text):
            target = found.group(1)
            if target.startswith("../"):
                target = posixpath.join(posixpath.dirname(path), target)
            if not _exists(files, target):
                yield Finding(path, number, "link-target", f"names {found.group(1)}, not in git")


def _evidence(files: Files, span: str) -> bool:
    """A command, or a tracked path with an optional `:line` or `::name` after it."""
    content = span.strip()
    if not content:
        return False
    if content.startswith(COMMANDS):
        return True
    token = content.split()[0].rstrip(".,;")
    token = re.split(r":(?=[\w(])", token, maxsplit=1)[0].split("::")[0]
    return _exists(files, token.removeprefix("./"))


def _status_path(files: Files) -> Iterator[Finding]:
    for path, number, line in lines(files):
        for marker, scope in units(line):
            spans = CODE.findall(scope)
            if marker != "✅" or not spans or any(_evidence(files, s) for s in spans):
                continue
            linked = [target.split("#")[0] for target in LINK.findall(scope)]
            base = posixpath.dirname(path)
            if not any(t and _exists(files, posixpath.join(base, t)) for t in linked):
                message = "✅ cites no path git holds and no command"
                yield Finding(path, number, "status-path-exists", message)


LINK_RULE = Rule(
    "link-target",
    _link_target,
    good=(
        {"docs/a.md": "[b](b.md), [s](#setup), [site](https://e.org/x.md)\n", "docs/b.md": ""},
        {"README.md": "Apps live in [apps/qa/](apps/qa/).\n", "apps/qa/models.py": ""},
        {
            "docs/a.md": '[repo](../), [b](/docs/b.md "B"), [c](c%20d.md)\n',
            "docs/b.md": "",
            "docs/c d.md": "",
        },
        {
            "rag/a.py": "# see docs/b.md\nPATH = 'docs/gone.md'  # data, not a reference\n",
            "docs/b.md": "",
        },
    ),
    bad=(
        {"docs/a.md": "[gone](gone.md)\n"},
        {"rag/a.py": "# see docs/gone.md\n"},
        {"README.md": "Read `docs/gone.md` first.\n"},
    ),
)

STATUS_PATH_RULE = Rule(
    "status-path-exists",
    _status_path,
    good=(
        {"docs/a.md": "- ✅ the chain is `scripts/check.py:81`\n", "scripts/check.py": ""},
        {"docs/a.md": '- ✅ run `uv run python -m rag.agent "q"`\n'},
        {"docs/a.md": "| Accounts | ✅ | `apps/accounts/` |\n", "apps/accounts/models.py": ""},
        {"docs/a.md": "- ✅ [the probe](../rag/probe.py) (`probe()`)\n", "rag/probe.py": ""},
    ),
    bad=(
        {"docs/a.md": "- ✅ the chain is `scripts/gone.py`\n"},
        {"docs/a.md": "| Parsing | ✅ | `rag/parse.py::convert` |\n"},
    ),
)

DOC_REFERENCES = Guard(
    "doc-references", (LINK_RULE, DECISION_RULE, STATUS_PATH_RULE), repository=True
)
