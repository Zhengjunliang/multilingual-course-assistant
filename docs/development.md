# Development

This file owns working on the repository: setting it up for development, the daily commands, the check chain, the frontend, the pipeline CLI, the code layout, the MICC servers and CI. Running the site once is the first screen of [README.md](../README.md); the HTTP API is [api.md](api.md).

## Setup

The first screen of [README.md](../README.md) installs and runs the site: uv brings its own Python 3.12 and leaves the system interpreter untouched, Node's version is in `frontend/.nvmrc`, `.env.example` holds the command that generates `DJANGO_SECRET_KEY` and leaves `DJANGO_DB_PASSWORD` for you to pick, and `docker compose` needs the Docker Desktop engine running. To develop, two more commands in the clone:

```powershell
uv run pre-commit install        # the commit and commit-message hooks; rerun it in a clone from before 2026-09-28
git config pull.rebase true      # history is linear: a pull rebases onto main instead of merging it
```

`docker-compose.yml` starts only the stateful services: Django runs on the host under `uv run`, because the embedding model and reranker in `rag/` use the local GPU. The fully containerised path is 🔜 `#41` (M6); the convention is described at the top of `docker-compose.yml`.

## Daily loop

| To | Run |
| -- | --- |
| start / stop PostgreSQL and Qdrant | `docker compose up -d` / `docker compose down` (data stays in the named volumes; `down -v` deletes both, the index and the pages fetched live that exist nowhere else included, irreversibly) |
| serve the site | `uv run python manage.py runserver` → <http://127.0.0.1:8000/> (admin at `/admin/`, superusers only) |
| work on the frontend | the above, plus `npm run dev --prefix frontend` → <http://localhost:5173/> |
| fill in the demo: two real programmes, their courses in two academic years, and `demo-` accounts holding each role | `uv run python manage.py populate_demo`; set `DEMO_PASSWORD` in `.env` first to log in as them. Safe to rerun: it adds what is missing, keeps the rows it finds, and resets the `demo-` accounts' roles to its data file. Every `demo-` account shares that password, `demo-admin` included, so switch `demo-admin` off in the admin on a site others can reach; a rerun leaves it off |
| run the tests quickly | `uv run pytest` |
| run everything CI runs | `uv run python scripts/check.py` |
| query or build an embedded index instead (tests, a machine without Docker) | `--qdrant <directory>` on any `rag` command that opens the index; one process holds it at a time |

A test is added, changed or deleted by the criteria of [docs/testing.md](testing.md), which also lists the tests kept whatever the criteria say.

**Changing a model** means regenerating the app's migration and rebuilding the local database, or the suite goes red (`test_no_pending_migrations` in `tests/test_accounts.py`). Until a database has to keep its data, each app has one migration, `0001_initial.py`, rewritten on every change rather than followed by a `0002` ([docs/decisions.md](decisions.md), 2026-09-26). Save the data **before** editing the model — `dumpdata` reads every column the model declares, so it fails once the model is ahead of the database — then run the rest one line at a time, stopping at the first that fails: the `docker compose rm` line deletes the local database.

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

## The check chain

[scripts/check.py](../scripts/check.py) is the one definition of what "green" means, locally and in CI. Without arguments it runs every step in order; with names it runs only those, in chain order:

```powershell
uv run python scripts/check.py               # all five steps
uv run python scripts/check.py hooks types   # only these two
```

| Step | Runs |
| ---- | ---- |
| `hooks` | every hook of `.pre-commit-config.yaml` except `uv-lock`, over every tracked file: file hygiene, `detect-private-key`, ruff lint and format, typos, and the repository's own guards, each named with its rule in `CLAUDE.md`, section 5 |
| `frontend` | biome, `tsc`, catalogue keys, colour contrast, vitest, production build |
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

