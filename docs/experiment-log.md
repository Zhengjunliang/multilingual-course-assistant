# Experiment log

What was measured, on which data and with which command, and the problems met along the way. One entry per date, newest first; each entry's *Reproducibility* section says how its numbers were produced, and what of that was not kept. Decisions are owned by [decisions.md](decisions.md); the thesis chapter on experiments is written from this log (`#42`).

## 2026-10-12 — Each passage once, sources by the reranker, citations by number: the gold sets hold, copies leave the top 5, no excerpt number in the prose

Retrieval and generation changed as [decisions.md](decisions.md), 2026-10-12, *A result list holds each passage once, as many as the reranker judges relevant, and an answer cites them by number*, records, one commit per step, for `#124` and `#187`. Everything ran on the local Qdrant service (`unifi_web` 29098 points, all crawled; `slides` 1234), whose index none of the steps changes; generation on Qwen3-4B q4 through the local Ollama, greedy.

### 1. The repeats in the index

The two counts of `#124` on `unifi_web`, taken again after the last step:

| Grouped by | Distinct | Under 2+ URLs | URLs involved | Points in those groups |
| --- | --- | --- | --- | --- |
| `text` (the sparse input) | 20753 | 3029 | 640 | 10196 (35%) |
| `embed_text` (the dense input) | 21406 | 3023 | 441 | 9502 (33%) |

Both rows are the counts `#124` reported before the change, to the point: the index is untouched, and the change acts on result lists.

### 2. The repeats in the result lists

Each gold question's top 5, retrieved as `rag.gold` retrieves it, with the retrieval of `550c1b4` and after the last step: the pairs of hits with equal text, and the pairs of web hits with unequal text that are near-duplicates by the rule of section 5.

| Set | Path | Equal-text pairs, before | after | Near-duplicate pairs, before | after |
| --- | --- | --- | --- | --- | --- |
| campus | rerank | 22, on 12 questions | **0** | 11, on 8 questions | **0** |
| campus | no rerank | 18, on 12 questions | **0** | 5, on 5 questions | **0** |
| smoke | both | 0 | 0 | 0 | 0 |

Before, with the reranker, equal texts sat in the top 5 of `c002`, `c004`, `c006`, `c008`, `c009`, `c010`, `c015`, `c018`, `c024`, `c026`, `c031` and `c032`, six of them with two pairs or more, and near-duplicates in that of `c004`, `c011`, `c018`, `c019`, `c021`, `c022`, `c028` and `c029`. After the last step no campus question holds a repeated or a near-duplicate text in its top 5, on either path.

### 3. The gold sets, step by step

Each step is named by its commit's subject. The totals are the same at every step, and the last step gives the same HIT or MISS on every question as the first, but for `c034` without the reranker: the retrieval of `550c1b4` scored it a MISS when the step was measured and a HIT after the restarts of section 4, the tie of `#124` at a branch's cut, which every step after it scores a MISS on every run.

| Step | smoke, rerank | smoke, no rerank | campus, rerank | campus, no rerank |
| --- | --- | --- | --- | --- |
| before: *test(gold): list the verified aliases of twelve campus answer pages*, the retrieval of `550c1b4` | 38/40 | 37/40 | 28/32 | 21/32 or 22/32 |
| *fix(search): equal scores rank by point id inside each branch, not by the server* | 38/40 | 37/40 | 28/32 | 21/32 |
| *feat(search): a result list holds each passage once* | 38/40 | 37/40 | 28/32 | 21/32 |
| *feat(search): the number of sources follows the reranker's judgement* | 38/40 | 37/40 | 28/32 | 21/32 |
| the branch review's three fixes of `collapse`, the last *fix(search): copies join the most alike first, so a reflowed copy never bridges two paragraphs* | 38/40 | 37/40 | 28/32 | 21/32 |

