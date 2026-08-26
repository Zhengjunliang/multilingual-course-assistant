# Task recipes — one name per chain instead of five copy-pasted commands.
# Install: `scoop install just` (Windows) / `brew install just` / distro package.

set windows-shell := ["powershell.exe", "-NoLogo", "-Command"]

# List available recipes.
default:
    just --list

# Lint (ruff check).
lint:
    uv run ruff check .

# Auto-format.
format:
    uv run ruff format .

# Type check.
typecheck:
    uv run pyright

# Tests, fast local run (no coverage overhead).
test:
    uv run pytest

# Tests with the coverage gate, exactly as CI runs them.
cov:
    uv run pytest --cov

# Install the SPA's dependencies from the lockfile (Node version in frontend/.nvmrc).
fe-install:
    npm ci --prefix frontend

# SPA dev server on http://localhost:5173/ (proxies /api and /admin to `just serve`).
fe-dev:
    npm run dev --prefix frontend

# The SPA's own chain: lint, types, catalogue keys, production build.
fe:
    npm run lint --prefix frontend
    npm run typecheck --prefix frontend
    npm run check:i18n --prefix frontend
    npm run build --prefix frontend

# The full CI chain, locally. `fe` runs first for the same reason CI puts it
# first: from the deployment stage on, Django's static settings point at
# frontend/dist, and `check --deploy` fails on a directory that is not there.
check: fe
    uv run ruff check .
    uv run ruff format --check .
    uv run pyright
    uv run python manage.py check
    uv run pytest --cov

# Start the backing services (PostgreSQL) in the background.
up:
    docker compose up -d

# Stop the backing services; the named volume keeps their data.
down:
    docker compose down

# Apply database migrations (needs `just up` first).
migrate:
    uv run python manage.py migrate

# Write the migration for a model change; `just migrate` then applies it.
makemigrations:
    uv run python manage.py makemigrations

# Development server on http://127.0.0.1:8000/ (needs `just up` first).
serve:
    uv run python manage.py runserver

# Create an admin account (interactive).
superuser:
    uv run python manage.py createsuperuser

# Profile PDFs and show the routing decision without parsing.
probe target:
    uv run python -m rag.probe "{{ target }}"

# Parse PDFs to DoclingDocument JSON (+ meta sidecar) following the per-file routing.
parse target:
    uv run python -m rag.parse "{{ target }}"

# Chunk parsed document JSON into payload-bearing JSONL.
chunk target:
    uv run python -m rag.chunk "{{ target }}"

# Index chunk JSONL into the local Qdrant hybrid collection.
index target:
    uv run python -m rag.index "{{ target }}"

# Hybrid search (+ rerank) against the local index.
search query *args:
    uv run python -m rag.search "{{ query }}" {{ args }}

# Retrieve + generate a cited answer (needs Ollama running locally).
answer question *args:
    uv run python -m rag.answer "{{ question }}" {{ args }}

# Route a question (course vs campus), retrieve and answer (needs Ollama running locally).
ask question *args:
    uv run python -m rag.agent "{{ question }}" {{ args }}

# Retrieval hit@k over the gold smoke set.
gold *args:
    uv run python -m rag.gold gold/smoke.jsonl {{ args }}

# Crawl the campus web source into a snapshot + registry (run by the user, 1 req/s, robots honored).
crawl *args:
    uv run python -m rag.crawl --out data\webcorpus {{ args }}

# Parse a crawl snapshot (HTML + PDF attachments) into chunkable artifact pairs.
webparse snapshot *args:
    uv run python -m rag.webparse "{{ snapshot }}" {{ args }}

# Fetch one URL live, gate it and (if relevant) grow the shared index; also --rollback / --measure-gate.
live *args:
    uv run python -m rag.live {{ args }}
