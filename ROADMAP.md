# ROADMAP

**范围**：Triennale 毕业论文（信息工程，UniFi — relatore Prof. Marco Bertini）：大学课程材料的多语言问答（仅 QA，⛔ 出题/判卷）+ **校园信息问答**（UniFi 网站第二知识源 + agentic 路由，M2.5，relatore 2026-08-21 口头新方向），RAG + 开源权重 LLM（Qwen 系），另含网站（PPM 部分）：Django/DRF + Celery/Redis 后端 + React SPA 前端。跨语言（任意语言提问 → 同语言回答）是双场景核心能力，不再是可选附加。relatore 约束、技术栈与决策状态见 [docs/architettura.md](docs/architettura.md)。

## 里程碑

### M0 — 脚手架与基础决策 ✅

✅ 交付物：仓库骨架（`.gitignore` · [CLAUDE.md](CLAUDE.md) · [README.md](README.md) · 本 roadmap）+ [docs/architettura.md](docs/architettura.md) 的技术栈决策表。技术栈与评估方法自主拍板（2026-07-30），不再挂 relatore 确认；relatore 属主项只剩跨语言启动（M4）。

### M1 — RAG 学习与分析 ✅

✅ 交付物：[docs/analisi-rag.md](docs/analisi-rag.md) —— relatore 指定的四个起步链接（Qwen-Agent RAG 模块 · Qwen3 RAG pipeline · Qwen3 agentic RAG 模板 · Granite-Docling）精读并扩展，路线定为自建 pipeline + 各领域最佳组件。MICC 接入完成（密钥登记 · 首次登录 · Discord · NAS home），规格与路径见 [docs/architettura.md](docs/architettura.md) 与 [README.md](README.md)。

2026-07-31 决定**不做一次性最小实验**：Docling 的解析质量（重音字符、公式、表格、多栏阅读顺序）与 Qwen3 推理直接在 M2 的真实 ingest 管线里验证 —— 同样的投入产出论文可引用的证据，而不是用完即弃的脚本。

### M2 — 单语言 RAG 原型 ✅

英语材料 + 英语提问（EN→EN），CLI 级别，不做 web。全部清单项完成（勾选如下），实测汇总见 [docs/diario-sperimentale.md](docs/diario-sperimentale.md)。

语料 2026-07-31 实测（31 份 PPM slides，约 1200 页）：**英语为主，~23 份英语、~8 份意大利语或英意混排**，全部有文字层（无扫描件）。原计划的 IT→IT 因此不成立 —— 单语基线改用占语料 3/4 的英语，relatore 要求的「先同语言再跨语言」递进保持不变。语料事实与决策见 [docs/architettura.md](docs/architettura.md)。

✅ 交付物：项目初始化（uv + Python 3.12 · 工程化链 · Django 骨架）—— [pyproject.toml](pyproject.toml) · [.pre-commit-config.yaml](.pre-commit-config.yaml) · [.github/workflows/ci.yml](.github/workflows/ci.yml) · `config/` · `rag/` · `tests/`。Ingest 步骤 0-1 —— 自适应路由 [rag/probe.py](rag/probe.py) + Docling 解析 [rag/parse.py](rag/parse.py)，解析质量验收与路由实测表在 [docs/docling-e-pipeline.md](docs/docling-e-pipeline.md)。

2026-08-21 拍板**本地优先**：生成端点默认本地 Ollama（Qwen3-4B 量化，OpenAI 兼容端点），MICC vLLM 只在 M3 正式实验使用 —— M2 收尾不再等服务器。实测数据的属主是 [docs/diario-sperimentale.md](docs/diario-sperimentale.md)。

- [x] 本地装 Ollama + 拉 Qwen3-4B 量化模型（Ollama 0.32.15 · `qwen3:4b-instruct-2507-q4_K_M`，命令见 [README.md](README.md)）
- [x] 全语料**本地** ingest：31 份约 1200 页 parse → chunk → index，collection 定名 `slides`（实测 ~15 分钟 · 1234 chunks，路由分布 classic 26 / formula 4 / OCR 1）
- [x] 冒烟 gold set：40 题 EN→EN（LLM 起草 + 人工按来源核验，[gold/smoke.jsonl](gold/smoke.jsonl)）+ 5 题防泄漏对照组（[gold/control.jsonl](gold/control.jsonl)）；参考答案在 `data/gold/answers/`（gitignore）。M3 扩为全量 gold set
- [x] Ingest 步骤 2 — chunking：HybridChunker + 与 Qwen3-Embedding 对齐的 tokenizer（[rag/chunk.py](rag/chunk.py)），chunk payload 字段定义在 [docs/docling-e-pipeline.md](docs/docling-e-pipeline.md)
- [x] Hybrid 检索：Qdrant 本地模式（dense Qwen3-Embedding-0.6B + sparse fastembed BM25 + RRF）+ Qwen3-Reranker-0.6B，小模型全部本地跑 —— [rag/index.py](rag/index.py) · [rag/search.py](rag/search.py)
- [x] Qwen3 生成回答：[rag/answer.py](rag/answer.py) 经本地 Ollama 实测 —— groundedness、IT 语言跟随、语料外拒答通过；4B 量化的引用 marker 忠实度问题与显存峰值 7761 MiB 记录在 [docs/diario-sperimentale.md](docs/diario-sperimentale.md)
- [x] 用真实课程材料端到端跑通：全量索引上 `just gold` **hit@5 = 38/40（95%）**，对照组 5/5（无泄漏虚高迹象）

