# HTTP API

This file owns the HTTP API the site serves: accounts, question answering, conversations and the catalogue. The shapes' single sources are [apps/qa/contract.py](../apps/qa/contract.py) and [apps/catalog/serializers.py](../apps/catalog/serializers.py); how to run the server is [development.md](development.md).

## Accounts

Every endpoint needs a session except `GET /api/auth/me`, `login`, `register` and `POST /api/ask`: a stored conversation belongs to someone, and an anonymous student asks campus questions only, with nothing stored and the history sent back by the client (section *Multi-turn conversations*; [docs/decisions.md](decisions.md), 2026-09-25, *The data model is decided on paper*, point 3). An anonymous `POST` carries the CSRF token, as a logged-in one does ([apps/accounts/permissions.py](../apps/accounts/permissions.py)).

| Method and path | Does |
| --------------- | ---- |
| `GET /api/auth/me` | who am I — **200 even when logged out**, with `{"authenticated": false}`; also sets the CSRF cookie. Logged in, the user carries `is_superuser` and `roles`, where the caller holds a staff role: `{"role": "teacher", "edition": <id>}` or `{"role": "secretariat", "programme": "<code>"}` |
| `PATCH /api/auth/me` | change the interface language (`locale` is the only writable field) |
| `POST /api/auth/login` | username + password → session cookie |
| `POST /api/auth/logout` | end the session (204) |
| `POST /api/auth/register` | open self-registration, logged in on success (201) |

`me` answers 200 rather than 403 when nobody is logged in because with `SessionAuthentication` alone DRF answers unauthenticated calls with 403 — and a failed CSRF check is also 403. Making "nobody is logged in" a normal result leaves 403 one meaning: this request was refused. Throttling is per endpoint (`ask` 4/min per account or, anonymous, per address; `auth` 5/min per address) with no global cap; the reasons are next to the rates in [config/settings.py](../config/settings.py).

## Question-answering API

`POST /api/ask` is the same chain as `rag.agent` over HTTP — route, retrieve, generate — and it answers with a **server-sent event stream**, not a JSON body: one answer takes tens of seconds, and streaming is how the reader sees the system working. It needs what the CLI needs (Ollama running, the Qdrant service up and indexed) plus the server, and an account for course material: an anonymous question is searched against the campus pages only (`scope=[]`, [data-model.md](data-model.md)), so one routed to the slides gets no citation and the refusal, and `route.target` in the `start` event says why.

```powershell
$json = @{ question = "What is an ORM?" } | ConvertTo-Json
[System.IO.File]::WriteAllText("$PWD\ask.json", $json, (New-Object System.Text.UTF8Encoding $false))
curl.exe -N -u <username>:<password> -X POST http://127.0.0.1:8000/api/ask `
  -H "Content-Type: application/json" -H "Accept: text/event-stream" `
  --data-binary "@ask.json"
```

- `-N` stops curl from buffering the stream into one block.
- `-u` is HTTP Basic, which is enabled only with `DJANGO_DEBUG=true` ([config/settings.py](../config/settings.py)); the browser uses the session cookie.
- **The question goes through a file, not `-d`**, even an English one: PowerShell converts arguments to the console code page on the way to a native program, and `学费` or `Università` arrive as `?`. `WriteAllText` with a BOM-less `UTF8Encoding` is the one form that holds — in a multilingual project, a form that works only for the example is a wrong form.

The stream is `start` (route, citations and how long the reader waited for it, once, before generation) → `token` (a fragment of the answer, many times) → `end` (the answer is complete), or `error` in place of `end`. The answer is the concatenation of every `token`'s `text`, and it cites the n-th citation of `start` as `[n]`. The citations are the passages the answer is grounded on, each once, as many as the reranker judges relevant and at most five ([decisions.md](decisions.md), 2026-10-12). Events, fields, and why "was this cited?" is the client's to compute are defined in [apps/qa/contract.py](../apps/qa/contract.py), the single source.

The first request takes about a minute while the models load into GPU memory. Answers are served one at a time — 8 GB cannot hold two concurrent rerank + generation passes — and a request that waits in the queue longer than 90 s gets a 503 with `Retry-After`. Closing the stream cancels the generation and frees the queue. A 503 carries `reason`: `busy` (worth retrying) or `unavailable` (the model server or the Qdrant service is down). Once the first event has gone out the status is 200 whatever happens, so a generation that dies midway is an `error` event.

| Method and path | Does |
| --------------- | ---- |
| `GET /api/sources/<sha256>` | the PDF a slides citation came from, inline, for any logged-in account; the key is the `source_sha256` a citation carries, looked up in the parse sidecars and never a path; a sidecar pointing outside `data/corpus/` is skipped, and every miss is a 404 ([apps/qa/sources.py](../apps/qa/sources.py)) |

🔜 M5 `#36`: it serves only the decks of courses in the caller's programme, past editions included — consistency with retrieval, not a protection, since the programme is self-declared ([docs/data-model.md](data-model.md), scope invariant 3).

## Multi-turn conversations

`POST /api/ask` takes an optional `conversation_id` to continue a conversation; without it a new one starts, and its id arrives in the `start` event.

