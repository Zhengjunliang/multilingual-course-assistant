# Development

This file owns working on the repository: setting it up for development, the daily commands, the check chain, the frontend, the pipeline CLI, the code layout, the MICC servers and CI. Running the site once is [README.md](../README.md), section "Run it locally"; the HTTP API is [api.md](api.md).

## Setup

[README.md](../README.md), section "Run it locally", installs and runs the site: uv brings its own Python 3.12 and leaves the system interpreter untouched, Node's version is in `frontend/.nvmrc`, `.env.example` holds the command that generates `DJANGO_SECRET_KEY` and leaves `DJANGO_DB_PASSWORD` for you to pick, and `docker compose` needs the Docker Desktop engine running. To develop, two more commands in the clone:

```powershell
uv run pre-commit install        # the commit and commit-message hooks; rerun it in a clone from before 2026-09-28
git config pull.rebase true      # history is linear: a pull rebases onto main instead of merging it
```

`docker-compose.yml` starts only the stateful services: Django runs on the host under `uv run`, because the embedding model and reranker in `rag/` use the local GPU. The fully containerised path is 🔜 `#41` (M6); the convention is described at the top of `docker-compose.yml`.

## Daily loop

| To | Run |
| -- | --- |
| start / stop PostgreSQL and Qdrant | `docker compose up -d` / `docker compose down` (data stays in the named volumes; `down -v` deletes both, the index and the pages fetched live that exist nowhere else included, irreversibly: `rag.snapshot` in section *The pipeline CLI* copies the index out first) |
| serve the site | `uv run python manage.py runserver` → <http://127.0.0.1:8000/> (admin at `/admin/`, superusers only) |
| work on the frontend | the above, plus `npm run dev --prefix frontend` → <http://localhost:5173/> |
| fill in the demo: three real programmes, their courses in the academic years Cineca offers them with their teaching starts, the demo teacher's syllabi and books, and `demo-` accounts holding each role | `uv run python manage.py populate_demo`; set `DEMO_PASSWORD` in `.env` first to log in as them, a password the registration rules accept (`.env.example`). Safe to rerun: it adds what is missing, keeps the rows it finds, gives an edition with no teaching start the file's, fills a syllabus or a reading list only in a language that has none, and resets the `demo-` accounts' roles to its data file. Every `demo-` account shares that password, `demo-admin` included, so switch `demo-admin` off in the admin on a site others can reach; a rerun leaves it off |
| run the tests quickly | `uv run pytest` |
| run everything CI runs | `uv run python scripts/check.py` |
| query or build an embedded index instead (tests, a machine without Docker) | `--qdrant <directory>` on any `rag` command that opens the index; one process holds it at a time |

A test is added, changed or deleted by the rules of [docs/testing.md](testing.md).

**Changing a model** means regenerating the app's migration and rebuilding the local database, or the suite goes red (`test_no_pending_migrations` in `tests/test_accounts.py`). Until a database has to keep its data, each app has one migration, `0001_initial.py`, rewritten on every change rather than followed by a `0002` ([docs/decisions.md](decisions.md), 2026-09-25, *The data model is decided on paper*, point 5). Save the data **before** editing the model — `dumpdata` reads every column the model declares, so it fails once the model is ahead of the database — then run the rest one line at a time, stopping at the first that fails: the `docker compose rm` line deletes the local database.

```powershell
# before editing models.py; -X utf8 because Windows would write the file in cp1252
uv run python -X utf8 manage.py dumpdata auth.group accounts qa catalog roles --natural-foreign --indent 2 --output data/dev.json
# after editing it
$app = "catalog"                                      # the app whose model changed
Remove-Item "apps/$app/migrations/0001_initial.py"
# roles' 0001 depends on catalog's, and makemigrations cannot load a graph missing it
if ($app -eq "catalog") { Remove-Item "apps/roles/migrations/0001_initial.py" }
docker compose rm -s -f postgres; docker volume rm multilingual-course-assistant_postgres-data; docker compose up -d --wait   # deletes the local database, irreversibly; the Qdrant volume stays
uv run python manage.py makemigrations                # the new 0001_initial.py goes into git
uv run python manage.py migrate
uv run python manage.py loaddata data/dev.json --ignorenonexistent
```

A field added as `NOT NULL` without a default has no value in `data/dev.json`; add it to the file before `loaddata`.

