"""Every route says who may call it, or the suite fails.

The guard walks the URL tree the way Django resolves it, so a route added in
any app is checked without anyone listing it here. A DRF view has said who may
call it when the permission classes it ends up with are not the ones APIView
falls back on, or when it decides them per request in `get_permissions()`.
What it ends up with, not what its own class body spells: a base class may
declare for its subclasses, the URLconf may override both through `as_view()`,
and an undecorated `@api_view` or a view that only inherits the default has
declared nothing. The default,
`DEFAULT_PERMISSION_CLASSES` in config/settings.py, stays as a safety net, but
a route that leans on it is a finding.

A route anyone may call is listed in `OPEN` with the reason; so is a view that
decides its permissions per request, since reading its code is the only way to
see what it opens. Every other route must require a login, `IsAuthenticated`
itself among its permission classes, so that `()`, an `OR` with `AllowAny` or
an object check standing alone cannot pass for one. A URL namespace that
answers for its own access is in `DELEGATED`.

What the guard cannot see is a view that overrides `initial()` or
`check_permissions()` and skips the checks its classes name; such a view is
read by a person, not by this file.

No `django_db` marker, as in tests/test_spa.py: resolving the URL tree reads
no database, and pytest-django refuses any query a test here would attempt.
"""

from __future__ import annotations

from collections import Counter
from typing import TYPE_CHECKING, NamedTuple

import pytest
from django.http import HttpResponse
from django.urls import URLPattern, URLResolver, get_resolver, path
from rest_framework.decorators import api_view
from rest_framework.generics import ListAPIView
from rest_framework.permissions import AllowAny, BasePermission, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.roles.api import ScopedObjectView
from apps.roles.registry import Permission, roles_with

if TYPE_CHECKING:
    from collections.abc import Callable, Iterator, Mapping, Sequence

    from django.http import HttpRequest
    from django.http.response import HttpResponseBase
    from rest_framework.request import Request

# Route name -> why anyone may call it.
OPEN: dict[str, str] = {
    "accounts:me": (
        "GET is how the SPA learns nobody is logged in; SessionView.get_permissions "
        "asks a login for PATCH"
    ),
    "accounts:login": "logging in is what a caller without a session does",
    "accounts:register": "anyone may open an account",
    "spa": "the shell is static HTML; every call it makes is an API route checked here",
    "favicon": "a redirect to a public static file, reading nothing",
}

# URL namespace -> what decides who may call the routes under it.
DELEGATED: dict[str, str] = {
    "admin": "SuperuserAdminSite.has_permission admits superusers only (config/admin.py)",
}


class Route(NamedTuple):
    name: str  # namespaced, or the pattern itself when the route has no name
    namespace: str
    view: Callable[..., object]


def routes(patterns: Sequence[URLPattern | URLResolver], namespace: str = "") -> Iterator[Route]:
    """Every route, in the order Django resolves them."""
    for pattern in patterns:
        if isinstance(pattern, URLResolver):
            inner = pattern.namespace
            nested = f"{namespace}:{inner}" if namespace and inner else inner or namespace
            yield from routes(pattern.url_patterns, nested)
        else:
            name = pattern.name or str(pattern.pattern)
            yield Route(f"{namespace}:{name}" if namespace else name, namespace, pattern.callback)


def findings(
    patterns: Sequence[URLPattern | URLResolver],
    open_routes: Mapping[str, str] = OPEN,
    delegated: Mapping[str, str] = DELEGATED,
) -> list[str]:
    """Each route that does not say who may call it, with what is wrong."""
    found: list[str] = []
    for name, namespace, callback in routes(patterns):
        if namespace.split(":")[0] in delegated:
            continue
        view = getattr(callback, "cls", None)
        if not (isinstance(view, type) and issubclass(view, APIView)):
            if name not in open_routes:
                found.append(f"{name}: not a DRF view, and not in OPEN")
            continue
        # What the URLconf passes to as_view() replaces the class attribute.
        classes = getattr(callback, "initkwargs", {}).get(
            "permission_classes", view.permission_classes
        )
        per_request = view.get_permissions is not APIView.get_permissions
        if per_request:
            if name not in open_routes:
                found.append(f"{name}: decides its permissions per request, and is not in OPEN")
        elif classes is APIView.permission_classes:
            found.append(f"{name}: declares no permission_classes")
        elif name not in open_routes and not any(
            permission is IsAuthenticated for permission in classes
        ):
            found.append(f"{name}: does not require a login, and is not in OPEN")
    return found


def test_every_route_says_who_may_call_it() -> None:
    assert findings(get_resolver().url_patterns) == []


class _OwnsIt(BasePermission):
    pass


class _OnlyAPIView(APIView):
    def get(self, request: Request) -> Response:
        return Response()


class _OnlyListView(ListAPIView):
    pass


@api_view(["GET"])
def _undecorated(request: Request) -> Response:
    return Response()


class _EmptyTuple(_OnlyAPIView):
    permission_classes = ()


class _OrAllowAny(_OnlyAPIView):
    permission_classes = (IsAuthenticated | AllowAny,)


class _ObjectCheckAlone(_OnlyAPIView):
    permission_classes = (_OwnsIt,)


