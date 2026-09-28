"""Where the prose is in each kind of file the guards read.

Prose is what a person wrote to be read: Python comments, docstrings and the
names of pytest tests; TypeScript and JavaScript comments; markdown outside
code. String literals are data and are never prose. Inside prose, a fragment
in quotes, backticks or italics is a citation (CITED), as is a URL.

The TypeScript reader is a lexical scan, not a parser: a comment inside a
template literal's `${…}` is not read.
"""

from __future__ import annotations

import ast
import bisect
import io
import re
import tokenize
from pathlib import PurePosixPath
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Callable, Iterator

    from scripts.guards import Files

CITED = re.compile(
    r'"[^"\n]*"|“[^”\n]*”|«[^»\n]*»|`[^`\n]*`'
    r"|(?<!\*)\*(?=\S)[^*\n]+(?<=\S)\*(?!\*)|https?://\S+"
)
MARKDOWN_NOISE = re.compile(r"<!--.*?-->|\]\([^)]*\)|<https?://[^>]*>")
CODE_SPAN = re.compile(r"`[^`\n]*`")
OPENING_QUOTE = re.compile(r"^[rRuUbBfF]*(\"\"\"|'''|\"|')")
CLOSING_QUOTE = re.compile(r"(\"\"\"|'''|\"|')$")
FENCE = re.compile(r"\s*(```|~~~)")
# After one of these, a `/` opens a regular expression rather than dividing;
# `<` and `>` stay out so that a JSX `</p>` is not read as one.
BEFORE_REGEX = frozenset("(,=:[!&|?{};+-*%~^")


def _python(text: str) -> Iterator[tuple[int, str]]:
    try:
        tokens = list(tokenize.generate_tokens(io.StringIO(text).readline))
    except (SyntaxError, tokenize.TokenError):
        tokens = []  # ruff reports a file that does not tokenize
    for token in tokens:
        if token.type == tokenize.COMMENT:
            yield token.start[0], token.string.lstrip("#")
    try:
        tree = ast.parse(text)
    except SyntaxError:
        return  # syntax newer than this interpreter: the comments above still count
    # Split where ast counts lines; str.splitlines() also breaks at \f and \x85.
    source = [line.encode("utf-8") for line in re.split(r"\r\n|\r|\n", text)]
    for node in ast.walk(tree):
        body = getattr(node, "body", None)
        if isinstance(body, list) and body and isinstance(body[0], ast.Expr):
            value = body[0].value
            if isinstance(value, ast.Constant) and isinstance(value.value, str):
                yield from _docstring(source, value)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name.startswith(
            "test"
        ):
            yield node.lineno, node.name.replace("_", " ")


def _docstring(source: list[bytes], value: ast.Constant) -> Iterator[tuple[int, str]]:
    """The docstring as written, line by line, without its quotes.

    Source rather than the string's value, whose escapes and continuations
    would shift every line number after them; cut to the string's own columns
    (UTF-8 byte offsets, as ast gives them) so no code on its lines is read.
    """
    first, last = value.lineno, value.end_lineno or value.lineno
    chunk = source[first - 1 : last]
    chunk[-1] = chunk[-1][: value.end_col_offset]
    chunk[0] = chunk[0][value.col_offset :]
    lines = [line.decode("utf-8", "replace") for line in chunk]
    lines[0] = OPENING_QUOTE.sub("", lines[0])
    lines[-1] = CLOSING_QUOTE.sub("", lines[-1])  # the same line, for a one-line docstring
    for offset, line in enumerate(lines):
        yield first + offset, line


def _skip_quoted(text: str, start: int, quote: str) -> int:
    """The index just past the string that opens at `start`."""
    i = start + 1
    while i < len(text) and text[i] != quote:
        if text[i] == "\n" and quote != "`":
            break  # a quote still open at the end of its line was not a string
        i += 2 if text[i] == "\\" else 1
    return i + 1


def _skip_regex(text: str, start: int) -> int:
    i, in_class = start + 1, False
    while i < len(text) and text[i] != "\n":
        if text[i] == "\\":
            i += 2
            continue
        if text[i] == "/" and not in_class:
            break
        in_class = (in_class or text[i] == "[") and text[i] != "]"
        i += 1
    return i + 1


def _script(text: str) -> Iterator[tuple[int, str]]:
    """The comments of TypeScript or JavaScript, found by a lexical scan."""
    newlines = [i for i, char in enumerate(text) if char == "\n"]
    i, last = 0, ""
    while i < len(text):
        char = text[i]
        if text.startswith("//", i):
            end = text.find("\n", i)
            end = len(text) if end < 0 else end
            yield bisect.bisect_left(newlines, i) + 1, text[i + 2 : end]
            i = end
        elif text.startswith("/*", i):
            end = text.find("*/", i + 2)
            end = len(text) if end < 0 else end
            first = bisect.bisect_left(newlines, i) + 1
            for offset, part in enumerate(text[i + 2 : end].split("\n")):
                yield first + offset, part
            i = end + 2
        elif char in "'\"`" and not (char == "'" and i and text[i - 1].isalnum()):
            # A `'` right after a letter is an apostrophe in JSX text.
            i, last = _skip_quoted(text, i, char), char
        elif char == "/" and (not last or last in BEFORE_REGEX):
            i, last = _skip_regex(text, i), "/"
        else:
            last = char if not char.isspace() else last
            i += 1


def _markdown(text: str) -> Iterator[tuple[int, str]]:
    fenced = commented = False
    for number, line in enumerate(text.splitlines(), 1):
        prose = line
        if commented:
            end = prose.find("-->")
            if end < 0:
                continue
            prose, commented = prose[end + 3 :], False
        elif FENCE.match(prose):
            fenced = not fenced
            continue
        if fenced:
            continue
        # A `<!--` shown in a code span opens nothing.
        masked = CODE_SPAN.sub(lambda span: " " * len(span.group()), prose)
        opened = masked.rfind("<!--")
        if opened >= 0 and "-->" not in masked[opened:]:
            prose, commented = prose[:opened], True
        yield number, MARKDOWN_NOISE.sub(" ", prose)


READERS: dict[str, Callable[[str], Iterator[tuple[int, str]]]] = {
    ".py": _python,
    **dict.fromkeys((".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"), _script),
    **dict.fromkeys((".md", ".markdown"), _markdown),
}


def prose(files: Files) -> Iterator[tuple[str, int, str]]:
    """Every piece of prose in the files, as (path, line, text), citations included."""
    for path, text in files.items():
        reader = READERS.get(PurePosixPath(path).suffix)
        for line, found in reader(text) if reader else ():
            yield path, line, found