**A reported error is found by its reference.** An error the reader cannot act on shows its code and the request's id under its sentence, `ENGINE_DOWN · rif. 4bf92f3577b34da6a3ce929d0e0e4736` in the Italian interface; the same id is in the response's `X-Request-ID` header ([api.md](api.md), section "Errors"). Every line the server writes for that request carries it in brackets, the refusal's own line included, with its traceback for a 5xx, and the server writes to its console only (`LOGGING` in [config/settings.py](../config/settings.py)), so the request's lines are the console's lines that hold the id: the terminal's search finds them, or `Select-String -Pattern <id>` over a saved copy of the output.

🔜 M3 `#26`: the same id names the request's trace in Langfuse. 🔜 M6 `#143`: each audit line carries it as its `request_id`.

## The check chain

[scripts/check.py](../scripts/check.py) is the one definition of what "green" means, locally and in CI. Without arguments it runs every step in order; with names it runs only those, in chain order:

```powershell
uv run python scripts/check.py               # all five steps
uv run python scripts/check.py hooks types   # only these two
```

| Step | Runs |
| ---- | ---- |
| `hooks` | every hook of `.pre-commit-config.yaml` except `uv-lock` and `biome` (the `frontend` step runs Biome), over every tracked file: file hygiene, `detect-private-key`, ruff lint and format, typos, zizmor and actionlint over the workflows, and the repository's own guards, each named with its rule in `CLAUDE.md`, section 5 |
| `frontend` | biome, `tsc`, catalogue keys, colour contrast, `DESIGN.md`'s tokens and linter, vitest, production build |
| `types` | `pyright` |
| `deploy` | `manage.py check --deploy --fail-level WARNING`, which runs the ordinary system checks too |
| `tests` | `pytest --cov`, with the coverage gate; migration drift is one of the tests |

A hook that rewrites a file (ruff, trailing whitespace) fails the run that rewrote it: review the diff, `git add`, run again. The chain runs with `DJANGO_DEBUG=false` whatever `.env` says, because that is how CI tests. Why each step is where it is — `frontend` first, the TLS flag only on `deploy` — is written next to the step in the script. Interrupting the `frontend` step on Windows makes `cmd` ask `Terminate batch job (Y/N)?`: answer `Y`.

In a pull request, "the checks pass" is shown by `uv run python scripts/check.py` ending green: its last line goes under *How it was verified*, next to the evidence for each criterion.

## Frontend

React + TypeScript SPA built with Vite, Tailwind and shadcn-style components (their source lives in the repository), UI text in three languages through react-i18next.

| To | Run | Open |
| -- | --- | ---- |
| work on the frontend | `runserver`, plus `npm run dev --prefix frontend` in a second terminal | <http://localhost:5173/> — reloads on save |
| see the site as it ships | `npm run build --prefix frontend` once, then `runserver` | <http://127.0.0.1:8000/> — same origin, one process |

The second row is what the site really is: Django serves `frontend/dist/index.html` at the root and the bundle under `/static/`, with no Vite involved — so a frontend change needs a rebuild before port 8000 shows it. Without a build that address answers 503 and names the command. With `DEBUG=False` Django refuses to serve static files; the static file server for deployment is 🔜 `#40` (M6).

Three runs stay out of the chain, so the local loop does not pay for them. `npm run e2e --prefix frontend` builds the interface into `frontend/dist-e2e/` and drives it in Playwright's Chromium, every `/api` request answered in the browser from fixtures typed by the client's mirrors ([frontend/e2e/api.ts](../frontend/e2e/api.ts)): the first question's travel, nothing moving under reduced motion, axe on every screen in both themes, and the byte budget of a visitor's first screen. It is what the `browser` job runs in CI; a machine needs the browser once, `npx --prefix frontend playwright install chromium --only-shell`. `npm run e2e:journeys --prefix frontend` drives the same browser against the real site instead ([frontend/playwright.journeys.config.ts](../frontend/playwright.journeys.config.ts)): it builds `frontend/dist/`, creates the database `mca_journeys` afresh beside `mca`, seeds the demo into it and serves it with `runserver` on port 8017, with a fake OpenAI-compatible model on 8018 and stub retrieval over an in-memory index ([tests/journeys/](../tests/journeys/)). It needs the PostgreSQL container up and runs with DEBUG off whatever `.env` says; it is what the `journeys` job runs. It rebuilds `frontend/dist/`, as the chain's `frontend` step does, and Playwright empties `frontend/test-results/` when either suite starts, so it runs after the chain and `npm run e2e`, not beside them. `npm run test:coverage --prefix frontend` prints vitest's coverage over every source file: a signal, whose baseline #89 records, not a gate.

