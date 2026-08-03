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

# Parse PDFs to markdown following the per-file routing.
parse target:
    uv run python -m rag.parse "{{ target }}"
