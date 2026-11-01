# Documents

Every document of the repository, under the reader it is written for, with its kind: a Diataxis type (how-to, reference, explanation; outside the repository: diataxis.fr) or a record of another kind. Each piece of information has one owner, and the other documents link it. Progress, blockers and deferred work are GitHub issues, never a document.

## The supervisor and the thesis committee

| File | Kind | Contents |
| --- | --- | --- |
| [architecture.md](architecture.md) | explanation | The supervisor's constraints, the stack and the state of each decision's verification, the two named rules, what every experiment records, the corpus and scope, where the work runs |
| [decisions.md](decisions.md) | decision record | The decisions taken without the supervisor that the thesis argues, in force only: the date, what was decided, why, the price |
| [experiment-log.md](experiment-log.md) | experiment record | Every measurement, newest first, each with how its numbers were produced |
| [rag-analysis.md](rag-analysis.md) | explanation | The supervisor's four links analysed, the route comparison, and why no framework is used |
| [rag-pipeline.md](rag-pipeline.md) | explanation | The ingest and query pipelines step by step: the parsing routes, the chunk payload contract, the retrieval and generation rules |
| [unifi-web-source.md](unifi-web-source.md) | explanation and reference | The campus source: the crawl's scope, retrieval over two collections, snapshots and the registry, the deepening loop and the agent's decision log |
| [security.md](security.md) | reference | The security self-review against the OWASP lists and ASVS, and the accepted risks |

## Developers, people and agents

| File | Kind | Contents |
| --- | --- | --- |
| [CLAUDE.md](../CLAUDE.md) | agent rules | The rules an agent works by, the project overview, and the documentation conventions with their guards |
| [development.md](development.md) | how-to and reference | Setup, the daily commands, the check chain, the frontend, the pipeline CLI, the code layout, the MICC servers, CI |
| [api.md](api.md) | reference | The HTTP API: accounts, questions, conversations, ratings, background work, the catalogue, errors |
| [data-model.md](data-model.md) | reference | The relational schema, the scope invariants, the contract between `apps/` and `rag/`, the migration order |
| [background-tasks.md](background-tasks.md) | reference | Redis, the Celery workers and beat, and how a question and a course material go through a worker |
| [testing.md](testing.md) | reference | The rules of the test suite: which layer tests what, when a test is added or deleted, what it may fake |
| [DESIGN.md](../DESIGN.md) | design system | The tokens, generated from `frontend/src/index.css`, how colour, type, layout, depth and shape are spent, the components, where the mascot stands |
| [gold/README.md](../gold/README.md) | reference | The gold sets: schema, id prefixes, writing rules, acceptance thresholds |
| [frontend/brand/README.md](../frontend/brand/README.md) | reference | The mark and the mascot: its files, how to use them, its CC0 licence; how it was made is [PROVENANCE.md](../frontend/brand/PROVENANCE.md) |
| [.github/](../.github/) | configuration | What GitHub reads besides the code, and what it inherits from the account: [development.md](development.md), section "Code layout" |

## Visitors on GitHub

| File | Kind | Contents |
| --- | --- | --- |
| [README.md](../README.md) | landing page | What the project is, how to use the site, how to run it |
| [.github/SECURITY.md](../.github/SECURITY.md) | how-to | How to report a vulnerability |
