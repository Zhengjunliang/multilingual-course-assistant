# 架构与技术栈

决策来源：relatore 的指示（2026-07-28 邮件）+ 此处记录的自主选择。本文件是**技术栈选型与决策状态**的属主；自主拍板项的完整理由（含被推翻的决策）在 [decisioni.md](decisioni.md)，文中里程碑（M3 · M5 · M6 · M7）与逐项工作状态在 GitHub issue。

## relatore 的约束

- **目标**：多语言回答大学课程相关问题 — 提问语言与材料语言不同（如英文提问、意大利语材料）。
- **只用开源权重 LLM**（Qwen 系）；禁用专有 API（OpenAI/Claude）。需评估最优模型尺寸以降低运行成本。
- **渐进路线**：先做与材料同语言的问答，再（视情况）做跨语言部分；必须能**评估回答质量**。
- **文档解析**：考虑用 Granite-Docling 做材料转换。
- **PPM 部分**：完整网站，Flask/Django + Celery/Redis 异步任务。
- **算力**：先用 Google Colab（免费 T4）试验；后接入 relatore 提供的 GPU 机器；备选 Runpod / Lightning。**偏离（2026-07-31 自主拍板）**：跳过 Colab，直接用 MICC 机器 — 接入已完成且 ultron 有 24 GB，Colab 的 16 GB + 会话超时 + 每次重装环境不构成优势。理由见下方算力策略。
- **新方向（2026-08-21 口头）**：agentic RAG（relatore 转的 Lightning «agentic RAG powered by Qwen3» 模板思路，分析见 [analisi-rag.md](analisi-rag.md)）+ UniFi 网站第二知识源 —— Erasmus/外国学生用自己的语言问校园信息（ingegneria、报名、学费、日历等）。落地设计（scope 规则、快照与 registry 布局、深化循环）在 [fonte-web-unifi.md](fonte-web-unifi.md)，余下的 autogrow 分数门重测见 `#24`。

relatore 给的四个起步链接已精读并扩展成 [analisi-rag.md](analisi-rag.md)（M1 交付物），原链接与逐条分析都在那里。

## 已定技术栈

决策已做；依赖只在真正要用的里程碑引入（已装：Django、pydantic-settings + 工具链；RAG 组件随 M2 各步加入，前端与 Celery 🔜 M5）。选型原则（2026-07-29 拍板）：**市面最好的开源方案**；硬约束只有两条 — 后端 Django + Celery/Redis（relatore 指定）、模型层开源权重 Qwen 全家桶（论文硬约束，且 Qwen3-Embedding 8B 是 MTEB multilingual 榜首，非妥协项）。

| 组件           | 选择                                | 动机                                                                     |
| -------------- | ----------------------------------- | ------------------------------------------------------------------------ |
| 语言           | Python 3.12（uv 管理）              | ML 生态；Flask/Django 是 relatore 指定范围                               |
| 包管理         | uv                                  | lockfile、内置 Python 版本管理（系统 3.10 不动）                         |
| Web            | Django 5.2 LTS                      | admin 免费当材料后台，auth/ORM/i18n 内置（多语言域加分），Celery 集成成熟。选 LTS 不选 6.0：支持到 2028-04，且 DRF 等生态对 LTS 支持最稳 |
| API            | DRF（Django REST Framework）+ SSE 流式 | 问答 API 与页面并行交付（2026-07-29 拍板）；为 M7 外部集成留口          |
| 前端           | React + TypeScript SPA（Vite）      | 市面主流组合；流式回答、引用高亮等交互展示性最强（2026-07-29 拍板）      |
| 异步任务       | Celery + Redis                      | relatore 指定                                                            |
| LLM            | Qwen3 系列（0.6B–8B 尺寸对比）      | relatore 指定；2080 Ti（11 GB）上 8B 需量化，ultron（24 GB）可 8B fp16   |
| Embedding/Rerank | Qwen3-Embedding / Qwen3-Reranker  | 与 LLM 同源的一体化方案，relatore 链接指向的路线                          |
| 文档解析       | Docling **经典 pipeline + 自适应路由**：逐份文件按画像决定是否开 OCR / 公式富化。**VLM 不进自动路由**，只留手动对照 | 2026-07-31 实测：经典 pipeline 修复词间空格粘连、还原表格与标题层级、重音正确；有文字层的 PDF 开 OCR 零产出却多耗 62% 时间。2026-08-02：富化开关全用 Docling 默认（关）会让公式与图片永久丢失 → 解析前先探测，31 份里 4 份开公式、1 份开 OCR，零误报。同日 VLM 对照实测**否决**了"缺文字层就上 VLM"的原设想：granite-docling 耗时翻倍（1059s vs 527s），唯一词汇反而更少（671 vs 729），丢掉 `avc1.42e01e` 这类检索命脉的字面量 —— 它在转述而非转录。规则、阈值与全部实测见 [docling-e-pipeline.md](docling-e-pipeline.md)，实现是 [rag/probe.py](../rag/probe.py) |

