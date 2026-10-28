# Testing

This file owns the rules of the test suite: which layer tests what, when a test is admitted, how long a layer may take, what a flaky test is, what coverage means and how the suite is reviewed, when a test may be deleted, which tests stay whatever those criteria say, where a regression test goes, and what a test may fake. How the suite runs is the steps of [scripts/check.py](../scripts/check.py) and the jobs of [.github/workflows/ci.yml](../.github/workflows/ci.yml); what each test checks is the test's own business.

A rule whose guard is not named is kept by `review`: the reading of a pull request before it is merged.

## Which layer tests what

One behaviour is tested in one layer, the one whose seam it belongs to: a rule of the server in pytest, the interface's logic in vitest, and in a browser only what needs a real browser to be seen. Same-kind applications and the large Django projects write the same rule: a test sits as far out as its behaviour is visible, and the browser keeps what only the assembled system shows (outside the repository: Onyx's `backend/tests/README.md`, Dify's `web/docs/test.md`, Sentry's and Zulip's testing documentation).

| Layer | Owns | Leaves to another layer | Example |
| ----- | ---- | ----------------------- | ------- |
| pytest, `tests/` | The server's rules: permissions, error codes, the scope invariants, the API contract and its TypeScript mirrors, the pipeline | How a page shows any of it | [tests/test_access_matrix.py](../tests/test_access_matrix.py): what each kind of caller gets from every API route |
| vitest, `frontend/src/**/*.test.{ts,tsx}` | The interface's logic and state, tested at page level: what a page shows for each answer the API can give, and what it sends | The server's rules, which its fixtures assume; a component on its own, unless a page test cannot reach its logic | [ChatPage.routing.test.tsx](../frontend/src/routes/ChatPage.routing.test.tsx) |
| Browser floors, [frontend/e2e/](../frontend/e2e/) | What only a real browser measures, on every screen: accessibility, reduced motion, type, the byte budget of the first screen; and the demo path on recorded answers | The server, whose answers [frontend/e2e/api.ts](../frontend/e2e/api.ts) records | [frontend/e2e/a11y.spec.ts](../frontend/e2e/a11y.spec.ts) |
| Journeys, [frontend/journeys/](../frontend/journeys/) | The flows whose two sides must agree, through the real Django and PostgreSQL: signing in and out, a role granted and then found, a question streamed, stored and reopened, a visitor's question | Interface states (refusals, languages, layout), which vitest and the floors hold; the model and retrieval, faked by [tests/journeys/](../tests/journeys/) | [frontend/journeys/ask.spec.ts](../frontend/journeys/ask.spec.ts) |

A component test that repeats what a page test of the same behaviour checks meets criterion (c) below.

## Before adding a test

