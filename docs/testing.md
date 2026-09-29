# Testing

This file owns two things: when a test may be deleted, and which tests stay whatever those criteria say. How the suite runs is the `tests` step of [scripts/check.py](../scripts/check.py); what each test checks is the test's own business.

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
| Login, logout, sessions, CSRF and the login throttle | `tests/test_accounts_api.py`, and the cases of `tests/test_qa_api.py` that refuse an anonymous caller |
| Migration drift, which no other step checks | `tests/test_accounts.py::test_no_pending_migrations` |
| Every route says who may call it | `tests/test_route_permissions.py` |
| CI calls exactly the chain, and every guard rule fails on its bad examples | `tests/test_check_script.py`, `tests/test_guards.py` |

One overlap is kept on purpose: `tests/test_smoke.py::test_django_system_checks_pass` runs the system checks that the chain's `deploy` step runs too, so that `uv run pytest`, the quick loop, catches a broken setting without the whole chain.
