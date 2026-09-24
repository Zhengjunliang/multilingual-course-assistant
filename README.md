# multilingual-course-assistant

Question answering over two sources: **university course material** (slides and lecture-note PDFs) and **campus information** (the UniFi website as a second knowledge source, with agentic routing between the two). **Cross-lingual retrieval is the core of both, not an add-on**: a question in any language is answered in that language, and the question need not share a language with the material (an English question over Italian slides). The scope is retrieval QA; generating or grading exercises is ⛔ out of scope. RAG over open-weights LLMs (the Qwen family); the website is a Django/DRF backend with a React SPA in front.

Bachelor's thesis (*triennale*), University of Florence (UniFi), Information Engineering — supervisor Prof. Marco Bertini.

Where the rest lives: progress, milestones and blockers in GitHub issues (milestones M3 · M5 · M6 · M7); decisions and their reversals in [docs/decisioni.md](docs/decisioni.md); supervisor constraints and the stack in [docs/architettura.md](docs/architettura.md); measured results in [docs/diario-sperimentale.md](docs/diario-sperimentale.md).

## Setup

```powershell
git clone git@github.com:Zhengjunliang/multilingual-course-assistant.git
cd multilingual-course-assistant
uv sync                          # uv brings its own Python 3.12; the system interpreter is untouched
npm ci --prefix frontend         # Node version in frontend/.nvmrc
Copy-Item .env.example .env      # fill DJANGO_SECRET_KEY and DJANGO_DB_PASSWORD; commands in the file
uv run pre-commit install
docker compose up -d             # PostgreSQL (the Docker Desktop engine has to be running)
uv run python manage.py migrate
uv run python manage.py createsuperuser
```

`docker-compose.yml` starts only the stateful services: Django runs on the host under `uv run`, because the embedding model and reranker in `rag/` use the local GPU. The fully containerised path is 🔜 `#41` (M6); the convention is described at the top of `docker-compose.yml`.

## Development

### Daily loop

| To | Run |
| -- | --- |
| start / stop PostgreSQL | `docker compose up -d` / `docker compose down` (data stays in the named volume; `down -v` deletes it, irreversibly) |
| serve the site | `uv run python manage.py runserver` → <http://127.0.0.1:8000/> (admin at `/admin/`) |
| work on the frontend | the above, plus `npm run dev --prefix frontend` → <http://localhost:5173/> |
| run the tests quickly | `uv run pytest` |
| run everything CI runs | `uv run python scripts/check.py` |

**While the site is running, the `rag` CLIs that touch the index fail** (`rag.index`, `rag.search`, `rag.agent`, …): local Qdrant is embedded and holds an exclusive lock on `data/qdrant`, so whichever process opens it first keeps it; the endpoints answer 503 with that explanation in the opposite case. Stop the server with `Ctrl+C` to use the CLI. 🔜 This goes away when Qdrant becomes a service (`#33`).

**After changing a model**, generate and apply the migration, or the suite goes red (`test_no_pending_migrations` in `tests/test_accounts.py`):

```powershell
uv run python manage.py makemigrations   # the migration file goes into git
uv run python manage.py migrate
```

### The check chain

[scripts/check.py](scripts/check.py) is the one definition of what "green" means, locally and in CI. Without arguments it runs every step in order; with names it runs only those, still in chain order:

```powershell
uv run python scripts/check.py              # all eight steps
uv run python scripts/check.py lint types   # only these two
```

| Step | Runs |
| ---- | ---- |
| `frontend` | biome, `tsc`, catalogue keys, colour contrast, vitest, production build |
| `lint` · `format` · `types` | `ruff check` · `ruff format --check` · `pyright` |
| `django` · `migrations` · `deploy` | `manage.py check` · `makemigrations --check` · `check --deploy --fail-level WARNING` |
| `tests` | `pytest --cov`, with the coverage gate |

