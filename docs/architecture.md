# Architecture and stack

This file owns the stack choices and the state of each decision's verification. Its sources are the supervisor's instructions (email of 2026-07-28) and the choices recorded here; the reasons for the decisions taken without the supervisor are in [decisions.md](decisions.md), and progress is in GitHub issues (milestones M3 · M4 · M5 · M6 · M7).

## The supervisor's constraints

- **Goal**: answer questions about university courses in several languages — the question's language differs from the material's (an English question, Italian material).
- **Open-weights LLMs only** (the Qwen family); proprietary APIs (OpenAI, Claude) are excluded. The model size that keeps running costs low has to be evaluated.
- **A progressive route**: first questions in the material's language, then (if possible) the cross-language part; **answer quality must be evaluable**.
- **Document parsing**: consider Granite-Docling for converting the material.
- **The PPM part**: a complete website, Flask or Django with Celery/Redis background tasks.
- **Compute**: Google Colab (free T4) first, then the GPU machines the supervisor provides, with Runpod or Lightning as alternatives. The GPU experiments skip Colab ([decisions.md](decisions.md), 2026-07-31, *The retrieval pipeline replaces a throwaway experiment, and MICC replaces Colab*).
- **A new direction** (oral, 2026-08-21): agentic RAG, from the Lightning template the supervisor forwarded, and the UniFi website as a second knowledge source, so that Erasmus and foreign students can ask about the campus (enrolment, fees, calendars) in their own language. The design is [unifi-web-source.md](unifi-web-source.md); the decision is [decisions.md](decisions.md), 2026-08-21, *The campus source and the agent*.

The four starting links the supervisor sent are analysed in [rag-analysis.md](rag-analysis.md).

## Chosen stack

The principle (2026-07-29): **the best open-source option available**. Two constraints are hard: Django with Celery/Redis on the backend (the supervisor's), and the open-weights Qwen family for the models (the thesis's). A dependency enters with the milestone whose code uses it (the rule is in `CLAUDE.md`).

| Component | Choice | Why |
| --- | --- | --- |
| Language | Python 3.12, managed by uv | the ML ecosystem; Flask and Django are the supervisor's range |
| Package manager | uv | a lockfile and built-in Python version management |
| Web | Django 5.2 LTS (`django>=5.2,<6`) | the admin is the superuser's back office, auth, ORM and i18n are built in, and the Celery integration is mature; LTS rather than 6.0 because it is supported until 2028-04 and DRF supports LTS most steadily |
| API | DRF with SSE streaming | the question-answering API ships with the pages, and leaves room for external integrations after the thesis (M7) |
| Frontend | React + TypeScript SPA (Vite) | the mainstream pairing; streaming answers and citation highlighting show best |
| Background tasks | Celery + Redis | the supervisor's choice |
| LLM | the Qwen3 family, sizes 0.6B–8B compared | the supervisor's choice; on a 2080 Ti (11 GB) 8B needs quantisation, on ultron (24 GB) it runs in fp16 |
| Embedding and rerank | Qwen3-Embedding and Qwen3-Reranker | one family with the LLM, the route the supervisor's links point to |
| Parsing | Docling's **classic pipeline with adaptive routing**: each file's profile decides OCR and formula enrichment; **the VLM stays out of automatic routing** and is kept for manual comparison | the classic pipeline restores word spacing, tables, heading levels and accents; routing, thresholds and rules are in [docling-pipeline.md](docling-pipeline.md), the measurements in [experiment-log.md](experiment-log.md), entries of 2026-07-31 and 2026-08-02; the code is [rag/probe.py](../rag/probe.py) |

Django rather than Flask: for a single developer Django means **less** code, with admin, auth, ORM and i18n built in, where Flask has to be assembled by hand. A React SPA rather than HTMX: PPM rewards presentation and streaming interaction. Both were settled on 2026-07-30. The interface counts toward the course grade ([decisions.md](decisions.md), 2026-09-14, *A person confirms what automatic growth proposes; the interface is graded*, point 2); its work is milestone M4 (`#85`).

## Decision status

Technical decisions are taken without waiting for the supervisor: a decision with grounds is made, and closed once an experiment verifies it.