The aliases come first so that the rows after them score a question on its page, whichever address survives: without them, collapsing equal texts alone turns `c006`, `c008`, `c024` and `c026` from HIT to MISS. The `top:` column moved where top hits tie: with the point-id order on `c002`, `c006`, `c024` and `c032` with the reranker and on `c010` and `c032` without it, and with the collapse on `c004` without the reranker, whose top hit became its newest student guide.

With the product's cut-off, `rag.gold --min-score 0.5` after the last step: smoke 38/40, campus 28/32, the totals of the table. Questions by number of sources kept:

| Set | 1 | 2 | 3 | 4 | 5 |
| --- | --- | --- | --- | --- | --- |
| smoke | 5 | 9 | 3 | 5 | 18 |
| campus | 0 | 0 | 1 | 0 | 31 |

The reranker judges nearly every campus top 5 relevant, so the cut-off reaches the course questions far more often than the campus ones.

### 4. Three restarts

Three runs at the step before the last, each after `docker compose restart qdrant` and the service's health check: both gold sets with and without the reranker, and each branch's top 20 for every gold question, the input of `#25`'s dense-only and sparse-only arms. The three runs agree pairwise on every line: the HIT or MISS and the `top:` column of every question on the four arms, and every branch's points, order and scores. Before the change, the same restart moved `c034` from MISS to HIT without the reranker and changed the `top:` column of six reranked campus questions (entry of 2026-09-29, section 4). The last step leaves the branches as they are, and its four gold runs gave the lines of these three.

### 5. The near-duplicate rule on its labelled set

On `gold/near-duplicates.jsonl`, the rule joins 169 of the 211 pairs labelled the same passage and 1 of the 65 labelled different: the same procedure article in the Erasmus call and in the call for students from outside the EU. The copies of `#187`'s passage are two pairs of equal texts that share 25 of 50 shingles across the pairs, every number of the shorter text in the longer, which is why the threshold is 0.5.

### 6. Citations and the answer's language

The first ten questions of `gold/smoke.jsonl`, each retrieved once (reranker, cut-off 0.5, at most five, `slides`) and answered in `it`, `en` and `zh`: thirty answers under the prompt of `550c1b4` and thirty under the numbered one.

| Prompt | A valid `[n]` | An excerpt named by number in the prose | A marker copied | A number glued to a word, a list in one bracket | In the language asked, it · en · zh |
| --- | --- | --- | --- | --- | --- |
| before | 3/30 | 16/30 | 10/30 | 0/30 | 6/10 · 10/10 · 2/10 |
| numbered | **30/30** | **0/30** | 0/30 | 0/30 | 4/10 · 10/10 · 1/10 |

An excerpt is named by number when a word for excerpt or source (`excerpt`, `estratto`, `fonte`, `source`, `摘录`, `片段`, `来源`, `资料`, and their plurals) stands beside a number, in either order, brackets allowed; every `[Excerpt N]` of the prompt before counts here. A `[n]` is valid when n names one of the retrieved excerpts. Under the numbered prompt every answer cites, and no answer names an excerpt any other way.

The questions are English, and asked for Italian or Chinese the model answered in English 15 times in 20, 12 under the prompt before. The language is not what this change targets, and thirty answers cannot tell 5 in 20 from 8; the full smoke set in three languages, 120 answers, runs with `#27`.

In the browser, `#187`'s question ("dove si trova il dipartimento di studio di morgani") was answered with pills and no excerpt number; the passage on the Centro Didattico Morgagni appeared once, from the 2026-27 student guide, and two reports of the CPDS whose excerpts carry one heading read apart by their file names.

### Reproducibility

```bash
uv run python -m rag.gold gold/smoke.jsonl                       # and gold/campus.jsonl; --no-rerank for the other arm
uv run python -m rag.gold gold/campus.jsonl --min-score 0.5      # the cut-off and the sources per question
uv run python -m rag.passages --measure gold/near-duplicates.jsonl
bash data/passages-124-187/determinism.sh OUT                    # section 4
PYTHONPATH=. uv run python data/passages-124-187/dupcount.py index          # section 1
PYTHONPATH=. uv run python data/passages-124-187/dupcount.py lists rerank   # section 2; norerank for the other arm
PYTHONPATH=. uv run python data/passages-124-187/gencheck.py OUT.jsonl      # section 6; needs Ollama
uv run python data/passages-124-187/genscan.py OUT.jsonl                    # the citation patterns
uv run python data/passages-124-187/genlang.py OUT.jsonl                    # the answer's language
```

