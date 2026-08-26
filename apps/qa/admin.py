"""Read-only admin for conversations.

Registered so that a person verifying the system by hand can see when a row was
written and what state it was left in — the acceptance run cares that a stream
cut off halfway leaves an incomplete assistant message behind, and that is
easier to confirm here than through a database client.

Everything is read-only on purpose. These rows are a record of what a student
was actually shown; an admin who edits one has changed the history a later
prompt is built from, silently.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from django.contrib import admin

from apps.qa.models import Conversation, Message

if TYPE_CHECKING:
    from django.db.models import Model
    from django.http import HttpRequest


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
