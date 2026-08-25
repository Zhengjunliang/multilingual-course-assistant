# ROADMAP

**范围**：Triennale 毕业论文（信息工程，UniFi — relatore Prof. Marco Bertini）：大学课程材料的多语言问答（仅 QA，⛔ 出题/判卷）+ **校园信息问答**（UniFi 网站第二知识源 + agentic 路由，M2.5，relatore 2026-08-21 口头新方向），RAG + 开源权重 LLM（Qwen 系），另含网站（PPM 部分）：Django/DRF + Celery/Redis 后端 + React SPA 前端。跨语言（任意语言提问 → 同语言回答）是双场景核心能力，不再是可选附加。relatore 约束、技术栈与决策状态见 [docs/architettura.md](docs/architettura.md)。

## 里程碑

### M0 — 脚手架与基础决策 ✅

仓库骨架与技术栈决策表落地；决策原则（自主拍板、不挂 relatore 确认）与决策状态在 [docs/architettura.md](docs/architettura.md)。

### M1 — RAG 学习与分析 ✅

relatore 四个起步链接精读、路线定为自建 pipeline（分析在 [docs/analisi-rag.md](docs/analisi-rag.md)，拍板在 [docs/architettura.md](docs/architettura.md)）；MICC 接入完成（规格在 [docs/architettura.md](docs/architettura.md)，日常使用在 [README.md](README.md)）；一次性最小实验的否决记录在 [docs/analisi-rag.md](docs/analisi-rag.md)。

### M2 — 单语言 RAG 原型 ✅

EN→EN CLI 原型端到端跑通：ingest 全链（probe → Docling → chunk → Qdrant hybrid）+ rerank + 本地 Ollama 生成，全量 31 deck · 1234 chunk，gold 40 题 hit@5 95%（防泄漏对照组 5/5）。实测与方法论在 [docs/diario-sperimentale.md](docs/diario-sperimentale.md)，解析/切块契约在 [docs/docling-e-pipeline.md](docs/docling-e-pipeline.md)，语料事实与本地优先拍板在 [docs/architettura.md](docs/architettura.md)，命令在 [README.md](README.md)。

### M2.5 — 校园信息源 + agentic 编排 🔜

relatore 2026-08-21 口头新方向（Lightning «agentic RAG powered by Qwen3» 模板思路的落地，模板分析见 [docs/analisi-rag.md](docs/analisi-rag.md)）：UniFi 网站作第二知识源，Erasmus/外国学生任意语言问校园信息（ingegneria、报名、学费、日历等）。架构：**爬取+索引为骨架，实时抓取为自增长层**——学生问到未收录的页面（贴链接，或从已收录页面的出链图找到候选）时实时抓取，经 **LLM 相关性门**判定与大学相关后**持久写入**共享库（registry 溯源，可按 run 整批回滚）；答案不在当前页时 agent **迭代深化**（信息在 PDF 附件就下载、在链接后就跟进，以「够回答」为停止条件，≤3 步硬上限）。页面发现 = sitemap + 范围规则（板块规则表，**不锁 unifi.it 域**——Santa Marta/DSU/CISIA 类学生刚需域走规则表显式条目；实测 unifi.it 有 `sitemap.xml` 带 IT/EN hreflang，ingegneria.unifi.it 有 `sitemap.php`），种子板块起步 ≤500 页硬顶。HTML 解析走 Docling HTML backend；agent 用显式控制流 + 每步受 pydantic 校验的 JSON 决策（⛔ 原生 tool-calling：4B 量化遵从性不可靠）。**评估可复现**：live 写入带 `ingest_source="live"`，eval 默认只取冻结快照（filter 隔离，设计在 [docs/architettura.md](docs/architettura.md) 决策表）。契约与设计细节 🔜 `docs/fonte-web-unifi.md`（M2.5a 首项建立）。实施计划（Stage 顺序、验证门、共识审查记录）在 `.omc/plans/piano-m25-autogrow.md`（gitignore 操作件）。工作量粗估：a 约 2 周、b 约 1 周。

**M2.5a — 契约 + 爬取 + 第二 collection + 多库检索**