| Decision | Choice | Status | Verification |
| --- | --- | --- | --- |
| RAG route | a self-built pipeline: Docling → chunking → hybrid retrieval → rerank → Qwen3; no LlamaIndex or LangGraph, for explainability ([rag-analysis.md](rag-analysis.md)) | ✅ | `rag/search.py`, `rag/answer.py`; smoke set hit@5 38/40 ([experiment-log.md](experiment-log.md), entry of 2026-08-21); the BM25 · dense · hybrid comparison is 🔜 M3 `#25` |
| Vector store | Qdrant with native hybrid search (dense Qwen3-Embedding + sparse fastembed BM25, fused with RRF); `locale` and edition-scope filters sit inside each prefetch branch ([docling-pipeline.md](docling-pipeline.md), section 4.1); the Qdrant server (`qdrant/qdrant:v1.19.1`) as a compose service every process shares, embedded `qdrant-client` only in tests and with `--qdrant DIR`; equal fused scores rank by point id, not in the order a server that searches its segments in parallel returns them; pgvector as the fallback | ✅ | `docker-compose.yml`, `rag/index.py`, `rag/search.py`; 31 decks, 1234 chunks ([experiment-log.md](experiment-log.md), entry of 2026-08-21); the move to the service passed three gates ([experiment-log.md](experiment-log.md), entry of 2026-09-29) |
| Database | PostgreSQL through Docker Compose; the custom `User` landed before the first `migrate` | ✅ | `docker-compose.yml` starts PostgreSQL 18; `apps/accounts/` |
| Frontend | React 19 + TypeScript + Vite + Tailwind v4 + Biome; shadcn-style component sources in the repository, not an npm package; interface text through react-i18next in three languages; a hand-written SSE parser (`EventSource` only sends GET); answers render as Markdown through `react-markdown` with GFM and CJK-friendly emphasis — raw HTML stays text, only absolute http(s) links open and show a host their text hides, images are not loaded, code is not highlighted, and `$$` math is typeset by KaTeX, loaded only with an answer that holds it, fonts served from the bundle (the reasons are in `frontend/src/features/chat/AnswerMarkdown.tsx` and `MathMarkdown.tsx`); the TypeScript mirror of the contract has one source, `apps/qa/contract.py` | ✅ | `frontend/`; `uv run python scripts/check.py frontend` runs lint, types, catalogue keys, contrast, tests and build |
| Access model | **login for the whole site**: session cookie + CSRF, no token or JWT (same origin needs none); open self-registration; per-endpoint throttles. Many accounts, one answer at a time: one 8 GB GPU answers serially, and per-caller throttles do not bound the global queue | ✅ | `apps/accounts/`; an anonymous `POST /api/ask` and a request without a CSRF token both get 403; anonymous campus-only questions are 🔜 M5 `#93` ([decisions.md](decisions.md), 2026-09-25, *The data model is decided on paper*, point 3). ✅ Staff act within the scopes their roles cover, through `/api/catalog/` (`apps/catalog/views.py`), by the permission registry of `apps/roles/registry.py` |
| Interface and message languages | the interface belongs to the three frontend catalogues, the answer language to the prompt in `rag/answer.py`, backend 503 and `error` messages are English ([decisions.md](decisions.md), 2026-08-27, *Website delivery (M5)*, point 1) | ✅ | `npm run check:i18n` keeps the key sets of the three catalogues identical |
| Inference serving | an OpenAI-compatible endpoint is the only contract: a local Ollama (Qwen3-4B q4) during development, vLLM on MICC for the M3 experiments (Turing cards have no bfloat16, so fp16); switching changes only `LLM_BASE_URL` and `LLM_MODEL` in `.env` | 🔶 | the development endpoint works (`config/env.py`); vLLM on MICC is 🔜 M3 `#18`, then the size comparison `#27` |
| Campus source | the UniFi website as a second knowledge source: a crawl and an index as the backbone, reusing the ingest pipeline (collection `unifi_web`), and live fetching as the automatic-growth layer; the design is [unifi-web-source.md](unifi-web-source.md) | ✅ | `rag/crawl.py`, `rag/live.py`; campus set hit@5 28/32 (`uv run python -m rag.gold gold/campus.jsonl`; [experiment-log.md](experiment-log.md), entry of 2026-08-24), above the threshold in [gold/README.md](../gold/README.md) |
| Agent orchestration | a router, then a deepening loop of at most three steps (`--no-deepen` fetches linked PDF attachments only, never a page link); explicit control flow with a pydantic-validated JSON decision at each step, and no native tool calling (a quantised 4B model follows such protocols unreliably); an append-only decision log in `data/webcorpus/decisions.jsonl`, the agent's one write path and an audit artefact, not knowledge | ✅ | `rag/agent.py` on the command line; the web API routes and retrieves without the loop (`apps/qa/engine.py`), its web path is 🔜 M5 `#34`; routing and the automatic-growth run are in [experiment-log.md](experiment-log.md), entry of 2026-08-24 |
| Automatic-growth write gate | a page fetched live is kept in the shared index after an LLM relevance verdict (binary JSON; a failed validation keeps nothing); the append-only registry records `url`, `content_hash`, `fetch_date`, `ingest_run_id`, `ingest_source`, `trigger`, `referrer_url`, `section` and `outlinks`, so a run can be rolled back | 🔶 | `rag/live.py` keeps what the gate passes; the decided human confirmation step is `#48`, which has no milestone ([decisions.md](decisions.md), 2026-09-14, *A person confirms what automatic growth proposes; the interface is graded*, point 1); the gate's 18/20 cannot be reproduced (`#83`) |
| Evaluation isolation | the eval-isolation rule, below | ✅ | `rag/search.py`, `rag/live.py`; campus 28/32 with 33 live points in the collection, and both rollbacks back to exactly 29098 points ([experiment-log.md](experiment-log.md), entry of 2026-08-24) |
| Deployment | defence-demo level: one `docker compose up` on a clean machine and a demonstration in the browser (running permanently on MICC or the public internet, and UniFi SSO, come after the thesis, M7); the development form serves the SPA from Django at `127.0.0.1:8000`, one address and one process | 🔶 | the development form is `npm run build --prefix frontend` then `uv run python manage.py runserver`; the clean-machine demonstration is 🔜 M6 `#41`, after static file serving `#40` |
| Observability | self-hosted Langfuse, LLM tracing | 🔜 | M3 `#26` |
| Evaluation | retrieval metrics and RAGAS (faithfulness, answer relevancy, context precision and recall; a large open-weights Qwen3 as the judge); gold sets built in the repository | 🔶 | hit@k is `rag/gold.py`; RAGAS and MRR are 🔜 M3 `#20` |
| Target languages | a question in any language is answered in that language, in both scenarios, evaluated in EN, IT and ZH; one index for all languages (Qwen3-Embedding is multilingual) with a `locale` field on each chunk for filtering | 🔶 | the campus set covers EN, IT and ZH (`gold/campus.jsonl`); the set covering both scenarios is 🔜 M3 `#19` |

