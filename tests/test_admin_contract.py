"""The SPA's copy of the superusers' account API must not drift from its serializers.

`apps/accounts/manage_serializers.py` is the single source and
`frontend/src/api/admin.ts` its shadow on the client, read as text as
tests/test_catalog_contract.py reads the catalogue's: the fields a serializer
declares and the field names of the interface of the same name are one set.
The page size is compared too, since the page counts its pages by it.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from test_qa_contract import declaration, fields

from apps.accounts.manage_serializers import ManagedUserSerializer, ResetLinkSerializer
from apps.accounts.manage_views import UserPagination

MIRROR = Path(__file__).resolve().parent.parent / "frontend" / "src" / "api" / "admin.ts"

# TypeScript interface -> the serializer it mirrors.
MIRRORED = {"ManagedUser": ManagedUserSerializer, "ResetLink": ResetLinkSerializer}


@pytest.fixture(scope="module")
def mirror() -> str:
    assert MIRROR.exists(), f"the SPA mirror is missing: {MIRROR}"
    return MIRROR.read_text(encoding="utf-8")


def test_the_mirror_declares_exactly_the_serializers_fields(mirror: str) -> None:
    declared = {name: fields(declaration(mirror, name)) for name in MIRRORED}

    assert declared == {name: set(serializer().fields) for name, serializer in MIRRORED.items()}


def test_the_mirror_pages_the_accounts_as_the_server_does(mirror: str) -> None:
    size = re.search(r"export const USER_PAGE_SIZE = (\d+);", mirror)

    assert size is not None
    assert int(size.group(1)) == UserPagination.page_size
