# CLAUDE.md — multilingual-course-assistant

> Loaded at the start of every session. Keep it short (<150 lines): only what Claude cannot infer from the code.
> Rules in the imperative; the project overview follows the project, and whatever goes stale is deleted.

## 1. Project overview

- **Project**: multilingual-course-assistant — multilingual question answering over university course material, plus campus-information QA (RAG over open-weights LLMs, the Qwen family; **QA only, ⛔ generating or grading exercises**) and a website (the PPM part), in one repository. **Bachelor's thesis (*triennale*)**, UniFi, supervisor (*relatore*) Prof. Marco Bertini; one developer (Junliang Zheng).
- **Pointers**: progress, milestones, blockers and deferred work → **GitHub issues** (milestones M3 · M4 · M5 · M6 · M7), never a checklist file in the repository; decisions taken without the supervisor that are in force → `docs/decisions.md`; code layout and module responsibilities → `README.md`; the stack decision table and the supervisor's constraints → `docs/architecture.md`; the check chain, identical locally and in CI → `scripts/check.py`; one topic per file under `docs/`. This file holds pointers only.
- **Scope**: **no proprietary LLM APIs** (OpenAI, Claude) — open-weights models only. The course scenario's corpus is slides and lecture-note PDFs only; the campus scenario's corpus is a crawl snapshot of the UniFi website plus pages fetched live when a student's question calls for them (not locked to the unifi.it domain). 🔶 The code stores a fetched page once the LLM relevance gate passes it, so the corpus grows by itself; a human confirmation step before storing is decided and is `#48`.
- **Dependencies**: **🔒 items must not bring in a dependency or a config file**; 🔶 items add theirs with `uv add`, and **only in the milestone that really uses it** — an installed dependency nothing uses is noise, and it puts something unexplainable in `uv.lock`. Frontend npm dependencies follow the same rule: `npm install --prefix frontend`, and `package-lock.json` is committed like `uv.lock` (CI runs `npm ci`). "Really uses" means **code runs it**, not "deployment will need it" — nobody can verify the latter. <!-- guard-ignore status-marker: names what the markers mean, reports no status -->
- **Boundaries**: **`rag/` never imports Django** — the thesis core must run and be evaluated without the web; `tests/test_smoke.py` guards this. **`frontend/` is the same boundary from the other side**: it knows only the TypeScript mirrors of the API's shapes — `apps/qa/contract.py` and the serializers of `apps/catalog/serializers.py` — never the Django models; each shape's single source is the Python side, and `tests/test_qa_contract.py` and `tests/test_catalog_contract.py` keep the two sides from drifting. `frontend/dist/` is a build artefact (gitignored), which is why the frontend build runs before every Django step of `scripts/check.py`. `data/` (course material and everything derived from it) is gitignored and **never** enters git. Further directories are created in the milestone that needs them; no "while I'm here" directories before that.
- **Language as a domain**: the business domain is multilingual; every row that carries user-visible text, and every function that produces it, carries a `locale` field or parameter from the start, except where `docs/decisions.md` records why not (2026-09-25, *The data model is decided on paper*, point 6, and *PPM read from Moodle and Cineca*, point 3). No hard-coded language strings.

## 2. Agent rules

1. **Before writing code**: read the related existing files and match their style. Never write from intuition.
2. **Contract-first**: where a shared contract exists (types, data schema, API), it is the **single source**; change the contract first, then its consumers, keeping both sides in step within the same change.
3. **Stage large tasks**: a change across layers (data / service / interface) is split into separate stages; never cover every layer in one session.
4. **Split large files**: when a file exceeds 250 lines, change the logic layer first and the view layer after; never both at once.
5. **Language**: identifiers, code comments, commit messages, repository documents and GitHub issues are in English (the table in section 5 names the guard behind each). **Talk to the user in Chinese**, whatever language they write in.
6. **One correct implementation, no noise**: keep exactly one correct implementation. Refactors **replace in place** — no parallel or alternative versions, no "backup" of old code (history lives in git; the `no-parallel-versions` hook refuses `*.bak`, `*_v2.*` and the like). Dead code is noise and is deleted outright.
7. **Follow the official format, invent no fields**: API responses, config, manifests and SDK parameters follow the official schema exactly. When in doubt, read the official documentation before implementing.
8. **Style belongs to the linters**: formatting and naming are enforced by linters and formatters; this file does not repeat them.
9. **Dangerous operations go to the user; writes stay inside the project**: for anything irreversible or outside the project, **print the command and let the user run it in their own terminal**. The AI **never runs**: recursive or bulk deletion, registry or system configuration changes, system-wide installs or uninstalls, any command that **writes to or connects to a live environment** of a hosted service (cloud DB, storage, auth service, paid API — migrations, seeds, resets, DDL, DML, admin APIs, deployments). Outside the project directory, read only. Inside it, deleting a single file (refactor, dead code) is allowed after listing the file and the reason. The AI is limited to **fully offline** operations: generating clients or types from local files, editing migration files, reading schemas.
10. **Ask, don't guess**: when a decision is missing (scope, stack, domain naming) and different readings lead to different work, ask **one** targeted question with 2–4 options; never choose silently for the user.