## Named rules

Code comments cite these two rules by name.

**The module boundary rule.**
1. `rag/agent.py` is control flow and reads only. Its one reachable write into knowledge is `rag.live.fetch_and_ingest`, and its own output is the decision log.
2. At query time `rag/live.py` is the only module that writes to the shared index.
3. A module that needs a shared encoder asks `rag/index.py` for it and never caches one of its own: two instances would cost another copy of the model in memory and a second first load.
4. `rag/llm.py` holds no state: it knows the configured endpoint and how to validate a completion, nothing about its callers.
5. Backends are configuration: `rag/` knows an OpenAI-compatible endpoint, not a vendor, so switching between Ollama and vLLM is an edit of `.env`. The one Ollama-specific call, unloading the model to free GPU memory, is a no-op on any other endpoint.

That `rag/` never imports Django is a rule of `CLAUDE.md`.

**The eval-isolation rule.** Points written by live fetching carry `ingest_source="live"`, and evaluation reads `"crawl"` by default (`--ingest-source`; optionally one snapshot, `--snapshot <run_id>`). The condition goes into the two `unifi_web` prefetch branches and never into the slides branches, so the slides non-regression gate cannot drift; a top-level filter would be ignored under fusion ([docling-pipeline.md](docling-pipeline.md), section 4.1). Deletion is bound to the `(url, ingest_source)` pair, so a crawl snapshot and live increments never overwrite each other. The one explicit release is `rag.gold --live on`, which drops the condition because the automatic-growth acceptance run has to see the pages it fetched.

## Experiment reproducibility

🔜 M3 `#20`: every experiment records the following.

