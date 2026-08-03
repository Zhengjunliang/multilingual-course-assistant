"""Normalisation has to hold, or lexical retrieval silently misses matches; the CLI
flag rules and variant names are pure logic guarding user-facing behaviour."""

import subprocess
import sys
import unicodedata
from pathlib import Path

import pytest

from rag.parse import main, normalize_text, variant_of
from rag.probe import ParsePlan

BASE_DIR = Path(__file__).resolve().parent.parent

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


def test_variant_names_encode_the_enabled_enrichments() -> None:
    """Output files are keyed by variant; two runs over the same deck must stay
    comparable on disk."""
    cases = {
        (False, False): "classic",
        (True, False): "classic-ocr",
        (False, True): "classic-formula",
        (True, True): "classic-ocr-formula",
    }
    for (ocr, formula), expected in cases.items():
        plan = ParsePlan(pipeline="classic", ocr=ocr, formula=formula, reason="manual")
        assert variant_of(plan) == expected


def test_manual_flags_are_rejected_under_auto_profile() -> None:
    """Silently ignoring --ocr under --profile auto would parse with a configuration
    the user did not ask for; argparse must refuse before any file is touched."""
    with pytest.raises(SystemExit):
        main(["missing.pdf", "--ocr"])


def test_classic_only_flags_are_rejected_on_the_vlm_pipeline() -> None:
    with pytest.raises(SystemExit):
        main(["missing.pdf", "--profile", "manual", "--pipeline", "vlm", "--ocr"])


def test_importing_parse_does_not_load_docling() -> None:
    """Docling drags torch along and costs seconds; anything that only wants
    `normalize_text` or flag validation must not pay for it."""
    result = subprocess.run(
        [sys.executable, "-c", "import rag.parse, sys; print('docling' in sys.modules)"],
        cwd=BASE_DIR,
        capture_output=True,
        text=True,
        check=True,
    )
    assert result.stdout.strip() == "False"