选 Django 不选 Flask 的理由：对单人开发 Django **减少**代码量（admin、auth、ORM、i18n 内置）；Flask 需手动拼装。前端选 React SPA 弃 HTMX 的理由：PPM 展示性与流式交互。两项 2026-07-30 拍板确认（前端技术选型自主）。同日拍板里的「PPM 无 UI 评分要求」一句**于 2026-09-14 推翻** —— 界面外观计入课程分数，理由见 [decisioni.md](decisioni.md) 2026-09-14「人工闸门与 UI 计分」第 2 条（被推翻的原话也存在那里）；现状盘点与未决点在 `#49`。

## 决策状态

原则（2026-07-29 拍板，2026-07-30 收敛）：技术决策自主，**不挂 relatore 确认** — 有依据即定，实验验证后关闭；🔒 只留 relatore 真正属主的项（跨语言启动、截止日期）。依赖规则：🔒 项**禁止**引入依赖或配置文件；🔶 项自 M2 起可引入（实验推翻则原地替换 — 规则在 CLAUDE.md）。

| 决策       | 选择                                                                                                          | 状态 | 验证条件                  |
| ---------- | ------------------------------------------------------------------------------------------------------------- | ---- | ------------------------- |
| RAG 路线   | 自建 pipeline：Docling → chunk → hybrid 检索 → rerank → Qwen3；Qwen-Agent/纯 BM25 做对照基线（分析见 [analisi-rag.md](analisi-rag.md)）；不用 LlamaIndex/LangGraph 全家桶（可解释性优先） | ✅   | M2 端到端跑通：gold 40 题 hit@5 95%（[diario-sperimentale.md](diario-sperimentale.md)） |
| 向量库     | Qdrant：原生 hybrid（dense Qwen3-Embedding + sparse fastembed BM25 + RRF）、locale/课程 payload 过滤（fusion 下必须放 prefetch 分支内，实测顶层 filter 被静默忽略）；M2 用 qdrant-client 本地模式（无服务器进程，[rag/index.py](../rag/index.py)、[rag/search.py](../rag/search.py)），M5 起 Docker；降级备选 pgvector | ✅   | 31 deck 全量（1234 chunk），gold 40 题 hit@5 38/40 |
| 数据库     | M2 原型无 DB（文件 + Qdrant 本地）；M5 起 PostgreSQL（Docker）                                                 | ✅   | `docker compose up -d` 起 PostgreSQL 18；自定义 `User` 在首个 `migrate` 之前落地 |
| 前端       | React 19 + TypeScript + Vite + Tailwind v4 + Biome；shadcn 风格组件源码进仓库（不是 npm 包）；界面文案 react-i18next 三语。SSE 解析器手写（⛔ `EventSource`：只发 GET）；契约 TS 镜像的唯一源在 `apps/qa/contract.py` | ✅   | `frontend/`，`uv run python scripts/check.py frontend` 一条跑完 lint + 类型 + catalogue key + 对比度 + 测试 + 构建 |
| 访问模型   | **全站需登录**（2026-08-27 拍板推翻此前两条免登录决定，理由见 [decisioni.md](decisioni.md) 2026-08-27 第 1 条）：session cookie + CSRF，⛔ token/JWT（同源用不上）；开放自助注册；限流按端点分桶。做到的是**多账号、单并发** —— 一张 8GB 卡串行答题，per-caller 限流对全局队列无约束。🔜 M5 `#93`: anonymous campus-only questions — [decisioni.md](decisioni.md), 2026-09-25 point 3 | ✅   | `apps/accounts/`；匿名 `POST /api/ask` → 403，无 CSRF token → 403 |
| 界面/消息语言 | 三层各有属主：界面 = 前端三份 catalogue · 回答语言 = `rag/answer.py` 的 prompt · 后端 503/`error` = **英文，不做 catalogue**（2026-08-27 拍板，读者是看服务端日志的人） | ✅   | `npm run check:i18n` 守着三份 catalogue 的 key 集合逐字相等 |
| 推理服务   | OpenAI 兼容端点是唯一契约：开发期本地 Ollama（Qwen3-4B q4），M3 正式实验 vLLM（MICC 服务器，流式；Turing 卡**无 bfloat16**，一律 fp16）—— 切换只改 `.env` 的 `LLM_BASE_URL`/`LLM_MODEL` | 🔶   | 服务器起 vLLM `#18` → 尺寸对比 `#27` |
| 校园信息源 | UniFi 网站第二知识源：爬取+索引为骨架（复用 ingest 管线，Qdrant `unifi_web` collection），实时抓取为**自增长层**（过相关性门后持久写入，registry 溯源可回滚）；发现 = sitemap + 范围规则（板块规则表，**不锁 unifi.it 域**——Santa Marta/DSU/CISIA 类学生刚需域走显式条目），种子板块 ≤500 页起步；页面直链 PDF 附件（≤20MB）复用 parse 管线；HTML 解析走 Docling HTML backend | ✅   | campus gold 28/32=88%（`uv run python -m rag.gold gold/campus.jsonl`，EN 92 · IT 85 ≥ 门 0.80） |
| agent 编排 | 分期：路由器（选库 + query 改写 + 带理由拒答 + 兜底拒答指路「贴 URL 可教会系统」，校验失败 fallback `both`）→ **深化循环**（抓页 → 「够答？」判定即停止条件——原 self-assess 并入 → 出链/PDF 编号候选选一，≤3 步硬上限，`--no-deepen` 降级）；显式控制流 + 每步受 pydantic 校验的 JSON 决策，⛔ 原生 tool-calling（4B 量化协议遵从性不可靠）；决策日志 append-only 落 `data/webcorpus/decisions.jsonl`——agent 唯一的例外写路径（审计工件，非知识库；KB 写入仍只经 `rag/live.py`） | ✅   | `rag/agent.py`；路由 exact 22/32 · wide 26/32；autogrow 门未达（双臂 0/7，归因 [diario-sperimentale.md](diario-sperimentale.md)） |
| 自增长写入门 | 实时抓到的页面经 LLM 相关性判定（JSON 二分，校验失败=不落库）后才持久写入共享库；registry（append-only）记 url · content_hash · fetch_date · ingest_run_id · ingest_source · trigger · outlinks，可按 run 整批回滚 | ✅   | `rag/live.py`；标注集真机 **18/20**（2026-08-24，`--measure-gate`）—— **这个数字不可复现，别当基线用**：冻结的只有标签，`gold/relevance-gate.jsonl` 只存 `{url, label, note}`，每次测量都重抓那 20 个网页，判的是当天的内容。2026-09-14 重跑得 17/20，而两次之间网页和 `pypdf` 都变了，归因不成立。修法与重测归 `#83` |
| eval 隔离  | live 写入带 `ingest_source="live"`，eval 默认只取 `"crawl"`（+ 可选 `--snapshot <run_id>`）；filter 只进 `unifi_web` 的 prefetch 分支（顶层 filter 在 fusion 下被忽略，已实测）；**写路径对偶**：删除谓词限定 (url, ingest_source)，crawl 快照与 live 增量互不覆盖 | ✅   | 33 live 点在库时 campus 仍 28/32；两次回滚精确归位 29098；回滚后 campus/smoke/control 恒等基线 |
| 部署形态   | 答辩演示级：干净机器 `docker compose up` 一键起全套、浏览器演示——共享 web KB 的「服务器」即 compose 服务；MICC/公网常驻与 UniFi SSO = post-tesi 可选。**开发形态已到位**：`npm run build --prefix frontend` + `uv run python manage.py runserver` → Django 在 `127.0.0.1:8000` 根路径上自己发 SPA，一个地址一个进程 | 🔶   | compose 演示 `#41`；两条前置 = Qdrant 服务化 `#33` + 静态文件服务 `#40`（`DEBUG=False` 时 Django 按设计拒发静态文件） |
| 可观测性   | Langfuse 自托管（Docker），LLM tracing                                                                         | 🔶   | 接入 `#26` |
| 评估方法   | RAGAS（faithfulness · answer relevancy · context precision/recall，judge = 开源权重 Qwen3 大尺寸）+ 检索指标（hit@k、MRR）；gold set 自建（无现成数据集） | 🔶   | 跑通 `#20` |
| 目标语言   | EN→EN 基线（M2）；任意语言提问 → 同语言回答是双场景核心（2026-08-21 拍板并入原 M4，见 [decisioni.md](decisioni.md) 2026-08-21 第 2 条），评估语言 EN/IT/ZH。语料不按语言拆库：Qwen3-Embedding 本身是多语言的，chunk 带 `locale` payload 供过滤 | 🔶   | 双场景 gold set `#19` |

