# 决策记录

本文件是**自主拍板项**的属主：哪一天、拍了什么板、依据是什么，含**后来被自己推翻的那些** —— 反转本身是记录的一部分，删掉就看不出为什么会反转，答辩上也答不出来。⛔ 不在这里：技术栈选型与决策状态表归 [architettura.md](architettura.md)（「选了什么、验证条件是什么」）；推进状态、阻塞项与暂缓项归 GitHub issue（里程碑 M3 · M5 · M6 · M7），不在任何 markdown 文件里。

## 2026-09-25 — PPM read from Moodle and Cineca: one course, two AD codes, one edition

1. **A course's code is the AD code of the Moodle course that holds its material, and it is fixed once entered.** UniFi's Moodle opens one course per AD code and academic year; the teacher keeps the material in one of them and declares the others *mutuati*. PPM's material has been in `B028451` every academic year since 2020-2021, with `B003712` declared as its *mutuato*, so PPM's `Course.code` is `B028451`. The code does not follow a teacher who later moves the material to another container.
   **Why:** an edition names material, and the material lives in the container. Which code is the container is the teacher's choice, not a university rule: for Intelligenza Artificiale it is `B003725`, the code without a curriculum, the opposite of PPM (outside the repository: UniFi Moodle, `e-l.unifi.it`).
   **The price:** the container is read from Moodle by a person. The Cineca course catalogue lists the two AD codes as two equal teachings and has no field saying which one is *mutuata da* the other.
2. **A course appears once per curriculum; when a curriculum lists two AD codes for it, the entry takes the one listed only in that curriculum.** The Cineca study plan of `B047`, curriculum TECNICO APPLICATIVO, lists PPM under both `B003712` and `B028451`, while TECNICO SCIENTIFICO lists `B003712` alone, so PPM is two entries: TECNICO APPLICATIVO with `B028451`, TECNICO SCIENTIFICO with `B003712`. Any other case is decided by whoever enters the row. Only PPM has been checked; four more courses of the same plan come in pairs of AD codes (outside the repository: Cineca course catalogue, `unifi.coursecatalogue.cineca.it`).
   **Why:** it keeps the (`programme`, `curriculum`, `course`) constraint of [data-model.md](data-model.md), so a course has one year of study in each curriculum. Relaxing the constraint later to one row per AD code only adds rows; tightening it after the fact would first have to remove some.
   **The price:** the table does not record that a TECNICO APPLICATIVO student may also take PPM under `B003712`, a credit slot that no code reads.
3. **The curriculum is stored by the name the Cineca catalogue prints**, such as `TECNICO APPLICATIVO`, and as an empty string when it prints none.
   **Why:** Cineca owns the study plans and shows the name only; the code `E70` appears in Moodle course titles alone, and the code of TECNICO SCIENTIFICO was not found anywhere.
   **The price:** a misspelt name is a new curriculum. The admin filter lists every stored value, which is where a typo shows.
4. **Official fields no code reads are not stored**: the programme's level (Cineca *Tipo di corso*), CFU, teaching period, mandatory or optional, cohort. Each is an additive `AddField` when a reader appears.
   **Why:** point 5 of *The data model is decided on paper*, the entry below: a column lands with the code that first uses it.
   **The price:** a cohort, if one is ever needed, changes the (`programme`, `curriculum`, `course`) constraint as well as adding a column, since a curriculum's year of study is then per cohort.
5. **The corpus is one edition.** All 31 PDFs in `data/corpus/PPM/` match, title by title, the 2025-2026 Moodle course of `B028451`. The years in their file names (2024, 2025, 2026) date the slides, not the teaching: the teacher reuses decks across academic years. This corrects `#96`, which read the file names as two academic years.
   **Why:** a file name dates the deck; the Moodle course dates the teaching.
   **The price:** the evaluation scope is a single pair, (`B028451`, `2025-2026`).

## 2026-09-25 — The data model is decided on paper before roles are built on it

