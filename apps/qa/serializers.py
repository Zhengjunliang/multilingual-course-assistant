"""Request parsing for `/api/ask`.

A DRF serializer rather than pydantic on this side: this is what `APIView`
calls, and its `ValidationError` is what produces the documented 400 body.
The response direction is pydantic — see apps/qa/contract.py for why the two
sides differ.
"""

from rest_framework import serializers

from rag.chunk import normalize_locale

# A 4B model's context is a shared, GPU-bound resource: every question is queued
# onto the one card this project has, and the prompt built around it — system
# instructions, retrieved excerpts, the question — has to fit a window measured
# in thousands of tokens. The cap is the same reasoning the roadmap applies to
# upload page counts: an unbounded input is an unbounded cost. A login does not
# change that; it only says whose cost it is.
MAX_QUESTION_CHARS = 1000


class AskRequest(serializers.Serializer):
    """The two things a question needs. Everything else is inferred."""

    question = serializers.CharField(max_length=MAX_QUESTION_CHARS, trim_whitespace=True)
    # Optional: with no locale the engine detects one from the question itself,
    # which is what the CLI does. An empty string is not a locale — `allow_null`
    # without `allow_blank` makes "omitted" and "null" the only ways to say
    # "decide for me", and `""` a validation error rather than a silent default.
    locale = serializers.CharField(required=False, allow_null=True, default=None)

    def validate_locale(self, value: str | None) -> str | None:
        """`it-IT` and `IT` both mean `it`; `itt` is an error, not a filter.

        The rule itself lives in `rag.chunk.normalize_locale`, which the CLI
        flags validate against too — one implementation, two entry points.
        """
        if value is None:
            return None
        try:
            return normalize_locale(value)
        except ValueError as exc:
            raise serializers.ValidationError(str(exc)) from exc