Before a session: `/login` · `/register` · `/forgot` (whom to ask for a reset link) · `/reset#<token>` (a new password through a reset link) · `/invite#<token>` (accepting an invitation, signed in or making an account), the token in the fragment, which no server log reads · `/styleguide` (the component layer against no data). Signed in: `/` (new conversation) · `/chat/:id` (a stored one, by its UUID) · `/account` (the roles held, the password, the devices signed in, deleting the account). Any other path outside `/staff` gets a page that says it is not there, with the way back to `/`. The chat, the account's page and the staff pages share one frame, [frontend/src/routes/ShellLayout.tsx](../frontend/src/routes/ShellLayout.tsx), whose sidebar shows the superuser and whoever holds a role a "Gestione" group above the conversations: `/staff/programmes` (the programmes in scope) · `/staff/programmes/:code` (a programme's study plan and its secretariat) · `/staff/courses/:code` (a course's study plans and editions, `?programme=<code>` naming the programme it was reached through) · `/staff/editions/:id` (an edition, its teachers, its syllabus and its reading list) · `/staff/mine` (the editions of a teacher's own courses from the current one on, `?show=all` for every year). `/staff` lands on the account's first Gestione item ([docs/decisions.md](decisions.md), 2026-10-05, *The staff pages live in the chat shell*, point 1), an unknown `/staff/…` path says "not found" inside the shell, and an account with no role is sent to `/`. [config/urls.py](../config/urls.py) answers every path it does not own with the same shell, so a reload on `/chat/<id>` works, and sends `/favicon.ico` to the built icon.

On 5173 the Vite dev server proxies `/api`, `/admin` and `/static` to port 8000 with `changeOrigin: false`, which keeps Django's CSRF origin check passing without `CSRF_TRUSTED_ORIGINS`. The reasons behind the frontend's other choices sit next to the code that makes them: session cookie and CSRF in [frontend/src/api/http.ts](../frontend/src/api/http.ts), no `EventSource` in [frontend/src/api/sse.ts](../frontend/src/api/sse.ts), citation markers in [frontend/src/lib/markers.ts](../frontend/src/lib/markers.ts), waiting and retries in [frontend/src/features/chat/](../frontend/src/features/chat/), themes in [frontend/src/theme/](../frontend/src/theme/) and [frontend/src/index.css](../frontend/src/index.css). [frontend/src/api/contract.ts](../frontend/src/api/contract.ts) mirrors [apps/qa/contract.py](../apps/qa/contract.py), which is the single source; [tests/test_qa_contract.py](../tests/test_qa_contract.py) fails when the two drift. [frontend/src/api/catalog.ts](../frontend/src/api/catalog.ts) mirrors the serializers of [apps/catalog/serializers.py](../apps/catalog/serializers.py), [apps/catalog/content_serializers.py](../apps/catalog/content_serializers.py) and [apps/catalog/invitation_serializers.py](../apps/catalog/invitation_serializers.py) the same way, checked by [tests/test_catalog_contract.py](../tests/test_catalog_contract.py), and [frontend/src/api/admin.ts](../frontend/src/api/admin.ts) those of [apps/accounts/manage_serializers.py](../apps/accounts/manage_serializers.py), checked by [tests/test_admin_contract.py](../tests/test_admin_contract.py).

## The pipeline CLI

Course PDFs go in `data/corpus/<course>/` (gitignored). Every command below is `uv run python -m rag.<module> …`:

