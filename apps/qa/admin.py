"""Read-only admin for conversations.

Registered so that a person verifying the system by hand can see when a row was
written and what state it was left in — the acceptance run cares that a stream
cut off halfway leaves an incomplete assistant message behind, and that is
easier to confirm here than through a database client.

Everything is read-only on purpose. These rows are a record of what a student
was actually shown; an admin who edits one has changed the history a later
prompt is built from, silently. A message is not deleted on its own either: its
replies hang from it (`Message.parent`), so deleting one would take the rest of
the thread with it. It goes when its conversation or its owner does.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from django.contrib import admin
from django.core.exceptions import PermissionDenied  # noqa: TID251

from apps.qa.models import Conversation, Message

if TYPE_CHECKING:
    from django.db.models import Model
    from django.http import HttpRequest, HttpResponse


class ReadOnlyAdmin(admin.ModelAdmin):  # pyright: ignore[reportMissingTypeArgument]
    def has_add_permission(self, request: HttpRequest) -> bool:
        return False

    def has_change_permission(self, request: HttpRequest, obj: Model | None = None) -> bool:
        return False


@admin.register(Conversation)
class ConversationAdmin(ReadOnlyAdmin):
    list_display = ("id", "owner", "locale", "created_at")
    list_filter = ("locale",)


@admin.register(Message)
class MessageAdmin(ReadOnlyAdmin):
    list_display = ("id", "conversation", "role", "locale", "complete", "created_at")
    list_filter = ("role", "complete", "locale")
    # The delete permission stays: Django's admin checks it on every row a
    # conversation or an account takes with it when deleted (`get_deleted_objects`),
    # and refusing it would refuse those deletions. What goes is the way to
    # delete a message by itself, the bulk action and the delete page.
    actions = None

    def delete_view(
        self, request: HttpRequest, object_id: str, extra_context: dict[str, object] | None = None
    ) -> HttpResponse:
        # Django's own refusal on its own pages, answered with its 403 page; the
        # ban on it is the API's, whose refusals are coded (config/errors.py).
        raise PermissionDenied