- [x] 契约终态一次到位：`Chunk`/`ParsedMeta` 加 web 溯源字段（`kind` · `url` · `referrer_url` · `fetch_date` · `section` · `ingest_run_id` · `ingest_source` · `trigger` · `content_hash`，全可空/带默认；`ParsedMeta` 另加 `lang`）；`GoldQuestion` 加 `urls`；`Locale` 放宽 BCP-47 + 中文检测接上；`rag/llm.py` 抽出（Completer Protocol + pydantic JSON 助手）；建 `docs/fonte-web-unifi.md`（scope 规则表、快照/registry 布局、深化循环状态机；chunk 字段表属主仍是 [docs/docling-e-pipeline.md](docs/docling-e-pipeline.md)）
- [x] `rag/crawl.py`：ScopeRule 规则表 + robots + sitemap（xml/php、link-BFS 兜底）+ 1 req/s + `--max-pages` 500 硬顶 + 页面直链 PDF 附件下载（≤20MB，记 `referrer_url`）；产物 = 不可变快照 manifest + 全局 registry（append-only：url · content_hash · fetch_date · ingest_run_id · ingest_source · trigger · outlinks——出链图/增量判定/回滚账本三合一）
- [x] `rag/webparse.py`：DOM 预剪（bs4）+ Docling HTML backend + sidecar 透传；入库用 **(url, ingest_source) 限定删除后 upsert**（crawl 与 live 版本互不覆盖）进 `unifi_web`
- [x] 真实爬取（用户执行）：≥3 种子板块 · ≥100 页 · count ≥ 页数
- [x] `rag/search.py` 多 collection 合并检索（合并池统一 rerank；`ingest_source` filter 只进 `unifi_web` 的 prefetch 分支）；`rag/answer.py` web 引用 marker `[<url> · <fetch_date>]`；**slides 非回归门**：gold 恒单库 38/40 且 MISS 仍为 q018/q028
- [x] 校园冒烟 gold set：`rag/golddraft.py` 分层起草 30–45 题（EN/IT/ZH），用户按 URL 核验晋级 `gold/campus.jsonl`；autogrow 组（≥5 题未收录，含 ≥1 题答案在 modulo PDF）单列 `gold/campus-autogrow.jsonl`；验收 campus hit@5 **EN/IT ≥ 0.80**（ZH 单独报告，阈值 M3 依数据定）

**M2.5b — 路由器 + 自增长实时层**

- [x] `rag/agent.py` 路由器：RouteDecision（target/query/fresh/reason，校验失败 fallback `both`）+ 带理由拒答 + 兜底拒答+指路（出链图无候选时提示「贴 URL 可教会系统」）+ `ask` CLI；`rag/gold.py` `--routing`（路由准确率 · both 占比 · fallback 率）——实测 exact 22/32 · wide 26/32 · both 4 · fallback 0，两跑恒等
- [x] `rag/live.py`（唯一写模块）：实时抓取 → LLM 相关性门（JSON 二分，校验失败=不落库；20 条标注集真机验收 **≥18/20**——实测 **18/20**，一轮门修订、金标未动）→ 持久写入（`ingest_source="live"`）+ registry 溯源 + 按 `ingest_run_id` 回滚 CLI；**整轮显存预算**：解析与 encode 走 CPU · LLM 段间卸载 · 页数 ≤40 · 60s/步 + 解析独立 120s（真机峰值 **7923** < 8188 MiB）
- [x] 深化循环：抓页 → 「够答？」判定（**原 self-assess 并入此停止条件**）→ 编号候选（出链 ≤10 + PDF 附件）选一 → ≤3 步硬上限；`--no-deepen` 降级开关；逐题决策日志（run_id，M3 错误分类法原料）
- [~] autogrow 验收：`rag/gold.py` 加 `--live {off,on}`（默认 off）；未收录题组前 0/N → 跑流程后 **≥⌈0.7N⌉**（降级触发则分数附注状态、不与正常态混比）；content_hash 变/不变 → 重索引/跳过日志；回滚后 campus 基线恒等（快照未被 live 打洞的证据）——工装与协议全部落地并真机验证（三态日志 · 两次回滚精确归位 29098 · campus/smoke/control 终跑恒等基线），**分数门未达：双臂均 0/7**（主臂与 `--no-deepen` 同分 = 瓶颈不在跳链），五种失败模式逐题归因见 [docs/diario-sperimentale.md](docs/diario-sperimentale.md)，作为 M3 错误分类法骨架。其中两个属于本里程碑自身的设计缺陷（选一无拒绝出口 · PDF 命中时出链图盲区）已就地修复但**未重测**；分数门余下部分归 M3 的「autogrow 分数门重测」项
- [x] eval 读侧隔离：`rag/gold.py` 加 `--ingest-source`（默认 `crawl`）+ `--snapshot <run_id>`，透传进 `search()`（ADR-1 eval 条款兑现，解锁 [docs/architettura.md](docs/architettura.md) 的 🔶 行）——33 个 live 点在库时 campus 仍 28/32，隔离实测成立