Five routes: `/login` · `/register` · `/` (new conversation) · `/c/:id` (a stored one) · `/styleguide` (the component layer against no data); any other path outside `/staff` redirects to `/`. The chat and the staff pages share one frame, [frontend/src/routes/ShellLayout.tsx](../frontend/src/routes/ShellLayout.tsx), whose sidebar shows the superuser and whoever holds a role a "Gestione" group above the conversations: `/staff/programmes` (the programmes in scope) · `/staff/programmes/:code` (a programme's study plan and its secretariat) · `/staff/courses/:code` (a course's study plans and editions, `?programme=<code>` naming the programme it was reached through) · `/staff/editions/:id` (an edition and its teachers) · `/staff/mine` (a teacher's own editions). `/staff` lands on the account's first Gestione item ([docs/decisions.md](decisions.md), 2026-10-05, *The staff pages live in the chat shell*, point 1), an unknown `/staff/…` path says "not found" inside the shell, and an account with no role is sent to `/`. [config/urls.py](../config/urls.py) answers every path it does not own with the same shell, so a reload on `/c/7` works.

On 5173 the Vite dev server proxies `/api`, `/admin` and `/static` to port 8000 with `changeOrigin: false`, which keeps Django's CSRF origin check passing without `CSRF_TRUSTED_ORIGINS`. The reasons behind the frontend's other choices sit next to the code that makes them: session cookie and CSRF in [frontend/src/api/http.ts](../frontend/src/api/http.ts), no `EventSource` in [frontend/src/api/sse.ts](../frontend/src/api/sse.ts), citation markers in [frontend/src/lib/markers.ts](../frontend/src/lib/markers.ts), waiting and retries in [frontend/src/features/chat/](../frontend/src/features/chat/), themes in [frontend/src/theme/](../frontend/src/theme/) and [frontend/src/index.css](../frontend/src/index.css). [frontend/src/api/contract.ts](../frontend/src/api/contract.ts) mirrors [apps/qa/contract.py](../apps/qa/contract.py), which is the single source; [tests/test_qa_contract.py](../tests/test_qa_contract.py) fails when the two drift. [frontend/src/api/catalog.ts](../frontend/src/api/catalog.ts) mirrors the serializers of [apps/catalog/serializers.py](../apps/catalog/serializers.py) the same way, checked by [tests/test_catalog_contract.py](../tests/test_catalog_contract.py).

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
| `config/` | Django project: `settings.py` (security headers conditional on `DEBUG` and `DJANGO_BEHIND_TLS`) · `urls.py` (with the SPA fallback) · `views.py` (the one non-API view, the SPA shell) · `admin.py` and `apps.py` (the admin site, which admits superusers only) · `exceptions.py` (error bodies whose messages carry codes, for the views that mix in `CodedErrors`) · `env.py` (`.env` through pydantic-settings, shared by `rag/` and Django) · asgi/wsgi |
| `apps/accounts/` | Accounts: custom `User` = `AbstractUser` + `locale` · serializers for register, login and the account · session login and the CSRF cookie in `views.py` · `urls.py` · `admin.py` |
| `apps/qa/` | QA API: `contract.py` (SSE contract, single source) · `serializers.py` · `models.py` (`Conversation`, `Message`, history window) · `conversations.py` (the chain's only ORM access) · `engine.py` (process-wide models + serial `stream_answer()`, reusing `rag/`, zero queries) · `views.py` (HTTP, SSE framing, when the answer is stored) · `conversation_views.py` · `sources.py` (which corpus PDF a sha256 names) · `source_views.py` · `urls.py` · `admin.py` |
| `apps/catalog/` | The university catalogue: `models.py` (`DegreeProgramme`, `Course`, `CourseEdition`, `CurriculumEntry`, and the database constraints that keep them consistent) · `editions.py` (`set_current()`, the one way to change a course's current edition) · `admin.py` (the four tables, and the `set_as_current` action that switches an edition through `set_current()`) · `serializers.py` · `views.py` (the catalogue API) · `staff_views.py` (teachers and secretariat staff under their scope) · `errors.py` (the refusal codes a staff page translates) · `urls.py` · `migrations/` |
| `apps/roles/` | Staff roles: `registry.py` (the roles and their permissions, in code) · `models.py` (`RoleAssignment`, one role on one scope, and the constraints that make the two fit) · `scopes.py` (the one place that says which role covers which scope) · `backends.py` (`user.has_perm` on a scope) · `api.py` (the DRF permission and the base view that resolves a scope first) · `grants.py` (granting and revoking, logged) · `admin.py` (where the superuser grants and revokes roles) · `management/commands/populate_demo.py` (the demo seed, and `demo_catalog.json`, its data read from the Cineca catalogue) · `migrations/` |
| `rag/` | The RAG pipeline — **must never import Django**, so the thesis core runs and is evaluated without the web. `probe` · `parse` · `crawl` · `webparse` · `chunk` · `index` · `search` · `llm` (OpenAI-compatible client, pydantic JSON validation) · `answer` · `agent` (routing, read-only control flow) · `live` (query-time fetch, relevance gate, writes to the shared index, rollback) · `gold` · `golddraft` (drafts gold questions for human review) |
| `frontend/` | React SPA: `src/api/` (contract mirror, SSE parser, CSRF-aware requests, account, conversation and catalogue calls, the link to a cited PDF page) · `src/auth/` (session context, route guards, who may open the staff pages and who teaches) · `src/routes/` (login, register, styleguide; the layout route the chat and the staff pages share, `ShellLayout.tsx`, the chat and each staff page) · `src/features/chat/` (question state machine, turn rendering) · `src/features/staff/` (the Gestione group and where `/staff` lands, the breadcrumb, the study plan's rules and its table, the assign, revoke and switch dialogs, refusals by code) · `src/components/` (account dialog and menu; `ui/` shadcn-style primitives) · `src/lib/markers.ts` · `src/theme/` · `src/i18n/` (three catalogues) · `src/test/` · `scripts/` (catalogue and contrast gates) · `public/fonts/` |
| `scripts/` | `check.py`, the check chain |
| `tests/` | pytest. `test_smoke.py` guards the `rag/` boundary and the Django configuration; `test_qa_contract.py` and `test_catalog_contract.py` the API's shapes and their mirrors; `test_check_script.py` the chain and the workflow that calls it; `test_qa_engine.py` and `test_spa.py` carry no `django_db`, so pytest-django fails them if they touch the database; `test_catalog_editions.py` holds the only test that runs with `transaction=True`, two threads switching one course's edition at once |
| `gold/` | Gold question sets; schema in [gold/README.md](../gold/README.md) |
| `docs/` | One topic per file: decisions, architecture, development (this file), the HTTP API, the security review, the data model, the Docling pipeline, the web source, RAG analysis, the experiment log, when a test may be deleted |
| `.github/` | `workflows/ci.yml` (the check chain + dependency audit), `workflows/secrets.yml` (gitleaks), `dependabot.yml` · `SECURITY.md` (how to report a vulnerability; the review is `docs/security.md`). The code of conduct, the contributing guide, the issue forms and the pull request template are the account's defaults, from the Zhengjunliang/.github repository (outside the repository) |
| `data/` | Course material and everything derived from it (parsed output and chunks; the index lives in the `qdrant-data` compose volume): gitignored, **never** in git |

## Working on the MICC servers

Access and hardware are in [docs/architecture.md](architecture.md). SSH aliases live in the local `~/.ssh/config` (`ssh targaryen` and so on).

**Starting.** Check the GPU dashboard (Grafana / Discord `#gpu-monitoring-dream-`) and pick a machine with **free VRAM and low CPU**; day to day that is a 2080 Ti machine, and ultron (24 GB) only when an experiment needs the memory. Confirm with `nvidia-smi` after logging in and pin a free card with `CUDA_VISIBLE_DEVICES=<id>`. Long jobs go in tmux: `tmux new -s tesi`, reattach with `tmux attach -t tesi`.

**Storage.** Model caches and datasets go on the NAS home, **not the server's local `/home`** (small, and shared by everyone). The NAS volumes `/andromeda` `/equilibrium` `/fishtank` `/oblivion` are mounted on every server, and personal directories differ per volume: `/oblivion/users/<user>` has `users/`, `/equilibrium/<user>` does not, andromeda and fishtank have none (ask the sysadmin). Check free space before choosing a volume; this project uses `/oblivion/users/jzheng`, with `export HF_HOME=/oblivion/users/jzheng/hf_cache` in the server's `~/.bashrc`. Shared datasets are under `/<volume>/DATASETS`, `/<volume>/datasets` or `/home/DATASETS` (naming differs per machine); datasets in a personal directory get cleaned up by the NAS rules.

**Finishing.** Check `nvidia-smi` for leftover processes of yours and `kill <PID>` them; Jupyter kernels hold GPU memory too. Close idle tmux sessions (`tmux kill-session -t tesi`). Release GPU memory when a run ends.

## CI

[.github/workflows/ci.yml](../.github/workflows/ci.yml) runs on pushes to `main` and on pull requests. Two jobs call the steps of `scripts/check.py` by name, side by side: `hooks` runs the `hooks` step with only the dev dependencies installed, and `check` installs with `uv sync --locked` and `npm ci` — so `uv.lock` and `frontend/package-lock.json` are committed with every dependency change — and runs the rest; [tests/test_check_script.py](../tests/test_check_script.py) fails if either job runs anything else, or a step goes missing, repeats or changes places. The `audit` job runs pip-audit over the lockfile and `npm audit --omit=dev`, and [.github/workflows/secrets.yml](../.github/workflows/secrets.yml) scans the whole history with gitleaks weekly. Dependency updates arrive as monthly Dependabot pull requests ([.github/dependabot.yml](../.github/dependabot.yml)).

## Language

Which language each part of the repository is written in: [CLAUDE.md](../CLAUDE.md), section on documentation conventions.