The chain runs with `DJANGO_DEBUG=false` whatever `.env` says, because that is how CI tests. Why each step is where it is — `frontend` first, the TLS flag only on `deploy` — is written next to the step in the script. Interrupting the `frontend` step on Windows makes `cmd` ask `Terminate batch job (Y/N)?`: answer `Y`.

## Frontend

React + TypeScript SPA built with Vite, Tailwind and shadcn-style components (their source lives in the repository), UI text in three languages through react-i18next.

| To | Run | Open |
| -- | --- | ---- |
| work on the frontend | `runserver`, plus `npm run dev --prefix frontend` in a second terminal | <http://localhost:5173/> — reloads on save |
| see the site as it ships | `npm run build --prefix frontend` once, then `runserver` | <http://127.0.0.1:8000/> — same origin, one process |

The second row is what the site really is: Django serves `frontend/dist/index.html` at the root and the bundle under `/static/`, with no Vite involved — so a frontend change needs a rebuild before port 8000 shows it. Without a build that address answers 503 and names the command. With `DEBUG=False` Django refuses to serve static files; the static file server for deployment is 🔜 `#40`.

Five routes: `/login` · `/register` · `/` (new conversation) · `/c/:id` (a stored one) · `/styleguide` (the component layer against no data); anything else redirects to `/`. [config/urls.py](config/urls.py) answers every path it does not own with the same shell, so a reload on `/c/7` works.

On 5173 the Vite dev server proxies `/api`, `/admin` and `/static` to port 8000 with `changeOrigin: false`, which keeps Django's CSRF origin check passing without `CSRF_TRUSTED_ORIGINS`. The reasons behind the frontend's other choices sit next to the code that makes them: session cookie and CSRF in [frontend/src/api/http.ts](frontend/src/api/http.ts), no `EventSource` in [frontend/src/api/sse.ts](frontend/src/api/sse.ts), citation markers in [frontend/src/lib/markers.ts](frontend/src/lib/markers.ts), waiting and retries in [frontend/src/features/chat/](frontend/src/features/chat/), themes in [frontend/src/theme/](frontend/src/theme/) and [frontend/src/index.css](frontend/src/index.css). [frontend/src/api/contract.ts](frontend/src/api/contract.ts) mirrors [apps/qa/contract.py](apps/qa/contract.py), which is the single source; [tests/test_qa_contract.py](tests/test_qa_contract.py) fails when the two drift.

## Pipeline CLI

Course PDFs go in `data/corpus/<course>/` (gitignored). Every command below is `uv run python -m rag.<module> …`:

| Module | Does | Example arguments |
| ------ | ---- | ----------------- |
| `probe` | profile PDFs and show the per-file routing, without parsing | `data\corpus\PPM` |
| `parse` | parse with Docling following that routing → `data\parsed\` | `data\corpus\PPM` · `"<file>.pdf" --profile manual --pipeline vlm` |
| `chunk` | chunk parsed documents → `data\chunks\*.jsonl` | `data\parsed` |
| `index` | encode into the local Qdrant collection → `data\qdrant\` | `data\chunks` |
| `search` | hybrid retrieval (dense + BM25 + RRF) + Qwen3 reranker | `"What is an ORM?"` |
| `answer` | retrieve + generate a cited answer | `"What is an ORM?"` |
| `agent` | route to course or campus collection, retrieve, answer; deepens by fetching linked pages unless `--no-deepen` | `"Quando scadono le tasse?"` |
| `gold` | retrieval hit@k over a gold set, or the router's report with `--routing` | `gold\smoke.jsonl` · `gold\campus.jsonl --routing` |
| `crawl` | snapshot the campus website (robots honoured, 1 req/s, ≤ 500 pages; run by the user) | `--out data\webcorpus` |
| `webparse` | parse a crawl snapshot into chunkable artefact pairs | `data\webcorpus\<run_id>` |
| `live` | fetch one URL, gate it, grow the shared index; `--rollback <run_id>` undoes a run, `--measure-gate` scores the gate | `<url>` |

Parsing writes two files per PDF, `<name>.<profile>.json` (the lossless DoclingDocument) and `<name>.<profile>.meta.json` (provenance); routing rules, measurements and the chunk payload contract are in [docs/docling-e-pipeline.md](docs/docling-e-pipeline.md).

Embedding and reranking (0.6B each) run on the local GPU, fully offline. Generation calls an OpenAI-compatible endpoint, by default a local Ollama:

```powershell
winget install Ollama.Ollama
ollama pull qwen3:4b-instruct-2507-q4_K_M
```

The endpoint and model are `LLM_BASE_URL` and `LLM_MODEL` in `.env`; the M3 experiments point them at vLLM on MICC through an SSH tunnel (the commented lines in `.env.example`). The reasons for this split are in [docs/architettura.md](docs/architettura.md), section on compute strategy.

## Accounts

Every endpoint needs a session except `GET /api/auth/me`, `login` and `register`, and that includes `POST /api/ask`. The reason is state, not secrecy (the corpus is course material): a conversation belongs to someone, an anonymous caller has no one to attribute it to, and handing out temporary identities would be a second, weaker account system built alongside the first.

| Method and path | Does |
| --------------- | ---- |
| `GET /api/auth/me` | who am I — **200 even when logged out**, with `{"authenticated": false}`; also sets the CSRF cookie |
| `PATCH /api/auth/me` | change the interface language (`locale` is the only writable field) |
| `POST /api/auth/login` | username + password → session cookie |
| `POST /api/auth/logout` | end the session (204) |
| `POST /api/auth/register` | open self-registration, logged in on success (201) |

`me` answers 200 rather than 403 when nobody is logged in because with `SessionAuthentication` alone DRF answers unauthenticated calls with 403 — and a failed CSRF check is also 403. Making "nobody is logged in" a normal result leaves 403 one meaning: this request was refused. Throttling is per endpoint (`ask` 4/min per account, `auth` 5/min per address) with no global cap; the reasons are next to the rates in [config/settings.py](config/settings.py).

## Question-answering API

`POST /api/ask` is the same chain as `rag.agent` over HTTP — route, retrieve, generate — and it answers with a **server-sent event stream**, not a JSON body: one answer takes tens of seconds, and streaming is how the reader sees the system working. It needs what the CLI needs (Ollama running, `data/qdrant` indexed) plus the server and an account.

```powershell
$json = @{ question = "What is an ORM?" } | ConvertTo-Json
[System.IO.File]::WriteAllText("$PWD\ask.json", $json, (New-Object System.Text.UTF8Encoding $false))
curl.exe -N -u <username>:<password> -X POST http://127.0.0.1:8000/api/ask `
  -H "Content-Type: application/json" -H "Accept: text/event-stream" `
  --data-binary "@ask.json"
```

- `-N` stops curl from buffering the stream into one block.
- `-u` is HTTP Basic, which is enabled only with `DJANGO_DEBUG=true` ([config/settings.py](config/settings.py)); the browser uses the session cookie.
- **The question goes through a file, not `-d`**, even an English one: PowerShell converts arguments to the console code page on the way to a native program, and `学费` or `Università` arrive as `?`. `WriteAllText` with a BOM-less `UTF8Encoding` is the one form that holds — in a multilingual project, a form that works only for the example is a wrong form.

The stream is `start` (route and citations, once, before generation) → `token` (a fragment of the answer, many times) → `end` (the answer is complete), or `error` in place of `end`. The answer is the concatenation of every `token`'s `text`. Events, fields, and why "was this cited?" is the client's to compute are defined in [apps/qa/contract.py](apps/qa/contract.py), the single source.

The first request takes about a minute while the models load into GPU memory. Answers are served one at a time — 8 GB cannot hold two concurrent rerank + generation passes — and a request that waits in the queue longer than 90 s gets a 503 with `Retry-After`. Closing the stream cancels the generation and frees the queue. A 503 carries `reason`: `busy` (worth retrying) or `unavailable` (the model server is down). Once the first event has gone out the status is 200 whatever happens, so a generation that dies midway is an `error` event.

