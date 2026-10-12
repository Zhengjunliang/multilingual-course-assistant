"""One passage once: the copies of a passage in a result list collapse into one hit.

`unifi_web` repeats itself. One page lives under two addresses, a crawl point
and a live point carry one text, and the student guide of every year repeats
its paragraphs with a new postcode or a hyphenated line break. A result list
spent on copies leaves less room for answers, and the reader sees one source
several times (#124, #187).

Two web hits are one passage when their texts are equal, or when they come
from two versions of a page, or from two pages, and are near-duplicates: a
3-shingle Jaccard of `NEAR_DUPLICATE_JACCARD` or more, and every number of the
shorter text also in the longer, so that two exam calendars or two years'
reports of one template stay apart. Slides never collapse: one PDF in two
editions is two identities (docs/data-model.md). The threshold and the rule are
measured on `gold/near-duplicates.jsonl` (`--measure`); the decision is argued
in docs/decisions.md.

    uv run python -m rag.passages --measure gold/near-duplicates.jsonl
"""

from __future__ import annotations

import argparse
import json
import re
from functools import lru_cache
from itertools import combinations
from pathlib import Path
from typing import TYPE_CHECKING
from urllib.parse import unquote

from rag.chunk import Chunk
from rag.index import WEB_COLLECTION, add_qdrant_argument, open_client

if TYPE_CHECKING:
    from collections.abc import Sequence

    from rag.search import Hit

# Chosen on gold/near-duplicates.jsonl: the lowest value that joins the four
# copies of #187's passage, whose two texts differ by an address line and
# share 25 of 50 shingles.
NEAR_DUPLICATE_JACCARD = 0.5

_HYPHENATED = re.compile(r"(\w)-\s*\n\s*(\w)")
_WORD = re.compile(r"\w+")
_NUMBER = re.compile(r"\d+")
_YEAR = re.compile(r"(?<!\d)(20\d{2})(?!\d)")
_LONG_RANGE = re.compile(r"(?<!\d)20(\d{2})[-_]20(\d{2})(?!\d)")
_SHORT_RANGE = re.compile(r"(?<!\d)(?:20)?(\d{2})[-_](\d{2})(?!\d)")


# Large enough for the pool of one search, whose texts every pair comparison
# reads again; a long-running server process keeps no more than that, since a
# text's shingles cost tens of kilobytes and another question brings others.
@lru_cache(maxsize=256)
def _features(text: str) -> tuple[frozenset[tuple[str, ...]], frozenset[str]]:
    """The 3-word shingles and the numbers of a text, a PDF's hyphenated line
    breaks joined first so that `didat-\\ntici` reads as one word."""
    joined = _HYPHENATED.sub(r"\1\2", text)
    words = _WORD.findall(joined.lower())
    shingles = frozenset(tuple(words[i : i + 3]) for i in range(max(0, len(words) - 2)))
    if words and not shingles:
        shingles = frozenset({tuple(words)})
    return shingles, frozenset(_NUMBER.findall(joined))


def _resemblance(a: str, b: str) -> float:
    """The 3-shingle Jaccard of two near-duplicates, 0 for two texts that are not."""
    shingles_a, numbers_a = _features(a)
    shingles_b, numbers_b = _features(b)
    if not shingles_a or not shingles_b:
        return 0.0
    shared = len(shingles_a & shingles_b)
    jaccard = shared / (len(shingles_a) + len(shingles_b) - shared)
    fewer, more = sorted((numbers_a, numbers_b), key=len)
    return jaccard if jaccard >= NEAR_DUPLICATE_JACCARD and fewer <= more else 0.0


def near_duplicate(a: str, b: str) -> bool:
    return _resemblance(a, b) > 0.0


def _link(a: Chunk, b: Chunk) -> float:
    """How alike two hits are as one passage, 0 when they are two."""
    if a.kind != "web" or b.kind != "web":
        return 0.0
    if a.text == b.text:
        return 1.0
    if a.url == b.url and a.content_hash == b.content_hash:
        return 0.0  # two chunks of one version of one page are two paragraphs
    return _resemblance(a.text, b.text)


def same_passage(a: Chunk, b: Chunk) -> bool:
    return _link(a, b) > 0.0


