"""An edition's content as the API shows it and takes it: its syllabus sections and its books.

Apart from apps/catalog/serializers.py, which reads the catalogue and its
staff; these rows are written through the API by an edition's teachers and
secretariat (apps/catalog/content_views.py). Neither names its edition: the
URL does, and the view resolves it before reading a field.
"""

from __future__ import annotations

from rest_framework import serializers

from apps.catalog.models import ReadingItem, Syllabus


# `ModelSerializer[...]` for the reason apps/accounts/serializers.py gives, and
# the same suppression on each `Meta`.
class SyllabusSectionSerializer(serializers.ModelSerializer[Syllabus]):
    """One section in one language; the URL names both, the body carries the text.

    The text may be blank, unlike the row's: a section written empty is a
    section cleared, which deletes its row (apps/catalog/models.py).
    """

    text = serializers.CharField(allow_blank=True)

    class Meta:  # pyright: ignore[reportIncompatibleVariableOverride]
        model = Syllabus
        fields = ("locale", "section", "text")
        read_only_fields = ("locale", "section")


class ReadingItemSerializer(serializers.ModelSerializer[ReadingItem]):
    """A book on the reading list, every field as the model declares it.

    A title already listed in the same language is refused by the view, which
    holds the edition this serializer does not see.
    """

    class Meta:  # pyright: ignore[reportIncompatibleVariableOverride]
        model = ReadingItem
        fields = ("id", "locale", "title", "authors", "year", "isbn", "url", "importance")
        read_only_fields = ("id",)