## Multi-turn conversations

`POST /api/ask` takes an optional `conversation_id` to continue a conversation; without it a new one starts, and its id arrives in the `start` event.

| Method and path | Does |
| --------------- | ---- |
| `GET /api/conversations` | the sidebar list; titles derive from the first question, and conversations with no messages are not listed |
| `GET /api/conversations/<id>` | one conversation with its messages; someone else's is **404, not 403** — a 403 would confirm the id exists |

- The last 3 turns (`HISTORY_WINDOW_TURNS`, [apps/qa/models.py](apps/qa/models.py)) go into the prompt with the next question. The window is capped because the 4B model's context is the same space the retrieved excerpts need.
- **The router sees only the student's past questions**; the generator sees whole turns, with answers cut to 400 characters and stripped of citation markers (they point at excerpts this turn does not have). History is always one `user` message, never alternating roles: the router is asked to output one JSON object, and a real `assistant` prose turn demonstrates the opposite. The sha256 of both prompts is pinned in `tests/test_agent.py` and `tests/test_answer.py`.
- Answers are **stored as they stream**: question and empty answer are written just before `start`, the text when the stream stops. `complete` is true only when `end` arrived; a half answer is kept, because it is what the student saw and a sample for the M3 error taxonomy. `citations` and `route` are stored with it, so a stored turn renders exactly like a live one.
- Errors: 400 validation · 403 not logged in or wrong CSRF token (told apart by `GET /api/auth/me`) · 429 throttled · 503 a dependency is unavailable. With `Accept: text/event-stream` they arrive as an `error` event, otherwise as JSON.
- **These messages are in English by decision, not by omission**: the interface belongs to the frontend catalogues, the answer language to the prompt in [rag/answer.py](rag/answer.py), and the readers of a 503 or an `error` are whoever reads the server log — a catalogue for them would have no reader. The strings stay marked with `gettext_lazy`. **A visible consequence, so it is not chased as a bug**: DRF's own validation messages do have Italian translations and follow `Accept-Language` (`LANGUAGE_CODE` is `it`), so one 400 body can hold both `"Questo campo è obbligatorio."` and `"No such conversation."`.

The deepening loop is not in this endpoint: it fetches pages and writes to the shared index, up to 3 fetches, so it runs only from `rag.agent` on the command line. Its web path is an asynchronous task (🔜 `#34`).

## Code layout