评估方法自主拍板（2026-07-30，见 [decisioni.md](decisioni.md)）：relatore 只要求"能评估回答质量"，未指定指标。gold set 无现成数据集，M2 建冒烟版、M3 扩全量（`#19`）。

## 实验可复现性 🔜 M3

依赖层的可复现已就位（`uv.lock` + CI `--locked`）；模型层的对应物是下面这份每实验必录清单，M3 评估脚本落地时执行：

- **模型身份**：HF 模型 revision（pin 到 commit，`Qwen3-8B` 这样的名字不是固定 artifact）+ 量化方案。量化 8B 与 fp16 8B 是**不同模型**：尺寸对比实验里两者不得跨机混比，否则尺寸轴与精度轴混杂。
- **推理配置**：vLLM 版本、seed、采样参数（temperature / top_p / max_tokens）。
- **数据身份**：语料快照哈希与解析配置随 chunk payload 携带（字段属主见 [docling-e-pipeline.md](docling-e-pipeline.md)）。
- **解析栈版本**：`docling`（含 `docling-ibm-models`）与 `pypdf` 的版本必须与语料数字一起记录。这条不是推演出来的：2026-09-14 实测 `pypdf` 6.16.1 → 6.18.1 在**页数与图片数完全不变**的前提下，31 份里 12 份的 `chars/p` 全部上升（最大 +9.7%），而路由判定一个没变。也就是说下方「语料与交付范围」里的「约 65 万字符」与 `3.5-HTML5` 的「10001 → 20032」都是**版本相关**的数字 —— 与模型 revision 同类，换库即须重测。明细见 [diario-sperimentale.md](diario-sperimentale.md) 2026-09-14 那条。