An anonymous caller has no stored conversation: it omits `conversation_id`, gets `"conversation_id": null` in the `start` event, and sends its own history as `history`, `[]` for a first question and otherwise a list of at most 3 `{"question", "answer"}` objects, oldest first, with each question at most 1000 characters and each answer at most 4000 (`MAX_HISTORY_ANSWER_CHARS`, [apps/qa/serializers.py](../apps/qa/serializers.py)), empty where the answer never arrived. The server stores none of it and trusts none of it: it is bounded, quoted in the prompt like any text the project did not write, and anything out of bounds is a 400. Each caller has one source of history, so a logged-in `history` (even `[]`) is a 400 too. A request without a session that sends no `history`, or names a `conversation_id`, is shaped like a signed-in client's whose session ended, and gets the 403 it got before anonymous questions existed, before the engine runs.

| Method and path | Does |
| --------------- | ---- |
| `GET /api/conversations` | the sidebar list, pinned conversations first, each group by its last message, newest first; a row is `id`, `locale`, `created_at`, `last_message_at`, `title`, `title_locale`, `pinned` and `last_source` (below) |
| `GET /api/conversations/<id>` | one conversation, its row as the list shows it with its `messages`; someone else's is **404, not 403** — a 403 would confirm the id exists |
| `PATCH /api/conversations/<id>` | `{"pinned": true}` or `false` pins or unpins it and answers with its row (200); `pinned` is the only field a conversation takes, in a JSON body only (any other is 415), and there is no `PUT`; someone else's is 404 |
| `DELETE /api/conversations/<id>` | deletes one of your conversations with its messages (204); someone else's is 404; a question queued for a conversation deleted meanwhile is refused with 400 |

- A row's fields other than `pinned` derive from its messages and are never stored: `title` is the first question cut to 60 characters, `title_locale` the language that question was asked in (`Message.locale`: a conversation has no single language), `last_message_at` the time of its last message. `last_source` is what its newest answer with excerpts drew on, `{"courses": [{"name", "locale"}], "web": bool}`: the courses of its slides excerpts in citation order, each once, named as `Course` names them (a code no course holds is shown as stored, with a `null` locale), and whether any excerpt was a university page. An answer refused for want of excerpts is skipped for the one before, and `last_source` is `null` when every answer was. The list costs the same queries for one conversation and for thirty.
- Pinning reorders nothing: the pinned rows follow their last message like the rest, so unpinning returns a row to its place (LibreChat and LobeChat order theirs the same way). A conversation with no messages, which a question refused with a 503 leaves behind, is not listed, opened, pinned or deleted: its id never reached the client.

- The last 3 turns (`HISTORY_WINDOW_TURNS`, [apps/qa/models.py](../apps/qa/models.py)) go into the prompt with the next question. The window is capped because the 4B model's context is the same space the retrieved excerpts need.
- **The router sees only the student's past questions**; the generator sees whole turns, with answers cut to 400 characters and stripped of their citations (an old `[2]` or marker names an excerpt of that turn, not of this one). History is always one `user` message, never alternating roles: the router is asked to output one JSON object, and a real `assistant` prose turn demonstrates the opposite. The sha256 of both prompts is pinned in `tests/test_agent.py` and `tests/test_answer.py`.
- Answers are **stored as they stream**: question and empty answer are written just before `start`, the text when the stream stops. `complete` is true only when `end` arrived; a half answer is kept, unless the student deletes the conversation, because it is what the student saw and a sample for the M3 error taxonomy. `citations`, `route` and `search_ms` are stored with it, so a stored turn renders exactly like a live one; `search_ms` is `null` on a question.
- Errors: 400 validation · 403 a wrong CSRF token, or no session where the request needs one (told apart by `GET /api/auth/me`) · 429 throttled · 503 a dependency is unavailable. With `Accept: text/event-stream` they arrive as an `error` event, otherwise as JSON.
- **These messages are in English by decision, not by omission**: the interface belongs to the frontend catalogues, the answer language to the prompt in [rag/answer.py](../rag/answer.py), and the readers of a 503 or an `error` are whoever reads the server log — a catalogue for them would have no reader. The strings stay marked with `gettext_lazy`. **A visible consequence, so it is not chased as a bug**: DRF's own validation messages do have Italian translations and follow `Accept-Language` (`LANGUAGE_CODE` is `it`), so one 400 body can hold both `"Questo campo è obbligatorio."` and `"No such conversation."`.

The deepening loop is not in this endpoint: it fetches pages and writes to the shared index, up to 3 fetches, so it runs only from `rag.agent` on the command line. Its web path is an asynchronous task (🔜 `#34`, M5).

## Catalogue API

What staff see and change, each within the scopes their roles cover ([apps/roles/scopes.py](../apps/roles/scopes.py)): a teacher every edition of a course they are assigned to an edition of, past and later years included, secretariat staff their programme and every edition of every course it offers, the superuser everything; what each role may do there is [apps/roles/registry.py](../apps/roles/registry.py). Every programme and edition carries `permissions`, what the caller holds on it, which is what a page reads to decide what to offer; an edition also carries `is_current`, worked out on the day of the request from the editions' teaching starts ([data-model.md](data-model.md), invariant 2), which nothing in the API changes.