## 3. Git

1. **Commits belong to the user**: the AI may edit files and run `git add`, `git diff`, `git status`; it **never runs `git commit`** — it prints the full command for the user to run. One logical unit per commit, messages in English, Conventional Commits with the types of commitlint's config-conventional (`feat:` · `fix:` · `docs:` · `refactor:` · `test:` · `ci:` · `build:` · `chore:` …); the `commit-msg` hook (`scripts/guards/commits.py`) holds the full list and rejects the rest.
2. **No signatures**: commit messages and pull request bodies carry **no** AI tool signature (`Co-Authored-By: Claude …`, `🤖 Generated with …` or the like). A message ends with its last line of content.
3. **Remotes and history belong to the user**: the AI **never runs** `git push` and does no remote or account-level operation (creating or deleting repositories, changing `git remote`, `git config --global`, `gh auth`). **Shared history is never rewritten**: no `push --force` (including `-f` and `--force-with-lease`) without an explicit request, no `reset --hard` over uncommitted work, no rebase or `--amend` of a published commit. Everything else: **print the command, the user runs it**.
4. **Branches**: work on `main` (personal repository). Propose a branch for experimental changes. History is linear: a branch is rebased onto `main`, never merged with it (the `commit-history` hook).

## 4. Domain invariants

The business rules whose violation is a bug are the scope invariants of `docs/data-model.md`; invent no others.

## 5. Documentation conventions

**Documents are in English.** The repository's markdown and its GitHub issues are written in English and maintained in place, **with no parallel translations** — two languages would mean keeping the same content twice. The thesis body and its delivery attachments are written in Italian outside the repository. Talk to the user in Chinese (agent rule 5). Decision and reasons: `docs/decisions.md`, 2026-09-23.

**Every rule has a guard or says it has none.** A guard is a hook of `.pre-commit-config.yaml`, run at commit time and by `scripts/check.py`; `review` marks what only a reader can check. String literals, the UI catalogues and the gold set are data, in whatever language the data is.

| Layer | Rule | Guard |
| ----- | ---- | ----- |
| Identifiers | English | `review` |
| Comments and docstrings (Python, TypeScript, JavaScript) | English | `language` |
| pytest test names | English | `language` |
| vitest test titles (string literals) | English | `review` |
| Markdown prose | English | `language` |
| Every tracked file | no known misspelling | `typos` |
| Status markers, temporal wording, links between files | the conventions below | `doc-conventions` |
| Links, document paths, decision references, paths a status marker cites | they resolve | `doc-references` |
| Commit messages | English Conventional Commits, no AI signature | `commit-msg`, `commit-history` |
| History | linear | `commit-history` |
| File names | one version of a file (agent rule 6) | `no-parallel-versions` |
| `.env.example` | names exactly what `config/env.py` reads | `env-example-parity` |
| GitHub issues | English | `review` |
| Any piece of information | one owner | `review` |

**Map** — the root files, `docs/` and `gold/README.md`. No other plan or checklist files anywhere in the repository:

| File | Contents |
| ---- | -------- |
| `README.md` | Entry point: what it is, how to run it, how to develop, CI |
| `CLAUDE.md` | Agent rules, project overview, documentation conventions |
| `docs/decisions.md` | Decisions in force: the date, what was decided, why; a reversal replaces what it reverses |
| `docs/*.md` | One topic per file, created only when the topic exists |
| `gold/README.md` | Gold set schema, id prefixes, writing rules and acceptance thresholds |

**Progress is owned by GitHub issues, never by a markdown file**: milestone checklists, blockers and deferred work live only in issues; documents say *what* and *why*, never *not yet*.

**One piece of information, one owner.** The owner holds the full text; any other file gets one line and a link, never a copy. When the owner is unclear, settling it is part of the change.

**Diagrams**: mermaid (GitHub renders it); ASCII only for tiny inline diagrams such as a directory tree. Status markers go in the prose above a diagram, never inside the mermaid syntax.

**Status markers** (the same everywhere): ✅ implemented — **must** cite a real path or a runnable command · 🔜 planned — **must** name the milestone · 🔶 partial — say what exists and what is missing · 🔒 blocked — say who unblocks it · ⛔ out of scope. `[ ] [~] [x]` checkboxes exist **only** in GitHub issue bodies. No temporal wording ("already", "currently", "soon"): status is expressed with markers only. <!-- guard-ignore status-marker: the legend of the markers -->

**A planned design is not a wrong design.** A 🔜 block may describe what does not exist yet; it **must not** describe what the code has rejected. Content that contradicts the code or the real contract is first rewritten to the real model, then marked. <!-- guard-ignore status-marker: names the marker, reports no status -->

**Links**: between files, link **files, never `#anchor`s** (headings change and anchors break silently); name sections in words. Anchors only within the same file. References **outside the repository** are plain text with a note (outside the repository), not links.