The index count scrolls every `unifi_web` point and groups by the field; a group is under 2+ URLs when its points carry two or more distinct `url`. The list count retrieves each gold question's top 5 as `rag.gold` does, in its target collection with the edition scope and the crawl only, without the cut-off, and counts the pairs of hits with equal text and the pairs of web hits with unequal text that are near-duplicates by the rule, which the script computes itself so that it also runs on the code before the change, with `BEFORE` naming a directory that holds `git archive 550c1b4 rag` unpacked (`counts.sh` runs both sides and the gold sets on the code before). The branch comparison calls `branch_search` for each gold question and branch with `limit` 20 and the filter `rag.gold` applies, and writes each point's id and score to six decimals. The generation check passes the `rag/answer.py` of `550c1b4` as a second argument for the prompt before; the answer's language is Chinese when a fifth of its characters are CJK, else Italian or English by the commoner of ten stopwords each. Scripts and answers are kept in `data/passages-124-187/`, outside git.

## 2026-10-08 — Quoting the text the project did not write: the gate holds, a tag written inline is copied

The prompts were changed to hold every excerpt, earlier turn, anchor and page sample between `<quoted>` tags, under a system prompt that says what the tags hold ([decisions.md](decisions.md), 2026-10-08, *Text the project did not write enters every prompt as quoted material*). Each prompt was measured before the change, at `7660c29`, and after it, on Qwen3-4B q4 through the local Ollama, greedy, the gate with `seed=0`.

### 1. The relevance gate

| Prompt | Agreement | Unparsable replies |
| --- | --- | --- |
| before the change | 18/20 | 0 |
| tags inline, `<quoted>text</quoted>` | 17/20 | 0 |
| each tag on a line of its own | **18/20**, every verdict as before | 0 |

The three runs took place within an hour, on the same day's pages; why runs on different days do not compare is `#83`. The one row that moved with the inline tags is a closed Google Form (`docs.google.com/forms/…/viewform`, labelled irrelevant), which became relevant. That page was then judged alone, twice in each of four prompts: the prompt before, the prompt after, the clause alone and the tags alone. Each pair agreed with itself, and the verdict flipped with the tags and not with the clause.

### 2. Generation

Eight questions, the first three of `gold/smoke.jsonl` and of `gold/campus.jsonl` plus *Quando scade la prima rata delle tasse universitarie?* and *如何申请DSU奖学金？*, each routed and answered from the top five reranked excerpts; one answer per question and prompt.

| Prompt | Answers copying a tag |
| --- | --- |
| before the change | 0/8 |
| tags inline | 1/8 |
| tags inline, plus a rule never to write them | 4/8 |
| each tag on a line of its own | 0/8 |
| Qwen-Agent's code fence instead of tags | 0/8 |

With the tags inline, the English slides answer interleaved its sentences with `<quoted>` blocks of its own, which `react-markdown` would show as text; naming the tags in a rule made it worse. On their own lines the tags are not copied.

### 3. The deepening decisions

On six campus questions, `assess_answerable` gave the same verdict before and after, and no reply failed to parse. `pick_candidate` parsed every reply too, but its choices moved: on the three shortlists the registry gave, the prompt before picked a candidate each time, and the final prompt declared two of them unsuitable. No labelled set says which candidate holds an answer, so the change is recorded, not judged.

### Reproducibility

```bash
git switch --detach 7660c29 && uv run python -m rag.live --measure-gate   # 18/20, the prompt before
git switch - && uv run python -m rag.live --measure-gate                  # 18/20, this entry's prompt; needs Ollama
```

