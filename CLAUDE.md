# CLAUDE.md — multilingual-course-assistant

> Loaded at the start of every session. Keep it short (<150 lines): only what Claude cannot infer from the code.
> Rules in the imperative; the project overview follows the project, and whatever goes stale is deleted.

## 1. Project overview

- **Project**: multilingual-course-assistant — multilingual question answering over university course material, plus campus-information QA (RAG over open-weights LLMs, the Qwen family; **QA only, ⛔ generating or grading exercises**) and a website (the PPM part), in one repository. **Bachelor's thesis (*triennale*)**, UniFi, supervisor (*relatore*) Prof. Marco Bertini; one developer (Junliang Zheng).
- **Pointers**: progress, milestones, blockers and deferred work → **GitHub issues** (milestones M3 · M5 · M6 · M7), never a checklist file in the repository; decisions taken without the supervisor, reversals included → `docs/decisioni.md`; code layout and module responsibilities → `README.md`; the stack decision table and the supervisor's constraints → `docs/architettura.md`; the check chain, identical locally and in CI → `scripts/check.py`; one topic per file under `docs/`. This file holds pointers only.
- **Scope**: **no proprietary LLM APIs** (OpenAI, Claude) — open-weights models only. The course scenario's corpus is slides and lecture-note PDFs only; the campus scenario's corpus is a crawl snapshot of the UniFi website plus pages fetched live when a student's question calls for them (stored permanently once the LLM relevance gate passes them, so the corpus grows by itself; not locked to the unifi.it domain).
- **Dependencies**: **🔒 items must not bring in a dependency or a config file**; 🔶 items add theirs with `uv add`, and **only in the milestone that really uses it** — an installed dependency nothing uses is noise, and it puts something unexplainable in `uv.lock`. Frontend npm dependencies follow the same rule: `npm install --prefix frontend`, and `package-lock.json` is committed like `uv.lock` (CI runs `npm ci`). "Really uses" means **code runs it**, not "deployment will need it" — nobody can verify the latter.
- **Boundaries**: **`rag/` never imports Django** — the thesis core must run and be evaluated without the web; `tests/test_smoke.py` guards this. **`frontend/` is the same boundary from the other side**: it knows only the TypeScript mirror of `apps/qa/contract.py`, never the Django models; the contract's single source is the Python side, and `tests/test_qa_contract.py` keeps the two from drifting. `frontend/dist/` is a build artefact (gitignored), which is why the frontend build runs before every Django step of `scripts/check.py`. `data/` (course material and everything derived from it) is gitignored and **never** enters git. Further directories are created in the milestone that needs them; no "while I'm here" directories before that.
- **Language as a domain**: the business domain is multilingual; every data model and every user-facing text carries a `locale` field or parameter from the start. No hard-coded language strings.

## 2. Agent rules

1. **Before writing code**: read the related existing files and match their style. Never write from intuition.
2. **Contract-first**: where a shared contract exists (types, data schema, API), it is the **single source**; change the contract first, then its consumers, keeping both sides in step within the same change.
3. **Stage large tasks**: a change across layers (data / service / interface) is split into separate stages; never cover every layer in one session.
4. **Split large files**: when a file exceeds 250 lines, change the logic layer first and the view layer after; never both at once.
5. **Language**: identifiers, code comments, commit messages, repository documents and GitHub issues are in English (see the documentation conventions). **Talk to the user in Chinese**, whatever language they write in.
6. **One correct implementation, no noise**: keep exactly one correct implementation. Refactors **replace in place** — no parallel or alternative versions, no "backup" of old code (history lives in git). Dead code is noise and is deleted outright.
7. **Follow the official format, invent no fields**: API responses, config, manifests and SDK parameters follow the official schema exactly. When in doubt, read the official documentation before implementing.
8. **Style belongs to the linters**: formatting and naming are enforced by linters and formatters; this file does not repeat them.
9. **Dangerous operations go to the user; writes stay inside the project**: for anything irreversible or outside the project, **print the command and let the user run it in their own terminal**. The AI **never runs**: recursive or bulk deletion, registry or system configuration changes, system-wide installs or uninstalls, any command that **writes to or connects to a live environment** of a hosted service (cloud DB, storage, auth service, paid API — migrations, seeds, resets, DDL, DML, admin APIs, deployments). Outside the project directory, read only. Inside it, deleting a single file (refactor, dead code) is allowed after listing the file and the reason. The AI is limited to **fully offline** operations: generating clients or types from local files, editing migration files, reading schemas.
10. **Ask, don't guess**: when a decision is missing (scope, stack, domain naming) and different readings lead to different work, ask **one** targeted question with 2–4 options; never choose silently for the user.

