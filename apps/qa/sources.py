"""Which corpus PDF a sha256 names, so a slides citation can open its page.

The client never sends a path. It sends the `source_sha256` a slides citation
carries (apps/qa/contract.py), and the parse sidecars — the provenance record
`rag.parse` writes next to every parsed document — say which file has that
hash. A sidecar is trusted only as far as the corpus directory: a path that
resolves outside it is skipped, which is the lesson of `#15`, a manifest value
joined into a path without normalisation.

The sidecars are read on every call rather than cached. There are a few dozen of
about a kilobyte each, and a cache would have to be dropped whenever a deck is
parsed again. `CourseMaterial` rows with their own file (`#35`) replace the scan.
"""

from __future__ import annotations

import logging
from pathlib import Path

from pydantic import ValidationError

from rag.parse import DEFAULT_OUT_DIR, ParsedMeta

logger = logging.getLogger(__name__)

# Where rag.parse writes its sidecars by default, and the corpus beside them
# (README, "Pipeline CLI"). Read when `source_pdf` runs, so a test can point
# both at tmp_path.
PARSED_DIR = DEFAULT_OUT_DIR
CORPUS_DIR = DEFAULT_OUT_DIR.parent / "corpus"


def source_pdf(sha256: str) -> Path | None:
    """The PDF a slides citation came from, or None when nothing may serve it.

    A sidecar that names the hash but points outside the corpus is skipped, not
    final: an old sidecar left pointing somewhere else must not hide a good one
    for the same file. The sha is the one recorded at parse time; the PDF is not
    hashed again, since the largest deck is about 30 MB.
    """
    corpus = CORPUS_DIR.resolve()
    for sidecar in sorted(PARSED_DIR.glob("*.meta.json")):
        try:
            meta = ParsedMeta.model_validate_json(sidecar.read_bytes())
        # OSError too: a sidecar removed mid-scan, a file another process holds,
        # a directory whose name ends in `.meta.json`. None of them is a reason
        # for a 500 instead of the next sidecar.
        except (ValidationError, OSError):
            logger.warning("skipping unreadable sidecar %s", sidecar.name)
            continue
        if meta.kind != "slides" or meta.source_sha256 != sha256:
            continue
        path = Path(meta.source_path).resolve()
        if path.is_relative_to(corpus) and path.is_file():
            return path
        logger.warning(
            "sidecar %s names %s, which is not a file inside %s: skipped",
            sidecar.name,
            path,
            corpus,
        )
    logger.info("no servable slides sidecar names %s", sha256)
    return None