The generation and deepening probes called `route`, `search` (top 5, reranker on), `build_messages`, `assess_answerable` and `pick_candidate` directly, from a script that was not kept; the other prompts were the final one with the tags or the clause edited out. Index unchanged: `slides` and `unifi_web` in the Qdrant service. Nothing was fetched or stored by the probes: candidates were the outlinks the registry held for the retrieved pages.

## 2026-09-29 — The index moves to the Qdrant service whole, and retrieval does not move

### 1. What moved

`rag/migrate.py` at `ec3cb1a` copied the embedded index at `data/qdrant/` to the Qdrant service of `docker-compose.yml` (server 1.19.1, client 1.19.0) with qdrant-client's `QdrantClient.migrate()`, then checked the copy; the decision and its gates are [decisions.md](decisions.md), 2026-08-24, *Qdrant runs as a service*. The source held 1234 `slides` points and 29098 `unifi_web` points, every one from the crawl snapshot and none fetched live. `migrate()` creates each collection with the configuration local mode reports, which holds placeholders: its `indexing_threshold` of 20000 KB, against the server's 10000, would have kept `unifi_web`, 8 segments of about 14.2 MiB, from ever getting an HNSW index. The optimizer settings were set to those of a collection the server creates through `ensure_collection`, and the seven keyword payload indexes, which local mode does not keep, were created.

Once the optimizer had finished, the server's telemetry (`GET /telemetry?details_level=4`, read per segment) showed:

| Collection | Points | Segments | Dense index |
| --- | --- | --- | --- |
| `slides` | 1234 | 8 | plain in all 8: exact by construction |
| `unifi_web` | 29098 | 8 | HNSW in 7, 29098 vectors indexed; the eighth segment is empty |

These two columns are the reference for the M3 gold runs: automatic growth adds points to `unifi_web`, and a change in the segment count or the dense index type is the signal to measure recall again with the method of section 3.

### 2. Every point, compared

Every source point was read back from the server by id: the counts and the 941 (`url`, `ingest_source`) pairs are equal, and 1234/1234 and 29098/29098 points are identical — the payload equal, the dense vector equal in direction within 1e-5 per component (the server stores a Cosine vector normalised, local mode keeps it raw; the largest difference 1.42e-08, where two distinct embeddings differ by about 1e-3 in some component), the sparse vector equal index for index and within a relative 1e-6 in value.

### 3. Approximate search against exact search

For each question of `gold/smoke.jsonl` and `gold/campus.jsonl`, the dense branch's top 20 (`PREFETCH_LIMIT`) with the product's search parameters was compared with an exact search (`exact=True`) under the filter `rag.gold` applies (the evaluation scope on `slides`, the crawl snapshot on `unifi_web`), the method of Qdrant's *Measuring ANN Recall* (outside the repository).

| Collection | Dense index | Questions | Mean recall@20 | Min | Below 1.00 | Gate |
| --- | --- | --- | --- | --- | --- | --- |
| `slides` | plain | 40 | 1.000 | 1.000 | none | exact by construction |
| `unifi_web` | HNSW | 32 | 1.000 | 1.000 | none | pass (target 0.99) |

The default `hnsw_ef` reaches the target, so the product's search parameters are unchanged.

### 4. The gold sets before and after

Both gold sets ran on the embedded index, the source the move reads without changing it, and on the server, with the reranker (the product path, the gate) and without it (the M3 no-rerank arm), with the code of `f274169`:

| Set | Path | Embedded | Server | Per question |
| --- | --- | --- | --- | --- |
| smoke | rerank | 38/40, MISS `q018` `q028` | 38/40 | identical; `top:` column identical |
| campus | rerank | 28/32, MISS `c003` `c011` `c012` `c034` | 28/32 | identical, en 11/12, it 11/13, zh 6/7 on both; `top:` differs on 6 questions |
| smoke | no rerank | 37/40, MISS `q015` `q035` `q036` | 37/40 | identical; `top:` column identical |
| campus | no rerank | 22/32 | 21/32 | `c034` HIT on the embedded index, MISS on the server |