- **Model identity**: the Hugging Face revision (pinned to a commit: a name such as `Qwen3-8B` is not a fixed artefact) and the quantisation. A quantised 8B and an fp16 8B are **different models**: the size comparison must not mix them across machines, or the size axis and the precision axis get confounded.
- **Inference configuration**: the vLLM version, the seed and the sampling parameters (temperature, top_p, max_tokens).
- **Data identity**: the corpus snapshot hash and the parse configuration travel in the chunk payload ([docling-pipeline.md](docling-pipeline.md), section 3.6).
- **Parsing stack version**: `docling` (with `docling-ibm-models`) and `pypdf`, recorded with the corpus numbers, which depend on them ([experiment-log.md](experiment-log.md), entry of 2026-09-14).

The dependency layer is reproducible through `uv.lock` and `--locked` in CI.

## Corpus and scope

- **Corpus**: the PPM course slides, PDFs in `data/corpus/PPM/` (gitignored: copyrighted material never enters git). Mostly English, some Italian or mixed; languages also mix inside one file, so `locale` is a chunk field, not a file field. Every document has a text layer, and one is mostly images. Naive extraction loses the spaces between words and keeps ligatures; Docling restores the spacing, and `rag/parse.py` normalises with NFKC. With Docling's defaults images and formulas are dropped, which motivates the adaptive routing and the picture-description ablation (`#28`). Counts and sizes are in [experiment-log.md](experiment-log.md), entries of 2026-07-31 and 2026-08-02. Past years' written exams as a corpus are `#47`.
- **Capability boundary**: question answering over retrieved material. ⛔ Generating or grading exercises.
- **Delivery**: the React SPA, the DRF API with SSE streaming, and the Django admin as the superuser's back office, in **one repository** with the RAG core.
- **Data model** 🔶 programmes, courses and yearly editions are tables in `apps/catalog/`, entered through the admin (`apps/catalog/admin.py`); role scopes are `apps/roles/`, and staff switch a course's current edition through `apps/catalog/views.py`; 🔜 M5: content ownership — [data-model.md](data-model.md).
- **Tenancy and authentication**: the campus knowledge base is one shared index with no per-user isolation on retrieval, on purpose, since the corpus is public; the deepening loop writing into it makes attribution a real question (`#17`). Writes that trigger growth are limited to accounts and throttled. UniFi single sign-on would go through IDEM GARR, the Italian universities' federation (SAML/Shibboleth); Django has ready service-provider libraries, but registering the application needs UniFi IT's approval, which a thesis project does not wait for: M5 uses Django accounts with pluggable authentication, and SSO is 🔜 M7 `#44`. ✅ Every route declares who may call it, and a route that leans on the global default fails the suite (`tests/test_route_permissions.py`).
- **External knowledge sources** (MCP, Google Drive): 🔜 M7 `#45`.

## Engineering

ruff (lint and format) · pyright (`rag/` strict) · pytest with pytest-django and a coverage gate · pre-commit (file hygiene, `detect-private-key`, ruff, typos, `uv-lock`, and the repository's own guards in `scripts/guards/`, commit messages included, each named with its rule in `CLAUDE.md`, section 5; `.pre-commit-config.yaml`, run at commit time and, without `uv-lock`, by the chain's `hooks` step) · two GitHub Actions workflows, `ci.yml` (the check chain, split over two parallel jobs, and a dependency audit) and `secrets.yml` (gitleaks). What each runs and why is written in the workflows' comments and in [development.md](development.md), section on CI. Dependabot opens update pull requests monthly (`.github/dependabot.yml`). Repository-level Dependabot alerts and security updates are on (repository settings, 2026-10-05): an alert flags an advisory published between pushes, which `pip-audit` and `npm audit` on every push cannot, and a security update opens its fix as a pull request that the audit gate judges like any other, except for the packages `.github/dependabot.yml` holds back, which get the alert alone. How to report a vulnerability: `.github/SECURITY.md`. Configuration and secrets come from `.env` through pydantic-settings (`config/env.py`, which does not import Django and is shared with `rag/`); `.env` never enters git. Docker Compose runs PostgreSQL and Qdrant (`docker-compose.yml`); Redis is 🔜 M5 `#34`.

The security self-review is [security.md](security.md).

## Compute strategy