| Module | Does | Example arguments |
| ------ | ---- | ----------------- |
| `probe` | profile PDFs and show the per-file routing, without parsing | `data\corpus\PPM` |
| `parse` | parse with Docling following that routing → `data\parsed\` | `data\corpus\PPM --course B028451 --academic-year 2025-2026` · `"<file>.pdf" --course B028451 --academic-year 2025-2026 --profile manual --pipeline vlm` |
| `chunk` | chunk parsed documents → `data\chunks\*.jsonl` | `data\parsed` |
| `index` | encode into the Qdrant service (`QDRANT_URL`); a directory holds the whole set of files of each edition it contains ([data-model.md](data-model.md), the contract between `apps/` and `rag/`) — two editions of a deck need separate `--out-dir` directories when parsing and chunking | `data\chunks` |
| `search` | hybrid retrieval (dense + BM25 + RRF) + Qwen3 reranker | `"What is an ORM?"` · `"What is an ORM?" --scope B028451:2025-2026` |
| `answer` | retrieve + generate a cited answer | `"What is an ORM?"` |
| `agent` | route to course or campus collection, retrieve, answer; deepens by fetching linked pages unless `--no-deepen` | `"Quando scadono le tasse?"` |
| `gold` | retrieval hit@k over a gold set, or the router's report with `--routing` | `gold\smoke.jsonl` · `gold\campus.jsonl --routing` |
| `golddraft` | draft campus gold questions from the crawled pages, for review; see [gold/README.md](../gold/README.md) before running it again | `data\webchunks --out data\golddraft` |
| `crawl` | snapshot the campus website (robots honoured, 1 req/s, ≤ 500 pages; run by the user) | `--out data\webcorpus` |
| `webparse` | parse a crawl snapshot into chunkable artefact pairs | `data\webcorpus\<run_id>` |
| `live` | fetch one URL, gate it, grow the shared index; `--rollback <run_id>` undoes a run, `--measure-gate` scores the gate | `<url>` |
| `snapshot` | copy `slides` and `unifi_web` out of the Qdrant server into `data\snapshots\<UTC time>\`, one snapshot file each and a `manifest.json` with their points per `url` and `ingest_source`; `--restore` uploads such a directory to a server that holds neither collection, then prints its counts as source / restored and fails if any differs | none · `--restore data\snapshots\<time> --qdrant http://127.0.0.1:6340` |

Parsing writes two files per PDF, `<name>.<variant>.json` (the lossless DoclingDocument) and `<name>.<variant>.meta.json` (provenance); routing rules, measurements and the chunk payload contract are in [docs/docling-pipeline.md](docling-pipeline.md).

Embedding and reranking (0.6B each) run on the local GPU, fully offline. Generation calls an OpenAI-compatible endpoint, by default a local Ollama:

```powershell
winget install Ollama.Ollama
ollama pull qwen3:4b-instruct-2507-q4_K_M
```

The endpoint and model are `LLM_BASE_URL` and `LLM_MODEL` in `.env`; the M3 experiments point them at vLLM on MICC through an SSH tunnel (the commented lines in `.env.example`). The reasons for this split are in [docs/architecture.md](architecture.md), section on compute strategy.

## Code layout

