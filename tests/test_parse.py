"""Normalisation has to hold, or lexical retrieval silently misses matches."""

import unicodedata

from rag.parse import normalize_text

COMPOSED = "perché è più"


def test_ligatures_fold_to_plain_letters() -> None:
    """The corpus contains U+FB01 in `micc.uniﬁ.it`; a query for `unifi` must match."""
    assert normalize_text("micc.uniﬁ.it") == "micc.unifi.it"


def test_decomposed_accents_are_composed() -> None:
    """PDF extraction can emit `e` + combining acute, which tokenises differently."""
    decomposed = unicodedata.normalize("NFD", COMPOSED)
    assert decomposed != COMPOSED, "fixture is not actually decomposed"
    assert normalize_text(decomposed) == COMPOSED


def test_already_normal_text_is_untouched() -> None:
    assert normalize_text("Digital images are sampled as a grid of pixels.") == (
        "Digital images are sampled as a grid of pixels."
    )
