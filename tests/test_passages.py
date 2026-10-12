"""A result list holds each passage once (#124, #187): equal texts and
near-duplicates of `unifi_web` collapse into their newest copy, while two
paragraphs, two dates of one template and two slides editions stay apart.
The texts are made up with the shape of the indexed ones: web text stays out
of git (gold/README.md)."""

from collections.abc import Iterator, Sequence
from pathlib import Path

import pytest
from qdrant_client import QdrantClient
from test_index import StubDense, StubSparse, make_chunk
from test_search import KeywordReranker

from rag.chunk import Chunk
from rag.index import WEB_COLLECTION, ensure_collection, index_chunks, open_client
from rag.passages import collapse, edition_year, main, near_duplicate, same_passage
from rag.search import Hit, Reranker, search

GUIDES = "https://ingegneria.unifi.it/upload/sub/guida-dello-studente/"
GUIDE_2015 = GUIDES + "guida-studente-2015-2016-1.pdf"
GUIDE_2016 = GUIDES + "guida-studente-2016_2017.pdf"
GUIDE_2018 = GUIDES + "web_GUIDA%20STUDENTE%20ING%202018-2019%20DEF.pdf"
GUIDE_2020 = GUIDES + "GUIDA%20STUDENTE%202020-21_ultime%20revisioni.pdf"

# Two editions of one paragraph, as #187 found them: the later one hyphenates a
# word across a line and adds an address line and the opening hours, and every
# number of the earlier one is still in it. They share 24 of 48 shingles.
CENTRE_OLD = (
    "Al Centro Didattico si trovano alcuni laboratori didattici, le aule di lezione e gli "
    "uffici della Scuola. Viale Morgagni, 40 tel. 055 0000001-002 reception.centro@unifi.it"
)
CENTRE_NEW = (
    "Al Centro Didattico si trovano alcuni laboratori didat-\ntici, le aule di lezione e gli "
    "uffici della Scuola. Viale Morgagni, 40 - 50139 Firenze GPS: 43.80, 11.24 tel. 055 "
    "0000001-002 reception.centro@unifi.it apertura al pubblico: dal lunedi al venerdi "
    "dalle 7.30 alle 19.00."  # spellchecker:disable-line
)

# One template, two exam sessions: 56% of the shingles shared, no date in common.
SESSION_TAIL = (
    " Le scadenze valgono per tutti i corsi di laurea magistrale della Scuola di Ingegneria"
    " e la domanda si presenta online sul portale dei servizi agli studenti."
)
FEBRUARY = (
    "Domanda di laurea: apertura dal 04/12/2026, chiusura entro il 10/01/2027, appello il "
    "16/02/2027." + SESSION_TAIL
)
APRIL = (
    "Domanda di laurea: apertura dal 02/02/2027, chiusura entro il 10/03/2027, appello il "
    "14/04/2027." + SESSION_TAIL
)

TASSE = "Le tasse universitarie si pagano in due rate tramite il portale dei servizi online."

# Three editions, each a near-duplicate of the next, the first and the last
# too far apart to be one by themselves.
EDITIONS = (
    "The teaching centre holds the laboratories, the lecture rooms and the offices of the "
    "School, and opens to students on every weekday from the early morning.",
    "The teaching centre holds the laboratories, both lecture rooms and the offices of the "
    "School, and opens to everyone on every weekday from the early morning.",
    "The teaching centre holds the laboratories, both lecture rooms and the offices for the "
    "School, and opens to everyone on every day from the early morning.",
)

# Two paragraphs of one page, alike enough to be one passage on two pages.
ANALYSIS = "Il corso di Analisi si tiene il lunedi in aula 101 del plesso di Santa Marta."
PHYSICS = ANALYSIS.replace("Analisi", "Fisica")


def web_chunk(
    index: int,
    text: str,
    url: str,
    *,
    source: str = "crawl",
    content_hash: str | None = None,
    fetch_date: str = "2026-08-22",
) -> Chunk:
    page = content_hash or f"{index:02d}" * 32
    return make_chunk(index, text).model_copy(
        update={
            "chunk_id": f"{page[:16]}:html:{index:04d}",
            "kind": "web",
            "course": "ingegneria",
            "academic_year": None,
            "url": url,
            "fetch_date": fetch_date,
            "ingest_source": source,
            "content_hash": page,
            "parse_variant": "html",
            "heading_path": [f"heading {index}"],
        }
    )


def hits_of(*chunks: Chunk) -> list[Hit]:
    return [Hit(chunk=chunk, score=1.0 - rank / 10) for rank, chunk in enumerate(chunks)]


@pytest.fixture
def web_index(tmp_path: Path) -> Iterator[QdrantClient]:
    qdrant = open_client(tmp_path / "qdrant")
    ensure_collection(qdrant, StubDense().dimension(), collection=WEB_COLLECTION)
    yield qdrant
    qdrant.close()