### M3 — 评估（双场景）

**执行顺序**：排在 M5 的 `docker compose up` 全通之后，决策与理由见本文件「自主拍板项（2026-08-24，执行顺序调整）」。

无现成 gold set，M2/M2.5 的冒烟版扩为全量；**slides QA 与 campus QA 双场景同评，gold 含 EN/IT/ZH**（吸收原 M4：跨语言即核心）。工作量粗估：约 3–4 周（模型尺寸对比的 3×3 网格是大头，逐配置重启 vLLM 的墙钟成本先估算再开跑）。

- [ ] 服务器侧：`~/.bashrc` 设 `HF_HOME=/oblivion/users/jzheng/hf_cache`，vLLM 起服务（尺寸网格与正式实验在服务器；开发期生成走本地 Ollama）
- [ ] 基于课程材料与 UniFi 语料构建 gold 问答集（M2/M2.5 冒烟版扩量：人工 + LLM 辅助生成，人工校验；按文件/主题与 section×locale 分层抽样，避免题目只覆盖解析得好的部分）
- [ ] RAGAS 指标（忠实度、相关性、context precision/recall）+ 检索指标（hit@k、MRR），可复现评估脚本，遵循 [docs/architettura.md](docs/architettura.md) 的实验可复现性协议
- [ ] LLM judge 校验：抽子样本人工打分，报告 judge 与人工的一致性 —— judge 与被评系统同为 Qwen 系，自偏好是已知效应，答辩必被问
- [ ] agent 指标：路由准确率 / `both` 占比 / fallback 率 / 拒答桶细分，纳入错误分类法
- [ ] 错误分类法：失败题逐个归因分桶（解析丢失 / 死 chunk / 切分不当 / 检索 miss / 路由错库 / rerank 降位 / 上下文截断 / 生成幻觉 / 误拒答 / 判定饱和 / 强制选择 / 出链图盲区 / 门判据范围），聚合分数不构成实验章，逐桶分析才构成。后四个桶由 M2.5b autogrow 跑观察到（见 [docs/diario-sperimentale.md](docs/diario-sperimentale.md)）
- [ ] autogrow 分数门重测（M2.5b `[~]` 的余下部分）：双臂 0/7 测于 `ee15f37`，此后两个设计缺陷已修（选一拒绝出口 · PDF 命中回溯 referrer）**未重测**。在尺寸网格上重测，报告须并列 0/7 与新分数并注明配置差异（修复 + 尺寸两处同时变化）；「判定饱和」需先决断按 URL 判分是否仍是 autogrow 的正确判据（g001 答对但目标页未入库）
- [ ] 基线三件套：纯 BM25（Qwen-Agent 路线，见 [docs/analisi-rag.md](docs/analisi-rag.md)）· dense-only vs hybrid · 有/无 rerank —— 「rerank 是质量主要来源」这一断言要有测量支撑
- [ ] Langfuse 接入（tracing，自托管）
- [ ] 模型尺寸对比（0.6B / 4B / 8B）：质量与运行成本
- [ ] 消融实验 — 图片描述（Docling `do_picture_description`，Qwen2.5-VL-3B 经 MICC 的 vLLM）：带 / 不带的 RAGAS 差值。动机是死 chunk（只剩标题、正文全是图的 slide），量化见 [docs/docling-e-pipeline.md](docs/docling-e-pipeline.md)
- [ ] 消融实验 — 自适应路由 vs 全经典 vs 全 VLM：质量增益与算力代价。2026-08-02 已有单份对照否决了自动路由用 VLM（见 [docs/docling-e-pipeline.md](docs/docling-e-pipeline.md)），此项用 gold set 在语料级复核

### M4 — 跨语言 ⛔ 已并入核心

2026-08-21 拍板：任意语言提问 → 同语言回答是双场景（slides QA + campus QA）核心能力，评估语言 EN/IT/ZH（± 一个欧洲语言），并入 M2.5/M3；本里程碑不再单独存在，保留编号避免 M5–M7 引用重排。relatore 原 «eventualmente» 门控随新方向关闭（Meet 报备项）。

