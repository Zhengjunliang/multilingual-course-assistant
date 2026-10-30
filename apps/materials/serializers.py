"""An edition's material as the API shows it, and the one field an upload sends.

The edition is not a field: the URL names it, and the view resolves it before
reading the body (apps/materials/views.py). The file's digest and its path on
disk are not either: the digest is how the server tells two uploads apart,
and the file leaves only through /api/sources (apps/qa/source_views.py).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from rest_framework import serializers

from apps.materials.models import CourseMaterial
from apps.materials.services import MAX_PDF_PAGES, NotAPdfError, TooManyPagesError, check_pdf
from config.errors import FieldReason, field_error

if TYPE_CHECKING:
    from django.core.files.uploadedfile import UploadedFile


# `ModelSerializer[...]` for the reason apps/accounts/serializers.py gives, and
# the same suppression on `Meta`.
class MaterialSerializer(serializers.ModelSerializer[CourseMaterial]):
    """A row of an edition's material: the name it was uploaded under and how far its ingest got.

    `failure` is empty unless `status` is `failed`; `uploaded_by` is a
    username, or null for a material imported from the command line or one
    whose uploader deleted their account.
    """

    uploaded_by = serializers.SlugRelatedField(slug_field="username", read_only=True)

    class Meta:  # pyright: ignore[reportIncompatibleVariableOverride]
        model = CourseMaterial
        fields = (
            "id",
            "source_file",
            "status",
            "failure",
            "uploaded_by",
            "created_at",
            "started_at",
            "finished_at",
        )
        read_only_fields = fields


class MaterialUploadSerializer(serializers.Serializer):
    """One file per request, its name the material's `source_file`.

    No length to check: Django cuts an uploaded file's name to 255 characters,
    its extension kept, which is the column's length. An empty file reaches no
    field, and is refused as missing. The file is a PDF by its content, of
    `MAX_PDF_PAGES` at most (`check_pdf`); its bytes the view counted first.
    """

    file = serializers.FileField()

    def validate_file(self, upload: UploadedFile) -> UploadedFile:
        try:
            check_pdf(upload)
        except NotAPdfError:
            raise field_error(FieldReason.INVALID) from None
        except TooManyPagesError:
            raise field_error(FieldReason.TOO_MANY_PAGES, max_pages=MAX_PDF_PAGES) from None
        return upload