## 3. Git

1. **Commits belong to the user**: the AI may edit files and run `git add`, `git diff`, `git status`; it **never runs `git commit`** — it prints the full command for the user to run. One logical unit per commit, messages in English, Conventional Commits (`feat:` · `fix:` · `docs:` · `chore:` · `refactor:` · `test:`).
2. **No signatures**: commit messages and pull request bodies carry **no** AI tool signature (`Co-Authored-By: Claude …`, `🤖 Generated with …` or the like). A message ends with its last line of content.
3. **Remotes and history belong to the user**: the AI **never runs** `git push` and does no remote or account-level operation (creating or deleting repositories, changing `git remote`, `git config --global`, `gh auth`). **Shared history is never rewritten**: no `push --force` (including `-f` and `--force-with-lease`) without an explicit request, no `reset --hard` over uncommitted work, no rebase or `--amend` of a published commit. Everything else: **print the command, the user runs it**.
4. **Branches**: work on `main` (personal repository). Propose a branch for experimental changes.

## 4. Domain invariants

🔜 To be written once the thesis scope is refined. Only business rules whose violation is a bug, not preferences. While this section is empty, invent no invariants.

## 5. Documentation conventions

**Documents are in English.** The repository's markdown and its GitHub issues are written in English and maintained in place, **with no parallel translations** — two languages would mean keeping the same content twice. The thesis body and its delivery attachments are written in Italian outside the repository. Talk to the user in Chinese (agent rule 5). Decision and reasons: `docs/decisioni.md`, 2026-09-23.

🔶 **Partial** — the rule applies at once to everything new or rewritten; existing documents are migrated under **issue #43**, which owns the list of files and their state.

**Map** — the root files plus `docs/`. No other plan or checklist files anywhere in the repository:

| File | Contents |
| ---- | -------- |
| `README.md` | Entry point: what it is, how to run it, how to develop, CI |
| `CLAUDE.md` | Agent rules, project overview, documentation conventions |
| `docs/decisioni.md` | Decisions: the date, what was decided, why — reversals included |
| `docs/*.md` | One topic per file, created only when the topic exists |

**Progress is owned by GitHub issues, never by a markdown file**: milestone checklists, blockers and deferred work live only in issues; documents say *what* and *why*, never *not yet*.

**One piece of information, one owner.** The owner holds the full text; any other file gets one line and a link, never a copy. When the owner is unclear, settling it is part of the change.

**Diagrams**: mermaid (GitHub renders it); ASCII only for tiny inline diagrams such as a directory tree. Status markers go in the prose above a diagram, never inside the mermaid syntax.

**Status markers** (the same everywhere): ✅ implemented — **must** cite a real path or a runnable command · 🔜 planned — **must** name the milestone · 🔶 partial — say what exists and what is missing · 🔒 blocked — say who unblocks it · ⛔ out of scope. `[ ] [~] [x]` checkboxes exist **only** in GitHub issue bodies. No temporal wording ("already", "currently", "soon"): status is expressed with markers only.

**A planned design is not a wrong design.** A 🔜 block may describe what does not exist yet; it **must not** describe what the code has rejected. Content that contradicts the code or the real contract is first rewritten to the real model, then marked.

**Links**: between files, link **files, never `#anchor`s** (headings change and anchors break silently); name sections in words. Anchors only within the same file. References **outside the repository** are plain text with a note (outside the repository), not links.
