"""An edition's content through the API: its syllabus, section by section, and its books.

Asked by the callers of `world()` (tests/test_roles.py). Who may call each
route on one edition is tests/access_matrix.txt; this file is about which
editions a caller reaches — every edition of a course they teach, past ones
included — and what a write leaves behind. A case that writes runs in a
transaction rolled back after it, as in tests/test_catalog_api.py.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import pytest
from test_catalog_api import as_user, code_of, rolled_back
from test_roles import world

from apps.catalog.content_views import EditionReadingView
from apps.catalog.models import ReadingItem, Syllabus

if TYPE_CHECKING:
    from django.http.response import HttpResponseBase

    from apps.accounts.models import User
    from apps.catalog.models import CourseEdition

pytestmark = pytest.mark.django_db

PREREQUISITES = "Analisi Matematica I."


def section(edition: CourseEdition, name: str = "prerequisiti") -> str:
    return f"/api/catalog/editions/{edition.pk}/syllabus/{name}"


def syllabus(edition: CourseEdition) -> str:
    return f"/api/catalog/editions/{edition.pk}/syllabus"


def books(edition: CourseEdition) -> str:
    return f"/api/catalog/editions/{edition.pk}/readings"


def answer(response: HttpResponseBase) -> tuple[int, Any]:
    """The status, and what a page reads of it: a success's body, a refusal's codes."""
    status = response.status_code
    if status == 204:
        return status, None
    if status < 300:
        return status, response.json()  # pyright: ignore[reportAttributeAccessIssue]
    if status == 400:
        fields = response.json()  # pyright: ignore[reportAttributeAccessIssue]
        return status, {field: [e["code"] for e in errors] for field, errors in fields.items()}
    return status, code_of(response)


def sections(edition: CourseEdition) -> list[tuple[str, str]]:
    return list(
        Syllabus.objects.filter(edition=edition).order_by("section").values_list("section", "text")
    )


def test_a_section_is_written_on_every_edition_of_a_course_one_teaches() -> None:
    w = world()
    cases: dict[str, tuple[User | None, CourseEdition]] = {
        "teacher, the year before the one assigned": (w.newcomer, w.ppm_old),
        "teacher, the year assigned": (w.newcomer, w.ppm_new),
        "secretariat, an edition of their programme": (w.secretariat, w.ppm_new),
        "superuser": (w.root, w.ia),
        "teacher, another course": (w.newcomer, w.ia),
        "secretariat, another programme's course": (w.other_secretariat, w.ppm_old),
        "student": (w.student, w.ppm_old),
        "anonymous": (None, w.ppm_old),
    }

    def put(user: User | None, edition: CourseEdition) -> tuple[int, Any, list[Any]]:
        response = as_user(user).put(section(edition), {"text": PREREQUISITES}, format="json")
        return (*answer(response), sections(edition))

    seen = {case: rolled_back(lambda args=args: put(*args)) for case, args in cases.items()}

    written = (
        200,
        {"section": "prerequisiti", "text": PREREQUISITES},
        [("prerequisiti", PREREQUISITES)],
    )
    assert seen == {
        "teacher, the year before the one assigned": written,
        "teacher, the year assigned": written,
        "secretariat, an edition of their programme": written,
        "superuser": written,
        "teacher, another course": (404, "not_found", []),
        "secretariat, another programme's course": (404, "not_found", []),
        "student": (404, "not_found", []),
        "anonymous": (403, "not_authenticated", []),
    }


def test_a_section_is_replaced_and_cleared_in_place() -> None:
    w = world()
    Syllabus.objects.create(edition=w.ppm_old, section="prerequisiti", text="Nessuno.")
    Syllabus.objects.create(edition=w.ppm_old, section="contenuti", text="Lezioni.")
    client = as_user(w.continuing)

    replaced = answer(client.put(section(w.ppm_old), {"text": PREREQUISITES}, format="json"))
    after_replace = sections(w.ppm_old)
    # Blank after trimming, so cleared; and clearing a section with no text changes nothing.
    blank = {"text": "  \n"}
    cleared = answer(client.put(section(w.ppm_old, "contenuti"), blank, format="json"))
    cleared_again = answer(client.put(section(w.ppm_old, "contenuti"), {"text": ""}, format="json"))
    missing = answer(client.put(section(w.ppm_old), {}, format="json"))

    assert replaced == (200, {"section": "prerequisiti", "text": PREREQUISITES})
    assert after_replace == [("contenuti", "Lezioni."), ("prerequisiti", PREREQUISITES)]
    assert (cleared, cleared_again) == ((204, None), (204, None))
    assert missing == (400, {"text": ["required"]})
    assert sections(w.ppm_old) == [("prerequisiti", PREREQUISITES)]


def test_the_syllabus_reads_in_its_language_and_catalogue_order() -> None:
    w = world()
    for name in ("altro", "obiettivi_formativi", "contenuti"):
        Syllabus.objects.create(edition=w.ppm_old, section=name, text=f"**{name}**")

    read = {
        "teacher, the year before the one assigned": answer(
            as_user(w.newcomer).get(syllabus(w.ppm_old))
        ),
        "student": answer(as_user(w.student).get(syllabus(w.ppm_old))),
    }

    assert read == {
        "teacher, the year before the one assigned": (
            200,
            {
                "locale": "it",
                "sections": [
                    {"section": "obiettivi_formativi", "text": "**obiettivi_formativi**"},
                    {"section": "contenuti", "text": "**contenuti**"},
                    {"section": "altro", "text": "**altro**"},
                ],
            },
        ),
        "student": (404, "not_found"),
    }


def test_the_syllabus_language_is_set_alone() -> None:
    """The language relabels the text; it neither translates nor touches a section."""
    w = world()
    Syllabus.objects.create(edition=w.ppm_old, section="altro", text="Nessuna nota.")
    client = as_user(w.newcomer)

    set_english = answer(client.patch(syllabus(w.ppm_old), {"locale": "en"}, format="json"))
    unknown = answer(client.patch(syllabus(w.ppm_old), {"locale": "fr"}, format="json"))
    w.ppm_old.refresh_from_db()

    assert set_english == (
        200,
        {"locale": "en", "sections": [{"section": "altro", "text": "Nessuna nota."}]},
    )
    assert unknown == (400, {"locale": ["invalid_choice"]})
    assert (w.ppm_old.syllabus_locale, sections(w.ppm_old)) == (
        "en",
        [("altro", "Nessuna nota.")],
    )


def test_a_section_outside_the_closed_set_matches_no_route() -> None:
    w = world()
    client = as_user(w.root)

    seen = {
        url: answer(client.put(url, {"text": "x"}, format="json"))[0]
        for url in (
            section(w.ppm_old, "testi"),
            f"{syllabus(w.ppm_old)}/it/prerequisiti",
            section(w.ppm_old, "altro"),
        )
    }

    assert list(seen.values()) == [404, 404, 200]


BOOK = {
    "title": "Fisica II",
    "authors": "Mazzoldi, Nigro, Voci",
    "importance": "recommended",
}


def test_a_book_is_added_changed_and_removed_on_a_past_edition() -> None:
    w = world()
    client = as_user(w.newcomer)

    added = answer(client.post(books(w.ppm_old), BOOK, format="json"))
    pk = added[1]["id"]
    changed = answer(client.patch(f"{books(w.ppm_old)}/{pk}", {"year": 2011}, format="json"))
    listed = answer(client.get(books(w.ppm_old)))
    removed = answer(client.delete(f"{books(w.ppm_old)}/{pk}"))

    book = {**BOOK, "id": pk, "locale": "it", "year": None, "isbn": "", "url": ""}
    assert added == (201, book)
    assert changed == (200, {**book, "year": 2011})
    assert listed == (200, [{**book, "year": 2011}])
    assert removed == (204, None)
    assert not ReadingItem.objects.exists()


@pytest.mark.parametrize(
    ("body", "codes"),
    [
        pytest.param(
            {},
            {"title": ["required"], "authors": ["required"], "importance": ["required"]},
            id="empty",
        ),
        pytest.param({**BOOK, "title": ""}, {"title": ["blank"]}, id="blank-title"),
        pytest.param({**BOOK, "title": "x" * 301}, {"title": ["max_length"]}, id="long-title"),
        pytest.param({**BOOK, "isbn": "9" * 18}, {"isbn": ["max_length"]}, id="long-isbn"),
        pytest.param({**BOOK, "url": "a library"}, {"url": ["invalid"]}, id="not-a-link"),
        pytest.param({**BOOK, "year": "soon"}, {"year": ["invalid"]}, id="not-a-year"),
        pytest.param({**BOOK, "year": -1}, {"year": ["min_value"]}, id="negative-year"),
        pytest.param({**BOOK, "year": 40000}, {"year": ["max_value"]}, id="year-too-large"),
        pytest.param(
            {**BOOK, "importance": "essential"}, {"importance": ["invalid_choice"]}, id="importance"
        ),
        pytest.param({**BOOK, "locale": "xx"}, {"locale": ["invalid_choice"]}, id="language"),
        pytest.param({**BOOK, "authors": "Altri"}, {"title": ["unique"]}, id="title-listed"),
    ],
)
def test_a_book_is_refused_field_by_field(body: dict[str, object], codes: object) -> None:
    w = world()
    ReadingItem.objects.create(edition=w.ppm_old, **BOOK)

    seen = answer(as_user(w.secretariat).post(books(w.ppm_old), body, format="json"))

    assert seen == (400, codes)
    assert ReadingItem.objects.count() == 1


def test_a_title_is_listed_once_per_edition_whatever_its_language() -> None:
    w = world()
    ReadingItem.objects.create(edition=w.ppm_old, **BOOK)
    client = as_user(w.secretariat)
    other = ReadingItem.objects.create(edition=w.ppm_old, **{**BOOK, "title": "Physics II"})

    seen = {
        "the same title in another language": answer(
            client.post(books(w.ppm_old), {**BOOK, "locale": "en"}, format="json")
        ),
        "the same title on another edition": answer(
            client.post(books(w.ppm_new), BOOK, format="json")
        )[0],
        "a book renamed to a title listed": answer(
            client.patch(f"{books(w.ppm_old)}/{other.pk}", {"title": BOOK["title"]}, format="json")
        ),
    }

    assert seen == {
        "the same title in another language": (400, {"title": ["unique"]}),
        "the same title on another edition": 201,
        "a book renamed to a title listed": (400, {"title": ["unique"]}),
    }


def test_a_book_removed_while_it_is_changed_stays_removed(monkeypatch: pytest.MonkeyPatch) -> None:
    """A delete committed between the change's lookup and its write: `Model.save()` would
    insert the row its update did not find, writing the book back."""
    w = world()
    book = ReadingItem.objects.create(edition=w.ppm_old, **BOOK)
    lookup = EditionReadingView.book

    def raced(view: EditionReadingView, item: int) -> ReadingItem:
        found = lookup(view, item)
        ReadingItem.objects.filter(pk=found.pk).delete()
        return found

    monkeypatch.setattr(EditionReadingView, "book", raced)
    changed = answer(
        as_user(w.newcomer).patch(f"{books(w.ppm_old)}/{book.pk}", {"year": 2011}, format="json")
    )

    assert (changed, ReadingItem.objects.filter(pk=book.pk).exists()) == (
        (404, "not_found"),
        False,
    )


def test_a_book_is_reached_through_its_own_edition_only() -> None:
    w = world()
    ia_book = ReadingItem.objects.create(edition=w.ia, **BOOK)
    through_ppm = f"{books(w.ppm_old)}/{ia_book.pk}"
    client = as_user(w.root)

    seen = {
        "change": answer(client.patch(through_ppm, {"year": 2011}, format="json")),
        "remove": answer(client.delete(through_ppm)),
        "remove, by a teacher of PPM": answer(as_user(w.newcomer).delete(through_ppm)),
        "list, by a teacher of PPM": answer(as_user(w.newcomer).get(books(w.ia))),
    }

    assert seen == {
        "change": (404, "not_found"),
        "remove": (404, "not_found"),
        "remove, by a teacher of PPM": (404, "not_found"),
        "list, by a teacher of PPM": (404, "not_found"),
    }
    assert ReadingItem.objects.get(pk=ia_book.pk).year is None
