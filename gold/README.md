# Gold sets

The questions that retrieval and routing are scored on, and the relevance gate's labelled set. This file owns their schema, the id prefixes, the writing rules and the acceptance thresholds; `rag/gold.py`, `rag/golddraft.py` and `rag/live.py` cite it.

| File | Prefix | Size | What it is | How it was written |
| --- | --- | --- | --- | --- |
| `smoke.jsonl` | `q` | 40 questions, all EN | course questions over the 31 decks, the tuning signal for chunk size, top-k and prompt | drafted by an LLM from the chunks, then checked by hand against the cited page |
| `control.jsonl` | `k` | 5 questions, EN | a control group against lexical leakage between a question's wording and the indexed text | written directly from the original PDFs, without looking at the chunks |
| `campus.jsonl` | `c` | 32 questions: EN 12 · IT 13 · ZH 7 | campus questions, scored by URL | drafted by `rag.golddraft` from pages in the index, checked by Claude row by row, then sampled by URL by the author |
| `campus-autogrow.jsonl` | `g` | 7 questions | questions whose answer pages are deliberately **not** in the index (form PDFs included), for the automatic-growth acceptance run | drafted by `rag.golddraft` from the outlink graph, checked the same way |
| `relevance-gate.jsonl` | — | 20 URLs: 10 relevant, 10 irrelevant | the relevance gate's labelled set; not questions (section below) | drafted by an LLM, checked by Claude, sampled by the author |

**Acceptance thresholds**, owned here:

- **Campus set**: hit@5 ≥ 0.80 for EN and for IT, each on its own; ZH is reported without a threshold. `rag.gold` prints per-locale rates when a set mixes locales.
- **Automatic growth**: from 0/N before the run to at least ⌈0.7 N⌉ after it (5 of the 7 questions).
- **Relevance gate**: at least 18 of the 20 labels.

The measured values are in [docs/experiment-log.md](../docs/experiment-log.md), entries of 2026-08-24 and 2026-09-14; the automatic-growth remeasurement is 🔜 M3 `#24`, and a gate measurement that can be repeated needs frozen page content (`#83`). The course side of the gold sets is English only: the set covering both scenarios in EN, IT and ZH is 🔜 M3 `#19`.

## Storage

- **Questions and references**: the `*.jsonl` files here, in git (the questions are original writing).
- **Reference answers**, which quote slides or web pages: `data/gold/answers/<id>.md`, gitignored and **never** in git.
- `rag.golddraft` writes its draft answers into `data/gold/answers/` and numbers its drafts from 1 on every run, so running it again overwrites the reviewed `c` and `g` answers. Point a new run elsewhere with `--answers-dir`.

## Question format

One question per line, for example the first row of `smoke.jsonl`:

```json
{"id": "q001", "locale": "en", "question": "What is an Object-Relational Mapping and what problem does it solve?", "source_file": "2-orm_django_2025.pdf", "page": 11, "answer_ref": "data/gold/answers/q001.md"}
```

| Field | Meaning |
| --- | --- |
| `id` | A prefix and three digits. One prefix per set: `q` smoke, `k` control, `c` campus, `g` campus-autogrow; ids are unique across all sets, because answers are named by id in one directory (`tests/test_gold.py`) |
| `locale` | the question's language: `en` in smoke and control; `en`, `it` or `zh` in the campus sets |
| `question` | a student's natural question, not a sentence copied from a slide |
| `source_file` | the PDF that holds the answer, by its name under `data/corpus/PPM/`; `""` for campus questions |
| `page` | the answer's main page (1-based, the same meaning as the chunk payload's `page`); `0` for campus questions |
| `answer_ref` | the reference answer's path, relative to the repository root (the commands run from there) |
| `target` | `slides` (the default when absent) or `unifi_web`: the collection the router should choose, and the one the question is scored against — `rag.gold` searches that single collection, so the non-regression gates keep a constant meaning (`rag/gold.py`) |
| `urls` | the ground truth of a campus question: a hit is any web chunk in the top k whose `url` is in the list (a trailing slash is ignored). A question with `urls` is scored by URL, never by `source_file` or `page`. When the answer is on several pages, every **verified** equivalent page is listed — never a page that retrieval merely happened to return |

## relevance-gate.jsonl

**Not a gold question**: it has no `id`, `question` or `answer_ref`, and `rag.gold` rejects it by design (`GateRow` in `rag/live.py`). Its one consumer is `uv run python -m rag.live --measure-gate`. The 20 URLs are uncrawled candidates from the outlink graph in `data/webcorpus/registry.jsonl`, and the set is frozen by a commit of its own before any measurement.

```json
{"url": "https://...", "label": "relevant", "note": "why the page should or should not be stored"}
```

| Field | Meaning |
| --- | --- |
| `url` | the page to judge: 10 relevant (DSU, CISIA and a PDF among the borderline cases) and 10 irrelevant (commercial pages, and login pages inside the unifi domain as hard negatives) |
| `label` | `relevant` (should be stored) or `irrelevant` (should not); the criterion is whether the content belongs in the campus knowledge base, not the domain |
| `note` | the reason for the label, for sampling checks and error analysis |

## Writing rules

1. Every course question has its answer at `source_file` + `page`: open that page before writing the question. Every campus question has its answer on each page in `urls`.
2. Stratify by file and topic: every one of the 31 decks should have questions, so the set does not cover only the parts that parse well.
3. Vary the style: definitions (what is), comparisons (difference between), procedures (how to) and reading code, each a share.
4. A reference answer is key points plus source excerpts (easy to grade by hand), not an essay.
5. One main source per question; when an answer truly spans pages, `page` is the first and the answer file names the others.
