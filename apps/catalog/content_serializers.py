"""An edition's content as the API shows it and takes it: its syllabus sections and its books.

Apart from apps/catalog/serializers.py, which reads the catalogue and its
staff; these rows are written through the API by an edition's teachers and
secretariat (apps/catalog/content_views.py). Neither names its edition: the
URL does, and the view resolves it before reading a field.
"""

from __future__ import annotations

from typing import Any

from django.conf import settings
from rest_framework import serializers
from rest_framework.exceptions import NotFound

from apps.catalog.models import ReadingItem, Syllabus


# `ModelSerializer[...]` for the reason apps/accounts/serializers.py gives, and
# the same suppression on each `Meta`.
class SyllabusSectionSerializer(serializers.ModelSerializer[Syllabus]):
    """One section; the URL names it, the body carries its Markdown.

    The text may be blank, unlike the row's: a section written empty is a
    section cleared, which deletes its row (apps/catalog/models.py).
    """

    text = serializers.CharField(allow_blank=True)

    class Meta:  # pyright: ignore[reportIncompatibleVariableOverride]
        model = Syllabus
        fields = ("section", "text")
        read_only_fields = ("section",)


class SyllabusSerializer(serializers.Serializer):
    """The whole syllabus: the edition's language for it, and its sections.

    The language is the edition's `syllabus_locale`, written alone: changing it
    relabels the text and translates nothing.
    """

    locale = serializers.ChoiceField(choices=settings.LANGUAGES)
    sections = SyllabusSectionSerializer(many=True, read_only=True)


class ReadingItemSerializer(serializers.ModelSerializer[ReadingItem]):
    """A book on the reading list, every field as the model declares it.

    A second book of a title the edition lists is refused by the view, which
    holds the edition this serializer does not see.
    """

    class Meta:  # pyright: ignore[reportIncompatibleVariableOverride]
        model = ReadingItem
        fields = ("id", "locale", "title", "authors", "year", "isbn", "url", "importance")
        read_only_fields = ("id",)

    def update(self, instance: ReadingItem, validated_data: dict[str, Any]) -> ReadingItem:
        """Writes the fields the request names in one UPDATE; a book gone meanwhile is a 404.

        `Model.save()` inserts the row its UPDATE did not find, so a book
        removed between this request's lookup and its write would be written
        back.
        """
        if not ReadingItem.objects.filter(pk=instance.pk).update(**validated_data):
            raise NotFound
        for field, value in validated_data.items():
            setattr(instance, field, value)
        return instance
