# Experiment log

What was measured, on which data and with which command, and the problems met along the way. One entry per date, newest first; every number is reproducible with the commands in its entry's *Reproducibility* section. Decisions are owned by [decisions.md](decisions.md); the thesis chapter on experiments is written from this log (`#42`).

## 2026-09-28 — The slides points move to their edition key without re-embedding

### 1. What moved

`rag/relabel.py` at `3ebc020` moves each slides point to its post-`#96` edition key without touching its vector: it scrolls the point's stored vector and payload, upserts them under the new id with the edition fields added, verifies the vector survived unchanged, then deletes the old id. `course` moves from `"PPM"` to `"B028451"`, `academic_year` from unset to `"2025-2026"`, and `chunk_id` is recomputed under the post-`#96` rule that folds both into the id.

Before the run, the whole index was copied to `data/backup/96/` (the `qdrant` directory identical to the source, 413496400 bytes; 31 sidecars; 31 chunk files) as the rollback point.

A dry run (`--dry-run`) reported it would move 1234 points across 31 source files and rewrite 31 sidecars and 31 chunk files (1234 lines); opening the embedded client took 27.50 s and peaked at 1627.7 MiB, because the same client also loads `unifi_web`'s 29098 points.

The real run scanned 1234 points (31 source files); every id matched the pre-`#96` rule, and the 1234 old-id → new-id pairs were recorded to `data/relabel-96/ids-20260928T184623Z.json` before anything was written. It upserted the 1234 points under their new ids, in batches of 256 (3.49 s), then **reopened the client** (4.78 s) and compared vectors against what that fresh client read back: **1234/1234 identical**. Only then did it delete the 1234 old points (2.82 s) from the id list recorded at scan time, and rewrite the 31 sidecars and 31 chunk files (1234 lines, 0.12 s). The comparison runs on a reopened client because the embedded client normalises cosine vectors in memory as it works with them; only the persisted state on disk keeps the raw values it actually wrote, so comparing against the in-memory copy would not have caught a write that landed wrong.

Final invariants held: 1234 slides points in the collection = 1234 chunk ids across the 31 chunk files, the two id sets equal, 0 points labelled `PPM`, and `unifi_web` unchanged at 29098 points both before and after (a fresh open reports 29098 too).

### 2. The smoke gold before, between and after

Three runs of `gold/smoke.jsonl` (40 questions, rerank path) isolate the relabel from the scope filter that `#96` also added:

| Run | What it ran | What it isolates | hit@5 |
| --- | --- | --- | --- |
| before | branch code, `rag.gold.EVAL_SCOPE` forced to `None`, on the index before the relabel | the search as it ran before `#96`'s scope existed | 38/40 (95%) |
| mid | the same forced-`None` run, on the relabelled index | the relabel alone (scope disabled in both) | 38/40 (95%) |
| after | branch head, scope pinned to `B028451:2025-2026` | the scope filter alone (relabel applied in both) | 38/40 (95%) |

`before` and `mid` were meant to compare the pre-scope commit against the relabelled index; forcing `EVAL_SCOPE` to `None` for one run reproduces that comparison without leaving the branch. The per-question HIT/MISS columns and the `top:` column are identical before→mid (the relabel changed nothing the ranking depends on) and mid→after (the scope filter changed nothing, because every point belongs to the one edition it names). Both misses are `q028` in all three runs (`4.2 Docker.pdf` p.11 wanted, `4.1 Docker.pdf` p.58 returned), unrelated to `#96`.

The scope filter was also checked directly on the relabelled index: `rag.search "Cosa sono le migrazioni?" --scope B028451:2025-2026 --no-rerank` returns slides (top: `2-orm_django_2025.pdf` p.24); the same question with `--scope B028451:2024-2025` — an edition the corpus does not hold — returns none.

### Reproducibility

```powershell
# dry run, then the real run, both at 3ebc020
.venv\Scripts\python.exe -m rag.relabel --from-course PPM --to B028451:2025-2026 --dry-run
.venv\Scripts\python.exe -m rag.relabel --from-course PPM --to B028451:2025-2026

# smoke gold: before/mid force the scope off, after pins it (branch head)
.venv\Scripts\python.exe -c "import rag.gold as g; g.EVAL_SCOPE = None; g.main(['gold/smoke.jsonl'])"
.venv\Scripts\python.exe -m rag.gold gold/smoke.jsonl

# the scope filter alone
.venv\Scripts\python.exe -m rag.search "Cosa sono le migrazioni?" --scope B028451:2025-2026 --no-rerank
.venv\Scripts\python.exe -m rag.search "Cosa sono le migrazioni?" --scope B028451:2024-2025 --no-rerank
```

Rollback point: `data/backup/96/` (copied before the run). Id map: `data/relabel-96/ids-20260928T184623Z.json` (1234 pairs). `rag/relabel.py` at `3ebc020` is a one-off script, deleted in the commit that records this entry.

## 2026-09-14 — A pypdf upgrade changes the extracted text without changing the routing

### 1. The comparison

The upgrade of `pypdf` from **6.16.1** to **6.18.1** (a Dependabot pull request) was accepted only after measuring `rag.probe` on the whole corpus before and after it, because CI runs no ingest and could say nothing about it.

Page counts and image counts are **identical in all 31 documents**. Only the density of extracted text changes, and it **always changes in the same direction**: 12 documents out of 31 return more characters per page, none returns fewer.