The rerank rows repeat the first comparison, run at `ec3cb1a` before the change below: the same HIT or MISS on every question, and the same totals as the baselines of the entry of 2026-08-24.

**The six `top:` differences of the rerank path are one page under two addresses.** In each (`c006`, `c008`, `c024`, `c026`, `c031`, `c032`) the two top URLs hold identical chunk text: the crawl stored the same page twice, such as `ingegneria.unifi.it/p365.html` and `vp-365-organi.html`, or an `unifi.it/en/node/…` path and its Italian alias. The reranker scores the two copies equally, and which leads depends on the fusion order.

**Equal fused scores had no fixed order on the server.** The first no-rerank comparison, at `ec3cb1a`, gave campus 23/32 on the embedded index and 22/32 on the server, the difference on `c035`. Repeated 30 times on the server, the same `c035` search kept its wanted page at the fifth place 19 times and lost it 11 times: RRF gives equal scores to points at equal ranks (0.25 and 0.25 at the cut), and a server searching its 8 segments in parallel returns equal scores in no fixed order, where the single-threaded local mode returned them in one order every time. `f274169` fetches the whole fused pool and ranks equal fused scores by point id before cutting it (`rag/search.py`); afterwards the fused top 5 and top 20 of all 72 gold questions were identical over 10 runs each on the server. The tie-break itself turns `c035` into a MISS on both backends, which is why the embedded no-rerank baseline reads 22/32 in the table.

**The no-rerank difference comes from equal and shifted scores, not from lost points.** Queried branch by branch after the service had been restarted, the dense top 20 is the same set on both backends for 70 of the 72 questions, scores within 2e-7; on `c008` and `c024` the two sets differ only among points with equal scores at the cut. The sparse top 20 is the same set for 65 of 72, and the other seven differ only at the cut: the server computes the BM25 IDF of `Modifier.IDF` itself, where the embedded index used the client's local mode, and scores the same points 0.9842 to 0.9992 times the embedded score. On `c034`, `unifi.it/en/node/12045` and `…/tasse-isee-e-agevolazioni/prestiti-donore` are one page under two addresses, with equal dense scores at ranks 19 and 20, and the server keeps no fixed order for equal scores inside a branch. In the comparison of the table it put the English copy at rank 19, where its fused score reaches 0.25, the score of the wanted page, and the point id put it fifth; after the restart it ranked the two as the embedded index does, and campus without the reranker read 22/32 on the server too, `c034` a HIT. `f274169` orders equal fused scores; equal scores inside one branch keep the server's order. The rerank path, which the gate reads, gave the same HIT or MISS on every question in both comparisons and again after the restart (38/40, 28/32). The M3 no-rerank arm is measured on the server, the one backend every M3 baseline uses ([decisions.md](decisions.md), 2026-08-24, *Qdrant runs as a service*), where a question decided by such a tie can change between two runs with a restart between them.

### Reproducibility

```bash
# at ec3cb1a: dry run, then the move and gates 1 and 2 (server empty before it)
.venv/Scripts/python.exe -m rag.migrate --from data/qdrant --dry-run
.venv/Scripts/python.exe -m rag.migrate --from data/qdrant

# at f274169: gate 3 and the no-rerank arm, embedded then server
for set in smoke campus; do
  .venv/Scripts/python.exe -m rag.gold gold/$set.jsonl --qdrant data/qdrant > $set-embedded.txt
  .venv/Scripts/python.exe -m rag.gold gold/$set.jsonl > $set-server.txt
  .venv/Scripts/python.exe -m rag.gold gold/$set.jsonl --no-rerank --qdrant data/qdrant > $set-embedded-norerank.txt
  .venv/Scripts/python.exe -m rag.gold gold/$set.jsonl --no-rerank > $set-server-norerank.txt
done
col() { grep -E '^[qc][0-9]{3} (HIT |MISS)' "$1" | cut -c1-9; }
diff <(col smoke-embedded.txt) <(col smoke-server.txt)
```

