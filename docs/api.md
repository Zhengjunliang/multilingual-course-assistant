# HTTP API

This file owns the HTTP API the site serves: accounts, question answering, conversations, the catalogue, and the one body every error answers. The shapes' single sources are [apps/qa/contract.py](../apps/qa/contract.py) and [apps/catalog/serializers.py](../apps/catalog/serializers.py); how to run the server is [development.md](development.md).

## Accounts

Every endpoint needs a session except `GET /api/auth/me`, `login`, `register`, `reset/lookup`, `reset`, `invitation/lookup`, `invitation/accept` and `POST /api/ask`: a stored conversation belongs to someone, and an anonymous student asks campus questions only, with nothing stored and the history sent back by the client (section *Multi-turn conversations*; [docs/decisions.md](decisions.md), 2026-09-25, *The data model is decided on paper*, point 3). An anonymous `POST` carries the CSRF token, as a logged-in one does ([apps/accounts/permissions.py](../apps/accounts/permissions.py)).

| Method and path | Does |
| --------------- | ---- |
| `GET /api/auth/me` | who am I — **200 even when logged out**, with `{"authenticated": false}`; also sets the CSRF cookie. Logged in, the user carries `is_superuser` and `roles`, where the caller holds a staff role: `{"role": "teacher", "edition": <id>}` or `{"role": "secretariat", "programme": "<code>"}` |
| `PATCH /api/auth/me` | change the interface language (`locale` is the only writable field) |
| `POST /api/auth/login` | username + password → session cookie |
| `POST /api/auth/logout` | end the session (204) |
| `POST /api/auth/register` | open self-registration, logged in on success (201); `username`, `password` and `locale` are the fields it reads, and the account it makes is a student's whatever else the body holds |
| `POST /api/auth/password` | `{"password", "new_password"}` → 204: the password changes, this session stays signed in under a new key, and every other session of the account ends |
| `GET /api/auth/sessions` | the account's live sessions, the last used first: a bare array of `{"id", "current", "user_agent", "ip", "authenticated_at", "last_activity"}`, where `current` marks the one asking |
| `POST /api/auth/sessions/end` | `{"password", "session"}` → 204: ends the session whose `id` is `session`, or with `"others"` every one but the caller's |
| `POST /api/auth/me/delete` | `{"password"}` → 204: deletes the account and its conversations, and signs out every session of it |
| `POST /api/auth/reset/lookup` | `{"token"}` → `{"username"}`: the account a reset link resets, for the page to name; the link stays as it is |
| `POST /api/auth/reset` | `{"token", "new_password"}` → 204: sets the account's password, ends every session of it and voids the link; nobody is signed in by it |
| `POST /api/auth/invitation/lookup` | `{"token"}` → `{"role", "edition", "programme"}`: what an invitation makes its holder, its scope named as the invitation lists name it (section *Catalogue API*) and the other one `null`; the invitation stays as it is |
| `POST /api/auth/invitation/accept` | signed in, `{"token"}` → 200; signed out, `{"token", "username", "password", "locale"}` → 201, an account made as `register` makes one, and signed in. Either way the account is granted the role, the invitation is used up, and the answer is `me`'s |

`me` answers 200 when nobody is logged in: "who am I" has an answer for a stranger too, and the page asks it before anything else. Elsewhere a request that needs a session and has none is a 401 `UNAUTHENTICATED`, and a failed CSRF check a 403 `CSRF_FAILED` (section *Errors*). Throttling is per endpoint (`ask` 4/min per account or, anonymous, per address; `auth` 5/min, per address on `login`, `register`, `reset/lookup`, `reset`, `invitation/lookup` and `invitation/accept` and per account on `password`, `sessions/end` and `me/delete`) with no global cap; the reasons are next to the rates in [config/settings.py](../config/settings.py).