### M2.5 — 校园信息源 + agentic 编排 🔜

relatore 2026-08-21 口头新方向（Lightning «agentic RAG powered by Qwen3» 模板思路的落地，模板分析见 [docs/analisi-rag.md](docs/analisi-rag.md)）：UniFi 网站作第二知识源，Erasmus/外国学生任意语言问校园信息（ingegneria、报名、学费、日历等）。架构：**爬取+索引为骨架，实时抓取为增量层**；页面发现 = sitemap + 范围规则（实测：unifi.it 有 `sitemap.xml` 且带 IT/EN hreflang 平行页，ingegneria.unifi.it 有 `sitemap.php`），种子板块起步（ingegneria + international/Erasmus + 核心服务页，≤500 页硬顶），查询缺口驱动扩张。HTML 解析走 Docling HTML backend（furniture 层自动剔导航/页脚，不引入新抽取依赖）；agent 用显式控制流 + 每步受 pydantic 校验的 JSON 决策（⛔ 原生 tool-calling：4B 量化遵从性不可靠）。契约与设计细节 🔜 `docs/fonte-web-unifi.md`（M2.5a 首项建立）。工作量粗估：a 约 2 周、b 约 1 周。

**M2.5a — 爬取 + 第二 collection + 路由器**

- [ ] 契约先行：`ParsedMeta`/`Chunk` 加可空 `url`/`fetch_date`/`section`（+`lang`）；`GoldQuestion` 加 `target`/`urls`；建 `docs/fonte-web-unifi.md`（scope 规则表、快照布局、字段属主）
- [ ] `rag/crawl.py`：scope 规则 + robots + sitemap（xml/php 宽松解析、link-BFS 兜底）+ 限速 1 req/s + 快照与 manifest（`content_hash` 增量）；实爬命令由用户执行
- [ ] `rag/webparse.py`：DOM 预剪（bs4）+ Docling HTML backend + sidecar；locale 优先 `<html lang>`
- [ ] chunk/index 打通 web 路径（sidecar 带 `url` 透传），索引进 `unifi_web` collection
- [ ] `rag/search.py` 多 collection 合并检索（合并池统一 rerank）；`rag/answer.py` 引用支持 URL
- [ ] `rag/llm.py` 抽出（Streamer/Completer Protocol）+ `rag/agent.py` 路由器（target/query/fresh/reason，校验失败 fallback `both`）+ 带理由拒答 + `ask` CLI
- [ ] 校园冒烟 gold set：`rag/golddraft.py` 分层抽样 LLM 起草 30–45 题（EN/IT/ZH），用户按 URL 核验晋级 `gold/campus.jsonl`
- [ ] `rag/gold.py`：campus hit@5（URL 命中）+ `--routing` 路由准确率（另报 `both` 占比与 fallback 率）

**M2.5b — 实时补抓 + 自评重试**

- [ ] `LiveFetcher` 三态 on/cache/off（一切评估默认 off）
- [ ] freshness 路径：路由判 fresh 且命中 campus → top 命中 ≤3 个 URL 重抓 → 内存内重建上下文，引用附抓取日期
- [ ] self-assess：生成后单次 JSON 判定，不支撑则改写 query 扩 `both` 重检索一次（硬上限 1）
- [ ] 可复现接线：快照以 run_id 冻结、每 run 落逐题决策日志（M3 错误分类法原料）

### M3 — 评估（双场景）

无现成 gold set，M2/M2.5 的冒烟版扩为全量；**slides QA 与 campus QA 双场景同评，gold 含 EN/IT/ZH**（吸收原 M4：跨语言即核心）。工作量粗估：约 3–4 周（模型尺寸对比的 3×3 网格是大头，逐配置重启 vLLM 的墙钟成本先估算再开跑）。