| Document | 6.16.1 | 6.18.1 | Δ |
| --- | --- | --- | --- |
| Progetti Esercitazione Back-end PPM 2026 | 3975 | **4362** | +9.7% |
| javascript_info_set2 | 540 | **557** | +3.1% |
| javascript_info_set1 | 461 | **474** | +2.8% |
| jquery_basics | 465 | **478** | +2.8% |
| javascript_browser_document_events_interfaces | 566 | **581** | +2.7% |
| 1.1 Course intro 2025 (2) | 261 | **268** | +2.7% |
| 2.3 IMAGES LOSSY COMPRESSION 2024 | 413 | **423** | +2.4% |
| 3.2b VIDEO H261-H262 2024 | 410 | **418** | +2.0% |
| 4.1 Docker | 350 | **357** | +2.0% |
| 3.1b VIDEO GENERAL CONCEPTS 2024 | 537 | **547** | +1.9% |
| 4.2 Docker | 342 | **348** | +1.8% |
| 3.3b VIDEO H264-H265 2024 | 1009 | **1020** | +1.1% |
| *(the other 19)* | — | *unchanged* | 0 |

The cause was not investigated: accepting the upgrade only required knowing that the routing verdict did not change. That the sign is always positive suggests an upstream fix in text-layer extraction, not a regression.

### 2. What did not change, which is why the upgrade was accepted

Adaptive routing is **identical**: the same 4 documents need formula enrichment (`2.1 IMAGES GENERAL`, `2.3 IMAGES LOSSY`, `3.2b VIDEO H261-H262`, `3.3b VIDEO H264-H265`, all because of the maths font `SymbolMT`), the same single document needs OCR (`3.5-HTML5-Part-2`, 50% of pages without a text layer), and the other 26 stay `classic`. Zero false positives, as in the original measurement.

Retrieval is unchanged as well: `gold/smoke.jsonl` returns **38/40 (95%)** before and after, with the same two misses (`q018`, `q028`). The measurement was also repeated after the upgrade of `qdrant-client` from 1.18.0 to 1.19.0, accepted in the same session.

### 3. The consequence for reproducibility

Two numbers recorded earlier in this log date from 2026-07-31, when `pypdf` was not a locked dependency and its version was not recorded: the corpus's **~650 000 characters** (entry of 2026-07-31) and the OCR gain on `3.5-HTML5` (**10001 → 20032 characters**, entry of 2026-08-02, section 2). This entry first said they were produced with 6.16.1, the version it upgraded from. They are not wrong, but they **depend on the version of the extraction library**, exactly as generation results depend on the model revision. The version of the parsing stack therefore joins the reproducibility list of [architecture.md](architecture.md).

### 4. The relevance gate: 17/20 — and the finding that the number is not comparable

`rag/live.py` uses `pypdf` for a second purpose: reading a sample of the text layer of a PDF fetched from the web, to hand to the relevance gate. Since extraction returns more text, the sample changes, and the verdict could change with it. The measurement was therefore repeated: `uv run python -m rag.live --measure-gate` returns **17/20**, against the **18/20** recorded on 2026-08-24.

**That comparison is not valid, and the reason is more interesting than the number.** `run_gate_measurement()` receives a *fetcher*, and `gold/relevance-gate.jsonl` holds only `{url, label, note}`: no snapshot of the content, no hash. Every run **fetches the twenty pages live again** and judges what they say that day. The 18/20 judged the web of 24 August, the 17/20 that of 14 September. Between the two measurements the `pypdf` version changed, but so did the input — and without a fixed input there is no controlled experiment. The difference **cannot be attributed** to the upgrade.

The three disagreements make it concrete:

| URL | Label | Verdict | The model's reason |
| --- | --- | --- | --- |
| `testcisia.it/calendario.php?tolc=ingegneria` | relevant | irrelevant | `elenca date TOLC di atenei diversi da Firenze` (lists TOLC dates of universities other than Florence) |
| `cercachi.unifi.it/cercachi-per-13.html` | relevant | irrelevant | `rubrica telefonica del personale, non un servizio agli studenti` (a staff phone directory, not a student service) |
| `sol.unifi.it/tesionlinestudente/engine` | irrelevant | **relevant** | `servizio Tesi Online di ateneo, è un servizio allo studente` (the university's Tesi Online service, a student service) | <!-- spellchecker:disable-line -->

The first is a **calendar page**: its content changes by definition, and three weeks apart it lists different sessions. The other two are not model errors but **debatable labels**: a staff directory is a service of the university but not of the student, and submitting the thesis is certainly a student service — on the third case the model's reason holds better than the label.

A methodological conclusion follows that reaches beyond this session. On twenty items, at least two of them with a debatable label, the difference between 18/20 and 17/20 is **smaller than the uncertainty of the measurement**; and as long as the content is not frozen, this instrument cannot serve as a non-regression test, which is exactly the use it was being put to here. The campus corpus has this discipline — a frozen snapshot, `ingest_source="crawl"` kept apart from `"live"` — and the gate's labelled set does not. The gap is `#83`.

### Reproducibility

```bash
uv run python -m rag.probe data/corpus/PPM      # routing over all 31 documents
uv run python -m rag.gold gold/smoke.jsonl      # hit@5 on the smoke set
uv run python -m rag.live --measure-gate        # 17/20 in section 4; needs Ollama
```

Versions compared: `pypdf` 6.16.1 → 6.18.1, `qdrant-client` 1.18.0 → 1.19.0. Corpus unchanged in `data/corpus/PPM` (31 PDFs); index unchanged in `data/qdrant/` (collection `slides`; `unifi_web` at 29098 points). No reindexing was run: `rag.probe` writes nothing, and the comparison concerns extraction, not vectors.

## 2026-08-27 — Acceptance run of the web interface: multi-turn conversation, anaphora resolution, transcription instead of an answer

### 1. The manual acceptance run of M5

The whole interface (`frontend/`, served by Django on its own root: `npm run build --prefix frontend`, then `uv run python manage.py runserver` → `127.0.0.1:8000`) was walked through by hand in one session. Registration, login, a course question, a campus question, switching between the three languages, switching theme, reopening a conversation from the sidebar, a narrow window, reloading on `/c/<id>`: no defect on the interface side. Source cards and numbered references reappear on conversations read back from the database, which is why `citations` and `route` are stored with the answer text — the `start` event that carried them no longer exists when the conversation is read back.

The two defects described below belong to generation, not to the interface.

### 2. Multi-turn anaphora resolution: a first, favourable observation

The follow-up turn was resolved correctly in a real case not designed as a test:

| Turn | Question | `RouteDecision.reason` |
| --- | --- | --- |
| 1 | `我九月就要毕业了，查看毕业时间` (I graduate in September; look up the graduation dates) | `毕业时间是官方公布的固定信息，属于 unifi_web 范畴…` (graduation dates are fixed official information, within the unifi_web scope…) |
| 2 | `我是 ingegneria informatica 的` (I am in computer engineering) | `学生是信息工程专业，需要查询该专业毕业时间，此信息属于大学官方行政信息…` (the student is in information engineering; **the graduation dates of that programme need looking up**; this is official university administrative information…) |

The second question contains no literal reference to the graduation date: it only says which degree programme the student belongs to. The antecedent was recovered from the previous question, which is exactly what injecting the history into the router has to produce.

Its evidential value is limited: **one case is not a measurement**. The reported routing accuracy (exact 22/32) is a single-turn figure, while the system demonstrated is multi-turn; `gold/campus.jsonl` holds no follow-up questions, and measuring multi-turn routing needs such a set first (`#22`).

The injection shape chosen at design time is confirmed: the router receives **only the student's questions**, never the answers. Two reasons, both visible in this session — a pronoun's antecedent is in the previous question, not in the answer; and answers are dense with web markers such as `[https://ingegneria.unifi.it/… · 2026-08-22]`, which after three turns would pull any new question, course questions included, towards `unifi_web`.

### 3. Transcription instead of an answer: a new bucket for the taxonomy

On the second turn the model wrote no answer: it **copied the retrieved excerpt**, opening its output with `[Excerpt 1] Ingegneria Informatica (INM 270/04) (INF PO INS 509/99) …` and continuing with the full transcription of the calendar row, administrative codes included. The content is correct and relevant; what is missing is the act of answering — no selection of the date that concerns the student, no sentence.

The defect is **distinct** from the one recorded on 2026-08-21 and 2026-08-25 under citation-marker conformance, although it shares the surface symptom `[Excerpt N]`. There the model wrote an answer and got the marker wrong; here it writes no answer at all. It is recorded as a bucket of its own in the error taxonomy (`#23`): **transcription instead of an answer**, with the hypothesis to verify that the trigger is a very short follow-up turn (a statement, not a question) combined with a densely structured tabular context.

The interface absorbs half of it by construction: source cards are rendered from retrieval metadata, not from the model's text ([decisions.md](decisions.md), 2026-08-21, *The campus source and the agent*, point 6), a decision taken because the markers are unreliable. The other half — a turn that does not answer — stays visible to the student and belongs to generation.

### Reproducibility

Session run on `127.0.0.1:8000` with `DEBUG=True`; PostgreSQL 18 through `docker compose up -d` (no profile: stateful services only), Django and `rag/` on the host under `uv run` for GPU access. Collection `unifi_web` at 29098 points, `slides` at 1234. Models: Qwen3-Embedding-0.6B and the Qwen3 0.6B reranker on CUDA, LLM `qwen3:4b-instruct-2507-q4_K_M` through Ollama, `temperature=0.0` for routing and generation, `seed=0` for routing only (`apps/qa/engine.py`). The routing decisions quoted come from the console log of `uv run python manage.py runserver`.

## 2026-08-25 — Asking over HTTP, citation conformance, the limit of the local machine

### 1. The cross-language path holds end to end on the endpoint

With the endpoint `POST /api/ask` (not streaming at the time, `apps/qa/`) the chain routing → retrieval → generation was driven for the first time by a client outside the terminal. Three languages, campus corpus (Italian):

| Question | Detected `locale` | Routing | Outcome |
| --- | --- | --- | --- |
| `学费什么时候交？` (When are tuition fees due?) | `zh` | `unifi_web` | query rewritten in Chinese (`学费缴纳时间`, tuition payment dates), 5 excerpts retrieved |
| `Quando si pagano le tasse universitarie?` (When are university fees paid?) | `it` | `unifi_web` | complete and correct answer |
| c003 · c008 · c018 (Chinese, `gold/campus.jsonl`) | `zh` | `unifi_web` | fluent answers in Chinese |

**The thesis's central capability — a question in any language, an Italian corpus, an answer in the language of the question — is verified on Chinese as well**, not only on Italian as in the entry of 2026-08-21.

One question degenerates reproducibly: `学费什么时候交？` (When are tuition fees due?) produces the output `[febbraio]` (Italian for "February"; two identical runs) although it retrieved the same 5 excerpts that, asked in Italian, give a correct answer. The defect is in generation, not retrieval, and specific to the pair (short question, Chinese): the other three Chinese questions do not show it. It goes to the error taxonomy (`#23`); it is not an endpoint defect.

### 2. Citation-marker conformance is the systematic problem

The generation prompt (`rag/answer.py`) spends three lines demanding a **character-for-character** copy of the bracketed marker. In none of the real runs of the day did the model follow it:

| Question language | Corpus | What the model wrote |
| --- | --- | --- |
| English | slides | `[Excerpt 1]` |
| Italian | campus | `[Excerpt 1][Excerpt 3][Excerpt 4][Excerpt 5]` |
| Chinese | campus | markdown links, e.g. `[毕业学期日历](p602.html)` (graduation-term calendar) |

The `cited` field of the answer contract (`apps/qa/contract.py`) was a literal substring test and reported `false` on every citation: **the field was not broken, it was counting honestly**. A citation-fidelity metric for M3 follows from it (`#27`).

The fix (prompt or model size) was **deferred** on purpose: the generation prompt is part of the chain the automatic-growth remeasurement runs, and changing it would add a variable to a measurement meant to isolate two others.

### 3. The local machine cannot host the automatic-growth remeasurement

An attempt to re-run the main arm of the automatic-growth acceptance run (protocol of the entry of 2026-08-24, `run_id` `live-retest-main`). Clean pre-test: **0/7**, collection at 29098 points. The run was stopped during the second question:

| Phase | Measurement |
| --- | --- |
| g001 | answers at step 0 without any fetch — behaviour **unchanged** after the two fixes, as expected (they fixed the forced choice and the blind graph, not the saturated sufficiency judgement); the answer is correct and cites form RIT_02, but URL scoring marks it MISS |
| g002 | dense encoding on CPU: one batch at **293.30 s/it** (19 min 33 s for 4 batches) and one at 55.93 s/it; more than 25 minutes spent without nearing the end of the seven questions |

The 1470 s batch recorded on 2026-08-24 as probable thermal throttling **is not an anomaly but this machine's normal regime**. The estimate of about two hours per arm is wrong, and the real cost has no upper bound.

No write reached the knowledge base: `unifi_web` stayed at 29098 points and the points with `ingest_run_id='live-retest-main'` are **0** (g001 fetched nothing; of g002's two fetches, one was unchanged from the crawl and the other was rejected by the gate). No rollback was needed.

**Operational consequence**: measurements that involve the LLM move to the MICC server; the local machine is for development and functional checks. The split is possible because `rag/` does not import Django and runs outside the web. The decision is [decisions.md](decisions.md), 2026-08-25, *Where measurements run*.

### 4. Moving to SSE streaming: two constraints that are not obvious

`POST /api/ask` was converted to **server-sent events** and has no non-streaming form: generation takes tens of seconds, and a client waiting for it in silence is precisely the defect streaming removes. The stream is a `start` event (language, routing decision, grounding excerpts), a `token` event per generated fragment and a closing `end` event — whose absence is the failure signal.

Two constraints came up during implementation and are recorded because they shape the architecture chapter.

**The status code exists only before the first byte.** The response headers leave with the first event: a generation endpoint that dies mid-answer can no longer become a 503. The engine's generator is therefore *primed* explicitly in the view (a first `next()`), so that routing and retrieval happen while a status response is available; whatever fails afterwards travels as an `error` event inside a 200 whose headers have left. The boundary can be checked both ways: a model never pulled (404 from the server during routing) stays a 503, a switched-off generation endpoint produces the sequence `["start", "error"]`.

**The response body cannot be a generator.** The lock that serialises answers (one GPU, one embedded index) is taken when the view primes the stream and released when the stream is closed. Django closes the response when the client leaves — exactly the case where a generator fails: closing a generator **never iterated** runs nothing, because its body never started and has no `finally` to run. A reader that closed the connection without reading a single byte would leave the lock held, and from then on every question would get a 503. The response body is therefore a class with an explicit `close()`.

The check was adversarial: with the generator version put back, the test `test_a_client_that_never_reads_a_byte_releases_the_lock` fails reporting `<locked _thread.lock object>`, while the complementary test — a reader that stops *after* the first fragment — keeps passing. The two cases are distinct and both are needed.

A useful side effect: since closing propagates to the generator suspended in `rag/answer.py`, **a reader who leaves also cancels the generation**; the queue moves to the next question at once instead of letting the model write for nobody.

A note on DRF: content negotiation happens *before* the handler runs (`APIView.initial`). Without a renderer declaring `text/event-stream`, the endpoint would reject with 406 a client asking for the only media type the endpoint speaks. The added renderer serves negotiation only: a successful response never goes through it.

Consequence for the contract: the `cited` field was removed from citations. A marker is regularly split between two `token` events, so the substring test is meaningful only on the reassembled answer — which is what the client holds, together with the marker. The citation-fidelity metric announced in section 2 does not disappear but moves: it belongs to the M3 evaluation path (`rag/`, where the gold sets run), not to the API.

### Reproducibility

Endpoint: `uv run python manage.py runserver`, then `POST /api/ask` with a JSON body encoded **explicitly in UTF-8** (Windows PowerShell 5.1's `Invoke-RestMethod` encodes a string body in ASCII when the `Content-Type` declares no charset: Chinese questions reached the server as `????????` and were routed to `both` with `locale=en`). Automatic-growth pre-test: `uv run python -m rag.gold gold/campus-autogrow.jsonl --live on`. Models as in the previous entry: Qwen3-Embedding-0.6B, the Qwen3 0.6B reranker, LLM `qwen3:4b-instruct-2507-q4_K_M` through Ollama, `temperature=0.0`.

## 2026-08-24 — Relevance gate, deepening loop, automatic-growth acceptance run

### 1. Relevance gate: 15/20 → 18/20 without touching the labels

The LLM gate (Qwen3-4B q4, binary JSON verdict, `temperature=0.0`, `seed=0`) was measured against a labelled set of 20 URLs **frozen in a commit of its own before any measurement** (`gold/relevance-gate.jsonl`, 10 relevant + 10 irrelevant, taken from the graph of links the crawl had not fetched): the discipline "freeze the ruler, then measure" rules out adjusting the labels afterwards by construction.

- **First measurement: 15/20.** The five disagreements (the causes below add up to six; the original record does not say which two overlap): two systematic false negatives (TOLC calendars rejected because they name other Tuscan universities), one systematic false positive (a commercial housing platform that calls itself an "official service"), one design case (a PDF that can be judged only by its file name), two debatable borderline cases.
- **Changes — to the gate only, never to the labels**: two rules added to the system prompt (student services at Tuscan regional scale — DSU, CISIA/TOLC — serve UniFi students too; the operator test: an institution publishing its own information versus a company selling something) and a text preview for PDFs (`pypdf`, first page, text layer only: a glance, not a parse — the classic pipeline's cost cannot be paid before the gate).
- **Second measurement: 18/20 ≥ 18 (the threshold).** One revision round. The two remaining disagreements are the known borderline cases: the internal phone directory (label relevant, gate irrelevant) and the Tesi Online login page (a hard negative; the gate lets the service name convince it).

With greedy decoding and a fixed seed, the repeated measurement gives identical verdicts (checked on the routing report too, run twice with the same outcome); the gate's agreement does not rest on sampling luck. Remeasured 2026-09-14: 17/20, not comparable (entry of 2026-09-14, section 4).

### 2. GPU memory and time budget (RTX 4070 Laptop, 8 GB)

- **Peak VRAM over the whole acceptance run: 7923 MiB < 8188**, **+162 MiB** over the 7761 baseline of 2026-08-21 (< 200 allowed). Sampling with `nvidia-smi -l 1`: a 1 Hz resolution can in principle miss sub-second peaks, and the remaining margin (265 MiB) covers that uncertainty.
- **PDF parsing on CPU**: the corpus's largest PDF (18.4 MB, capped at 40 pages, classic pipeline) takes **68.8 s / 65.9 s** over two runs. The parsing budget was therefore separated from the step clock (60 s) and set to **120 s** (`PDF_PARSE_TIMEOUT_SECONDS`): parsing held within 60 s would make exactly the long documents (decrees) the live layer exists for impossible to store. In the acceptance run real parsing peaked at 46.6 s.
- **Dense encoding on CPU, outside the step clock**: 13 chunks ≈ 77 s, 18 chunks ≈ 117 s; one anomalous batch of **1470 s** (24.5 min; recorded as probable thermal throttling, the machine's normal regime per the entry of 2026-08-25, section 3) produced no false timeout — empirical confirmation of not counting parsing and encoding in the step budget (counting them would have marked every successful write as lost).
- **Step clock (60 s)**: covers the four network/LLM waits (the "enough to answer?" judgement, the candidate choice, the fetch, the gate); reloading the model after unloading it (`ollama stop`, `maybe_unload_llm()` in `rag/live.py`) falls by construction on the first LLM call of the next step and is therefore **inside** the budget. Per-request LLM ceiling: 30 s (the SDK default of 10 minutes would make any budget fictitious).

### 3. Automatic-growth acceptance run: 0/7 on both arms (target ≥ 5/7 not reached)

Protocol (knowledge base restored to the snapshot state before each arm; one `run_id` per arm, rollback in one command):

1. pre-test `--live on`: **0/7** (clean baseline: none of the 11 answer pages is in the snapshot);
2. seven questions end to end (`rag.agent`, `--question-id` for attribution, `--run-id live-stage9-autogrow`);
3. post-test `--live on`: **0/7**; rollback (33 points removed → 29098);
4. degraded arm `--no-deepen` (`live-stage9-nodeepen`): post-test **0/7**; rollback (31 points → 29098).

| Question | Main arm | `--no-deepen` arm | Attribution |
| --- | --- | --- | --- |
| g001 | answers at step 0, no fetch | identical | **saturated judgement**: the index page `moduli-e-certificati` (forms and certificates) is enough for the 4B model; the answer is correct and cites form RIT_02, but the target PDF is never fetched — URL scoring and answer quality diverge |
| g002 | 3 steps, 2 correct gate rejections, 1 irrelevant page | empty candidate pool | lost context ("Annex 1" without the call it belongs to); the top hits are PDFs, which carry no outlinks |
| g004 | 3 fee/ISEE pages stored (21 chunks), not the target ones | 3 irrelevant PDFs | **forced choice**: the model states that no candidate is relevant but, having to pick one, picks — the choice prompt offers no "none" option |
| g005 | 2 neighbouring pages + 1 correct rejection (commercial platform) | empty pool | pages semantically close to the gold one but different |
| g006 | the gate rejects the governance page → ephemeral → **correct and complete answer** | 3 off-topic PDFs | the gate's "student services" criterion does not cover governance questions; the ephemeral branch keeps its promise (a gate error costs the knowledge base, not the answer) |
| g007 | empty pool | identical | the top hits are PDF guides: no outlinks in the registry → blind graph |
| g008 | routed to `slides` | identical | routing error (a campus question classified as course material) |

**The equality of the two arms is itself the result**: the failure does not depend on following links (the one variable designed to differ between the arms, noting that the arms also differ in top-5 truncation) but on four bottlenecks upstream — the saturated sufficiency judgement, a forced choice with no option to refuse, wrong routing, and a gate criterion misaligned on governance questions. These four, plus the blind graph of PDFs, form the skeleton of the error taxonomy (`#23`).

The infrastructure, on the other hand, was entirely validated in the field: the gate correctly rejected 4 unsuitable candidates in production; the three-state incremental log classified every write honestly (6 × `first fetch`, 6 × `content changed`, no wrong skip); both rollbacks returned the collection to exactly 29098 points; read isolation held (campus 28/32 **with** 33 live points in the collection).

### 4. Final regressions (after rollback, collection at 29098 points)

| Set | Outcome | Invariant |
| --- | --- | --- |
| campus (32 questions) | **28/32 = 88%** (EN 92% · IT 85% · ZH 86%) | same misses: c003 · c011 · c012 · c034 |
| smoke slides (40) | **38/40 = 95%** | same misses: q018 · q028 |
| control (5) | **5/5 = 100%** | — |

Two complete runs with live writes and rollbacks left the snapshot untouched: the read/write split (the `ingest_source` filter in the prefetch branches; deletion bound to `(url, ingest_source)`) is verified end to end.

### 5. Routing accuracy on the campus set

The router (`route()` in `rag/agent.py`) was scored on the 32 questions of `gold/campus.jsonl`: **exact 22/32 · wide 26/32**, `both` chosen 4 times, 0 fallbacks, identical over two runs. *Exact* counts a routed target equal to the question's `target`, so `both` is a miss; *wide* accepts any routed set that contains the target (`RoutingReport` in `rag/gold.py`). The router prompt measured is pinned by its hash in `tests/test_agent.py` (`ROUTER_PROMPT_SHA256`): changing the prompt requires rerunning this report in the same commit. The figure is single-turn (entry of 2026-08-27, section 2).

### Reproducibility

**Measured configuration**: every figure in this entry comes from commit `ee15f37`; both arms ran on the same tree (no code change between the two runs). Afterwards, **without remeasuring**, two design defects the run itself exposed were fixed: the candidate choice admits an explicit refusal ("none of the candidates can contain the answer"), and candidates are traced back through the `referrer_url` when the retrieval hits are PDFs without outlinks. Both fixes stand on their own — a forced choice writes into the shared knowledge base pages the model itself calls irrelevant; a blind graph shuts a whole class of questions out of deepening — but **their effect on the score is not measured**. The remeasurement runs in M3 on the size grid (`#24`): a comparison with the 0/7 here has to keep in mind that two variables changed together (the fixes and the model size).

Gate: `uv run python -m rag.live --measure-gate` (labels in `gold/relevance-gate.jsonl`). Run: `uv run python -m rag.agent "<question>" --question-id gNNN --run-id live-<id>` for the seven questions of `gold/campus-autogrow.jsonl`; scoring with `uv run python -m rag.gold gold/campus-autogrow.jsonl --live on`; rollback with `uv run python -m rag.live --rollback <run_id>`. Routing report: `uv run python -m rag.gold gold/campus.jsonl --routing`. Decision log per question in `data/webcorpus/decisions.jsonl` (outside the repository). Models: Qwen3-Embedding-0.6B (CPU for the live branch), the Qwen3 0.6B reranker, LLM `qwen3:4b-instruct-2507-q4_K_M` through Ollama, `temperature=0.0`, `seed=0`.

## 2026-08-23 — Outlinks and candidate ranking for the deepening loop

### 1. How many links a page offers

In the registry of the two seed crawls, a page has a median of **79** non-PDF outlinks (p90 **138**, max **232**; all outlinks: **83 / 143 / 640**), and PDF outlinks reach p90 **9** and max **408**. A cap of 10 candidates drops about nine links in ten, so the ranking has to be explicit rather than follow DOM or registry order; the rule is in [unifi-web-source.md](unifi-web-source.md). Every attachment row in the registry on 2026-08-24 (**132/132**: 127 from the first crawl, 5 written live by the run `live-stage9-nodeepen`) appears among its carrier page's outlinks, which is why pages the retrieval returned are excluded from the candidates.

### 2. Offline ranking quality

On the gold questions with their real carrier pages: g001's correct PDF ranks **2/32**, with a margin of **+0.267** at the top-5 boundary; g002's ranks **3/40**, margin **+0.056**. Both are inside the top 5, so none of the named fallbacks (lexical pre-filter, GPU encoding window, anchor-vector cache) was needed. g002's thin margin is a known weak point: a sibling PDF on the same page has a word-for-word identical anchor, and the only distinguishing signal is the DOM section heading, which `extract_links` does not collect (`#23`).

### Reproducibility

Registry `data/webcorpus/registry.jsonl` of the 2026-08-22 crawls (outside the repository); ranking by `narrow_candidates()` in `rag/agent.py` with the CPU dense encoder, as of commit `52cd016`, which recorded these figures. No CLI runs the ranking on its own, and the counting method behind the outlink statistics was not recorded; the registry has grown with live rows since.

## 2026-08-22 — Two seed crawls of the campus website

### 1. The crawls

| Run | Site sections | Items fetched | At the 500-item cap |
| --- | --- | --- | --- |
| `crawl-20260822-143647` | `ingegneria` **497** (**370** pages + **127** PDFs) · `servizi` **1** | **498** | 940 URLs left in the queue |
| `crawl-20260822-164843` | `servizi` **327** · `mobilita` **74** · `international` **99** | **500** pages | 2101 URLs left in the queue |

Together: **998** items (**871** pages and **127** PDFs) over 4 site sections, indexed as **29098 points** in `unifi_web` — the count the evaluation isolation and every rollback are checked against (entry of 2026-08-24). The figures first recorded ("497 pages + 127 PDFs", `servizi` 328, 501 pages in the second run) counted the PDFs twice and summed `servizi` over both runs; the numbers above are read from each run's `manifest.json` and from the registry. Office attachments are not followed: the **46** found in the first crawl were all blank application-form templates.

### Reproducibility

```bash
uv run python -m rag.crawl --out data/webcorpus --sections servizi,mobilita,international    # the second run
uv run python -m rag.webparse data/webcorpus/<run_id>
uv run python -m rag.chunk data/webparsed/<run_id> --out-dir data/webchunks/<run_id>
uv run python -m rag.index data/webchunks/<run_id> --collection unifi_web
```

The first run used an earlier scope table, recorded in its manifest (`ingegneria` `/`, `international` `/international`, `servizi` `/vp-`; no `mobilita`), so the current `DEFAULT_SCOPE` reproduces the second run only. Snapshots in `data/webcorpus/` (outside the repository); code as of commit `20ab9f2`.

## 2026-08-21 — Full corpus indexing, the extended gold set, local generation

### 1. Index expansion: from 4 to 31 slide decks

The whole PPM corpus (31 PDFs, ~1200 pages) was converted and indexed locally (RTX 4070 Laptop GPU, 8 GB):

| Phase | Command | Outcome |
| --- | --- | --- |
| Parsing | `uv run python -m rag.parse data\corpus\PPM` | 31/31, ~15 min |
| Chunking | `uv run python -m rag.chunk data\parsed` | 31/31, **1234 chunks** |
| Indexing | `uv run python -m rag.index data\chunks` | collection `slides`, count = 1234 |

Adaptive routing confirmed the distribution the probing phase predicted: 26 `classic` files, 4 `classic-formula`, 1 `classic-ocr`. Parsing took far less than the initial estimate (~1 h): the layout models run on CUDA, and the OCR engine Docling selects (RapidOCR/onnxruntime) is an order of magnitude faster than the earlier measurement with EasyOCR (527 s for the deck `3.5-HTML5-Part-2`).

### 2. Retrieval evaluation: a 40-question gold set and a control group

The smoke set grew from 2 to **40 questions** (stratified coverage of the 31 decks; drafted by an LLM from the chunks and checked by hand against the cited sources). Against inflation, a **control group** of 5 questions was written directly from the original PDFs, without looking at the chunks, to measure any lexical leakage between the wording of a question and the indexed text.

| Set | hit@5 (rerank on) |
| --- | --- |
| smoke (40 questions, EN→EN) | **38/40 = 95%** |
| control (5 questions) | **5/5 = 100%** |

The control group does not score lower than the main group: no inflation from lexical leakage is measurable, and the 95% is taken as reliable. The two misses are instructive near misses for the error taxonomy (`#23`): `q018` (media queries) retrieves the right deck but an adjacent page with overlapping meaning; `q028` (the exec form of CMD) suffers competition between the two Docker decks, whose contents overlap.

A side observation: the text extracted from the PDFs carries typographic noise (`E XAM G RADING`, `c1ass`, `handleerrors`) that hurts BM25's lexical recall; the dense branch is immune to it (`#23`).

### 3. Local generation with Ollama (Qwen3-4B instruct, q4_K_M)

The first end-to-end check of the retrieval → generation chain running entirely locally (OpenAI-compatible endpoint, `uv run python -m rag.answer "<question>"`):

- **Groundedness**: the 8 trial answers were correct and faithful to the retrieved excerpts; no hallucinated content observed.
- **Language adherence**: a question in Italian → an answer in Italian (the "same language as the question" requirement).
- **Out-of-domain refusal**: to a question foreign to the course (Kubernetes ingress) the model answers correctly that the excerpts do not contain the information, without inventing.
- **Citation-marker fidelity — a problem found**: the quantised 4B model does not reliably copy the `[file p.N]` markers into the answer body: it shortens them, writes `[Excerpt N]`, or (before the fix) copied the **example** file name in the system prompt. The prompt fix (removing the example, an instruction to copy literally) removes the invented names but does not guarantee a full copy. Operational conclusion: the "Sources" list generated by code after retrieval is the only reliable source of citation, and the web interface renders citations from retrieval metadata, not from the model's text ([decisions.md](decisions.md), 2026-08-21, *The campus source and the agent*, point 6). Marker fidelity becomes a variable of the 0.6B/4B/8B size comparison (`#27`).
- **GPU memory**: measured peak **7761 / 8188 MiB** during an answer (dense encoder Qwen3-Embedding-0.6B in **bfloat16** ≈ 1.2 GB + reranker fp16 ≈ 1.2 GB + LLM q4 ≈ 2.6 GB + activations). The three models fit on 8 GB, at the limit: between questions the Ollama model has to be unloaded (`ollama stop …` or `OLLAMA_KEEP_ALIVE=0` on the server side), otherwise the default residency (5 min) causes an OOM on the next question.

### Reproducibility

Index rebuilt from scratch in the collection `slides` (embedded Qdrant, `data/qdrant/`); gold sets versioned in `gold/smoke.jsonl` and `gold/control.jsonl`; reference answers (copyrighted excerpts) outside the repository in `data/gold/answers/`. Generation model: `qwen3:4b-instruct-2507-q4_K_M` through Ollama 0.32.15, endpoint `http://localhost:11434/v1`.

## 2026-08-02 — Adaptive parsing routes, and OCR against a VLM

### 1. Routing over the 31 documents

`rag/probe.py` reads four signals from the PDF structure without loading a model or rendering a page — text per page, share of empty pages, image objects, font table — and routes each file: `classic + ocr` **1** document (`3.5-HTML5-Part-2`, **16 of 32** pages nearly empty), `classic + formula` **4** (the image and video compression decks), `classic` **26**. No false positive; **27/31** documents skip the formula model and **30/31** skip OCR. The thresholds are this corpus's measured values (`EMPTY_PAGE_CHARS = 50`, `NEEDS_VISION_RATIO = 0.3`); the rules are in [docling-pipeline.md](docling-pipeline.md).

### 2. OCR against a VLM on the image-based deck

`3.5-HTML5-Part-2` parsed both ways: OCR **527 s** (measured on 2026-07-31), VLM **1059 s**. The VLM produces more characters (**22621** against **20032**) but fewer distinct words (**671** against **729**), losing technical literals such as `avc1.42e01e`, `autoplay` and `codecs` for narrative words: the VLM paraphrases, OCR transcribes, and BM25 depends on literal tokens. Dead sections: **20** with the VLM, **19** with OCR. The page header `HTML &amp; CSS` pollutes more with the VLM: it repeats on **21/32** pages with OCR and on **32/32** with the VLM. OCR doubles what the text layer gives (**10001 → 20032** characters, also measured on 2026-07-31). An empty-page ratio above the threshold therefore routes to `classic + ocr`, not to the VLM.

VLM speed: more than **56 s** per page on CPU, **33 s** per page on the laptop GPU with the CUDA build of torch — only **1.7×** faster, because token-by-token decoding is bound by latency, not compute. The classic pipeline runs at about **0.8–0.9 s** per page on CPU.

### 3. What the default configuration drops

- **Formulas**: `2.1 IMAGES GENERAL CONCEPTS` (**35** pages) shows **1** `formula-not-decoded` placeholder without enrichment and **4** LaTeX formulas with it — three were dropped without even a placeholder. Counting placeholders underestimates the loss.
- **Images**: in **9** sampled decks (about **322** pages), **63** dead sections — a heading with nothing but `<!-- image -->` under it — and **401** image placeholders (counted on 2026-08-04). Extreme case `3.5`: **19/19** sections dead. This is the denominator of the picture-description ablation (`#28`).
- **Page furniture**: a genuine section spans **2–4** consecutive slides, far below a repeated header's 21 of 32 pages (section 2; counted on 2026-08-04); this sets the furniture threshold (`furniture_threshold()` in `rag/chunk.py`).
- **Ligatures**: present in the text layer of **17** PDFs, up to **97** in one (`non-proﬁt`, `conﬁgured`, `micc.uniﬁ.it`); NFKC normalisation in `rag/parse.py` leaves **0**.

### Reproducibility

`uv run python -m rag.probe data\corpus\PPM` for the routing; `uv run python -m rag.parse "data\corpus\PPM\3.5-HTML5-Part-2--CSS-Positioning-Classic-Part-1.pdf" --profile manual --pipeline vlm` against the default route for the comparison. Code as of commits `aaf93da` and `f171b6f`; `pypdf` 6.14.2 (`uv.lock` at `aaf93da`). The nine sampled decks were not listed in the record.

## 2026-07-31 — The corpus measured

- **Size**: **31** PDFs, about **1200** pages and **650 000** characters, in `data/corpus/PPM/` (outside git: copyrighted material).
- **Language**: English in about **23** (Django, Docker, JavaScript, image and video compression, REST, Flask), Italian or mixed in about **8** (`3.1-web-intro-html`, `3.6`–`3.8`, `HTML5_tag_semantici`). Languages also mix inside one file, which is why `locale` is a chunk field.
- **Text layer**: present in all **31**; no scanned document.
- **OCR on a document that has a text layer is waste**: a **28**-page deck gives the same output with and without OCR (**11040** characters) in **43.8 s** against **27.0 s**, so OCR costs **62%** more time for nothing. `do_ocr` is off by default in `rag/parse.py`, against Docling's own default.

### Reproducibility

Measured with `pypdf` over `data/corpus/PPM`, before it was a locked dependency, so its version was not recorded (commit `fb00303` records the figures); `uv run python -m rag.probe data\corpus\PPM` reproduces the page and text-layer counts. The 28-page deck of the OCR comparison was not named in the record.