def retrieve(
    client: QdrantClient, chunks: Sequence[Chunk], reranker: Reranker | None, limit: int = 5
) -> list[Chunk]:
    index_chunks(client, chunks, StubDense(), StubSparse(), WEB_COLLECTION)
    hits = search(
        client,
        "tasse e laurea",
        StubDense(),
        StubSparse(),
        reranker,
        scope=None,
        limit=limit,
        collections=(WEB_COLLECTION,),
    )
    return [hit.chunk for hit in hits]


@pytest.mark.parametrize("reranker", [None, KeywordReranker()], ids=["fusion", "reranked"])
def test_one_text_under_two_addresses_is_one_hit_cited_at_a_page_that_holds_it(
    web_index: QdrantClient, reranker: Reranker | None
) -> None:
    alias = web_chunk(0, TASSE, "https://ingegneria.unifi.it/p365.html")
    page = web_chunk(1, TASSE, "https://ingegneria.unifi.it/vp-365-organi.html")

    found = retrieve(web_index, [alias, page], reranker)

    assert len(found) == 1
    # The survivor is one whole point: its URL is the page its text came from.
    assert found[0] in (alias, page)


def test_a_crawl_point_and_a_live_point_of_one_page_are_one_hit_the_live_one(
    web_index: QdrantClient,
) -> None:
    url = "https://www.unifi.it/it/studia-con-noi/tasse"
    crawl = web_chunk(0, TASSE, url, content_hash="aa" * 32)
    live = web_chunk(1, TASSE, url, source="live", content_hash="aa" * 32, fetch_date="2026-10-01")

    assert retrieve(web_index, [crawl, live], None) == [live]


def test_an_edited_live_version_of_a_page_collapses_into_its_crawl_version(
    web_index: QdrantClient,
) -> None:
    url = "https://www.unifi.it/it/studia-con-noi/tasse"
    crawl = web_chunk(0, TASSE, url, content_hash="aa" * 32)
    edited = TASSE.replace("tramite il portale", "tramite il nuovo portale")
    live = web_chunk(1, edited, url, source="live", content_hash="bb" * 32, fetch_date="2026-10-01")

    assert retrieve(web_index, [crawl, live], KeywordReranker()) == [live]


def test_four_editions_of_one_passage_are_one_hit_the_newest_guide(
    web_index: QdrantClient,
) -> None:
    """#187's four copies: two pairs of equal texts, the pairs near-duplicates
    of each other. The survivor is the guide whose file name tells the newest
    year, read from the URL as the index stores it, percent-encoded."""
    guides = [
        web_chunk(index, text, url)
        for index, (text, url) in enumerate(
            [
                (CENTRE_OLD, GUIDE_2015),
                (CENTRE_OLD, GUIDE_2016),
                (CENTRE_NEW, GUIDE_2018),
                (CENTRE_NEW, GUIDE_2020),
            ]
        )
    ]

    found = retrieve(web_index, guides, KeywordReranker())

    assert [chunk.url for chunk in found] == [GUIDE_2020]


def test_one_template_with_other_dates_stays_two_hits() -> None:
    february = web_chunk(0, FEBRUARY, "https://ingegneria.unifi.it/CALENDARIO_FEB_2027_LM.pdf")
    april = web_chunk(1, APRIL, "https://ingegneria.unifi.it/CALENDARIO_APR_2027_LM.pdf")

    assert not same_passage(february, april)
    assert len(collapse(hits_of(february, april))) == 2


def test_a_chain_of_editions_is_one_hit_whatever_their_ranks() -> None:
    """The middle edition ranked last still joins the first and the last."""
    first, middle, last = (
        web_chunk(index, text, url)
        for index, (text, url) in enumerate(
            zip(EDITIONS, (GUIDE_2015, GUIDE_2018, GUIDE_2020), strict=True)
        )
    )
    assert not near_duplicate(EDITIONS[0], EDITIONS[2])

    assert [hit.chunk.url for hit in collapse(hits_of(first, last, middle))] == [GUIDE_2020]


def test_two_paragraphs_of_one_page_stay_two_hits_however_alike() -> None:
    url = "https://ingegneria.unifi.it/p536.html"
    first = web_chunk(0, ANALYSIS, url, content_hash="cc" * 32)
    second = web_chunk(1, PHYSICS, url, content_hash="cc" * 32)

    assert near_duplicate(ANALYSIS, PHYSICS)  # alike enough to merge across pages
    assert len(collapse(hits_of(first, second))) == 2


