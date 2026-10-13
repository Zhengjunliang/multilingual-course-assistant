"""An edition's content: its syllabus, section by section in the edition's language, and its books.

Separate from apps/catalog/staff_views.py, which is about people, and nested
under the edition the same way, so the edition is resolved, and checked,
before anything else (apps/roles/api.py): a book of another edition is a 404
here, as missing as one that does not exist. Whoever views the edition reads
its content; its teachers and its secretariat change it (`edition.edit_content`,
apps/roles/registry.py). Each view's methods are exactly the keys of its
`scope_map`, as in staff_views.py.

A section has no `DELETE`: writing it empty clears it, so the one request a
page sends for a section is the same whatever its text. A section the
catalogue does not name matches no route (apps/catalog/urls.py). The
syllabus's language is written on its own, by `PATCH` on the syllabus.
"""

from __future__ import annotations

from types import MappingProxyType
from typing import TYPE_CHECKING

import psycopg
from django.db import IntegrityError, transaction
from django.http import Http404
from django.utils.translation import gettext_lazy as _
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from apps.catalog.content_serializers import (
    ReadingItemSerializer,
    SyllabusSectionSerializer,
    SyllabusSerializer,
)
from apps.catalog.models import CourseEdition, ReadingItem, Syllabus, SyllabusSection
from apps.catalog.views import EditionView
from apps.roles.registry import Permission
from apps.roles.scopes import editions_for

if TYPE_CHECKING:
    from django.db.models import QuerySet
    from rest_framework.request import Request

# The catalogue's order (apps/catalog/models.py), which the rows' own ordering does not keep.
_SECTION_ORDER = {section: index for index, section in enumerate(SyllabusSection.values)}


class _EditionContent(EditionView):
    """A view on one edition's content, which reads the edition's row and none of its staff."""

    def get_queryset(self) -> QuerySet[CourseEdition]:
        return editions_for(self.request.user, self.visible_with)


def _syllabus(edition: CourseEdition, locale: str) -> dict[str, object]:
    """The syllabus as the API shows it: its language and its sections, in catalogue order."""
    rows = sorted(
        Syllabus.objects.filter(edition=edition), key=lambda row: _SECTION_ORDER[row.section]
    )
    return SyllabusSerializer({"locale": locale, "sections": rows}).data


class EditionSyllabusView(_EditionContent):
    """`GET` reads the syllabus; `PATCH` sets its language, the one field it takes."""

    scope_map = MappingProxyType(
        {"GET": Permission.EDITION_VIEW, "PATCH": Permission.EDITION_EDIT_CONTENT}
    )

    def get(self, request: Request, pk: int) -> Response:
        return Response(_syllabus(self.scope, self.scope.syllabus_locale))

    def patch(self, request: Request, pk: int) -> Response:
        serializer = SyllabusSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        locale = serializer.validated_data["locale"]
        # One UPDATE of the one column, so the edition's other fields are not written back.
        CourseEdition.objects.filter(pk=self.scope.pk).update(syllabus_locale=locale)
        return Response(_syllabus(self.scope, locale))


class EditionSyllabusSectionView(_EditionContent):
    """`PUT` writes one section: 200 with the section, or 204 when cleared."""

    scope_map = MappingProxyType({"PUT": Permission.EDITION_EDIT_CONTENT})

    def put(self, request: Request, pk: int, section: str) -> Response:
        serializer = SyllabusSectionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        text = serializer.validated_data["text"]
        rows = Syllabus.objects.filter(edition=self.scope, section=section)
        if not text:
            rows.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        row, _created = Syllabus.objects.update_or_create(
            edition=self.scope, section=section, defaults={"text": text}
        )
        return Response(SyllabusSectionSerializer(row).data)


class _Books(_EditionContent):
    def books(self) -> QuerySet[ReadingItem]:
        return ReadingItem.objects.filter(edition=self.scope)

    def save(self, serializer: ReadingItemSerializer) -> ReadingItem:
        """The book saved on this edition; a second book of a title it lists is a 400.

        The unique constraint decides, in a savepoint of its own, so two
        requests adding one title at once cannot both pass a check made first.
        Any other constraint failing is a bug to surface, as in
        apps/roles/grants.py.
        """
        try:
            with transaction.atomic():
                return serializer.save(edition=self.scope)
        except IntegrityError as exc:
            cause = exc.__cause__
            if not (
                isinstance(cause, psycopg.Error)
                and cause.diag.constraint_name == "catalog_reading_unique_title"
            ):
                raise
            raise ValidationError(
                {"title": [_("This title is already on the list.")]},
                code="unique",
            ) from None


class EditionReadingsView(_Books):
    """`GET` lists the edition's books, by title; `POST` adds one (201)."""

    scope_map = MappingProxyType(
        {"GET": Permission.EDITION_VIEW, "POST": Permission.EDITION_EDIT_CONTENT}
    )

    def get(self, request: Request, pk: int) -> Response:
        return Response(ReadingItemSerializer(self.books(), many=True).data)

    def post(self, request: Request, pk: int) -> Response:
        serializer = ReadingItemSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        book = self.save(serializer)
        return Response(ReadingItemSerializer(book).data, status=status.HTTP_201_CREATED)


class EditionReadingView(_Books):
    """`PATCH` changes the fields it names of one book; `DELETE` removes the book (204)."""

    scope_map = MappingProxyType(
        {"PATCH": Permission.EDITION_EDIT_CONTENT, "DELETE": Permission.EDITION_EDIT_CONTENT}
    )

    def book(self, item: int) -> ReadingItem:
        found = self.books().filter(pk=item).first()
        if found is None:
            raise Http404
        return found

    def patch(self, request: Request, pk: int, item: int) -> Response:
        serializer = ReadingItemSerializer(self.book(item), data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        return Response(ReadingItemSerializer(self.save(serializer)).data)

    def delete(self, request: Request, pk: int, item: int) -> Response:
        self.book(item).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