- **Only logic gets a test**: state, data, permissions, validation, API contracts. A change to style, copy or layout gets none and is looked at instead. The browser floors are no exception to this: they check invariants of every screen rather than one change's look, and a new screen joins them as a row of [frontend/e2e/screens.ts](../frontend/e2e/screens.ts), not as a new test.
- **Extend before adding.** Search first, by the unit's name, the text on screen or the error code, and extend the test that covers the behaviour, as a new row of its table where it has one. Every new test function costs every later run its time (Open WebUI's regression contract, outside the repository).
- **The deletion criteria hold for a new or changed test**: one that would meet any of (a)–(d) below is not written.
- **The requirement wins.** A test that contradicts the issue or the spec it implements is reported, never changed to agree with the code.
- **A new browser test passes five runs in a row**, `npx playwright test <file> --repeat-each=5` from `frontend/` (with `--config playwright.journeys.config.ts` for a journey), before it is committed; one failure in five is a failing test (Open WebUI's contract). Those five runs happen once, when the test is accepted, and never in the chain.

## Time caps

Every check says where it runs: the commit hooks of `.pre-commit-config.yaml`, the chain of [scripts/check.py](../scripts/check.py), CI only, or by hand. A browser suite runs only in the last two, so the local loop never waits for a browser. The caps are the commit hooks at 6 s for a commit, a pull request green within two minutes of its push with every job of the workflow included, and 15 billed CI minutes for a run. A check that would push a layer past its cap is paid for by removing another, or it is not added.

Each CI job and step has a `timeout-minutes` about twice its measured median, rounded up to minutes, and a comment beside it giving the measurement: a suite that needs longer has grown a regression to look at, not to wait for. The chain's pytest prints its ten slowest tests (`--durations` in the `tests` step), so a slow test is seen in the run that brings it. Guard: those `timeout-minutes`.

## Coverage

Coverage is a diagnostic signal, not a target (Dify's `web/docs/test.md`, outside the repository). `fail_under` in `pyproject.toml` is a floor that catches a large untested addition; it is never raised for its own sake, and no test is written to move it. The frontend's coverage, `npm run test:coverage --prefix frontend`, is read by hand and gates nothing. Guard: `fail_under`, for the floor.

## The review at a milestone's end

By hand, once at the end of each milestone, never in the chain:

1. **pytest, per test.** `uv run pytest --cov --cov-context=test`, then `uv run coverage json --show-contexts -o htmlcov/contexts.json`. A test whose covered lines are all covered by another test is a candidate.
2. **vitest, per file**, since vitest records no coverage per test. Run each test file alone, `npx vitest run <file> --coverage --coverage.reportsDirectory=coverage/<name>` from `frontend/`; a file whose covered lines another file covers is a candidate, and the tests inside one file are read for repeats.
3. **The browser floors and the journeys**: a test whose behaviour a lower layer can see is a candidate.
4. **Triage.** Each candidate gets a verdict, delete, merge or keep, and the criterion of the next section or the layer rule above that decides it. Line coverage does not drop, or each line lost is explained, such as a line only a test asserting on its own mock ever ran.

## Flaky tests

A test that fails with no change to the code is a wrong test: it is fixed or deleted when it is seen, never retried, skipped or set aside in a quarantine. Both browser suites run with `retries: 0` ([frontend/playwright.config.ts](../frontend/playwright.config.ts), [frontend/playwright.journeys.config.ts](../frontend/playwright.journeys.config.ts)), since a retry reports a race as a pass; Open WebUI and Dify run their browser suites the same way, and Zulip treats a nondeterministic failure as an urgent bug (outside the repository). A browser test waits for what the page or the server states, through an assertion that retries by itself such as `toBeVisible`, never for a fixed time. Guard: `retries: 0`.

## When a test may be deleted

A test earns its place by what breaks when it is gone. It may be deleted when one of these holds:

- **(a) Its only assertion is on a mock it built itself.** It then tests the test, not the code. *Software Engineering at Google*, chapter 13, *Prefer Realism Over Isolation*, and chapter 12, *Test State, Not Interactions*.
- **(b) It fails on a pure internal refactor**, a change that keeps every behaviour a caller can see. Chapter 12, *Test via Public APIs* and *Strive for Unchanging Tests*.
- **(c) It repeats a scenario another test covers**, with nothing of its own to add. Chapter 12, *Test Behaviors, Not Methods*.
- **(d) Its failure does not say what broke**: reading the failure alone, one cannot tell which behaviour is gone. Chapter 12, *Write Clear Failure Messages*.

The book is read online (outside the repository: abseil.io/resources/swe-book, chapters 12 and 13). The four criteria are those of issue `#89`.

The commit that deletes a test names the criterion on a line of its own for every test it deletes, such as `- delete tests/test_x.py::test_y — (c) repeats tests/test_x.py::test_z`.

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
| The interface and the server agree end to end: a session ended on the server, a granted role, a stream stored and reopened, a visitor's question | `frontend/journeys/` |

One overlap is kept on purpose: `tests/test_smoke.py::test_django_system_checks_pass` runs the system checks that the chain's `deploy` step runs too, so that `uv run pytest`, the quick loop, catches a broken setting without the whole chain.

## Where a regression test goes

The fix of a logic defect brings the test that was red before it, and the commit says it was; a fix of style, copy or layout brings none (section "Before adding a test"). The test goes in the test file of the unit the fix protects, never in a file of its own: a new row of the parametrised table that covers the behaviour when there is one, with an `id` that names the input (`id="zero-width-space"`), otherwise a test named for the behaviour that broke. The issue number goes in the commit (`Closes #158`), not in the id or the name: a failure has to say what broke, criterion (d), and a number says only where to read about it.

## What a test may fake

A test runs the project's own code and fakes only what is outside it or cannot be had on demand:

- **Out of process**: the LLM endpoint (`rag.llm.build_completer`, `rag.llm.build_streamer`, `openai.OpenAI`; for the journeys, an OpenAI-compatible server of their own, `tests/journeys/fake_llm.py`), HTTP fetches (`rag.crawl.HttpxFetcher`), git and other binaries (`subprocess.run`).
- **Time**: the clock (`time.monotonic`) and the wait between fetches (`rag.live.shared_throttle`, replaced by a `Throttle` with no interval).
- **Too heavy for the unit loop**: the embedding encoders and the reranker (`StubDense` and `StubSparse` in `tests/test_index.py`), the document converters and the chunker (`rag.live.build_converter`, `rag.live.chunk_document`).
- **A failure no input produces**: an encoder that cannot load, a Qdrant that refuses, a build slow enough for two requests to meet (`tests/test_qa_api.py`, `tests/test_qa_engine.py`).

Two things are never faked. The database is the PostgreSQL test database Django creates, the engine production runs. Qdrant is a real embedded index, under `tmp_path` (`rag.index.open_client` with a directory), or in memory for the journeys (`tests/journeys/retrieval.py`, which `QA_RETRIEVAL` names). Pointing a setting or a directory at the test's own, such as `PARSED_DIR` at `tmp_path` or a shorter queue timeout, is not a fake.

A fake of the project's own code outside these cases checks how the code is called, not what it does (*Software Engineering at Google*, chapter 12, *Test State, Not Interactions*). It is written only where no outcome can show the behaviour, and its docstring says why, as `tests/test_qa_api.py` does for the wrapper that keeps the engine's generator alive.