## 语料与交付范围

- **语料 ✅**：PPM 课程 slides，31 份 PDF、约 1200 页、约 65 万字符，在 `data/corpus/PPM/`（gitignore，版权材料永不进 git）。2026-07-31 用 pypdf 实测：
  - **语言**：英语为主（~23 份：Django 全系列、Docker、JavaScript、图像/视频压缩理论、REST、Flask），意大利语或英意混排 ~8 份（`3.1-web-intro-html`、`3.6`–`3.8`、`HTML5_tag_semantici`）。**单文件内也会混语言**，所以 `locale` 是 chunk 级属性，不是文件级。
  - **文字层**：31 份全部有，无扫描件 → OCR 非必需项。
  - **例外**：`3.5-HTML5-Part-2` 32 页里 16 页近乎为空，内容在图里 → 路由为其开 OCR（抽取量 10001 → 20032 字符）。仍余 19 个死 section，VLM 也救不回。
  - **两个已知坑，均已验收 ✅**：朴素抽取丢词间空格（`"Video isa sequenceof frames"`）→ Docling 还原成 `"Video is a sequence of frames"`；连字（U+FB01 等）出现在 17 份 PDF 的文字层里，单份多达 97 处（`non-proﬁt` · `conﬁgured` · `micc.uniﬁ.it`），不归一化 BM25 必漏召回 → `rag/parse.py` 的 NFKC 归一化后残留为 0。
  - **新发现的坑**：图片与公式在 Docling 默认配置下全部丢弃，抽样 9 份约 322 页里有 **63 个死 section**（只剩标题、正文全是图片占位）。这是本语料最大的检索缺口，也是自适应路由与 M3 图片描述消融实验的动机。明细见 [docling-e-pipeline.md](docling-e-pipeline.md)。
  - 往年 scritto 真题暂缓 🔜 M3 后（`#47`）。
- **能力边界**：检索问答（QA）。出题 / 自动判卷 ⛔ 超出范围。
- **交付**：React SPA + DRF API（SSE 流式问答）+ Django admin 材料后台，与 RAG 部分**同一仓库**。
- **Data model** 🔜 M5: programmes, courses and yearly editions, role scopes, content ownership — [data-model.md](data-model.md).
- **租户与认证**：campus web KB = 全局共享一份，检索侧无 per-user 隔离，这是有意的（语料本就公开）—— 但深化循环接上 web 之后它会变成真问题，见 `#17`。触发自增长的写操作收敛到账号 + rate limit。**免登录已作废**：2026-08-22 定案里的「campus 免登录可问」与「论文期演示环境免登录」于 2026-08-27 被自己推翻，现为**全站需登录**（上方「访问模型」行；理由见 [decisioni.md](decisioni.md) 2026-08-27 第 1 条 —— 多轮会话本身就是每用户状态，而写下免登录时系统还是单轮的）。🔜 M5 `#93`: anonymous campus-only questions — [decisioni.md](decisioni.md), 2026-09-25 point 3.**UniFi SSO 可行性**：走意大利高校联邦身份 IDEM GARR（SAML/Shibboleth），Django 侧有现成 SP 库，技术上是标准协议——但把应用注册为学校认可的服务方需要 UniFi IT 审批，单人论文项目不等它：M5 用自建 Django 账号，auth 做成可插拔，SSO 记为 post-tesi 可选（🔜 `#44`）。
- **外部知识源**（MCP、Google Drive 等）🔜 M7（可选，post-M6，`#45`）。