def edition_year(url: str) -> int | None:
    """The newest year a URL's last segment names, read the ways the School's
    files name their editions: `2020-21`, `2017-2018`, `2016_2017`, `23_24`,
    a dated `2022_11_07` or a plain `2025`. A range counts only when its two
    years follow each other, so a date or a code like `B271-23-23` names no
    range."""
    segment = unquote(url.rstrip("/").rsplit("/", 1)[-1])
    years = {int(year) for year in _YEAR.findall(segment)}
    for pattern in (_LONG_RANGE, _SHORT_RANGE):
        years.update(
            2000 + int(second)
            for first, second in pattern.findall(segment)
            if int(second) == (int(first) + 1) % 100
        )
    return max(years, default=None)


def _survivor(copies: Sequence[Hit]) -> Hit:
    """The newest edition the copies tell: the year in every copy's file name,
    else the latest fetch, else the best-ranked."""
    years = [edition_year(hit.chunk.url or "") for hit in copies]
    by_year = all(year is not None for year in years)

    def newest(index: int) -> tuple[int, str, int]:
        year = years[index] if by_year else None
        return (year or 0, copies[index].chunk.fetch_date or "", -index)

    return copies[max(range(len(copies)), key=newest)]


def _paragraphs_of_one_page(a: Chunk, b: Chunk) -> bool:
    return a.url == b.url and a.content_hash == b.content_hash and a.text != b.text


def collapse(hits: Sequence[Hit]) -> list[Hit]:
    """Each passage once, in the order of its best-ranked copy.

    Pairs of hits that are one passage join their groups pair by pair, the
    most alike first, equal texts before near-duplicates: single-linkage
    clustering in Kruskal's order. Every such pair ends in one group, so a
    chain of editions each close to the next is one passage, though the first
    and the last are far apart, whatever order the ranking brings them in. A
    join that would put two paragraphs of one page version into one group is
    refused, a cannot-link constraint (Wagstaff et al., ICML 2001); a copy of
    one of them at another address may be a near-duplicate of both, and
    joins the one it is closer to first, which keeps the other out. Equally
    alike pairs join in rank order. The group keeps its best score and shows
    its newest copy, so a citation's URL is always the page its text came
    from."""
    pairs = sorted(
        (-link, first, second)
        for first, second in combinations(range(len(hits)), 2)
        if (link := _link(hits[first].chunk, hits[second].chunk)) > 0.0
    )
    group_of = list(range(len(hits)))
    members = {index: [index] for index in range(len(hits))}
    for _, first, second in pairs:
        joined, other = sorted((group_of[first], group_of[second]))
        if joined == other or any(
            _paragraphs_of_one_page(hits[a].chunk, hits[b].chunk)
            for a in members[joined]
            for b in members[other]
        ):
            continue
        for member in members[other]:
            group_of[member] = joined
        members[joined].extend(members.pop(other))
    collapsed: list[Hit] = []
    for key in sorted(members):
        copies = [hits[member] for member in sorted(members[key])]
        best = max(hit.score for hit in copies)
        collapsed.append(_survivor(copies).model_copy(update={"score": best}))
    return collapsed


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--measure", type=Path, required=True, metavar="LABELS")
    add_qdrant_argument(parser)
    args = parser.parse_args(argv)

    from qdrant_client import models

    client = open_client(args.qdrant)

    def chunk(key: dict[str, str | int]) -> Chunk:
        points, _ = client.scroll(
            WEB_COLLECTION,
            scroll_filter=models.Filter(
                must=[
                    models.FieldCondition(key=field, match=models.MatchValue(value=key[field]))
                    for field in ("url", "chunk_index", "ingest_source")
                ]
            ),
            limit=2,
            with_payload=True,
        )
        if len(points) != 1:
            raise SystemExit(f"{len(points)} points for {key}: the labels name another index")
        return Chunk.model_validate(points[0].payload)

    lines = args.measure.read_text(encoding="utf-8").splitlines()
    rows = [json.loads(line) for line in lines if line.strip()]
    joined: dict[str, int] = {"same": 0, "different": 0}
    totals: dict[str, int] = {"same": 0, "different": 0}
    wrongly: list[str] = []
    for row in rows:
        a, b = chunk(row["a"]), chunk(row["b"])
        totals[row["label"]] += 1
        if same_passage(a, b):
            joined[row["label"]] += 1
            if row["label"] == "different":
                wrongly.append(f"{a.url} #{a.chunk_index} | {b.url} #{b.chunk_index}")
    client.close()

    print(f"threshold {NEAR_DUPLICATE_JACCARD}")
    print(f"same passage, joined: {joined['same']}/{totals['same']}")
    print(f"different, joined: {joined['different']}/{totals['different']}")
    for pair in wrongly:
        print(f"  joined although different: {pair}")


if __name__ == "__main__":
    main()