`data/qdrant` was deleted with `#33`; `data/backup/33/qdrant` is the embedded index as it was at the move, and rerunning the embedded side means copying it back to `data/qdrant`. The branch comparison of section 4 queries each branch alone on both backends: `query_points` with the question's dense or sparse vector, `using` that branch, `limit` 20 and the filter `rag.gold` applies. The repeat checks call `hybrid_search` on the server for every gold question, ten times each at `f274169`, and thirty times for `c035` at `ec3cb1a`.

Run outputs: `data/migrate-33/` (`run.log` of the move, the gold outputs of both comparisons; `v3/` the branch comparison, the repeat check and the gold runs after the restart, with their scripts). `rag/migrate.py` exists only at `ec3cb1a`.

## 2026-09-14 — A pypdf upgrade changes the extracted text, and the relevance gate's number is not comparable

### 1. The extracted text, the routing and retrieval

Upgrading `pypdf` from 6.16.1 to 6.18.1 left the page and image counts of all 31 documents unchanged and raised the characters per page of 12 of them, by 1.1% to 9.7%, lowering none. The adaptive routing of all 31 did not change, and neither did `gold/smoke.jsonl`: 38/40 before and after, missing `q018` and `q028`. The corpus figures of the entries of 2026-07-31 and 2026-08-02 were taken before `pypdf` was a locked dependency, its version unrecorded, and depend on it as generation results depend on the model revision; the parsing stack's version is on the reproducibility list of [architecture.md](architecture.md) for this reason.

### 2. The relevance gate: 17/20 — and the finding that the number is not comparable

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
uv run python -m rag.live --measure-gate        # 17/20 in section 2; needs Ollama
```

Versions compared: `pypdf` 6.16.1 → 6.18.1; the smoke set gave the same 38/40 again after `qdrant-client` 1.18.0 → 1.19.0. Corpus unchanged in `data/corpus/PPM` (31 PDFs); index unchanged in `data/qdrant/` (collection `slides`; `unifi_web` at 29098 points). No reindexing was run: `rag.probe` writes nothing, and the comparison concerns extraction, not vectors.

## 2026-08-27 — Multi-turn anaphora resolution, and transcription instead of an answer

Both observations come from one conversation in the web interface.

### 1. Multi-turn anaphora resolution: a first, favourable observation

The follow-up turn was resolved correctly in a real case not designed as a test:

| Turn | Question | `RouteDecision.reason` |
| --- | --- | --- |
| 1 | `我九月就要毕业了，查看毕业时间` (I graduate in September; look up the graduation dates) | `毕业时间是官方公布的固定信息，属于 unifi_web 范畴…` (graduation dates are fixed official information, within the unifi_web scope…) |
| 2 | `我是 ingegneria informatica 的` (I am in computer engineering) | `学生是信息工程专业，需要查询该专业毕业时间，此信息属于大学官方行政信息…` (the student is in information engineering; **the graduation dates of that programme need looking up**; this is official university administrative information…) |

The second question contains no literal reference to the graduation date: it only says which degree programme the student belongs to. The antecedent was recovered from the previous question, which is exactly what injecting the history into the router has to produce.

Its evidential value is limited: **one case is not a measurement**. The reported routing accuracy (exact 22/32) is a single-turn figure, while the system demonstrated is multi-turn; `gold/campus.jsonl` holds no follow-up questions, and measuring multi-turn routing needs such a set first (`#22`).

The injection shape chosen at design time is confirmed: the router receives **only the student's questions**, never the answers. Two reasons, both visible in this session — a pronoun's antecedent is in the previous question, not in the answer; and answers are dense with web markers such as `[https://ingegneria.unifi.it/… · 2026-08-22]`, which after three turns would pull any new question, course questions included, towards `unifi_web`.

### 2. Transcription instead of an answer: a new bucket for the taxonomy