## 工程化 ✅

ruff（lint + format）· pyright（`rag/` strict）· pytest + pytest-django + 覆盖率门禁（pytest-cov）· pre-commit（含泄密与 lockfile 守卫、commit 消息格式）· GitHub Actions **两个 workflow**：[ci.yml](../.github/workflows/ci.yml) 的两个并行 job（`check` 链 · `audit` 依赖审计）与独立的 [secrets.yml](../.github/workflows/secrets.yml)。前端质量门与后端对等：`npm run test`（vitest，覆盖 `sse.ts` 的帧解析与事件契约、`markers.ts` 的引用切分）接在 lint/类型/catalogue 之后、build 之前。依赖更新由 [dependabot.yml](../.github/dependabot.yml) 每周提 PR（`uv` · `npm@/frontend` · `github-actions` 三个生态）。**仓库级 Dependabot alerts 有意不开**（2026-09-14）：它是另一个开关，管的是 security updates —— advisory 一落地就即时通知并针对性提 PR。不开的代价只有「即时」二字，而发现漏洞这件事本就不靠它：`pip-audit` 与 `npm audit` 每次 push 都跑，`#7` 那两条 CVE 正是被它们抓到的，Dependabot 当时既没开也帮不上（其中一条根本没有修复版本）。每周的版本更新 PR 负责送来修复，审计闸门负责在修复到达前让构建红着。**`ci.yml` 不做路径过滤**：纯文档 commit 照样跑全链。曾经用 `paths-ignore` 过滤过，仓库转公开（Actions 分钟数不再稀缺）后撤销 —— 路径过滤是**事件级**开关，被过滤掉的 commit 根本不启动 workflow、因而不上报任何状态，而分支保护的「必需检查」会永远等那个不会到来的状态。过滤器与必需检查只能二选一，理由见 [decisioni.md](decisioni.md) 2026-09-14「仓库转公开」。密钥扫描双层：pre-commit 的 `detect-private-key` 拦「别写进去」，gitleaks 答「以前有没有写进去过」。后者独立成 workflow 是因为**触发器**：gitleaks-action 只在 `workflow_dispatch` 与 `schedule` 下扫全历史，`push`/`pull_request` 下只看该事件带的那几个 commit —— 每周一次的定时跑才是回答「以前」的那一次，而把周期性 cron 塞进 `ci.yml` 会把整条 Python/TS 链一起拖着跑。工具配置集中在 [pyproject.toml](../pyproject.toml)，hook 在 [.pre-commit-config.yaml](../.pre-commit-config.yaml)；日常命令见 [README.md](../README.md)。配置与密钥经 `.env` 由 pydantic-settings 读入（`config/env.py`，不 import Django，将来与 `rag/` 共用同一来源），`.env` 永不进 git。docker-compose 🔜 M5（PostgreSQL · Redis · Qdrant · Langfuse）。

## 安全自查 ✅ 2026-09-14

一轮全仓库自查。判据是两份现行清单，版本写死以便日后判断是否过期：**OWASP Top 10:2025**（final；2021 版已被 OWASP 标为 superseded，SSRF 不再是独立类别而并入 A01）与 **OWASP Top 10 for Large Language Model Applications, versione 2026**（2026-08-04 发布，项目现名 OWASP GenAI Security Project；取代 2025 版）。⛔ ISO 27001 / NIST 映射：没有真实审计可指回时映射只能自己编，理由见 [decisioni.md](decisioni.md) 2026-09-14「推进状态搬进 GitHub issue」第 4 条。

本文件是**覆盖范围**的属主 —— 即「两份清单的每一项在本项目里判成了什么」。开放鉴定的正文不在这里，在带 `security-review` 标签的 issue 里。下面两张表的每一行必须落到三种归属之一：健全（写依据）、有开放鉴定（写 issue 号）、缺口（也写 issue 号）。没有第四种。

**OWASP Top 10:2025 — 逐项**

