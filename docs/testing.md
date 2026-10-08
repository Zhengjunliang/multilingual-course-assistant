# Testing

This file owns four things: when a test may be deleted, which tests stay whatever those criteria say, where a regression test goes, and what a test may fake. How the suite runs is the `tests` step of [scripts/check.py](../scripts/check.py); what each test checks is the test's own business.

## When a test may be deleted

A test earns its place by what breaks when it is gone. It may be deleted when one of these holds:

- **(a) Its only assertion is on a mock it built itself.** It then tests the test, not the code. *Software Engineering at Google*, chapter 13, *Prefer Realism Over Isolation*, and chapter 12, *Test State, Not Interactions*.
- **(b) It fails on a pure internal refactor**, a change that keeps every behaviour a caller can see. Chapter 12, *Test via Public APIs* and *Strive for Unchanging Tests*.
- **(c) It repeats a scenario another test covers**, with nothing of its own to add. Chapter 12, *Test Behaviors, Not Methods*.
- **(d) Its failure does not say what broke**: reading the failure alone, one cannot tell which behaviour is gone. Chapter 12, *Write Clear Failure Messages*.

The book is read online (outside the repository: abseil.io/resources/swe-book, chapters 12 and 13). The four criteria are those of issue `#89`.

The commit that deletes a test names the criterion on a line of its own for every test it deletes, such as `- delete tests/test_x.py::test_y — (c) repeats tests/test_x.py::test_z`. The criteria hold for a new or changed test too: a test that would meet one of them is not written.

## Kept whatever the criteria say

Each of these is the only guard of what it protects. One that meets a criterion is rewritten rather than deleted, and the rewrite goes in the same commit as the removal of its old form.

| What it protects | Where |
| ---------------- | ----- |
| The scope invariants of [data-model.md](data-model.md) | `tests/test_catalog_models.py`; `tests/test_roles.py` for invariant 3 |
| `rag/` runs without Django | `tests/test_smoke.py` |
| The TypeScript mirror of `apps/qa/contract.py` | `tests/test_qa_contract.py` |
| The TypeScript mirror of the catalogue serializers and the permission names | `tests/test_catalog_contract.py` |
| Login, logout, sessions, CSRF and the login throttle | `tests/test_accounts_api.py` |
| Migration drift, which no other step checks | `tests/test_accounts.py::test_no_pending_migrations` |
| Every route says who may call it | `tests/test_route_permissions.py` |
| What each kind of caller gets from every API route | `tests/access_matrix.txt`, checked by `tests/test_access_matrix.py` |
| CI calls exactly the chain, and every guard rule fails on its bad examples | `tests/test_check_script.py`, `tests/test_guards.py` |

One overlap is kept on purpose: `tests/test_smoke.py::test_django_system_checks_pass` runs the system checks that the chain's `deploy` step runs too, so that `uv run pytest`, the quick loop, catches a broken setting without the whole chain.

## Where a regression test goes

A fix brings the test that was red before it, and the commit says it was. The test goes in the test file of the unit the fix protects, never in a file of its own: a new row of the parametrised table that covers the behaviour when there is one, with an `id` that names the input (`id="zero-width-space"`), otherwise a test named for the behaviour that broke. The issue number goes in the commit (`Closes #158`), not in the id or the name: a failure has to say what broke, criterion (d), and a number says only where to read about it.

## What a test may fake

A test runs the project's own code and fakes only what is outside it or cannot be had on demand:

- **Out of process**: the LLM endpoint (`rag.llm.build_completer`, `rag.llm.build_streamer`, `openai.OpenAI`), HTTP fetches (`rag.crawl.HttpxFetcher`), git and other binaries (`subprocess.run`).
- **Time**: the clock (`time.monotonic`) and the wait between fetches (`rag.live.shared_throttle`, replaced by a `Throttle` with no interval).
- **Too heavy for the unit loop**: the embedding encoders and the reranker (`StubDense` and `StubSparse` in `tests/test_index.py`), the document converters and the chunker (`rag.live.build_converter`, `rag.live.chunk_document`).
- **A failure no input produces**: an encoder that cannot load, a Qdrant that refuses, a build slow enough for two requests to meet (`tests/test_qa_api.py`, `tests/test_qa_engine.py`).

Two things are never faked. The database is the PostgreSQL test database Django creates, the engine production runs. Qdrant is a real embedded index under `tmp_path` (`rag.index.open_client` with a directory). Pointing a setting or a directory at the test's own, such as `PARSED_DIR` at `tmp_path` or a shorter queue timeout, is not a fake.

A fake of the project's own code outside these cases checks how the code is called, not what it does (*Software Engineering at Google*, chapter 12, *Test State, Not Interactions*). It is written only where no outcome can show the behaviour, and its docstring says why, as `tests/test_qa_api.py` does for the wrapper that keeps the engine's generator alive.