| Path | Contents |
| ---- | -------- |
| `config/` | Django project: `settings.py` (security headers conditional on `DEBUG` and `DJANGO_BEHIND_TLS`) · `urls.py` (with the SPA fallback) · `views.py` (the SPA shell, and the API's fallbacks for a path no view has and for a 500) · `admin.py` and `apps.py` (the admin site, which admits superusers only) · `errors.py` (the closed table of error codes, the coded error body, `fail()` and `field_error()` that refuse with a code, and the handler that answers every `/api/` error in it) · `request_id.py` (each request's id, in its `X-Request-ID` and on every log line it causes) · `env.py` (`.env` through pydantic-settings, shared by `rag/` and Django) · asgi/wsgi |
| `apps/accounts/` | Accounts: custom `User` = `AbstractUser` + `locale` · serializers for register, login and the account · session login and the CSRF cookie in `views.py` · the CSRF check for a caller without a session and the superuser check in `permissions.py`, and the CSRF check for a session in `authentication.py`, refusing as `CSRF_FAILED` · the session engine, saving each session into a table keyed to its account, in `sessions.py` · how long a session lives, by tier, in `middleware.py` · changing the password, seeing and ending one's own sessions and deleting one's own account in `self_views.py`, each confirmed by the password (`reauth.py`) · a superuser's list of every account, and deactivating, reactivating, signing out and deleting one, in `manage_views.py` and `manage_serializers.py` · a reset link, made by a superuser and used once by its holder, in `links.py`, and what the holder of a reset link or an invitation calls in `link_views.py` · the rules every door obeys, and the writes, in `services.py` · `urls.py` under `/api/auth/`, `manage_urls.py` under `/api/admin/` · `admin.py`, which opens no account and sets no password |
| `apps/qa/` | QA API: `contract.py` (SSE contract, single source) · `serializers.py` · `models.py` (`Conversation`, `Message`, history window) · `conversations.py` (the chain's only ORM access) · `engine.py` (process-wide models + serial `stream_answer()`, reusing `rag/`, zero queries) · `views.py` (HTTP, SSE framing, when the answer is stored) · `conversation_views.py` · `sources.py` (which corpus PDF a sha256 names) · `source_views.py` · `urls.py` · `admin.py` |
| `apps/catalog/` | The university catalogue: `models.py` (`DegreeProgramme`, `Course`, `CourseEdition`, `CurriculumEntry`, and the database constraints that keep them consistent) · `editions.py` (`with_current()`, which works out a course's current edition from its editions' teaching starts) · `admin.py` (the four tables) · `serializers.py` · `views.py` (the catalogue API) · `staff_views.py` (teachers and secretariat staff under their scope) · `invitation_views.py` and `invitation_serializers.py` (the invitations under each scope, and every scope's for the superuser) · `content_views.py` and `content_serializers.py` (an edition's syllabus and reading list) · `urls.py` · `migrations/` |
| `apps/roles/` | Staff roles: `registry.py` (the roles and their permissions, in code) · `models.py` (`RoleAssignment`, one role on one scope, and the constraints that make the two fit; `Invitation`, one role on one scope offered) · `scopes.py` (the one place that says which role covers which scope) · `backends.py` (`user.has_perm` on a scope) · `api.py` (the DRF permission and the base view that resolves a scope first) · `grants.py` (granting and revoking, logged) · `invitations.py` (an invitation to a role, made by whoever may grant it and accepted once, as a grant of theirs) · `admin.py` (where the superuser grants and revokes roles) · `management/commands/populate_demo.py` (the demo seed, with `demo_catalog.json` and `demo_content.json`, its data read from the Cineca catalogue) · `migrations/` |
| `rag/` | The RAG pipeline — **must never import Django**, so the thesis core runs and is evaluated without the web. `probe` · `parse` · `crawl` · `webparse` · `chunk` · `index` · `search` · `llm` (OpenAI-compatible client, pydantic JSON validation) · `answer` · `agent` (routing, read-only control flow) · `live` (query-time fetch, relevance gate, writes to the shared index, rollback) · `snapshot` (the index's collections copied to the host, and restored on another server) · `gold` · `golddraft` (drafts gold questions for human review) |
| `frontend/` | React SPA: `src/api/` (contract mirror, the error codes' mirror, SSE parser, CSRF-aware requests and the one `ApiError` a refusal becomes, account, conversation and catalogue calls, the link to a cited PDF page) · `src/auth/` (session context, route guards, who may open the staff pages and who teaches) · `src/routes/` (login, register, the forgotten password, the reset link's and the invitation's pages, styleguide; the layout route the chat, the account's page and the staff pages share, `ShellLayout.tsx`, and the column every one but the chat sits in, `PageLayout.tsx`; the chat, the account's page and each staff page) · `src/features/chat/` (question state machine, turn rendering: the process line, the answer with its source pills, the copy button and the sources panel; the signed-in shell: its sidebar, rail, drawer and keys) · `src/features/entry/` (the entry screen, its caption and its intro) · `src/features/account/` (the account page's parts: the password change, the devices and the name read from each one's browser, the dialog that asks for the password again) · `src/features/staff/` (the Gestione group and where `/staff` lands, the breadcrumb and its area, the page head, the study plan's rules and its table, the people rows, the row marked on coming back with Back, a teacher's editions not over, the assign and revoke dialogs, refusals by code; `content/`, an edition's syllabus edited in place and its reading list) · `src/components/` (the account menu, the settings and shortcuts dialogs, the password field and the refusals of a form that sets one, `Mascot.tsx`, the living cat `LivingMascot.tsx` and its behaviour; `ui/` shadcn-style primitives) · `src/brand/` (the cat's one drawing) · `src/lib/` (citation markers, the reduced-motion hook, a refusal read into the catalogue's sentences) · `src/theme/` · `src/i18n/` (three catalogues) · `src/test/` · `scripts/` (catalogue and contrast gates, the palette they share with `DESIGN.md`'s generator and check, the writer of the brand files) · `brand/` (the cat's SVGs, how to use them, their provenance, CC0) · `public/` (fonts, icons, manifest, link-preview image) · `e2e/` (the browser tests: the API answered in the browser, its typed fixtures, every screen and who opens it, one spec per floor) and `playwright.config.ts` · `journeys/` (the browser tests against the real site: the demo accounts signed in once, an account of a test's own, one spec per area) and `playwright.journeys.config.ts` |
| `scripts/` | `check.py`, the check chain |
| `tests/` | pytest. `test_smoke.py` guards the `rag/` boundary and the Django configuration; `test_qa_contract.py`, `test_catalog_contract.py` and `test_admin_contract.py` the API's shapes and their mirrors; `test_error_contract.py` the error codes, their mirror and `docs/api.md`'s tables, and `test_error_handler.py` how each error is answered and logged; `test_check_script.py` the chain and the workflow that calls it; `test_qa_engine.py` and `test_spa.py` carry no `django_db`, so pytest-django fails them if they touch the database · `journeys/`, no tests of its own: the site the journeys run against, its settings, its stub retrieval and its fake model |
| `gold/` | Gold question sets; schema in [gold/README.md](../gold/README.md) |
| `docs/` | One topic per file: decisions, architecture, development (this file), the HTTP API, the security review, the data model, the Docling pipeline, the web source, RAG analysis, the experiment log, the test suite's rules |
| `.github/` | `workflows/ci.yml` (the check chain, and the browser tests), `workflows/dependencies.yml` (dependency review and audit), `workflows/secrets.yml` (gitleaks), `renovate.json` (version updates) · `dependabot.yml` (security updates) · `SECURITY.md` (how to report a vulnerability; the review is `docs/security.md`) · `assets/` (the README's screenshot). The code of conduct, the contributing guide, the issue forms and the pull request template are the account's defaults, from the Zhengjunliang/.github repository (outside the repository) |
| `data/` | Course material and everything derived from it (parsed output and chunks; the index lives in the `qdrant-data` compose volume, its snapshots in `data/snapshots/`): gitignored, **never** in git |

## Working on the MICC servers

Access and hardware are in [docs/architecture.md](architecture.md). SSH aliases live in the local `~/.ssh/config` (`ssh targaryen` and so on).

**Starting.** Check the GPU dashboard (Grafana / Discord `#gpu-monitoring-dream-`) and pick a machine with **free VRAM and low CPU**; day to day that is a 2080 Ti machine, and ultron (24 GB) only when an experiment needs the memory. Confirm with `nvidia-smi` after logging in and pin a free card with `CUDA_VISIBLE_DEVICES=<id>`. `ssh -o ServerAliveInterval=30 <server>` keeps an idle session from being dropped. Long jobs go in tmux (`tmux new -s tesi`, reattach with `tmux attach -t tesi`), or under `nohup` with their output in a log where tmux cannot create its socket: on 2026-10-26 ultron's root filesystem was mounted read-only, and `/tmp` with it.

**Storage.** Model caches and datasets go on the NAS home, **not the server's local `/home`** (small, and shared by everyone; ultron's had 12 GB free on 2026-10-26). The NAS volumes `/andromeda` `/equilibrium` `/fishtank` `/oblivion` are mounted on every server, and personal directories differ per volume: `/oblivion/users/<user>` has `users/`, `/equilibrium/<user>` does not, andromeda and fishtank have none (ask the sysadmin). Check free space before choosing a volume; this project uses `/oblivion/users/jzheng`, and these lines at the end of the server's `~/.bashrc` send every cache, uv's Python, its virtual environments and temporary files there:

```bash
export XDG_CACHE_HOME=/oblivion/users/jzheng/.cache
export HF_HOME=/oblivion/users/jzheng/hf_cache
export UV_CACHE_DIR=/oblivion/users/jzheng/uv_cache
export UV_PYTHON_INSTALL_DIR=/oblivion/users/jzheng/uv_python
export UV_PYTHON_BIN_DIR=/oblivion/users/jzheng/bin
export TRITON_CACHE_DIR=/oblivion/users/jzheng/.triton
export TMPDIR=/oblivion/users/jzheng/tmp
export VLLM_RPC_BASE_PATH=/dev/shm       # vLLM's process sockets stay off NFS
export VLLM_NO_USAGE_STATS=1
export HF_HUB_DISABLE_TELEMETRY=1
export UV_NO_SYNC=1                      # uv run keeps the CUDA torch (Serving the index)
export PATH=/oblivion/users/jzheng/bin:$PATH   # uv, installed with UV_INSTALL_DIR there
```

On ultron the system `gcc` (gcc-11) stops with "internal compiler error: Illegal instruction" on any input, and Triton compiles its kernel launchers with the compiler `CC` names, so ultron's `~/.bashrc` also exports `CC=gcc-12`. Shared datasets are under `/<volume>/DATASETS`, `/<volume>/datasets` or `/home/DATASETS` (naming differs per machine); datasets in a personal directory get cleaned up by the NAS rules.

**Serving the LLM.** vLLM pins its own torch, so it gets a virtual environment of its own, and the project reaches it over HTTP only. PyPI's `vllm` 0.32.0 is built for CUDA 13, which needs driver 580 or later; ultron's driver is 535, so the wheel is the release page's `+cu129` build:

```bash
uv venv /oblivion/users/jzheng/venvs/vllm --python 3.12
uv pip install --python /oblivion/users/jzheng/venvs/vllm/bin/python "https://github.com/vllm-project/vllm/releases/download/v0.32.0/vllm-0.32.0+cu129-cp38-abi3-manylinux_2_28_x86_64.whl" --torch-backend=cu129
REV=$(curl -s https://huggingface.co/api/models/Qwen/Qwen3-4B-Instruct-2507 | python3 -c "import json,sys;print(json.load(sys.stdin)['sha'])")
(umask 077; openssl rand -hex 16 > ~/.vllm_key)
VLLM_API_KEY=$(cat ~/.vllm_key) CUDA_VISIBLE_DEVICES=0 nohup /oblivion/users/jzheng/venvs/vllm/bin/vllm serve Qwen/Qwen3-4B-Instruct-2507 \
  --revision "$REV" --tokenizer-revision "$REV" --dtype float16 --host 127.0.0.1 --port 8417 \
  --max-model-len 16384 --gpu-memory-utilization 0.55 --seed 0 > ~/vllm.log 2>&1 &
```

The server listens on loopback because the MICC servers answer from the internet, and checks a key because every user of the server reaches its loopback port. The key travels in `VLLM_API_KEY`, not `--api-key`: `ps` shows any process's command line to every user. A first start compiles kernels for about three minutes into the caches above, and a restart takes about 80 s ([experiment-log.md](experiment-log.md), entry of 2026-10-26). On the laptop, a tunnel and three lines of `.env` (`.env.example` names them) point the project at it, with no change to the code:

```bash
ssh -o ServerAliveInterval=30 -N -L 8100:127.0.0.1:8417 ultron
```

**Serving the index.** Formal experiments retrieve on the server, from a Qdrant server of the laptop's version holding a restore of the laptop's snapshot (`snapshot` in the table of the pipeline CLI section). Qdrant does not run on network file systems and `/oblivion` is NFS, so its storage lives in `/dev/shm`, in memory: a reboot empties it, and the snapshot on `/oblivion` is restored again. The release page's gnu build of 1.19.1 needs glibc 2.38, which ultron (2.35) lacks, so the binary is the static musl build. Its configuration is environment variables, the key among them, so that no command line shows it. From the laptop, at the repository root:

```bash
tar -C data/snapshots -cf - <time> | ssh ultron "mkdir -p /oblivion/users/jzheng/snapshots && tar -C /oblivion/users/jzheng/snapshots -xf -"
```

On the server (the SHA-256 is the release page's digest for the asset):

```bash
mkdir -p /oblivion/users/jzheng/qdrant && cd /oblivion/users/jzheng/qdrant
curl -fsSLO https://github.com/qdrant/qdrant/releases/download/v1.19.1/qdrant-x86_64-unknown-linux-musl.tar.gz
echo "70a40529e2ebe0a2787d574d3a2e28437cfe94f26f24fa419f6ac57b4ae817c9  qdrant-x86_64-unknown-linux-musl.tar.gz" | sha256sum -c - && tar -xzf qdrant-x86_64-unknown-linux-musl.tar.gz
[ -f ~/.qdrant_key ] || (umask 077; openssl rand -hex 32 > ~/.qdrant_key)
D=/dev/shm/jzheng-qdrant; mkdir -p -m 700 $D; [ -O $D ] || echo "$D belongs to another user"
QDRANT__SERVICE__HOST=127.0.0.1 QDRANT__SERVICE__API_KEY=$(cat ~/.qdrant_key) QDRANT__TELEMETRY_DISABLED=true \
  QDRANT__STORAGE__STORAGE_PATH=$D/storage QDRANT__STORAGE__SNAPSHOTS_PATH=$D/snapshots QDRANT__STORAGE__TEMP_PATH=$D/tmp \
  nohup ./qdrant > qdrant.log 2>&1 < /dev/null &
sleep 3; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:6333/collections   # 401, or stop

git clone https://github.com/Zhengjunliang/multilingual-course-assistant.git /oblivion/users/jzheng/multilingual-course-assistant
cd /oblivion/users/jzheng/multilingual-course-assistant
uv sync --locked --no-dev
uv pip install "torch==<torch>+cu126" "torchvision==<torchvision>+cu126" --torch-backend=cu126
uv run python -m rag.snapshot --restore /oblivion/users/jzheng/snapshots/<time>
CUDA_VISIBLE_DEVICES=0 uv run python -m rag.gold gold/smoke.jsonl
```

The lockfile gives Linux the CPU build of torch (`pyproject.toml`, `[tool.uv.sources]`), so the CUDA build of the versions `pyproject.toml` pins goes over it: cu126, the laptop's, which driver 535 runs through CUDA's minor-version compatibility. The local version `+cu126` is part of the requirement because the CPU build that `uv sync` installed meets `torch==<torch>`. `UV_NO_SYNC=1`, among the `~/.bashrc` lines above, keeps every `uv run`, in every session, from syncing the CPU build back, under which the models would run on the CPU without an error. Another user's Qdrant on port 6333 stops this one at start, which only `qdrant.log` reports; the request without the key gets `401` only from a server that checks a key, so `200` is another user's open server, which the restore would fill and send the key to, and `000` is no server at all. A restore refuses a server holding any of the collections; one that stopped halfway leaves those it finished, which `curl -X DELETE -H "api-key: $(cat ~/.qdrant_key)" http://127.0.0.1:6333/collections/<name>` removes before it runs again. The server's `.env` (created with `umask 077`) holds `QDRANT_URL=http://127.0.0.1:6333`, `QDRANT_API_KEY`, and any value for `DJANGO_SECRET_KEY` and `DJANGO_DB_PASSWORD`, which the settings require although no Django runs there; the three `LLM_*` lines name `http://127.0.0.1:8417/v1`, the vLLM above, with no tunnel.

**Finishing.** Check `nvidia-smi` for leftover processes of yours and `kill <PID>` them (`pkill -u $USER -f "vllm serve"` for the server above); Jupyter kernels hold GPU memory too. `pkill -u $USER -x qdrant` stops the index server; its storage stays in `/dev/shm` until a reboot, and the same start command serves it again. Close idle tmux sessions (`tmux kill-session -t tesi`). Release GPU memory when a run ends, and take the three lines out of the laptop's `.env` to go back to Ollama.

## CI

[.github/workflows/ci.yml](../.github/workflows/ci.yml) runs on pushes to `main` and on pull requests. Three jobs call the steps of `scripts/check.py` by name, side by side: `hooks` runs the `hooks` step with only the dev dependencies installed; `static` installs with `uv sync --locked` and `npm ci` — so `uv.lock` and `frontend/package-lock.json` are committed with every dependency change — and runs `frontend`, `types` and `deploy`; `tests` installs with `uv sync --locked`, starts PostgreSQL and runs `tests`. [tests/test_check_script.py](../tests/test_check_script.py) fails if any of the three runs anything else, or a step goes missing, repeats or changes places. `hooks` and `tests` save their uv cache from `main` only, and `static` restores the one `tests` saves. A fourth job, `browser`, runs `npm run e2e` (section *Frontend*) with neither Python nor PostgreSQL installed, and uploads the traces of the tests that failed; a fifth, `journeys`, runs `npm run e2e:journeys` with both, restoring the uv cache `tests` saves, and uploads its own. [.github/workflows/dependencies.yml](../.github/workflows/dependencies.yml) checks the dependencies in two layers: on a pull request, `dependency-review` fails on a vulnerable version the change brings in; on `main`, weekly and by hand, `audit` runs pip-audit over the lockfile's Linux resolution and `npm audit --omit=dev`, and blocks nothing. [.github/workflows/secrets.yml](../.github/workflows/secrets.yml) runs gitleaks over a pull request's commits, and over the whole history weekly. The `main` ruleset requires `hooks`, `static`, `tests`, `browser`, `journeys`, `gitleaks` and `dependency-review`: each judges only what the pull request brings, which is why `audit`, red whenever an advisory appears overnight, runs apart and blocks nothing. Dependency updates arrive as Renovate pull requests ([.github/renovate.json](../.github/renovate.json), over the account's preset in Zhengjunliang/.github, outside the repository): once a month, each version at least seven days old, minor and patch updates in one pull request, each major in its own, and `frontend/package-lock.json` refreshed in another. The measured pipeline that `pyproject.toml` pins with `==` waits in one draft pull request, merged in the session that re-measures. Security fixes are Dependabot's, at once and for transitive packages too ([.github/dependabot.yml](../.github/dependabot.yml)); before merging one that touches the measured pipeline, compare the parse and BM25 output of a few documents before and after.

## Language

Which language each part of the repository is written in: [CLAUDE.md](../CLAUDE.md), section on documentation conventions.