| 类别 | 判定 | 归属 |
| --- | --- | --- |
| A01:2025 Broken Access Control | 🔶 有开放鉴定 ×3 | `#4`（任意 URL fetch 无目的地 allowlist —— 2021 版的 A10 SSRF 并入本类后归这里）· `#15`（manifest 值未归一化即拼成路径）· `#17`（索引共享，无 per-user 归属）。三面判定健全：授权与 IDOR（queryset 层 scoping，404 与「不存在」不可区分）· CSRF 端到端（双向，`ensure_csrf_cookie` + 请求头，Vite 代理 `changeOrigin: false` 有据 —— 2021 版起 CSRF 并入本类）· 爬虫的出站姿态（robots 遵守与限速写在代码里，不靠约定） |
| A02:2025 Security Misconfiguration | 🔶 有开放鉴定 ×2 | `#11`（无 CSP）· `#14`（错误消息把服务端命令与路径讲给调用方）。健全面：`check --deploy --fail-level WARNING` 通过 · `docker-compose.yml` 无明文凭据且默认不暴露应用服务 · 两个 workflow 的 token 都是只读且按需给：`ci.yml` 只要 `contents: read`，`secrets.yml` 另加 `pull-requests: read`（gitleaks 在 PR 上要列 commit 定扫描范围，少了它 403；**write 没给** —— 那是发 PR 评论用的）。`makemigrations --check` 守着迁移漂移 |
| A03:2025 Software Supply Chain Failures | 🔶 有开放鉴定 ×2 | `#7`（lockfile 两条 CVE，两条都是**风险接受**不是修复，见 [decisioni.md](decisioni.md)「两个 CVE 的处置」）· `#55`（其中 `transformers` 那条有修复版但被全平台求解挡住，这是它的出口，挂 M3）· `#10`（HF 模型未钉 revision）。本类是 2021 版 A06「Vulnerable and Outdated Components」的扩展，所以未钉 revision 从 2021 的 A08 移到这里。健全面：`uv sync --locked` · `npm ci` · action 按 SHA 钉住 · `npm audit` 为 0 · [dependabot.yml](../.github/dependabot.yml) 每月提更新 PR |
| A04:2025 Cryptographic Failures | ✅ 健全 | `check --deploy` 下 HSTS · SSL redirect · cookie secure 齐备；`SecretStr` 用法有据；客户端无 token 存储（`localStorage` 里没有 token，只有同源 cookie） |
| A05:2025 Injection | ✅ 健全 | 无裸查询，只走 ORM 与 `models.Filter`；前端无 `dangerouslySetInnerHTML`，`URL_PATTERN` 只认 `https?://`，`rel="noreferrer"`，`CSS.escape()`；唯一一处 `subprocess.run` 固定 argv、不过 shell |
| A06:2025 Insecure Design | 🔶 有开放鉴定 ×1 | `#5`（把一次永久写入托付给读着待判内容的 LLM 判定 —— 「LLM 当授权决策」）。2021 版编号为 A04 |
| A07:2025 Authentication Failures | 🔶 有开放鉴定 ×2 | `#9`（`/admin/` 登录尝试无限）· `#16`（`DEBUG` 默认为真时 `BasicAuthentication` 仍在）。健全面：`create_user` · Django 四个校验器 · session key 轮换 · 单一失败消息 · DRF `ScopedRateThrottle` 配 `NUM_PROXIES = 0`。2021 版名为「Identification and Authentication Failures」 |
| A08:2025 Software or Data Integrity Failures | ✅ 健全 | 无 `pickle` / `torch.load` / `yaml.load` / `eval`，JSONL 一律 `model_validate_json`，registry 与 manifest 的坏行跳过并告警；仓库与 git 历史中无密钥，`.env` 从未被跟踪，pre-commit 带 `detect-private-key`。模型 artifact 的完整性归 A03 的 `#10` |
| A09:2025 Security Logging and Alerting Failures | 🔶 有开放鉴定 ×1 | `#13`（认证事件不留日志）。2021 版名为「Security Logging and Monitoring Failures」 |
| A10:2025 Mishandling of Exceptional Conditions | 🔶 缺口（本轮新开） | **有什么**：多处有意设计的兜底 —— 相关性门失败即 `relevant=False`（失败朝关的方向）· LLM 的 JSON 输出单点校验 + 每个调用方确定性兜底 + 30 s 超时 · 契约里有显式的 `Unavailable` 区分「稍后重试」与「模型服务不在」· 路由器校验失败回落 `both`。**缺什么**：一个判定。本类是 2025 版新增（2021 版那个位置是 SSRF），本轮自查按旧清单做，因而从未按这一类别看过 —— 尤其是这些兜底**并非同一个方向**：门朝关的方向失败，而 registry/manifest 的坏行是跳过并告警，也就是带着残缺数据继续 → `#52` |

**OWASP Top 10 for LLM Applications 2026 — 逐项**