1. **A course has two levels and a yearly edition.** A `DegreeProgramme` (such as `B047`) lists `Course` rows (such as `B003725`) through `CurriculumEntry`, which carries `year_of_study`, the `ad_code` and the curriculum, so a course shared between programmes (*mutuazione*) is one more entry pointing at the same course, never a copy of its material. Material, syllabus, reading list and reference pages hang on a `CourseEdition` (`course`, `academic_year` such as `2025-2026`); past editions are kept and can be chosen. Which edition is current is a manual switch, `is_current`, flipped by a teacher or the secretariat, at most one per course, and a search defaults to the current edition. This reverses the course label `"PPM"`, taken from the corpus directory name: the slides payload field `course` becomes the UniFi course code, and `academic_year` joins it.
   **Why:** this is how UniFi's own Moodle lists a course — `B003725 (B047)`, the programme as its category, shared courses marked *mutuati* — and Cineca Esse3, Moodle categories and Canvas accounts nest the same way; UniFi's Moodle opens one container per academic year, as Open edX does with course runs and Canvas with terms (outside the repository). The key stays a plain string, the way Open edX keeps `CourseKey` a string that its `CourseOverview` table is keyed by (outside the repository), so `rag/` does not import Django. A switch and not a date, because a new edition is worth searching only once its material is in, and whoever uploads it knows when that is.
   **The price:** every slides point in Qdrant is rewritten to the new key, and the evaluation pins PPM's code and year instead of following `is_current`, so a switch cannot move an M3 number.