- [ ] 服务器侧：`~/.bashrc` 设 `HF_HOME=/oblivion/users/jzheng/hf_cache`，vLLM 起服务（尺寸网格与正式实验在服务器；开发期生成走本地 Ollama）
- [ ] 基于课程材料与 UniFi 语料构建 gold 问答集（M2/M2.5 冒烟版扩量：人工 + LLM 辅助生成，人工校验；按文件/主题与 section×locale 分层抽样，避免题目只覆盖解析得好的部分）
- [ ] RAGAS 指标（忠实度、相关性、context precision/recall）+ 检索指标（hit@k、MRR），可复现评估脚本，遵循 [docs/architettura.md](docs/architettura.md) 的实验可复现性协议
- [ ] LLM judge 校验：抽子样本人工打分，报告 judge 与人工的一致性 —— judge 与被评系统同为 Qwen 系，自偏好是已知效应，答辩必被问
- [ ] agent 指标：路由准确率 / `both` 占比 / fallback 率 / 拒答桶细分，纳入错误分类法
- [ ] 错误分类法：失败题逐个归因分桶（解析丢失 / 死 chunk / 切分不当 / 检索 miss / 路由错库 / rerank 降位 / 上下文截断 / 生成幻觉 / 误拒答），聚合分数不构成实验章，逐桶分析才构成
- [ ] 基线三件套：纯 BM25（Qwen-Agent 路线，见 [docs/analisi-rag.md](docs/analisi-rag.md)）· dense-only vs hybrid · 有/无 rerank —— 「rerank 是质量主要来源」这一断言要有测量支撑
- [ ] Langfuse 接入（tracing，自托管）
- [ ] 模型尺寸对比（0.6B / 4B / 8B）：质量与运行成本
- [ ] 消融实验 — 图片描述（Docling `do_picture_description`，Qwen2.5-VL-3B 经 MICC 的 vLLM）：带 / 不带的 RAGAS 差值。动机是死 chunk（只剩标题、正文全是图的 slide），量化见 [docs/docling-e-pipeline.md](docs/docling-e-pipeline.md)
- [ ] 消融实验 — 自适应路由 vs 全经典 vs 全 VLM：质量增益与算力代价。2026-08-02 已有单份对照否决了自动路由用 VLM（见 [docs/docling-e-pipeline.md](docs/docling-e-pipeline.md)），此项用 gold set 在语料级复核

### M4 — 跨语言 ⛔ 已并入核心

2026-08-21 拍板：任意语言提问 → 同语言回答是双场景（slides QA + campus QA）核心能力，评估语言 EN/IT/ZH（± 一个欧洲语言），并入 M2.5/M3；本里程碑不再单独存在，保留编号避免 M5–M7 引用重排。relatore 原 «eventualmente» 门控随新方向关闭（Meet 报备项）。

### M5 — 网站（PPM 部分）

工作量粗估：约 4–6 周（后端 + docker-compose + SPA，是研究里程碑之外最大的工程块）。

- [ ] **首个 `migrate` 前**建自定义 User（`AUTH_USER_MODEL`）—— Django 官方明确建议，事后改造要重写全部迁移
- [ ] settings 拆 dev/prod + prod 安全响应头（HSTS · secure cookies 等），CI 加 `manage.py check --deploy` 与 `makemigrations --check` 漂移守卫
- [ ] Django + DRF + Celery/Redis 后端项目
- [ ] docker-compose：PostgreSQL · Redis · Qdrant · Langfuse
- [ ] 上传材料 → Celery 异步 ingest
- [ ] 上传滥用防护：文件大小/页数上限 · ingest 超时 · rate limit · 索引多租户隔离（谁的材料谁可检索）—— 单份 32 页图片密集 deck 实测吃掉 527s OCR，无上限等于开放算力
- [ ] DRF 问答 API（`/api/ask`，SSE 流式，带 `locale` 参数）
- [ ] React + TypeScript SPA（Vite）：问答界面、流式渲染、来源引用展示
- [ ] admin 后台管理材料
- [ ] `/api/ask` 暴露路由决策与 URL 引用（campus 场景进 SPA：来源既有 slides 页码也有 unifi.it 链接）
- [ ] admin 爬取快照状态页（run_id、页数、content_hash 变更；可选）

### M6 — 部署与论文

工作量粗估：约 4 周（论文写作为主）。

- [ ] 部署到 MICC 服务器（或 Runpod）
- [ ] 论文写作
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

待 relatore 答复：

1. 毕业 session 与截止日期。
2. 论文实验跑在 MICC 服务器上是否需要额外报备（技术细节找 sysadmin）。