| Method and path | Does |
| --------------- | ---- |
| `GET /api/catalog/programmes` | the programmes the caller may view: `code`, `name`, `locale`, `curricula` (names, sorted), `course_count` (each course once), `secretariat` (`[{"id", "username", "name"}]` by username, `name` the account's full name or `""` when it has none), `permissions`; a student gets `[]` |
| `GET /api/catalog/programmes/<code>` | one programme, as the list shows it |
| `GET /api/catalog/programmes/<code>/courses` | the programme's study plan, one row per course it lists, with or without an edition: `course`, and `current_edition` (`id`, `academic_year`, `teachers`) or `null` |
| `GET /api/catalog/courses/<code>` | one course a programme the caller may view lists: `code`, `name`, `locale`, `code_source` (`moodle` or `cineca-only`), `entries` (`programme` as `code`, `name`, `locale`; `curriculum`, `year_of_study`, `ad_code`), in every programme that lists it; 404 for any other course, a teacher's included |
| `GET /api/catalog/editions` | the editions the caller may view: `id`, `course` (as `courses/<code>` reads it), `academic_year`, `teaching_starts` (`YYYY-MM-DD` or `null`), `period` (`first_semester`, `second_semester`, or `""` when not entered), `is_current`, `teachers` (members shaped as a programme's `secretariat`), `permissions`; `?course=<code>` keeps one course's, and gives `[]` for a code the caller may not view |
| `GET /api/catalog/editions/<id>` | one edition, as the list shows it |
| `POST /api/catalog/editions/<id>/teachers` | `{"username": "..."}` makes that user a teacher of the edition (201, answering with the member as the lists show it); needs `edition.assign_teacher` |
| `DELETE /api/catalog/editions/<id>/teachers/<username>` | revokes it (204) |
| `GET /api/catalog/editions/<id>/syllabus` | the edition's syllabus, `{"locale", "sections": [{"section", "text"}]}`: the one language every section is written in, one of `settings.LANGUAGES`, and the sections in the course catalogue's order, each text in Markdown (CommonMark with GitHub's extensions); a section with no text is not listed |
| `PATCH /api/catalog/editions/<id>/syllabus` | `{"locale": "en"}` sets the syllabus's language and answers with the syllabus; no section is changed or translated; needs `edition.edit_content` |
| `PUT /api/catalog/editions/<id>/syllabus/<section>` | `{"text": "..."}` writes that section's Markdown (200, answering with the section), and a text blank once trimmed clears it (204); needs `edition.edit_content`. `<section>` is one of `SyllabusSection` ([apps/catalog/models.py](../apps/catalog/models.py)); any other matches no route |
| `GET /api/catalog/editions/<id>/readings` | the edition's books, `[{"id", "locale", "title", "authors", "year", "isbn", "url", "importance"}]` by title, `locale` the language the book is written in, a tag Django knows such as `en` or `de`, `year` a number or `null`, `isbn` and `url` `""` when not given, `importance` `required` or `recommended` |
| `POST /api/catalog/editions/<id>/readings` | adds a book (201, answering with it); `locale` defaults to `it`; a title the edition lists is refused as `unique` on `title`; needs `edition.edit_content` |
| `PATCH /api/catalog/editions/<id>/readings/<book id>` | changes the fields the body names (200, the book); `DELETE` removes it (204); both need `edition.edit_content`, and a book of another edition is a 404 |
| `POST /api/catalog/programmes/<code>/secretariat` | makes a user secretariat staff of the programme (201, the member likewise); needs `programme.assign_secretariat`, which only the superuser holds |
| `DELETE /api/catalog/programmes/<code>/secretariat/<username>` | revokes it (204) |

- Status codes: 403 not logged in · 404 outside the caller's scope, whether or not it exists · 403 inside it without the permission · then 400 for the body's fields · 405 for a method the route does not serve, `OPTIONS` included. Each refusal a view returns names itself with a code, in DRF's envelope with every message as `{"message", "code"}`: `{"detail": {"message": "...", "code": "not_found"}}`, or `{"username": [{"message": "...", "code": "no_such_user"}]}` for a field ([config/exceptions.py](../config/exceptions.py); this project's codes: [apps/catalog/errors.py](../apps/catalog/errors.py)); a path no route matches is Django's plain 404, with no code. The scope is looked up before the permission and the permission before the fields, so a refusal says nothing the caller may not see; only a body that is not JSON at all is refused first, since the CSRF check reads it.
- Books: a field the model refuses carries DRF's code (`required`, `blank`, `max_length`, `invalid`, `invalid_choice`, `min_value`, `max_value`), and a title the edition lists in that language is a 400 on `title` with `unique`.
- Assigning: an unknown username (`no_such_user`), or a role the user holds on that scope (`already_held`), is a 400, and each grant and revocation made here writes one `INFO` line to the `apps.roles.grants` logger. To revoke every role of one person, the superuser searches the role assignments for their exact username in the admin.