### M5 — 网站（PPM 部分）

**执行顺序**：本里程碑提前到 M3 之前执行，做到 M6 的「干净机器 `docker compose up` 一条命令起全套 + 浏览器完成双库问答演示」为止，含账号与多租户隔离；「Celery beat 定时刷新」留到 M3 之后，「UniFi SSO」仍为 post-tesi。决策与理由见本文件「自主拍板项（2026-08-24，执行顺序调整）」。

工作量粗估：约 4–6 周（后端 + docker-compose + SPA，是研究里程碑之外最大的工程块）。

- [x] **首个 `migrate` 前**建自定义 User（`AUTH_USER_MODEL`）：`apps/accounts/` 的 `User(AbstractUser)` 带 `locale`（取值域对齐 `settings.LANGUAGES`）；`0001_initial` 已生成
- [x] 安全响应头 + CI 守卫：**settings 不拆 dev/prod**（单人单部署，`DJANGO_DEBUG` 已承担这个区分；拆两个模块是噪音），改为单一 `config/settings.py` 里按 `DEBUG` 与 `DJANGO_BEHIND_TLS` 条件生效——后者独立于 `DEBUG`，因为「不在调试」与「背后有 TLS」是两个问题，MICC 内网或答辩机可能无 TLS，硬开重定向会让站点打不开。CI 加 `makemigrations --check` 与 `check --deploy --fail-level WARNING`（`--fail-level` 是关键：不加它只打印不失败）
- [~] Django + DRF + Celery/Redis 后端项目：Django ✅ · DRF ✅（`apps/qa/`，`rest_framework` 已进 `INSTALLED_APPS`，匿名限流 10/min）· Celery/Redis 🔜 随异步 ingest 一起到位
- [x] docker-compose 骨架：**一份文件用 profiles 分层**（无 profile = 有状态服务，本机开发只起这些，Django/Celery 走 `uv run` 在宿主机以直接用 GPU；`app` profile = 整套容器化，MICC/答辩路径）。PostgreSQL 已就位；Redis · Qdrant · Langfuse 与 `app` profile 随各自消费方到位
- [ ] 上传材料 → Celery 异步 ingest
- [ ] 上传滥用防护：文件大小/页数上限 · ingest 超时 · rate limit · 索引多租户隔离（谁的材料谁可检索）—— 单份 32 页图片密集 deck 实测吃掉 527s OCR，无上限等于开放算力
- [~] DRF 问答 API（`/api/ask`，带 `locale` 参数）：非流式 ✅（`apps/qa/views.py`，路由→检索→回答，`uv run python manage.py runserver` 后可 POST）· SSE 流式 🔜 下一 Stage（`rag.answer.answer` 本就是 generator，非流式只是把它 join 了）。**deepen 不在这个端点里**：它写共享索引且最多 3 次抓取，按下面「访问模型」条排在账号 + Celery 异步之后
- [ ] React + TypeScript SPA（Vite）：问答界面、流式渲染、来源引用展示
- [ ] admin 后台管理材料
- [x] `/api/ask` 暴露路由决策与 URL 引用：响应契约 `apps/qa/contract.py` 带 `route`（复用 `rag.agent.RouteDecision`）与 `citations`（每条含 `marker` · `cited` · slides 的 file+page 或 web 的 url+fetch_date）
- [ ] admin 爬取快照状态页（run_id、页数、content_hash 变更；可选）
- [ ] 访问模型：campus QA **免登录**可问；slides 上传/问答需账号（多租户隔离见上）；触发自增长的写操作挂账号 + rate limit
- [ ] Celery beat 定时刷新 web 快照（content_hash 增量：变了才重解析重索引，没变跳过）——「⛔ 调度器」non-goal 到此解除，论文期只有查询保鲜 + 手动重爬
- [ ] UniFi SSO（IDEM GARR 联邦，SAML/Shibboleth）post-tesi 可选：论文期自建 Django 账号、auth 做成可插拔；可行性与阻塞（校方注册审批）见 [docs/architettura.md](docs/architettura.md)

### M6 — 部署与论文

工作量粗估：约 4 周（论文写作为主）。

