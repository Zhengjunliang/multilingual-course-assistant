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

# The full CI chain, locally.
check:
    uv run ruff check .
    uv run ruff format --check .
    uv run pyright
    uv run python manage.py check
    uv run pytest --cov

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
