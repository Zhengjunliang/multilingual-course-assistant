"""Invitations: a link making its holder staff of a scope, from whoever may grant the role there.

Who may invite to a role is who may grant it (`GRANT_PERMISSION`,
apps/roles/registry.py): secretariat staff invite teachers to their
programme's editions, and the superuser invites to any role on any scope,
the way Dify lets a workspace's admins invite members (outside the
repository). The holder accepts with the account they are signed in to, or
with one they make on the spot, choosing its username and password: nobody
sets another's password (ASVS 6.4.1, outside the repository). The token is
made and opened as a reset link's is (apps/accounts/links.py), and an
invitation lives 72 hours, Dify's `INVITE_EXPIRY_HOURS`.

The grant is the maker's, so accepting asks again whether the maker may still
make it: an invitation whose maker was deactivated, or lost the role that let
them grant it, is as dead as an expired one, and one whose scope or maker was
deleted went with it. Each dead link is the one 404 `LINK_EXPIRED`, as a
reset link's is. A used or revoked invitation is deleted; an expired one
stays on its scope's list until whoever may grant the role there revokes it,
as GitHub lists an expired invitation (outside the repository).
"""

from __future__ import annotations

from datetime import timedelta
from typing import TYPE_CHECKING

from django.db import transaction
from django.utils import timezone

from apps.accounts.events import AuthEvent, auth_event
from apps.accounts.links import live, new_token
from apps.roles.grants import AlreadyHeldError, grant
from apps.roles.models import Invitation, on_scope
from apps.roles.registry import GRANT_PERMISSION, Role
from apps.roles.scopes import held_on
from config.errors import ErrorCode, fail

if TYPE_CHECKING:
    from django.db.models import QuerySet

    from apps.accounts.models import User
    from apps.accounts.services import Caller
    from apps.catalog.models import CourseEdition, DegreeProgramme

INVITATION_LIFETIME = timedelta(hours=72)


def _line(invitation: Invitation) -> dict[str, object]:
    """What a line about `invitation` names: which one, and the role it grants where."""
    # `str`: a row just made holds the `Role` itself, whose repr is not its value.
    return {"invitation": invitation.pk, "role": str(invitation.role), "on": invitation.scope_label}


def invite(
    actor: User, role: Role, scope: CourseEdition | DegreeProgramme, request: Caller
) -> tuple[Invitation, str]:
    """A new invitation from `actor` to `role` on `scope`, and its token, returned this once.

    Whether `actor` may make it is the caller's to check, as for a grant
    (apps/roles/grants.py).
    """
    token, token_hash = new_token()
    invitation = Invitation.objects.create(
        role=role,
        created_by=actor,
        token_hash=token_hash,
        expires_at=timezone.now() + INVITATION_LIFETIME,
        **on_scope(scope),
    )
    auth_event(
        AuthEvent.INVITATION_CREATED, request, None, **_line(invitation), by=actor.get_username()
    )
    return invitation, token


def revoke_invitation(actor: User, invitation: Invitation, request: Caller) -> bool:
    """Deletes `invitation`; False when it was gone already, used or revoked meanwhile.

    By primary key, and logged only when a row went, as `revoke` does a role
    (apps/roles/grants.py).
    """
    line = _line(invitation)
    deleted, _ = Invitation.objects.filter(pk=invitation.pk).delete()
    if not deleted:
        return False
    auth_event(AuthEvent.INVITATION_REVOKED, request, None, **line, by=actor.get_username())
    return True


def _good(invitations: QuerySet[Invitation], token: str) -> Invitation:
    """The invitation of `invitations` that `token` opens, while its maker may still grant
    what it grants; fails with `LINK_EXPIRED` otherwise."""
    invitation = live(invitations, token)
    granting = GRANT_PERMISSION[Role(invitation.role)]
    # `held_on` holds nothing for an account deactivated.
    if granting not in held_on(invitation.created_by, invitation.scope):
        fail(ErrorCode.LINK_EXPIRED)
    return invitation


def invitation_for(token: str) -> Invitation:
    """The invitation `token` opens, for the page to say what it grants; it stays as it is."""
    invitations = Invitation.objects.select_related("created_by", "edition__course", "programme")
    return _good(invitations, token)


def accept(token: str, user: User, request: Caller) -> None:
    """Grants `user` what the invitation `token` opens, as its maker, and voids it.

    `user` is the account signed in, or one to make, not saved yet and its
    password checked already (`RegisterSerializer`, apps/accounts/serializers.py):
    it is saved only once the invitation is found good, so a dead link makes
    no account. The invitation is locked while it is used, so two requests
    holding it grant once: the second finds no invitation. A role the account
    holds there already is a 409 `ROLE_ALREADY_HELD`. Whatever refuses, the
    invitation stays as it was.
    """
    new = user.pk is None
    with transaction.atomic():
        # Its own row only: PostgreSQL refuses to lock the nullable side of
        # the outer joins `select_related` makes.
        invitations = Invitation.objects.select_for_update(of=("self",)).select_related(
            "created_by", "edition", "programme"
        )
        invitation = _good(invitations, token)
        if new:
            user.save()
        try:
            grant(invitation.created_by, user, Role(invitation.role), invitation.scope)
        except AlreadyHeldError:
            fail(ErrorCode.ROLE_ALREADY_HELD)
        line = _line(invitation)
        invitation.delete()
    if new:
        auth_event(AuthEvent.REGISTER, request, user)
    maker = invitation.created_by.get_username()
    auth_event(AuthEvent.INVITATION_ACCEPTED, request, user, **line, by=maker)