class _AllowAny(_OnlyAPIView):
    permission_classes = (AllowAny,)


def _plain(request: HttpRequest) -> HttpResponse:
    return HttpResponse()


class _PerRequest(_OnlyAPIView):
    def get_permissions(self) -> list[BasePermission]:
        return [AllowAny()]


class _DeclaredByItsBase(_OnlyAPIView):
    permission_classes = (IsAuthenticated, _OwnsIt)


class _InheritsTheDeclaration(_DeclaredByItsBase):
    pass


@pytest.mark.parametrize(
    ("view", "is_open", "reported"),
    [
        pytest.param(_OnlyAPIView.as_view(), False, True, id="only-inherits-APIView"),
        pytest.param(_OnlyListView.as_view(), False, True, id="only-inherits-ListAPIView"),
        pytest.param(_undecorated, False, True, id="undecorated-api_view"),
        pytest.param(_EmptyTuple.as_view(), False, True, id="empty-tuple"),
        pytest.param(_OrAllowAny.as_view(), False, True, id="or-with-AllowAny"),
        pytest.param(_ObjectCheckAlone.as_view(), False, True, id="object-check-alone"),
        pytest.param(_AllowAny.as_view(), False, True, id="AllowAny-not-in-OPEN"),
        pytest.param(_plain, False, True, id="plain-function-view"),
        pytest.param(_PerRequest.as_view(), False, True, id="per-request-not-in-OPEN"),
        # The URLconf may override what the class declares.
        pytest.param(
            _InheritsTheDeclaration.as_view(permission_classes=(AllowAny,)),
            False,
            True,
            id="overridden-in-the-urlconf",
        ),
        pytest.param(_PerRequest.as_view(), True, False, id="per-request-in-OPEN"),
        pytest.param(_InheritsTheDeclaration.as_view(), False, False, id="declared-by-its-base"),
    ],
)
def test_a_route_that_says_nothing_is_reported(
    view: Callable[..., HttpResponseBase], is_open: bool, reported: bool
) -> None:
    open_routes = {"route": "a reason"} if is_open else {}

    found = findings([path("route", view, name="route")], open_routes, {})

    assert [finding.split(":")[0] for finding in found] == (["route"] if reported else [])


def test_a_delegated_namespace_is_matched_as_a_namespace() -> None:
    """A route merely named like a delegated namespace is checked like any other."""
    found = findings([path("admin", _OnlyAPIView.as_view())], {}, {"admin": "a reason"})

    assert [finding.split(":")[0] for finding in found] == ["admin"]


def test_the_walk_reaches_every_app() -> None:
    """Without this, a walk that stopped descending would find nothing wrong."""
    reached = {route.name for route in routes(get_resolver().url_patterns)}

    assert reached >= {
        "accounts:me",
        "accounts:logout",
        "qa:ask",
        "qa:conversation",
        "catalog:editions",
        "spa",
    }


def test_every_exemption_names_a_route() -> None:
    reached = Counter(route.name for route in routes(get_resolver().url_patterns))
    namespaces = {route.namespace.split(":")[0] for route in routes(get_resolver().url_patterns)}

    # Exactly once: a second route of the same name would share the exemption.
    assert {name: reached[name] for name in OPEN} == dict.fromkeys(OPEN, 1)
    assert set(DELEGATED) <= namespaces


def served(view: type[APIView]) -> set[str]:
    """The methods a view answers, but HEAD, which follows GET."""
    return {m.upper() for m in view.http_method_names if m != "head" and hasattr(view, m)}


def scoped_views() -> dict[str, type[ScopedObjectView]]:
    """The scoped views the URL tree mounts, by route name."""
    return {
        route.name: view
        for route in routes(get_resolver().url_patterns)
        if isinstance(view := getattr(route.view, "cls", None), type)
        and issubclass(view, ScopedObjectView)
    }


def test_every_permission_guards_a_route() -> None:
    """No permission in the registry is dead: some routed view filters or checks by it."""
    guarded: set[object] = set()
    for route in routes(get_resolver().url_patterns):
        view = getattr(route.view, "cls", None)
        guarded.add(getattr(view, "visible_with", None))
        guarded |= set(getattr(view, "scope_map", {}).values())

    assert guarded - {None} == set(Permission)


def test_each_scoped_view_maps_every_method_it_serves() -> None:
    """A method a scoped view serves but does not map would be refused to everyone.

    OPTIONS counts too, so a scoped view cannot serve it: its metadata would
    describe the writes to a caller who may only read (`apps/roles/api.py`).
    """
    views = scoped_views()
    methods = {name: served(view) for name, view in views.items()}

    assert methods
    assert methods == {name: set(view.scope_map) for name, view in views.items()}


def test_whoever_may_act_on_a_scope_may_see_it() -> None:
    """Without this, a caller holding a write but not the view would get a 404 for a 403.

    A scoped view hides what its caller may not see, so every role holding a
    permission its `scope_map` names must hold the view permission too.
    """
    unseen = {
        (name, permission): roles_with(permission) - roles_with(view.visible_with)
        for name, view in scoped_views().items()
        for permission in view.scope_map.values()
    }

    assert {cell: roles for cell, roles in unseen.items() if roles} == {}