A session lives by its account's tier, a staff one (a superuser or the holder of a role) 1 hour idle and 24 hours in all, a student's 7 days idle and 14 in all, and the first request past either limit finds its caller signed out, answered as a stranger is ([apps/accounts/middleware.py](../apps/accounts/middleware.py); [decisions.md](decisions.md), 2026-10-27, *Signing in stays a server-side session, which lives by its account's tier*). A session's `id` is a digest of its key, so the key, which is the cookie, never leaves the server; the caller's own session is listed but not ended here, and an `id` naming it is the 404 `NOT_FOUND` of an `id` naming no session of the account, since signing out is how it ends. The three changes ask for the current password, and a wrong one is a 400 `WRONG_CREDENTIALS`, as at login ([apps/accounts/self_views.py](../apps/accounts/self_views.py)). An account that holds a staff role is not deleted, a 409 `ROLES_HELD`, until its roles are revoked, and neither is the last active superuser, a 409 `LAST_SUPERUSER` ([apps/accounts/services.py](../apps/accounts/services.py)).

A reset link is made by a superuser and handed over in person; the site sends no mail. Its token is the holder's only credential, so it travels in a body, never in a URL a log keeps, and the server stores its digest alone. A link works once within 24 hours, and a newer link of the account voids it; a token that opens no link, unknown, used, replaced or expired, is the one 404 `LINK_EXPIRED` whichever, and a new password the rules refuse is the 400 `INVALID_ARGUMENT` of registering, which leaves the link working ([apps/accounts/links.py](../apps/accounts/links.py)).

An invitation is made by whoever may grant its role on its scope (section *Catalogue API*), handed over the same way, and its token travels and is stored as a reset link's. It works once within 72 hours, and only while its maker may grant the role there: a token that opens none, unknown, used, revoked, expired, or made by an account deactivated or without that grant, is the one 404 `LINK_EXPIRED`. Signed out, the account's fields are checked first, as `register` checks them, and a refusal is that 400, which leaves the invitation working; signed in, an account holding the role there is a 409 `ROLE_ALREADY_HELD`, which leaves it working too. The role is granted as the maker's grant ([apps/roles/invitations.py](../apps/roles/invitations.py)).

A superuser manages every account from the site, under `/api/admin/users`, by the rules `/admin/` keeps too ([apps/accounts/manage_views.py](../apps/accounts/manage_views.py)); any other caller gets a 403 `PERMISSION_DENIED`.

| Method and path | Does |
| --------------- | ---- |
| `GET /api/admin/users` | every account by username, 50 a page (`?page=`), in DRF's page shape `{"count", "next", "previous", "results"}`; `?q=` keeps the usernames containing it in any case, `?active=true` or `false` the active or the deactivated accounts. A row is `{"id", "username", "is_active", "is_superuser", "last_login", "date_joined", "roles"}`, with `roles` as `me` names them |
| `POST /api/admin/users/<id>/deactivate` | → 204: the account no longer signs in, and every session of it ends |
| `POST /api/admin/users/<id>/activate` | → 204: the account signs in again, afresh; an active one is left as it is |
| `POST /api/admin/users/<id>/sessions/end` | → 204: every session of the account ends, and it stays active |
| `DELETE /api/admin/users/<id>` | → 204: deletes a deactivated account and its conversations |
| `POST /api/admin/users/<id>/reset-link` | → 201 `{"token", "expires_at"}`: a reset link for the account, deactivated or not, its token in this answer only; any earlier link of the account stops working |

No change asks for the password again. A superuser does not take their own access away here, nor makes a reset link for their own account, a 409 `SELF_NOT_ALLOWED`, and deletes their own account through `me/delete`; an active account is deactivated before it is deleted, a 409 `ACCOUNT_STILL_ACTIVE`, and an `<id>` naming no account is a 404 `NOT_FOUND` ([apps/accounts/services.py](../apps/accounts/services.py)). A deactivated account signing in gets the 400 `WRONG_CREDENTIALS` of a wrong password.

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

The first request takes about a minute while the models load into GPU memory. Answers are served one at a time — 8 GB cannot hold two concurrent rerank + generation passes — and a request that waits in the queue longer than 90 s gets a 503 `UNAVAILABLE`, which says how many seconds to wait before asking again. Closing the stream cancels the generation and frees the queue. A model server or Qdrant service that is down is a 503 `ENGINE_DOWN`, which asking again does not fix. Once the first event has gone out the status is 200 whatever happens, so a generation that dies midway is an `error` event, `ENGINE_DOWN`, and a defect midway one with `INTERNAL` (section *Errors*).

| Method and path | Does |
| --------------- | ---- |
| `GET /api/sources/<sha256>` | the PDF a slides citation came from, inline, for any logged-in account; the key is the `source_sha256` a citation carries, looked up in the parse sidecars and never a path; a sidecar pointing outside `data/corpus/` is skipped, and every miss is a 404 ([apps/qa/sources.py](../apps/qa/sources.py)) |

🔜 M5 `#36`: it serves only the decks of courses in the caller's programme, past editions included — consistency with retrieval, not a protection, since the programme is self-declared ([docs/data-model.md](data-model.md), scope invariant 3).

## Multi-turn conversations

`POST /api/ask` takes an optional `conversation_id` to continue a conversation; without it a new one starts, and its id arrives in the `start` event.

Every id this API reads or returns for a conversation or a message is a random version 4 UUID, written as a string (`"3f1c9a52-6b0e-4d7a-9c1e-2a5b8d4f0e17"`): it names one row and says nothing about how many others exist ([decisions.md](decisions.md), 2026-10-27, *A conversation and its messages are named by random UUIDs, and a thread is a chain of parents*). An id is refused by where it is written:

- in an address, `/api/conversations/<id>`: anything but a lower-case UUID matches no route, a 404 `NOT_FOUND`;
- in a question's body: a `conversation_id` that is not a UUID string, a number included, is a 400 `INVALID_ARGUMENT` on that field;
- well-formed in either, naming nothing of the caller's, unknown or someone else's alike: a 404, `CONVERSATION_GONE` on a question.

An anonymous caller has no stored conversation: it omits `conversation_id`, gets `"conversation_id": null` in the `start` event, and sends its own history as `history`, `[]` for a first question and otherwise a list of at most 3 `{"question", "answer"}` objects, oldest first, with each question at most 1000 characters and each answer at most 4000 (`MAX_HISTORY_ANSWER_CHARS`, [apps/qa/serializers.py](../apps/qa/serializers.py)), empty where the answer never arrived. The server stores none of it and trusts none of it: it is bounded, quoted in the prompt like any text the project did not write, and anything out of bounds is a 400. Each caller has one source of history, so a logged-in `history` (even `[]`) is a 400 too. A request without a session that sends no `history`, or names a `conversation_id`, is shaped like a signed-in client's whose session ended, and gets the 401 `UNAUTHENTICATED` that sends such a client to sign in, before the engine runs.

| Method and path | Does |
| --------------- | ---- |
| `GET /api/conversations` | the sidebar list, pinned conversations first, each group by its last message, newest first; a row is `id`, `locale`, `created_at`, `last_message_at`, `title`, `title_locale`, `pinned` and `last_source` (below) |
| `GET /api/conversations/<id>` | one conversation, its row as the list shows it with its `messages`: the thread from its first question to its current leaf, each message after the one it follows, in the same number of queries however long; someone else's is **404, not 403** — a 403 would confirm the id exists |
| `PATCH /api/conversations/<id>` | `{"pinned": true}` or `false` pins or unpins it and answers with its row (200); `pinned` is the only field a conversation takes, in a JSON body only (any other is 415), and there is no `PUT`; someone else's is 404 |
| `DELETE /api/conversations/<id>` | deletes one of your conversations with its messages (204); someone else's is 404; a question queued for a conversation deleted meanwhile is refused with 404 `CONVERSATION_GONE` |

- A row's fields other than `pinned` derive from its messages and are never stored: `title` is the first question cut to 60 characters, `title_locale` the language that question was asked in (`Message.locale`: a conversation has no single language), `last_message_at` the time of its last message. `last_source` is what its newest answer with excerpts drew on, `{"courses": [{"name", "locale"}], "web": bool}`: the courses of its slides excerpts in citation order, each once, named as `Course` names them (a code no course holds is shown as stored, with a `null` locale), and whether any excerpt was a university page. An answer refused for want of excerpts is skipped for the one before, and `last_source` is `null` when every answer was. The list costs the same queries for one conversation and for thirty.
- Pinning reorders nothing: the pinned rows follow their last message like the rest, so unpinning returns a row to its place (LibreChat and LobeChat order theirs the same way). A conversation with no messages, which a question refused with a 503 leaves behind, is not listed, opened, pinned or deleted: its id never reached the client.

- The last 3 turns of the thread (`HISTORY_WINDOW_TURNS`, [apps/qa/models.py](../apps/qa/models.py)) go into the prompt with the next question. The window is capped because the 4B model's context is the same space the retrieved excerpts need.
- **The router sees only the student's past questions**; the generator sees whole turns, with answers cut to 400 characters and stripped of their citations (an old `[2]` or marker names an excerpt of that turn, not of this one). History is always one `user` message, never alternating roles: the router is asked to output one JSON object, and a real `assistant` prose turn demonstrates the opposite. The sha256 of both prompts is pinned in `tests/test_agent.py` and `tests/test_answer.py`.
- Answers are **stored as they stream**: question and empty answer are written just before `start`, the text when the stream stops. Under the conversation's row lock the question hangs from the conversation's current leaf, the answer from the question, and the answer becomes the leaf. `complete` is true only when `end` arrived; a half answer is kept, unless the student deletes the conversation, because it is what the student saw and a sample for the M3 error taxonomy. `citations`, `route` and `search_ms` are stored with it, so a stored turn renders exactly like a live one; `search_ms` is `null` on a question.

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
| `GET /api/catalog/editions/<id>/invitations` | the invitations to teach the edition not accepted yet, oldest first, the expired ones included, which stay until revoked: `[{"id", "role", "edition", "programme", "created_by", "created_at", "expires_at"}]`, `edition` as `{"id", "course": {"code", "name", "locale"}, "academic_year"}`, `programme` `null`, `created_by` a username, and never a token. `POST` with `{}` makes one (201, the row with its `token`, in this answer only); both need `edition.assign_teacher` |
| `DELETE /api/catalog/editions/<id>/invitations/<invitation id>` | revokes it (204); an invitation of another scope is a 404 |
| `GET /api/catalog/editions/<id>/syllabus` | the edition's syllabus, `{"locale", "sections": [{"section", "text"}]}`: the one language every section is written in, one of `settings.LANGUAGES`, and the sections in the course catalogue's order, each text in Markdown (CommonMark with GitHub's extensions); a section with no text is not listed |
| `PATCH /api/catalog/editions/<id>/syllabus` | `{"locale": "en"}` sets the syllabus's language and answers with the syllabus; no section is changed or translated; needs `edition.edit_content` |
| `PUT /api/catalog/editions/<id>/syllabus/<section>` | `{"text": "..."}` writes that section's Markdown (200, answering with the section), and a text blank once trimmed clears it (204); needs `edition.edit_content`. `<section>` is one of `SyllabusSection` ([apps/catalog/models.py](../apps/catalog/models.py)); any other matches no route |
| `GET /api/catalog/editions/<id>/readings` | the edition's books, `[{"id", "locale", "title", "authors", "year", "isbn", "url", "importance"}]` by title, `locale` the language the book is written in, a tag Django knows such as `en` or `de`, `year` a number or `null`, `isbn` and `url` `""` when not given, `importance` `required` or `recommended` |
| `POST /api/catalog/editions/<id>/readings` | adds a book (201, answering with it); `locale` defaults to `it`; a title the edition lists is refused as `ALREADY_EXISTS` on `title`; needs `edition.edit_content` |
| `PATCH /api/catalog/editions/<id>/readings/<book id>` | changes the fields the body names (200, the book); `DELETE` removes it (204); both need `edition.edit_content`, and a book of another edition is a 404 |
| `POST /api/catalog/programmes/<code>/secretariat` | makes a user secretariat staff of the programme (201, the member likewise); needs `programme.assign_secretariat`, which only the superuser holds |
| `DELETE /api/catalog/programmes/<code>/secretariat/<username>` | revokes it (204) |
| `GET /api/catalog/programmes/<code>/invitations` | the invitations to the programme's secretariat, as an edition's are listed, with `programme` as `{"code", "name", "locale"}` and `edition` `null`; `POST` makes one; both need `programme.assign_secretariat` |
| `DELETE /api/catalog/programmes/<code>/invitations/<invitation id>` | revokes it (204) |
| `GET /api/catalog/invitations` | every scope's invitations, rows as each scope lists them, for the superuser alone; any other caller gets a 403 `PERMISSION_DENIED`. Each is revoked under its scope |

- Status codes (section *Errors*): 401 not logged in · 404 outside the caller's scope, whether or not it exists · 403 inside it without the permission · then 400 for the body's fields · 405 for a method the route does not serve, `OPTIONS` included. The scope is looked up before the permission and the permission before the fields, so a refusal says nothing the caller may not see; only a body that is not JSON at all is refused first, since the CSRF check reads it.
- Books: a refused field carries `REQUIRED`, `TOO_LONG`, `INVALID`, `TOO_SMALL` or `TOO_LARGE`, and a title the edition lists in that language is a 400 with `ALREADY_EXISTS` on `title`.
- Assigning: an unknown username is a 400 with `NO_SUCH_USER` on `username`, a role the user holds on that scope a 409 `ROLE_ALREADY_HELD`, and each grant and revocation made here writes one `INFO` line to the `apps.roles.grants` logger. To revoke every role of one person, the superuser searches the role assignments for their exact username in the admin.
- Inviting: whoever may assign a role may invite to it, so the statuses are assigning's. Making, revoking and accepting an invitation each write one `INFO` line to the `apps.accounts.events` logger, and an accepted one also the grant's line, as the maker's.

## Errors

Every error of an `/api/` path answers one body, built by `api_exception_handler` in [config/errors.py](../config/errors.py) and mirrored for the interface in [frontend/src/api/errors.ts](../frontend/src/api/errors.ts):

```json
{"error": {"code": "INVALID_ARGUMENT", "message": "The request has fields that were rejected.",
           "data": {},
           "fields": [{"field": "password", "reason": "TOO_SHORT", "data": {"min_length": 15}}],
           "request_id": "4bf92f3577b34da6a3ce929d0e0e4736"}}
```

- `code` comes from the closed table below, and the status is the code's: no view picks a status of its own. A view refuses with `fail(code)`, a serializer with `field_error(reason)`, and DRF's and Django's own exceptions are read by their class.
- `message` is the code's English template filled in with `data`, for the developer and the log. No page shows it, and nothing an exception says reaches it: the interface words each code from its own catalogues, in the interface's language ([decisions.md](decisions.md), 2026-08-27).
- `data` holds the values the code's sentence fills in, as the table names them; numbers stay numbers.
- `fields` lists the rejected fields beside `INVALID_ARGUMENT`, each with a `reason` from the second table and its own `data`. `field` is the path from the top of the body, dots between names and list indexes (`history.0.answer`), or `null` for a refusal of the object as a whole. A code of DRF's or Django's that no reason names is read as `INVALID`, and logged as a WARNING.
- `request_id` is the request's id, also in the `X-Request-ID` header of every response and on every log line the request writes: 32 lowercase hexadecimal characters, the format of a W3C Trace Context trace id. The server makes it and ignores any id the request sends ([config/request_id.py](../config/request_id.py)). How to find a request's lines by it is [development.md](development.md).
- A 401 carries `WWW-Authenticate: Session realm="api"`, and a code that carries `retry_after_seconds` sends the same number as `Retry-After`.
- `POST /api/ask` asks for `text/event-stream`, so its refusals arrive as one `error` event holding the same body; a failure after the stream has begun is an `error` event too, under the stream's own 200.
- Each refusal writes one log line: a WARNING with the method, the route's pattern rather than the path asked for, the status, the code and the message, or for a 5xx an ERROR with the traceback.

`Kind` is what a page does with the code: a `fixable` error is one the reader can act on, and the page shows its sentence alone; a `failure` is one they cannot, and the page adds the code and the request id, for a report. [tests/test_error_contract.py](../tests/test_error_contract.py) keeps both tables equal to `SPEC` and `FIELD_SPEC`.

| Code | Status | Kind | Means | `data` |
| ---- | ------ | ---- | ----- | ------ |
| `INVALID_ARGUMENT` | 400 | fixable | fields were rejected, each named in `fields` | |
| `MALFORMED_REQUEST` | 400 | failure | the request cannot be read: a body that is not JSON or a form past one of Django's `DATA_UPLOAD_MAX_*` limits, a `Host` the site does not serve | |
| `WRONG_CREDENTIALS` | 400 | fixable | the login's username or password is wrong; not a 401, on which the page signs its reader out | |
| `UNAUTHENTICATED` | 401 | fixable | the request needs a session and has none: never had one, past its tier's limits, or ended by another request while it ran | |
| `PERMISSION_DENIED` | 403 | fixable | the signed-in user lacks the permission | |
| `CSRF_FAILED` | 403 | failure | the CSRF token is missing or does not match; reloading the page fixes it | |
| `NOT_FOUND` | 404 | fixable | no such object within the caller's scope, or no route for the path | |
| `CONVERSATION_GONE` | 404 | fixable | the conversation a question names does not exist, or was deleted while the question waited | |
| `LINK_EXPIRED` | 404 | fixable | a link's token is unknown, used, replaced by a newer link or past its time | |
| `METHOD_NOT_ALLOWED` | 405 | failure | the route does not serve the method | |
| `NOT_ACCEPTABLE` | 406 | failure | no response matches `Accept` | |
| `ROLE_ALREADY_HELD` | 409 | fixable | the user holds the role being granted, on that scope | |
| `SELF_NOT_ALLOWED` | 409 | fixable | a superuser's change to an account is asked of the caller's own | |
| `ACCOUNT_STILL_ACTIVE` | 409 | fixable | an account is deleted only once deactivated | |
| `ROLES_HELD` | 409 | fixable | an account holding a staff role deletes itself only once its roles are revoked | |
| `LAST_SUPERUSER` | 409 | fixable | the last active superuser cannot delete their own account | |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | failure | the route parses no body of that `Content-Type` | |
| `RESOURCE_EXHAUSTED` | 429 | fixable | throttled | `retry_after_seconds` |
| `INTERNAL` | 500 | failure | anything no row names; the traceback is in the log line | |
| `UNAVAILABLE` | 503 | fixable | another question is being answered; the page asks again by itself | `retry_after_seconds` |
| `ENGINE_DOWN` | 503 | failure | a service the answer needs, the model server or Qdrant, is not running | |

| Reason | Means | `data` |
| ------ | ----- | ------ |
| `REQUIRED` | missing, blank or null | |
| `INVALID` | not a value the field takes, or a code no reason names | |
| `TOO_LONG` | longer than the field takes, a password included | `max_length` |
| `TOO_SHORT` | shorter than the field takes, a password included | `min_length` |
| `TOO_SMALL` | below the field's least value | `min_value` |
| `TOO_LARGE` | above the field's greatest value | `max_value` |
| `ALREADY_EXISTS` | another row holds the value: a username, a book's title in its edition | |
| `NO_SUCH_USER` | no account has the username | |
| `TOO_COMMON` | a password on Django's list of common ones | |
| `BREACHED` | a password Pwned Passwords holds as seen in a breach (outside the repository) | |
| `TOO_SIMILAR` | a password too close to the account's username or name | |