| 类别 | 判定 | 归属 |
| --- | --- | --- |
| LLM01:2026 Prompt Injection | 🔶 有开放鉴定 ×2 | `#5`（间接注入打向**写入决策**）· `#6`（间接注入打向**回答**：检索片段无分隔符进生成 prompt） |
| LLM02:2026 Sensitive Information Disclosure | 🔶 有开放鉴定 ×1 | `#36`。**健全的部分**：今天索引里只有公开的校园页面，无跨账号可读的私密材料 —— 因为上传功能**代码里根本不存在**（无 `FileField`、无端点）。**缺的部分**：它一旦存在，本行的判定就要重做，而该判定正是 `#36` 的验收项。将来要为它立的那几道闸别处已有先例：`LIVE_MAX_PDF_PAGES = 40` · `document_timeout` 120 s · `artifact_name()` 定盘上文件名 |
| LLM03:2026 Excessive Agency | 🔶 缺口（本轮新开） | `rag/agent.py` 的深化循环有实质约束（≤3 步硬上限 · 显式控制流 · 每步 pydantic 校验的 JSON 决策 · ⛔ 原生 tool-calling · 唯一例外写路径 `decisions.jsonl` 是审计工件），但**从未按这一类别系统评估过**；本类在 2026 版从第 6 升到第 3 → `#53` |
| LLM04:2026 Supply Chain | 🔶 有开放鉴定 ×1 | `#10`（模型未钉 revision）。依赖侧见 A03:2025 的 `#7` |
| LLM05:2026 Data and Model Poisoning | 🔶 有开放鉴定 ×1 | `#5` —— 自增长写入就是本项目的投毒面；2026-09-14 起的缓解方向是人工确认闸门（`#48`），见 [decisioni.md](decisioni.md) 2026-09-14「人工闸门与 UI 计分」第 1 条 |
| LLM06:2026 Unbounded Consumption | 🔶 有开放鉴定 ×2 | `#8`（尺寸上限在整个响应体已进内存后才生效）· `#12`（注册开放且队列无全局上限）。2025 版编号为 LLM10 |
| LLM07:2026 Misinformation | 🔶 缺口（本轮新开） | **有什么**：⛔ 出题与判卷超出范围（最危险的用法不存在）· 回答只从检索片段生成 · 引用卡来自 retrieval 而非模型散文（`frontend/src/features/chat/AnswerStream.tsx` 写明了这个区分）· 路由器会带理由拒答。**缺什么**：一个判定。原先这里写的是「控制在别处（`#20` 的 RAGAS faithfulness）」，但 `#20` 是评估 issue、只带 `enhancement` 标签，量的是平均质量，不是「答错一条截止日期会怎样」 → `#56`。2025 版编号为 LLM09 |
| LLM08:2026 Hidden Context Exposure | 🔶 缺口（本轮新开） | 2026 版把 2025 的「System Prompt Leakage」扩展为「任何被组装进模型上下文的非用户可见内容，含检索到的文本、工具 schema、流程规则」。本项目的上下文里这三样都有 → `#54` |
| LLM09:2026 Vector and Embedding Weaknesses | 🔶 有开放鉴定 ×1 | `#17`（索引共享，没有任何点带着「谁引发的」）。**本轮补上的归类**：该 issue 原本只标了「LLM04 Data and Model Poisoning」（2026 版为 LLM05）。那条不算错，但它标的是**后果**；多租户向量库的隔离与溯源本身有专门的类别，就是这一条，之前漏了 |
| LLM10:2026 Improper Output Handling | ✅ 健全 | LLM 的 JSON 输出单点校验，每个调用方都有确定性的安全兜底，30 s 超时；前端渲染侧见 A05:2025 那一行。2025 版编号为 LLM05 |

## 算力策略：分层（开发本地 · 实验服务器）