def test_a_copy_at_another_address_does_not_join_two_paragraphs_of_one_page() -> None:
    """The copy of the first paragraph is a near-duplicate of the second, so a
    group open to any member's copies would take all three."""
    url = "https://ingegneria.unifi.it/p536.html"
    first = web_chunk(0, ANALYSIS, url, content_hash="cc" * 32)
    copy = web_chunk(1, ANALYSIS, "https://ingegneria.unifi.it/vp-536-corsi.html")
    second = web_chunk(2, PHYSICS, url, content_hash="cc" * 32)

    assert [hit.chunk.text for hit in collapse(hits_of(first, copy, second))] == [
        ANALYSIS,
        PHYSICS,
    ]


def test_one_slides_text_in_two_editions_stays_two_hits() -> None:
    """docs/data-model.md: one PDF in two editions yields two identities."""
    this_year = make_chunk(0, TASSE)
    last_year = this_year.model_copy(update={"academic_year": "2024-2025", "chunk_id": "other"})

    assert len(collapse(hits_of(this_year, last_year))) == 2


def test_a_collapse_before_the_cut_lets_the_next_passage_in(web_index: QdrantClient) -> None:
    """Six candidates, two of them one text: the five hits are five passages,
    the sixth candidate taking the slot the copy would have spent."""
    texts = [
        "Le tasse si pagano in due rate.",
        "Esonero dalle tasse per merito.",
        "Rimborso delle tasse versate in eccesso.",
        "Tasse ridotte per chi studia part-time.",
        "Scadenze delle tasse di iscrizione.",
    ]
    chunks = [
        web_chunk(index, text, f"https://www.unifi.it/p{index}") for index, text in enumerate(texts)
    ]
    chunks.append(web_chunk(9, texts[0], "https://www.unifi.it/alias"))

    found = retrieve(web_index, chunks, KeywordReranker())

    assert sorted(chunk.text for chunk in found) == sorted(texts)


def test_a_group_keeps_its_best_score_and_its_first_place() -> None:
    other = web_chunk(5, TASSE, "https://www.unifi.it/tasse")
    old = Hit(chunk=web_chunk(0, CENTRE_OLD, GUIDE_2015), score=0.9)
    new = Hit(chunk=web_chunk(1, CENTRE_NEW, GUIDE_2020), score=0.4)

    collapsed = collapse([old, Hit(chunk=other, score=0.6), new])

    assert [(hit.chunk.url, hit.score) for hit in collapsed] == [
        (GUIDE_2020, 0.9),
        (other.url, 0.6),
    ]


@pytest.mark.parametrize(
    ("url", "year"),
    [
        (GUIDE_2015, 2016),
        (GUIDE_2016, 2017),
        (GUIDE_2018, 2019),
        (GUIDE_2020, 2021),
        (GUIDES + "esec%20web_GUIDA%20STUDENTE%20INGEGNERIA%202022_11_07.pdf", 2022),
        (GUIDES + "guida_studente_ingegneria_unifi_23_24%20def.pdf", 2024),
        ("https://ingegneria.unifi.it/upload/sub/regolamenti/2024-2025/B271-23-24.pdf", 2024),
        ("https://ingegneria.unifi.it/upload/sub/B271-23-23.pdf", None),
        ("https://ingegneria.unifi.it/upload/sub/erasmus_studio_2627_0.pdf", None),
        ("https://www.unifi.it/en/node/12045", None),
        ("https://ingegneria.unifi.it/p487.html", None),
    ],
)
def test_edition_year_reads_the_file_names_of_the_index(url: str, year: int | None) -> None:
    assert edition_year(url) == year


def test_measure_counts_the_labelled_pairs_each_way(
    web_index: QdrantClient, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    chunks = [
        web_chunk(0, CENTRE_OLD, GUIDE_2015),
        web_chunk(1, CENTRE_NEW, GUIDE_2020),
        web_chunk(2, FEBRUARY, "https://ingegneria.unifi.it/feb.pdf"),
        web_chunk(3, APRIL, "https://ingegneria.unifi.it/apr.pdf"),
    ]
    index_chunks(web_index, chunks, StubDense(), StubSparse(), WEB_COLLECTION)
    web_index.close()

    def key(chunk: Chunk) -> str:
        return (
            f'{{"url": "{chunk.url}", "chunk_index": {chunk.chunk_index}, '
            f'"ingest_source": "{chunk.ingest_source}"}}'
        )

    labels = tmp_path / "pairs.jsonl"
    labels.write_text(
        f'{{"a": {key(chunks[0])}, "b": {key(chunks[1])}, "label": "same"}}\n'
        f'{{"a": {key(chunks[2])}, "b": {key(chunks[3])}, "label": "different"}}\n',
        encoding="utf-8",
    )
    main(["--measure", str(labels), "--qdrant", str(tmp_path / "qdrant")])

    out = capsys.readouterr().out
    assert "same passage, joined: 1/1" in out
    assert "different, joined: 0/1" in out
