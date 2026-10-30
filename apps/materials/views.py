"""An edition's material: listed with the state of each ingest, and added one file at a time.

Nested under the edition as its syllabus and books are (apps/catalog/content_views.py),
so the edition is resolved, and checked, before the body is read: an edition the
caller may not see is a 404, whatever the upload. Both methods need
`edition.manage_materials` (apps/roles/registry.py), since the list shows who
uploaded each file and why an ingest failed. An upload answers 202 with the row,
`queued`, before any parsing: the ingest runs on a worker (apps/materials/tasks.py),
and the page reads the row again until it is `ready` or `failed`.
"""

from __future__ import annotations

from types import MappingProxyType
from typing import TYPE_CHECKING, cast

from rest_framework import status
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response

from apps.catalog.content_views import EditionContentView
from apps.materials.models import CourseMaterial
from apps.materials.serializers import MaterialSerializer, MaterialUploadSerializer
from apps.materials.services import MaterialExistsError, create_material
from apps.roles.registry import Permission
from config.errors import ErrorCode, fail

if TYPE_CHECKING:
    from rest_framework.request import Request

    from apps.accounts.models import User


class EditionMaterialsView(EditionContentView):
    """`GET` lists the edition's material, newest first; `POST` adds one file (202).

    A file whose bytes the edition holds is a 409 `MATERIAL_EXISTS` naming the
    row it is; one of a name the edition holds is that material's next version.
    """

    scope_map = MappingProxyType(
        {"GET": Permission.EDITION_MANAGE_MATERIALS, "POST": Permission.EDITION_MANAGE_MATERIALS}
    )
    parser_classes = (MultiPartParser,)

    def get(self, request: Request, pk: int) -> Response:
        materials = CourseMaterial.objects.filter(edition=self.scope).select_related("uploaded_by")
        return Response(MaterialSerializer(materials, many=True).data)

    def post(self, request: Request, pk: int) -> Response:
        serializer = MaterialUploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            material = create_material(
                self.scope,
                serializer.validated_data["file"],
                # Past IsAuthenticated, so this project's user (apps/accounts/views.py).
                uploaded_by=cast("User", request.user),
            )
        except MaterialExistsError as exc:
            fail(ErrorCode.MATERIAL_EXISTS, material=exc.material.pk)
        return Response(MaterialSerializer(material).data, status=status.HTTP_202_ACCEPTED)