On the second turn the model wrote no answer: it **copied the retrieved excerpt**, opening its output with `[Excerpt 1] Ingegneria Informatica (INM 270/04) (INF PO INS 509/99) …` and continuing with the full transcription of the calendar row, administrative codes included. The content is correct and relevant; what is missing is the act of answering — no selection of the date that concerns the student, no sentence.

The defect is **distinct** from the one recorded on 2026-08-21 and 2026-08-25 under citation-marker conformance, although it shares the surface symptom `[Excerpt N]`. There the model wrote an answer and got the marker wrong; here it writes no answer at all. It is recorded as a bucket of its own in the error taxonomy (`#23`): **transcription instead of an answer**, with the hypothesis to verify that the trigger is a very short follow-up turn (a statement, not a question) combined with a densely structured tabular context.

The source cards were unaffected, since they are rendered from retrieval metadata, not from the model's text ([decisions.md](decisions.md), 2026-08-21, *The campus source and the agent*, point 6); the turn that does not answer stays visible to the student and belongs to generation.

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

The generation prompt of the time (`rag/answer.py`) spent three lines demanding a **character-for-character** copy of the bracketed marker. In none of the real runs of the day did the model follow it:

| Question language | Corpus | What the model wrote |
| --- | --- | --- |
| English | slides | `[Excerpt 1]` |
| Italian | campus | `[Excerpt 1][Excerpt 3][Excerpt 4][Excerpt 5]` |
| Chinese | campus | markdown links, e.g. `[毕业学期日历](p602.html)` (graduation-term calendar) |

A citation-fidelity metric for M3 follows from it (`#27`). Numbered citations replaced the markers, and under them every one of thirty answers cited a valid `[n]` (entry of 2026-10-12, section 6).

### 3. The local machine cannot host the automatic-growth remeasurement

An attempt to re-run the main arm of the automatic-growth acceptance run (protocol of the entry of 2026-08-24, `run_id` `live-retest-main`). Clean pre-test: **0/7**, collection at 29098 points. The run was stopped during the second question:

| Phase | Measurement |
| --- | --- |
| g001 | answers at step 0 without any fetch — behaviour **unchanged** after the two fixes, as expected (they fixed the forced choice and the blind graph, not the saturated sufficiency judgement); the answer is correct and cites form RIT_02, but URL scoring marks it MISS |
| g002 | dense encoding on CPU: one batch at **293.30 s/it** (19 min 33 s for 4 batches) and one at 55.93 s/it; more than 25 minutes spent without nearing the end of the seven questions |

With the 1470 s batch of 2026-08-24, these times are this machine's normal regime for CPU encoding, and the cost of an arm has no upper bound.