分界线按**用途**（2026-08-21 拍板本地优先）：**正式实验**（M3 尺寸网格、评估跑分）在 MICC 服务器 vLLM；**开发循环**全本地，含生成 —— Ollama + Qwen3-4B q4 约 2.6 GB，与 embedding/reranker（0.6B 各约 1.2 GB）共存 —— 实测生成时峰值 7761/8188 MiB（[diario-sperimentale.md](diario-sperimentale.md)），成立但贴限，题间须卸载 Ollama 模型（`ollama stop` 或服务端 `OLLAMA_KEEP_ALIVE=0`）；8B 级笔记本塞不下，只在服务器。ingest 阶段那几个小模型本就本地 —— 2026-08-02 修正，笔记本装 CUDA 版 torch（`pyproject.toml` 的 `pytorch-cu126` index，`sys_platform == 'win32'` 限定，Linux CI 不受影响），让 Docling 的 layout / TableFormer / CodeFormulaV2 / granite-docling-258M（fp16 约 0.5 GB）走本地 GPU。**收益有限但真实**：VLM 从 CPU 上 > 56s/页降到 33s/页（只快 1.7 倍 —— 逐 token 解码是延迟受限，不是算力受限），足以在本地跑完那次否决了 VLM 的对照实验，也为 M3 的 Qwen2.5-VL 图片描述留出本地试错空间。全量解析与需要吞吐的 VLM/图片描述仍上服务器（vLLM 后端）。实测见 [docling-e-pipeline.md](docling-e-pipeline.md)。relatore 邮件说的 "2080Ti 机器" 即 Dream Machines 本身（每台 2× 2080 Ti）。

Colab ⛔ 不用：MICC 接入已完成，6 台 Dream Machines + ultron 可挑空闲机器，显存和常驻能力都优于免费 T4；Colab 的会话超时、每次重装依赖、模型权重反复下载只会拖慢迭代，且论文实验需要可复现的固定环境。Runpod / Lightning 仅作 MICC 长期不可用时的付费兜底，不进日常流程。

日常开发循环（**代码与数据都不需要同步到服务器**，2026-08-04 落实，2026-08-21 生成也本地化）：embedding（Qwen3-Embedding-0.6B）与 reranker（Qwen3-Reranker-0.6B）在笔记本 GPU 本地跑（dense bf16、reranker fp16，各约 1.2 GB），Qdrant 用本地嵌入式模式（`data/qdrant/`，无服务进程）—— 索引与检索**完全离线**；生成走本地 Ollama（Qwen3-4B q4，OpenAI 兼容端点），代码里只配 base_url（`config/env.py` 的 `LLM_BASE_URL`）；M3 正式实验把它指向服务器 vLLM 的 SSH 隧道（`ssh -L 8000:localhost:8000 <server>`，tmux 常驻，发过去的是 prompt —— 问题 + 检索出的 chunk 文本，不是文件）。单测/CI mock 掉 LLM client，零网络零 GPU。只有正式实验（M3 评估、尺寸对比）才在服务器上 `git pull` 执行。

## 硬件拓扑

| 环境                 | GPU / 显存                | 用途                                       |
| -------------------- | ------------------------- | ------------------------------------------ |
| MICC Dream Machines  | 每台 2× RTX 2080 Ti（doc 标 12 GB，实际规格 11 GB）；6 台：targaryen · lannister · lechuck · theflash · harlock · nikita | 常规实验；通过监控挑空闲机器 |
| MICC ultron          | 2× Titan RTX 24 GB        | 大实验、8B fp16、模型尺寸对比               |
| 开发笔记本           | RTX 4070 Laptop, 8 GB     | 写代码 + SSH + **ingest 小模型与开发期生成本地跑**（Docling 全套，含 granite-docling-258M · Ollama Qwen3-4B q4）；8B 级实验不做 |
| Runpod / Lightning   | 可变                      | 付费兜底，仅当 MICC 长期不可用              |

MICC 接入 ✅：账号与公钥登记（sysadmin 确认）；首次登录（targaryen：2× 2080 Ti 11 GB、CUDA 12.4；ultron：2× Titan RTX 24 GB、CUDA 12.2，用户 `jzheng`）；NAS 个人 home 存在（`/oblivion/users/jzheng`、`/equilibrium/jzheng`）。校外接入 ✅：Dream Machines 公网直连 `ssh <user>@<server>.micc.unifi.it`，无需 VPN（OpenVPN 已弃用，sysadmin 确认；另有可选 MICC VPN，本项目不用）。服务器规格与 IP 见 doc portal：`https://doc.portal.micc.unifi.it`（仓库外，需登录）。存储：共享 NAS `andromeda` · `equilibrium` · `fishtank` · `oblivion`，home 配额 100 GB；卷选择、个人目录路径与 `HF_HOME` 见 [README.md](../README.md)。GPU 监控：专用 Discord 频道 / Grafana（micc-authentik 登录）。**凭据永不进仓库。**

## 开发环境注意（Windows）

- 系统 Python 3.10：不动；项目版本由 uv 管理 ✅（`.python-version` 写 3.12）。
- PyPI 在 Windows 上给的 torch 是 CPU 版；项目把它指向 CUDA 构建，理由与实测见上方算力策略。
- Redis 无原生 Windows 版：本地经 Docker 或 WSL2。
- Windows 上 Celery：dev 用 `solo` pool；部署在 Linux 上。
