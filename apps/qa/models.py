"""Conversations, and the messages that make one.

Two models and no more. What a follow-up needs is the previous questions and
answers in order; everything else a chat product usually stores — titles,
folders, sharing, edits — is a feature this thesis is not making a claim about.
The sidebar's title is derived from the first message rather than stored,
because a stored one is a second copy of that text free to disagree with it.

**Why the citations and the routing decision are columns here.** They arrive in
the `start` event, which exists once and is gone. Reopening a conversation from
the sidebar replays it from these rows, and without them an older turn comes
back as bare prose: no source cards, no citation badges, no visible routing
decision — the three things the interface exists to show. They are stored as
JSON rather than as a third and fourth table because `Citation` and
`RouteDecision` are frozen pydantic models that already own those shapes
(apps/qa/contract.py, rag/agent.py); a Django table would be the same schema
declared twice, in two languages, free to drift.

`rag/` never sees any of this. It takes `rag.answer.Turn`, plain data with two
strings on it, which is what lets the pipeline stay runnable without Django.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models
from django.utils.translation import gettext_lazy as _

# How many completed exchanges travel with the next question. The constant lives
# here because this is where the cut is made — the window is a slice taken in a
# database query (apps/qa/conversations.py), and by the time the engine is
# called it has already happened. Nothing downstream knows or needs to know how
# wide it was.
#
# Three, because a 4B model's context is shared with the excerpts the answer is
# actually grounded in, and those must not be squeezed to make room for older
# conversation.
HISTORY_WINDOW_TURNS = 3


class Conversation(models.Model):
    """A thread of questions belonging to one student.

    `owner` is not nullable, and that is the constraint the whole login stage
    was for: a conversation with no owner is a row anybody could ask to be
    continued, which is an insecure direct object reference wearing a feature's
    clothes.

    `locale` here is Django's spelling — `it`, `en`, `zh-hans`, the values in
    `settings.LANGUAGES` — because it is copied from the account's preference
    and drives the interface. `Message.locale` is the other namespace; see there.
    """

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="conversations",
        verbose_name=_("owner"),
    )
    locale = models.CharField(
        max_length=16,
        choices=settings.LANGUAGES,
        default=settings.LANGUAGE_CODE,
        verbose_name=_("language"),
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name=_("created at"))

    class Meta:
        ordering = ("-created_at", "-id")
        verbose_name = _("conversation")
        verbose_name_plural = _("conversations")

    def __str__(self) -> str:
        # The owner is a column the admin list already shows; naming it here
        # would mean loading the row every time a conversation is printed.
        return f"conversation #{self.pk}"


class Message(models.Model):
    """One turn, either half.

    `complete` is not bookkeeping: an answer whose generation died halfway, or
    whose reader closed the tab, is kept exactly as far as it got and marked
    incomplete. That is what the student saw, so it is what the next turn's
    history has to contain — and the fragments themselves are the raw material
    for M3's error taxonomy, which a delete-on-failure policy would throw away.

    `locale` is the *rag* namespace here — a BCP-47 primary subtag, `zh` where
    `Conversation.locale` says `zh-hans` — because this is the language
    generation was actually asked for, and that value comes from and goes back
    into `rag/`. One bridge, one direction: `rag.chunk.normalize_locale`.
    """

    class Role(models.TextChoices):
        USER = "user", _("student")
        ASSISTANT = "assistant", _("assistant")

    conversation = models.ForeignKey(
        Conversation,
        on_delete=models.CASCADE,
        related_name="messages",
        verbose_name=_("conversation"),
    )
    role = models.CharField(max_length=16, choices=Role.choices, verbose_name=_("role"))
    # Blank is the normal state of an assistant row for as long as it is being
    # written: it is created before the first token and filled in when the
    # stream settles.
    text = models.TextField(blank=True, verbose_name=_("text"))
    locale = models.CharField(max_length=16, verbose_name=_("language"))
    complete = models.BooleanField(default=False, verbose_name=_("complete"))
    # Both empty on a student's own turn. `list` and `None` rather than a shared
    # mutable default — a bare `[]` would be one list shared by every row.
    citations = models.JSONField(default=list, verbose_name=_("citations"))
    route = models.JSONField(null=True, blank=True, verbose_name=_("routing decision"))
    created_at = models.DateTimeField(auto_now_add=True, verbose_name=_("created at"))

    class Meta:
        # `id` breaks the tie, and it has to be there: two messages written in
        # the same transaction can share a timestamp to the microsecond, and a
        # history window whose order depends on which row the planner returned
        # first is a prompt that cannot be reproduced.
        ordering = ("created_at", "id")
        indexes = (models.Index(fields=("conversation", "created_at")),)
        verbose_name = _("message")
        verbose_name_plural = _("messages")

    def __str__(self) -> str:
        return f"{self.role}: {self.text[:60]}"