No write reached the knowledge base: `unifi_web` stayed at 29098 points and the points with `ingest_run_id='live-retest-main'` are **0** (g001 fetched nothing; of g002's two fetches, one was unchanged from the crawl and the other was rejected by the gate). No rollback was needed.

**Operational consequence**: measurements that involve the LLM move to the MICC server; the local machine is for development and functional checks. The split is possible because `rag/` does not import Django and runs outside the web. The decision is [decisions.md](decisions.md), 2026-08-25, *Where measurements run*.

### Reproducibility

Endpoint: `uv run python manage.py runserver`, then `POST /api/ask` with a JSON body in UTF-8. Automatic-growth pre-test: `uv run python -m rag.gold gold/campus-autogrow.jsonl --live on`. Models as in the previous entry: Qwen3-Embedding-0.6B, the Qwen3 0.6B reranker, LLM `qwen3:4b-instruct-2507-q4_K_M` through Ollama, `temperature=0.0`.

## 2026-08-24 — Relevance gate, deepening loop, automatic-growth acceptance run

### 1. Relevance gate: 15/20 → 18/20 without touching the labels

The LLM gate (Qwen3-4B q4, binary JSON verdict, `temperature=0.0`, `seed=0`) was measured against a labelled set of 20 URLs **frozen in a commit of its own before any measurement** (`gold/relevance-gate.jsonl`, 10 relevant + 10 irrelevant, taken from the graph of links the crawl had not fetched): the discipline "freeze the ruler, then measure" rules out adjusting the labels afterwards by construction.

- **First measurement: 15/20.** The disagreements came from systematic false negatives (TOLC calendars rejected because they name other Tuscan universities), a systematic false positive (a commercial housing platform that calls itself an "official service"), a design case (a PDF that can be judged only by its file name) and debatable borderline cases.
- **Changes — to the gate only, never to the labels**: two rules added to the system prompt (student services at Tuscan regional scale — DSU, CISIA/TOLC — serve UniFi students too; the operator test: an institution publishing its own information versus a company selling something) and a text preview for PDFs (`pypdf`, first page, text layer only: a glance, not a parse — the classic pipeline's cost cannot be paid before the gate).
- **Second measurement: 18/20 ≥ 18 (the threshold).** One revision round. The two remaining disagreements are the known borderline cases: the internal phone directory (label relevant, gate irrelevant) and the Tesi Online login page (a hard negative; the gate lets the service name convince it).

With greedy decoding and a fixed seed, the repeated measurement gives identical verdicts (checked on the routing report too, run twice with the same outcome); the gate's agreement does not rest on sampling luck. Remeasured 2026-09-14: 17/20, not comparable (entry of 2026-09-14, section 2).

### 2. GPU memory and time budget (RTX 4070 Laptop, 8 GB)

- **Peak VRAM over the whole acceptance run: 7923 MiB < 8188**, **+162 MiB** over the 7761 baseline of 2026-08-21 (< 200 allowed). Sampling with `nvidia-smi -l 1`: a 1 Hz resolution can in principle miss sub-second peaks, and the remaining margin (265 MiB) covers that uncertainty.
- **PDF parsing on CPU**: the corpus's largest PDF (18.4 MB, capped at 40 pages, classic pipeline) takes **68.8 s / 65.9 s** over two runs. The parsing budget was therefore separated from the step clock (60 s) and set to **120 s** (`PDF_PARSE_TIMEOUT_SECONDS`): parsing held within 60 s would make exactly the long documents (decrees) the live layer exists for impossible to store. In the acceptance run real parsing peaked at 46.6 s.
- **Dense encoding on CPU, outside the step clock**: 13 chunks ≈ 77 s, 18 chunks ≈ 117 s; one batch of **1470 s** (24.5 min; this machine's normal regime, entry of 2026-08-25, section 3) produced no false timeout — empirical confirmation of not counting parsing and encoding in the step budget (counting them would have marked every successful write as lost).
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

The router (`route()` in `rag/agent.py`) was scored on the 32 questions of `gold/campus.jsonl`: **exact 22/32 · wide 26/32**, `both` chosen 4 times, 0 fallbacks, identical over two runs. *Exact* counts a routed target equal to the question's `target`, so `both` is a miss; *wide* accepts any routed set that contains the target (`RoutingReport` in `rag/gold.py`). The router prompt measured is pinned by its hash in `tests/test_agent.py` (`ROUTER_PROMPT_SHA256`): changing the prompt requires rerunning this report in the same commit. The figure is single-turn (entry of 2026-08-27, section 1).

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

Together: **998** items (**871** pages and **127** PDFs) over 4 site sections, indexed as **29098 points** in `unifi_web` — the count the evaluation isolation and every rollback are checked against (entry of 2026-08-24). The numbers are read from each run's `manifest.json` and from the registry. Office attachments are not followed: the **46** found in the first crawl were all blank application-form templates.

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
- **Citation-marker fidelity — a problem found**: the quantised 4B model does not reliably copy the `[file p.N]` markers into the answer body: it shortens them, writes `[Excerpt N]`, or copies a file name the system prompt gave as an example. The web interface therefore renders sources from retrieval metadata, not from the model's text ([decisions.md](decisions.md), 2026-08-21, *The campus source and the agent*, point 6), and numbered citations replaced the markers (entry of 2026-10-12, section 6). Citation fidelity becomes a variable of the 0.6B/4B/8B size comparison (`#27`).
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