- [ ] 答辩演示级部署：干净机器 `docker compose up` 一条命令起全套（Django · PostgreSQL · Redis · Qdrant · 生成端点），浏览器完成双库问答演示——共享 web KB 的「服务器」即 compose 服务；MICC/公网常驻 = post-tesi 可选
- [ ] 论文写作（实验章声明：表中数字均在冻结快照 run_id 上测得）
- [ ] 最终交付文档译为意大利语

### M7 — 外部知识源集成 🔜（可选，post-M6）

论文范围外，答辩后视情况启动。UniFi 网站源已由 M2.5 承担，本里程碑收窄为其余外部源。

- [ ] MCP / Google Drive 等外部源接入知识库

## 阻塞项 🔒

| 阻塞                                                | 谁解锁              |
| --------------------------------------------------- | ------------------- |
| 毕业 session / 截止日期                             | 用户 + relatore     |

## 暂缓项

| 项                                          | 状态 | 说明                                                        |
| ------------------------------------------- | ---- | ----------------------------------------------------------- |
| 往年 scritto 真题（语料 + gold set 种子）   | 🔜 M3 后 | 2026-07-30 决定暂不纳入；课程场景语料只用 slides/讲义 PDF（校园场景语料另见 M2.5）。加入时走同一 ingest 管线，不为其做特殊设计 |

## Meet 议题（给 relatore）

Meet 🔜 未安排，不阻塞任何里程碑。

自主拍板项（2026-07-30）报备即可，不等答复：Django + DRF + React SPA · Qdrant hybrid · vLLM · RAGAS + 检索指标 · gold set 自建 · EN→EN 起步（语料实测英语为主）· 网站与 RAG 同仓库交付。

自主拍板项（2026-08-21，新方向落地）报备即可：

1. 校园信息源落地方式：爬取+索引为骨架、实时抓取为增量层（他转的 agentic 模板思路，差异 = 封闭可复现优先）；agent 分期（路由器 → 循环）。
2. 跨语言并入核心（M4 解散）：任意语言提问 → 同语言回答，评估 EN/IT/ZH。
3. 开发期生成本地 Ollama（Qwen3-4B 量化），MICC vLLM 留 M3 正式实验。
4. 爬取姿态：robots 遵守 · 限速 1 req/s · ≤500 页 · 只读 · UA 表明论文用途（ingegneria.unifi.it 封 GPTBot 类训练爬虫，但通配 UA 无限制；我们是检索索引非模型训练）。
5. 自增长姿态（2026-08-22 定案）：学生触发的实时抓取经 LLM 相关性门判定后才持久入库，registry 溯源可整批回滚；范围不锁 unifi.it 域（Santa Marta/DSU/CISIA 类学生刚需域可进）；评估用冻结快照与 live 写入隔离，论文数字不受演示影响；论文期演示环境免登录。

自主拍板项（2026-08-24，执行顺序调整）报备即可：

1. **M5 提前到 M3 之前**，做到 M6 的「干净机器 `docker compose up` 一条命令起全套 + 浏览器完成双库问答演示」为止（含账号与多租户隔离）。三条理由：① 研究成果目前只有终端输出，Meet 与答辩都需要看得见的东西；② `migrate` 从未跑过（无 `migrations/`、无 `db.sqlite3`），此刻建自定义 User 与换 PostgreSQL 的成本≈0，越往后越贵（M5 首条已警告事后改造要重写全部迁移）；③ 数据库与检索后端一次换到位，M3 的全部基线建在同一后端上，不会跑到一半换。
2. **Qdrant 由嵌入式改为 compose 中的服务进程**：网站起来后 Django web、Celery worker、终端评估三方同时要这份索引，嵌入式的单进程文件锁下网站起不来。切换排在 M2.5b「autogrow 分数门重测」记账**之后**，避免一次改动同时变「修了缺陷」与「换了后端」两个变量；切换后重索引并重跑 slides 与 campus gold，两组分数并列记录并注明后端变更。
3. **访问模型以 M5「访问模型」条为准**：campus QA 免登录、slides 上传与问答需账号 + 多租户隔离。2026-08-22 报备里的「论文期演示环境免登录」限于 campus 场景。
4. **重排触发条件**：毕业 session 日期一经确定即重新评估 M5/M3 顺序 —— M5 约 4–6 周 + M3 约 3–4 周，当前顺序把 M3 排在了一个边界未知的时间轴之后。

待 relatore 答复：

1. 毕业 session 与截止日期。
2. 论文实验跑在 MICC 服务器上是否需要额外报备（技术细节找 sysadmin）。
