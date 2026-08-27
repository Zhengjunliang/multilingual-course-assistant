"""Serving the SPA: what answers a path Django itself does not own.

No `django_db` marker, and as in tests/test_qa_engine.py that is a claim rather
than an omission — pytest-django refuses any query a test without the marker
attempts, so these tests state that handing out the shell reaches no database.
It is the cheapest page this project serves and should stay that way.

Every test overrides `SPA_DIST` at a temporary directory instead of reading the
real build. Both outcomes then belong to the test rather than to whether
somebody ran `just fe` first, and the missing-build branch becomes reachable at
all — on a checked-out repo that has been built, it never is.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest
from django.test import Client, override_settings

if TYPE_CHECKING:
    from collections.abc import Iterator
    from pathlib import Path

SHELL = b'<!doctype html>\n<html lang="it"><body><div id="root"></div></body></html>'

# Paths the SPA routes on its own. `/c/7` is the one that matters: it is where
# a reader lands after sharing a conversation with themselves, and the only
# reason the catch-all exists.
SPA_PATHS = ["/", "/login", "/register", "/c/7"]


@pytest.fixture
def built(tmp_path: Path) -> Iterator[Path]:
    """A frontend build that exists, with a shell whose bytes are known."""
    (tmp_path / "index.html").write_bytes(SHELL)
    with override_settings(SPA_DIST=tmp_path):
        yield tmp_path


@pytest.fixture
def unbuilt(tmp_path: Path) -> Iterator[Path]:
    """A checkout where `just fe` has never run: the directory is empty."""
    with override_settings(SPA_DIST=tmp_path):
        yield tmp_path


@pytest.mark.usefixtures("built")
@pytest.mark.parametrize("path", SPA_PATHS)
def test_a_path_the_spa_routes_gets_the_shell(client: Client, path: str) -> None:
    response = client.get(path)

    assert response.status_code == 200
    assert response.headers["Content-Type"] == "text/html; charset=utf-8"
    assert response.content == SHELL


@pytest.mark.usefixtures("built")
def test_the_shell_is_served_without_signing_in(client: Client) -> None:
    """The gate is on /api, not on the page that will ask the reader to log in.

    Stated as a test because it reads like a hole and is not one: a visitor has
    to be able to load the interface in order to reach its login form, and
    every endpoint behind it refuses them until they do.

    This client carries no credentials, and the file's missing `django_db` is
    the second half of the claim — a 200 here is a 200 that consulted no
    session table and no user row.
    """
    assert client.get("/").status_code == 200


@pytest.mark.usefixtures("unbuilt")
def test_a_missing_build_names_the_command_that_fixes_it(client: Client) -> None:
    response = client.get("/")

    assert response.status_code == 503
    assert b"just fe" in response.content


@pytest.mark.usefixtures("built")
@pytest.mark.parametrize("path", ["/api/nope", "/api/", "/api/ask/typo"])
def test_a_wrong_api_path_is_a_404_and_not_the_shell(client: Client, path: str) -> None:
    """The negative lookahead in config/urls.py, stated as a test.

    Without it the catch-all would answer these with the shell and a 200, and
    a caller's `response.json()` would fail on `<!doctype html>` — an error
    that names neither the wrong path nor the pattern that swallowed it.
    """
    response = client.get(path)

    assert response.status_code == 404
    assert SHELL not in response.content