| Path | Contents |
| ---- | -------- |
| `config/` | Django project: `settings.py` (security headers conditional on `DEBUG` and `DJANGO_BEHIND_TLS`) · `urls.py` (with the SPA fallback) · `views.py` (the one non-API view, the SPA shell) · `env.py` (`.env` through pydantic-settings, shared by `rag/` and Django) · asgi/wsgi |
| `apps/accounts/` | Accounts: custom `User` = `AbstractUser` + `locale` · serializers for register, login and the account · session login and the CSRF cookie in `views.py` · `urls.py` · `admin.py` |
| `apps/qa/` | QA API: `contract.py` (SSE contract, single source) · `serializers.py` · `models.py` (`Conversation`, `Message`, history window) · `conversations.py` (the chain's only ORM access) · `engine.py` (process-wide models + serial `stream_answer()`, reusing `rag/`, zero queries) · `views.py` (HTTP, SSE framing, when the answer is stored) · `conversation_views.py` · `urls.py` · `admin.py` |
| `rag/` | The RAG pipeline — **must never import Django**, so the thesis core runs and is evaluated without the web. `probe` · `parse` · `crawl` · `webparse` · `chunk` · `index` · `search` · `llm` (OpenAI-compatible client, pydantic JSON validation) · `answer` · `agent` (routing, read-only control flow) · `live` (query-time fetch, relevance gate, writes to the shared index, rollback) · `gold` · `golddraft` (drafts gold questions for human review) |
| `frontend/` | React SPA: `src/api/` (contract mirror, SSE parser, CSRF-aware requests, account and conversation calls) · `src/auth/` (session context, route guard) · `src/routes/` (login, register, chat, styleguide) · `src/features/chat/` (question state machine, turn rendering) · `src/components/` (account dialog and menu; `ui/` shadcn-style primitives) · `src/lib/markers.ts` · `src/theme/` · `src/i18n/` (three catalogues) · `src/test/` · `scripts/` (catalogue and contrast gates) · `public/fonts/` |
| `scripts/` | `check.py`, the check chain |
| `tests/` | pytest. `test_smoke.py` guards the `rag/` boundary and the Django configuration; `test_qa_contract.py` the contract and its mirror; `test_check_script.py` the chain and the workflow that calls it; `test_qa_engine.py` and `test_spa.py` carry no `django_db`, so pytest-django fails them if they touch the database |
| `gold/` | Gold question sets; schema in [gold/README.md](gold/README.md) |
| `docs/` | One topic per file: decisions, architecture, the Docling pipeline, the web source, RAG analysis, the experiment log |
| `.github/` | `workflows/ci.yml` (the check chain + dependency audit), `workflows/secrets.yml` (gitleaks), `dependabot.yml` |
| `data/` | Course material and everything derived from it (parsed output, the local Qdrant index): gitignored, **never** in git |

## Working on the MICC servers

Access and hardware are in [docs/architettura.md](docs/architettura.md). SSH aliases live in the local `~/.ssh/config` (`ssh targaryen` and so on).

**Starting.** Check the GPU dashboard (Grafana / Discord `#gpu-monitoring-dream-`) and pick a machine with **free VRAM and low CPU**; day to day that is a 2080 Ti machine, and ultron (24 GB) only when an experiment needs the memory. Confirm with `nvidia-smi` after logging in and pin a free card with `CUDA_VISIBLE_DEVICES=<id>`. Long jobs go in tmux: `tmux new -s tesi`, reattach with `tmux attach -t tesi`.

**Storage.** Model caches and datasets go on the NAS home, **not the server's local `/home`** (small, and shared by everyone). The NAS volumes `/andromeda` `/equilibrium` `/fishtank` `/oblivion` are mounted on every server, and personal directories differ per volume: `/oblivion/users/<user>` has `users/`, `/equilibrium/<user>` does not, andromeda and fishtank have none (ask the sysadmin). Check free space before choosing a volume; this project uses `/oblivion/users/jzheng`, with `export HF_HOME=/oblivion/users/jzheng/hf_cache` in the server's `~/.bashrc`. Shared datasets are under `/<volume>/DATASETS`, `/<volume>/datasets` or `/home/DATASETS` (naming differs per machine); datasets in a personal directory get cleaned up by the NAS rules.

**Finishing.** Check `nvidia-smi` for leftover processes of yours and `kill <PID>` them; Jupyter kernels hold GPU memory too. Close idle tmux sessions (`tmux kill-session -t tesi`). Release GPU memory as soon as a run ends.

## CI

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs on pushes to `main` and on pull requests. The `check` job installs with `uv sync --locked` and `npm ci` — so `uv.lock` and `frontend/package-lock.json` are committed with every dependency change — and then calls each step of `scripts/check.py` by name; [tests/test_check_script.py](tests/test_check_script.py) fails if the job runs anything else. The `audit` job runs pip-audit over the lockfile and `npm audit --omit=dev`, and [.github/workflows/secrets.yml](.github/workflows/secrets.yml) scans the whole history with gitleaks weekly. Dependency updates arrive as monthly Dependabot pull requests ([.github/dependabot.yml](.github/dependabot.yml)).

## Language

Which language each part of the repository is written in: [CLAUDE.md](CLAUDE.md), section on documentation conventions.