The split follows **use**. Formal experiments (the M3 size grid, evaluation runs) run on vLLM on the MICC servers. The **development loop** runs entirely on the laptop, generation included: Ollama with Qwen3-4B q4 (about 2.6 GB) next to the 0.6B embedding and reranker models (about 1.2 GB each) fits in 8 GB at the limit, so the LLM is unloaded between the relevance gate and the parse of a live fetch (`maybe_unload_llm()` in `rag/live.py`, `ollama stop`); 8B models run only on the servers. The small ingest models also run locally: the laptop installs the CUDA build of torch (the `pytorch-cu126` index in `pyproject.toml`, limited to `sys_platform == 'win32'`; Linux resolves torch and torchvision to the CPU builds of the `pytorch-cpu` index, so CI installs no CUDA runtime, and a Linux machine with a GPU installs the CUDA build over them, 🔜 M3 `#18`), so Docling's layout, TableFormer, CodeFormulaV2 and granite-docling-258M (about 0.5 GB in fp16) models run on the local GPU. The gain is modest but real, enough to run locally the comparison that rejected the VLM and to try picture description in M3; full parses and batch VLM or picture-description work go to the servers. Measurements: [experiment-log.md](experiment-log.md), entries of 2026-08-21 and 2026-08-02. The "2080 Ti machines" of the supervisor's email are the Dream Machines themselves (two 2080 Ti each).

Nothing has to be synchronised to the server for daily work. Embedding and reranking run on the laptop GPU and Qdrant runs as the compose service on the laptop (`docker-compose.yml`), so indexing and retrieval are fully offline; generation calls the local Ollama through `LLM_BASE_URL` (`config/env.py`). The M3 experiments point `LLM_BASE_URL` at vLLM on MICC through an SSH tunnel ([development.md](development.md), section on the pipeline CLI, and `.env.example`); what travels is the prompt — the question and the retrieved chunk text — not files. Unit tests and CI mock the LLM client: no network, no GPU. Only formal experiments (M3 evaluation, the size comparison) run on the server after a `git pull`, and their retrieval runs on a Qdrant server too, not on an embedded copy: every M3 baseline is measured on one backend, and an embedded index scores the no-rerank arm differently ([experiment-log.md](experiment-log.md), entry of 2026-09-29, section 4). The index reaches that server as a snapshot of the laptop's service, 🔜 M5 `#122`.

## Hardware

| Environment | GPU and memory | Use |
| --- | --- | --- |
| MICC Dream Machines | two RTX 2080 Ti each (the documentation says 12 GB, the specification 11 GB); six machines: targaryen · lannister · lechuck · theflash · harlock · nikita | regular experiments; a free machine is picked from the monitoring |
| MICC ultron | two Titan RTX, 24 GB | large experiments, 8B in fp16, the size comparison |
| Development laptop | RTX 4070 Laptop, 8 GB | code, SSH, **the ingest models and generation during development** (the whole Docling set including granite-docling-258M, Ollama Qwen3-4B q4); no 8B experiments |
| Runpod / Lightning | variable | a paid fallback, only if MICC is unavailable for a long time |

MICC access ✅: account and public key registered (confirmed by the system administrators); first login done (targaryen: two 2080 Ti with 11 GB, CUDA 12.4; ultron: two Titan RTX with 24 GB, CUDA 12.2; user `jzheng`); personal NAS homes exist (`/oblivion/users/jzheng`, `/equilibrium/jzheng`). Access from outside ✅: the Dream Machines are reachable directly, `ssh <user>@<server>.micc.unifi.it`, with no VPN (OpenVPN is retired, confirmed by the system administrators; an optional MICC VPN exists and is not used). Server specifications and addresses are on the documentation portal, `https://doc.portal.micc.unifi.it` (outside the repository, login required). Storage: the shared NAS volumes `andromeda`, `equilibrium`, `fishtank` and `oblivion`, with a 100 GB home quota; which volume to use, the personal paths and `HF_HOME` are in [development.md](development.md), section on the MICC servers. GPU monitoring: a dedicated Discord channel and Grafana (login through micc-authentik). **Credentials never enter the repository.** <!-- guard-ignore status-path-exists: facts about the MICC servers, outside the repository -->

## Windows notes

- The system Python 3.10 stays untouched; the project's version is managed by uv ✅ (`.python-version` says 3.12).
- PyPI gives Windows the CPU build of torch; the project points it at the CUDA build (see the compute strategy above).
- Redis has no native Windows build: on this machine it runs in Docker or WSL2. 🔜 M5 `#34`.
- Celery's default worker pool is not supported on Windows: the development worker uses the `solo` pool, and deployment is on Linux. 🔜 M5 `#34`.