2. **Roles are rows with a scope; permissions are code.** `RoleAssignment` (`user`, `role`, nullable `programme`, nullable `edition`) holds the staff scopes: a teacher is assigned to a `CourseEdition` and reassigned every year, the secretariat to a `DegreeProgramme`. What each role may do is a permission registry in code, and views check a permission, never a role name — the one-gate-per-action rule of `#92`. The site administrator is Django's `is_superuser`, not a role row. Where a student's programme is stored — a student row in `RoleAssignment` or a field on `User` — is left to `#93`. That programme is **a scope boundary, self-declared until `#44`**: it bounds the courses a student's search may cover, and it is not a security boundary, because the student states it.
   **Why:** one table with nullable scope columns is Open edX's `CourseAccessRole`; a role-to-permission registry in code is Sentry's; teachers per term course and staff per category are Canvas enrollments and Moodle role assignments at category level (outside the repository). A teacher is scoped to the edition and not the course because of point 1: the edition owns what a teacher edits.
   **The price:** teacher assignments are repeated every year (the secretariat copies the previous year's rows), and until `#44` brings the university identity nothing stops a student from declaring another programme.
3. **Anonymous students ask campus questions only, and nothing of theirs is stored.** Their multi-turn history lives in the browser and travels with each request; the server treats it as untrusted input and keeps no row, so `Conversation.owner` stays non-nullable and no migration follows. Course questions and stored conversations stay behind login. This reverses point 1 of 2026-08-27, which made the whole site login-only.
   **Why:** the reason given on 2026-08-27 was that a multi-turn conversation is per-user state; holding that state in the browser removes the reason without an ownerless row the database would have to guard. Open WebUI stores no anonymous chat, and the OpenAI Chat Completions API is stateless, the caller resending `messages` every time (outside the repository). The campus corpus is public pages, so an anonymous reader learns nothing a browser would not show.
   **The price:** the history a client sends has to be bounded and validated, and an anonymous request has to be kept out of course material explicitly, since the search reads an empty filter as no filter; both are checklist items of `#93`.
4. **Content belongs to the edition, and each kind of content has one owner.** Material uploaded by a teacher or the secretariat belongs to the `CourseEdition`; `uploaded_by` is kept for audit, which answers the uploaded-material part of `#17`; the attribution of `live` web points stays open there. Students do not upload. This reverses `#36`, where only the uploader could see a file. The syllabus is split into the five U-GOV sections (Obiettivi · Prerequisiti · Programma · Metodi didattici · Modalità di verifica); the reading list is owned by `ReadingItem` alone and is never repeated as a syllabus section. Both reach retrieval; the library catalogue (OPAC) is not connected. `WebSource` (`url`, nullable `edition`) is what should be fetched — a campus page when the edition is empty, a course reference page otherwise — and `data/webcorpus/registry.jsonl` is what was fetched; a task in `apps/` reads the first and hands `rag.crawl` plain data derived from it.
   **Why:** a workspace owning its documents with the uploader kept as a column is AnythingLLM's `workspace_documents` and Dify's `Document.created_by`; an editable source list apart from the pipeline's record is Dify's `Dataset` next to its `Document`; the section names are the ones UniFi's syllabus pages use, and a reading list as rows with title, authors and importance is Talis Aspire's (outside the repository). A course is taught to everyone enrolled in it, so its material is shared by construction.
   **The price:** a student cannot add their own notes (point 7).
5. **Migrations only add.** No table or column is dropped or renamed, and each table lands with the issue that first uses it, not ahead of it — the rule dependencies follow. The concrete order is owned by [data-model.md](data-model.md).
   **Why:** Django's "Writing migrations" guide adds a nullable field, backfills it and tightens it afterwards, and expand/contract is the general name for the pattern (outside the repository); when nothing is removed, the code of each step runs against the schema of the next.
6. **Four refinements follow from the points above.** A slides point's identity carries the course code and `academic_year`, since the same PDF in two editions would otherwise collide on `chunk_id`. Putting a student's own year first is ordering in the interface list only, never a filter. `locale` goes only on rows with user-visible text — programme and course names, `Syllabus`, `ReadingItem` — and not on `CourseMaterial`, whose language is carried by each chunk's `locale`. `year_of_study` on the student lands with the student course list of `#36`, the first code that reads it.
   **Why:** each keeps one fact in one place: an identity blind to the edition cannot tell editions apart, a year used as a filter would contradict the scope of point 2, and a file-level language would be a second copy of the chunk-level field that the corpus notes in [architettura.md](architettura.md) ask for.
7. **Two things are deferred, each with an owner.** Global settings — which model answers, and similar site-wide choices — wait in `#51` until the model runs on the MICC servers under `#18`; the direction noted there, a singleton row choosing from a profile list in `.env`, is a suggestion, not a decision. Student uploads visible only to their author wait in `#36`; the additive change they need is described in [data-model.md](data-model.md).
   **Why:** vLLM serves one model per process (outside the repository), so a model name an administrator could type would name a model the server does not serve; the settings are worth designing only against the server that runs them.

## 2026-09-24 — `just` is retired; scripts/check.py is the one chain

1. **The justfile is gone, and nothing replaces it as a tool.** It had 27 recipes, and CI called none of them: `.github/workflows/ci.yml` spelled every command out a second time, so the two copies drifted. CI ran `check --deploy --fail-level WARNING` and `just check` did not, and CI tested with `DJANGO_DEBUG=false` while a local run inherited `true` from `.env` — "green locally" and "green in CI" were different statements. The chain is now [scripts/check.py](../scripts/check.py): eight named steps plus the mode variables they run under, and CI calls each step by name. `tests/test_check_script.py` reads the workflow and fails when it runs anything else, drops or reorders a step, or sets a mode variable itself.
   The survey behind it (outside the repository): the projects where local and CI agree by construction — `encode/httpx` with its `scripts/` directory, `pypa/pip` with nox, `pallets/flask` with tox, `getsentry/sentry` with make — have in common that CI calls the aggregate by name; those whose CI runs raw commands next to an aggregate (`django/django` with tox, `wagtail/wagtail`, `home-assistant/core`) are in the state this repository was in. Which tool holds the aggregate is secondary, and none of the projects surveyed uses `just`. A Python script needs nothing that `uv sync` does not already install, and runs natively under PowerShell.
   **The price:** the one-line wrappers over `rag/` are gone, so a pipeline command is typed in full (`uv run python -m rag.agent "…"`); README lists them. Two steps of the chain (`django`, `migrations`) repeat checks that `tests/test_smoke.py` and `tests/test_accounts.py` already make — kept, because the chain mirrors what CI ran, and whether to drop them is a question for the test-suite epic `#89`.

## 2026-09-23 — The repository speaks English

1. **Every document in the repository is English** — markdown, GitHub issues and the experiment log included — joining the identifiers, comments and commit messages that already were. The conversation with the author is in Chinese and does not live in the repository; the thesis body and its delivery attachments are written in Italian, outside it. The rule is owned by `CLAUDE.md`, documentation conventions; the list of files still to translate by issue `#43`.
2. **This reverses two rules of 2026-09-14**, and records one of them for the first time. Point 2 of the entry that moved progress into GitHub issues made issues Italian and kept the markdown Chinese; later the same day commit `b8453eb` made every repository document Italian, and that second rule never had an entry here. The reasoning then was that the supervisor reads the repository and the M6 deliverables are Italian, so writing in Italian early was gathering material. It also reverses the older habit of writing the experiment log in formal Italian to spare a translation at M6.
   **Why:** one language per repository is a rule a machine can check — the language-guards epic `#90` — and a rule without a check decays silently. Three languages each owning a slice of the prose is exactly what such a check cannot express. The deliverable that has to be Italian is the thesis, and it is written as Italian prose from the English record, not translated out of the repository.
   **The price:** the documents written in Chinese and the experiment log written in Italian are translated under `#43`, and the thesis chapter is written from an English log instead of lifted from an Italian one.

## 2026-09-15 — La tavolozza diventa acromatica, e il cancello cambia verso

1. **Revocato il commit `637f5cc`, «give the interface an accent colour of its own».** Quel commit, di sei giorni prima, aveva dato all'interfaccia un accento teal proprio perché `--accent` valeva carattere per carattere quanto `--ink` e l'interfaccia non aveva un colore suo. Dopo aver provato Morphic e Perplexity la decisione è stata di adottare la loro tavolozza, che è **interamente acromatica**: croma esattamente 0 su ogni token tranne la famiglia `--warn*`. L'accento torna a essere l'inchiostro, questa volta per scelta e non per difetto.
   Il costo è reale e non va nascosto: il collegamento fra una citazione nella risposta e la sua scheda fonte era portato dal colore, ed è l'interazione più caratteristica di questa interfaccia. Passa al **riempimento** — la pillola porta `--mark`, la scheda accesa porta `--mark` più un anello d'inchiostro — e quelle sono asserzioni in `CitationList.test.tsx`, non un cancello.

2. **`MIN_CHROMA` diventa `MAX_CHROMA`, e il rigore cala.** Il cancello chiedeva «dimostra di avere un colore» e ora chiede «dimostra di essere rimasta neutra». Va detto che **non è lo stesso rigore**: con ogni token neutro a croma zero il nuovo controllo non è falsificabile, e nessuna modifica legittima può farlo scattare. È una guardia contro la distrazione. Quello che il vecchio difendeva — «l'accento non è l'inchiostro» — non è più difendibile con un numero e passa a un'asserzione sul sorgente.
   In compenso il cancello guadagna qualcosa che prima non aveva: una **scaletta delle superfici**, che misura la distanza di chiarezza fra due riempimenti che si toccano senza un bordo. Su una tavolozza di soli grigi è l'unico controllo in tensione — il margine più stretto è di due punti esatti, fra la conversazione aperta e la barra laterale che la contiene. Confronto in punti percentuali interi e non in virgola mobile: `0.25 - 0.23` vale `0.019999999999999990`, e scritto ingenuamente il controllo boccerebbe una tavolozza corretta.

3. **Cancellati `--accent-text` e `--mark-ink`.** Sulla tavolozza nuova valgono entrambi quanto `--ink` in tutti e due i temi. La regola applicata è che superfici e inchiostri sono due spazi di nomi: un duplicato *dentro* uno dei due è rumore, una coincidenza *fra* i due è un fatto della tavolozza. È per questo che `--accent` resta pur valendo quanto `--ink`.

4. **`AppHeader.tsx` eliminato, non svuotato.** Le sue cinque responsabilità hanno quattro case nuove: il titolo nella testata della barra laterale, il pulsante del cassetto in `ChatShell`, lingua e tema e uscita in `AccountDialog`, l'identità in `AccountMenu`. Nessuna barra attraversa più la colonna della conversazione, che è la differenza più visibile fra questo guscio e quello di prima.

5. **Due dipendenze nuove**: `@radix-ui/react-dropdown-menu` in runtime e `jsdom` in sviluppo. La seconda merita una nota, perché è stata presa per un motivo e ne ha resi veri altri: serviva per poter asserire il contenuto del dialogo dell'account, che vive in un portale e che un render a stringa restituisce vuoto. Si è poi scoperto che jsdom 30 ha `PointerEvent`, quindi anche il menu a tendina si apre in un test senza `@testing-library/user-event`. **L'ambiente resta `node` per default** e il documento si chiede per file: sotto jsdom Vite risolve con le condizioni client e `import.meta.url` smette di essere un URL `file:`, che rompe i quattro test che leggono il proprio soggetto dal disco.

## 2026-09-14 — 仓库转公开，并撤销 `paths-ignore`

1. **仓库由 private 改为 public。** 直接动机是 Actions 分钟数：三个 job × 每次 push，加上 Dependabot 批量开 PR，private 在 Free 计划下的每月额度撑不住；public 仓库的 Actions 无限免费。转之前查过一遍历史，**不是凭感觉**：git 全历史里从未出现过 PDF、语料或任何二进制（最大对象是 261 KB 的 `uv.lock`），`.env` 从未被跟踪，gitleaks 扫 47 个 commit 零命中。
   **代价要写清楚，因为它不会自己消失**：15 条 `security-review` issue 现在是公开的，里面逐条写着未修复的漏洞、代码位置与复现命令（`#4` SSRF、`#5`/`#6` 两条 prompt injection、`#9` admin 登录不限次）。系统只跑在本机与 MICC 内网时这不构成实际风险，对论文反而是成果；**但 `#41` 的干净机器演示、以及 `#44`/`#45` 的 post-tesi 公网常驻，必须在这些 issue 关闭或重新定级之后**。这条约束的属主是本条，不在任何 issue 里 —— 因为它约束的正是那些 issue 什么时候才算可以不管。
   附带收益：CodeQL 对公开仓库免费，而当初只用 gitleaks 正是因为私有仓库的 CodeQL 要付费 GHAS。值得单开一条 issue 重新考虑。

2. **撤销当天早些时候给 `ci.yml` 加的 `paths-ignore`。** 加它时写的理由是「不让一个绿勾声称验过它从没读过的东西」—— 那是两个理由里**弱的**那个，真正撑着它的是省分钟数，而 public 之后那条不成立了。留下它的代价反而变实：路径过滤是事件级开关，被过滤掉的 commit 不启动 workflow、不上报状态，而分支保护的「必需检查」会永远等一个不会到来的状态，纯文档 PR 因此永远合不了。**过滤器与必需检查只能二选一**，这里选必需检查。
   `secrets.yml` 独立成 workflow 的理由**不受影响**：它当初有两条，一条是「不能跟着 `paths-ignore` 走」（现在没了），另一条是 gitleaks-action 只在 `workflow_dispatch` 与 `schedule` 下扫全历史 —— 后者才是硬的，也是它今天仍然独立的原因。

## 2026-09-14 — 人工闸门与 UI 计分：两条自我推翻

1. **推翻「相关性门判定后**直接**持久入库」**（2026-08-21 第 5 条，2026-08-22 定案）。改为：门只产出**候选**，admin 人工确认后才进索引。依据是那条决策的证据本身撑不住它想撑的结论 —— 门在标注集上 18/20，但那 20 条里没有一条是**想通过**的；`#5`（`severity: alto`）描述的正是「门读着能指挥它的内容，却据此决定一次永久写入」。人工闸门**不提高门的准确率**，它换掉的是「判错即永久」这个后果，这是两件不同的事。门本身保留，降级为排序与降噪。方向记在 `#48`（只记方向，无验收无里程碑），`#5` 正文已加 2026-09-14 更新块，原「Esito atteso」行保留不删。
   **新代价一并记下**：自动门的错误可测（`--measure-gate`），人的疲劳不可测。一个每天批五十条候选的人会以本仓库今天**没有任何指标在观察**的方式犯错。换掉一种失败模式不等于消除失败模式，这条在答辩上会被问。

2. **推翻「PPM 无 UI 评分要求」**（2026-07-30 拍板）。原文是 [architettura.md](architettura.md)「已定技术栈」节末尾那句拍板确认的括号内容，今日已改写 —— 所以那个括号里现在**找不到**被推翻的原话了，这里是它唯一的存档：括号原文为「PPM 无 UI 评分要求，前端自主」。界面外观计入课程分数，当初那句读错了。方向记在 `#49`。
   写 issue 前先去核实，省掉了一条假前提：颜色 token 层**已经存在**且没有漂移，缺的是别的三样。盘点与依据归 `#49` 正文，不在这里复写。

## 2026-09-14 — 两个 CVE 的处置：都不是修复，是风险接受

CI 的 `audit` job 红了两次（两次都是纯文档 commit），根因是 `pip-audit` 报出两条。两条都决定**不修**，但理由完全不同，混为一谈会让论文里的安全章节站不住：

1. **`accelerate` 的 PYSEC-2026-3804 —— 无限期接受**。上游没有任何修复版本，而它是 `docling` 的必需传递依赖，删不掉。逐条依据（为何删不掉、为何不可达、真正的控制为何是 `#10`）写在 `--ignore-vuln` 旁边，属主是 [ci.yml](../.github/workflows/ci.yml) 的 `audit` 步骤注释，`#7` 记账。
2. **`transformers` 的 PYSEC-2026-3929 —— 有到期日的接受**。有修复版（5.10.0），但够不着：一个本项目哪儿都不跑的平台（darwin）把天花板按在了 Windows 和 Linux 头上。**这里要记的决定只有一条：本次不限平台。** 加 `environments` 一行就能解开，但那是在减少 lockfile 的承诺，不该在修 CVE 的顺手里做掉；另一条路（升 docling 大版本）要重跑 ingest 并重验 gold 38/40 与 campus 28/32，那属于 M3 的重测场次，不属于这里。两条路、各自代价与可达性论证的属主是 `#55`（挂 M3）。
3. **措辞上的要求**：这两条在论文里要写成「已识别、已定级、已说明为何不修」，**不能**写成「已修复」。区别不是修辞 —— 第 1 条的风险将长期存在，第 2 条的风险有到期日（`#55` 关闭那天）。

## 2026-09-14 — 推进状态搬进 GitHub issue

1. **`ROADMAP.md` 删除**。里程碑清单、阻塞项、暂缓项全部变成 GitHub issue；本文件接手决策记录。理由：勾选框与文档的属主职责不匹配 —— 文档记「是什么、为什么」，issue 记「还没做、谁挡着」，两者混在一个文件里，每次推进都要改文档。
2. **Issue 用意大利语，仓库 markdown 仍用中文**。issue 列表页 relatore 看得到；M6 的最终交付物本来就要译成意语，提前写就是在攒素材。
3. **标签与里程碑照搬 `airjump-booking`**：`chore` · `blocked` · `security-review` + 四档 `severity:`。里程碑四个：M3 · M5 · M6 · M7，描述里写验收目标。**M4 是空号**：它原是「跨语言」里程碑，2026-08-21 并入核心后解散（见下），编号留空是为了不让 M5–M7 的既有引用整体重排。
4. **安全自查按 OWASP，不按 ISO 27001**。3M 那套 ISO/NIST 引用成立是因为背后有真实审计报告可指回；本仓库没有审计，映射只能自己编。OWASP Top 10 与 OWASP Top 10 for LLM Applications 不预设审计存在，自查本就是它们的用法，答辩也引得动。覆盖面（查过且判定为健全的部分）归 [architettura.md](architettura.md)，未关闭的鉴定项归带 `security-review` 标签的 issue。

## 2026-08-27 — M5 网站交付

报备即可：

1. **推翻两条自己的免登录拍板**：2026-08-22 第 5 条末句「论文期演示环境免登录」与 2026-08-24 第 3 条「campus QA 免登录」。**全站需登录**，匿名路径已从代码里删除。理由见 [README.md](../README.md)「Accounts」一节 —— 简言之，多轮会话就是每用户状态，而当初写下免登录时系统还是单轮的。这两条同时改，只改一条会让记录自相矛盾。
2. **后端消息不做 gettext catalogue，论文期保持英文**。这个项目里三种语言各有属主：界面归前端的三份 catalogue（it/en/zh-hans，已全译），回答语言归 `rag/answer.py` 的 prompt（M2 起就在跑），而 503 与 `error` 这一层的读者是看服务端日志的人。给它再建一套 catalogue 是没有读者的活。可见后果：一个 400 响应体里可能同时出现 DRF 自带的意语校验消息和本项目的英文消息。
3. **同源发页面只做开发形态，静态文件服务推 M6**。`DEBUG=False` 下 Django 按设计拒绝发静态文件，需要 whitenoise 或 nginx；而今天仓库里没有任何地方跑 `DEBUG=False` 起服务，现在装等于装一个没人能验的依赖。已作为显式前置写进 `#41`。
4. **本机不跑整套容器化**：`docker compose up` 无 profile 只起 PostgreSQL，Django 仍在宿主机 `uv run` 下以直接用 GPU；`--profile app` 的整套容器化是 Linux 宿主 / 答辩机路径。这条是 2026-08-24 第 2 条的既有设定，此处只是重申，因为 M5 交付后「一条命令起全套」容易被误读成本机也该这么跑。

## 2026-08-25 — 测量场地划线

报备即可：

1. **本机不再承担带 LLM 的测量跑**，只承担开发与功能自查（起服务、问几个问题、看响应形状）。依据是实测：本机 CPU dense encoding 在 autogrow 循环里出现 **293 s/batch**（单批 19 分半）与 55.9 s/batch，七题跑到第二题已逾 25 分钟且未近尾声——2026-08-24 diario 记为「probabile throttling termico」的 1470 s 异常，实为可复现常态。带 LLM 的评估一律移到 MICC（`rag/` 无 Django 依赖，可脱离 web 单独跑，正是为此）。本机仍必须能跑通全链，这条只约束**测量**，不约束可运行性。
2. **「autogrow 分数门重测」（`#24`）移至 MICC 执行**，与 M3 尺寸网格（`#27`）同场，符合该条原本就写下的「在尺寸网格上重测」。前置任务：把 `data/qdrant`（或 chunk 与快照）搬上服务器，与 vLLM 一起备齐。
3. **Stage 8（Qdrant 换服务进程，`#33`）的门改为检索门**：切换 + 重索引后重跑 smoke 与 campus gold，须复现 **38/40** 与 **28/32**；复现即视为「换后端未动检索」，后端就此从 autogrow 分数的混淆变量里剔除，MICC 上的重测仍只有该条已写明的两个变量（缺陷修复 + 模型尺寸）。原门（等重测记账）作废——重测既已移至 M3，照原门走会连带阻塞硬依赖 Stage 8 的 Celery 一条（`#34`），把网站卡死在登录那一步。

## 2026-08-24 — 执行顺序调整

报备即可：

1. **M5 提前到 M3 之前**，做到 M6 的「干净机器 `docker compose up` 一条命令起全套 + 浏览器完成双库问答演示」为止（含账号与多租户隔离）。三条理由：① 研究成果目前只有终端输出，Meet 与答辩都需要看得见的东西；② `migrate` 从未跑过（无 `migrations/`、无 `db.sqlite3`），此刻建自定义 User 与换 PostgreSQL 的成本≈0，越往后越贵（自定义 User 那条已警告事后改造要重写全部迁移）；③ 数据库与检索后端一次换到位，M3 的全部基线建在同一后端上，不会跑到一半换。
2. **Qdrant 由嵌入式改为 compose 中的服务进程**（`#33`）：网站起来后 Django web、Celery worker、终端评估三方同时要这份索引，嵌入式的单进程文件锁下网站起不来。**迁移不是「重索引」**——`rag/live.py` 明写 `Live keeps no snapshot file`，自增长抓来的页面只存在于索引里、`data/chunks/` 没有副本，需从嵌入式 `scroll(with_vectors=True, with_payload=True)` 读出再 `upsert` 进服务端（零 GPU），该路径切换时实测验证。
3. **访问模型以 M5 里程碑的「访问模型」条为准**：campus QA 免登录、slides 上传与问答需账号 + 多租户隔离。2026-08-22 报备里的「论文期演示环境免登录」限于 campus 场景。
4. **重排触发条件**：毕业 session 日期一经确定即重新评估 M5/M3 顺序 —— M5 约 4–6 周 + M3 约 3–4 周，当前顺序把 M3 排在了一个边界未知的时间轴之后。

## 2026-08-21 — 新方向落地

报备即可：

1. 校园信息源落地方式：爬取+索引为骨架、实时抓取为增量层（他转的 agentic 模板思路，差异 = 封闭可复现优先）；agent 分期（路由器 → 循环）。
2. 跨语言并入核心（M4 解散）：任意语言提问 → 同语言回答，评估 EN/IT/ZH。
3. 开发期生成本地 Ollama（Qwen3-4B 量化），MICC vLLM 留 M3 正式实验。
4. 爬取姿态：robots 遵守 · 限速 1 req/s · ≤500 页 · 只读 · UA 表明论文用途（ingegneria.unifi.it 封 GPTBot 类训练爬虫，但通配 UA 无限制；我们是检索索引非模型训练）。
5. 自增长姿态（2026-08-22 定案）：学生触发的实时抓取经 LLM 相关性门判定后才持久入库，registry 溯源可整批回滚；范围不锁 unifi.it 域（Santa Marta/DSU/CISIA 类学生刚需域可进）；评估用冻结快照与 live 写入隔离，论文数字不受演示影响；论文期演示环境免登录。

## 2026-07-30 — 起步选型

报备即可，不等答复：Django + DRF + React SPA · Qdrant hybrid · vLLM · RAGAS + 检索指标 · gold set 自建 · EN→EN 起步（语料实测英语为主）· 网站与 RAG 同仓库交付。
