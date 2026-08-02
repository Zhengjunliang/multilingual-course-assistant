# ROADMAP

**范围**：Triennale 毕业论文（信息工程，UniFi — relatore Prof. Marco Bertini）：大学课程材料的多语言问答（仅 QA，⛔ 出题/判卷），RAG + 开源权重 LLM（Qwen 系），另含网站（PPM 部分）：Django/DRF + Celery/Redis 后端 + React SPA 前端。relatore 约束、技术栈与决策状态见 [docs/architettura.md](docs/architettura.md)。

## 里程碑

### M0 — 脚手架与基础决策 ✅

✅ 交付物：仓库骨架（`.gitignore` · [CLAUDE.md](CLAUDE.md) · [README.md](README.md) · 本 roadmap）+ [docs/architettura.md](docs/architettura.md) 的技术栈决策表。技术栈与评估方法自主拍板（2026-07-30），不再挂 relatore 确认；relatore 属主项只剩跨语言启动（M4）。

### M1 — RAG 学习与分析 ✅

✅ 交付物：[docs/analisi-rag.md](docs/analisi-rag.md) —— relatore 指定的四个起步链接（Qwen-Agent RAG 模块 · Qwen3 RAG pipeline · Qwen3 agentic RAG 模板 · Granite-Docling）精读并扩展，路线定为自建 pipeline + 各领域最佳组件。MICC 接入完成（密钥登记 · 首次登录 · Discord · NAS home），规格与路径见 [docs/architettura.md](docs/architettura.md) 与 [README.md](README.md)。

2026-07-31 决定**不做一次性最小实验**：Docling 的解析质量（重音字符、公式、表格、多栏阅读顺序）与 Qwen3 推理直接在 M2 的真实 ingest 管线里验证 —— 同样的投入产出论文可引用的证据，而不是用完即弃的脚本。

### M2 — 单语言 RAG 原型

英语材料 + 英语提问（EN→EN），CLI 级别，不做 web。

语料 2026-07-31 实测（31 份 PPM slides，约 1200 页）：**英语为主，~23 份英语、~8 份意大利语或英意混排**，全部有文字层（无扫描件）。原计划的 IT→IT 因此不成立 —— 单语基线改用占语料 3/4 的英语，relatore 要求的「先同语言再跨语言」递进保持不变。语料事实与决策见 [docs/architettura.md](docs/architettura.md)。

✅ 交付物：项目初始化（uv + Python 3.12 · 工程化链 · Django 骨架）—— [pyproject.toml](pyproject.toml) · [.pre-commit-config.yaml](.pre-commit-config.yaml) · [.github/workflows/ci.yml](.github/workflows/ci.yml) · `config/` · `rag/` · `tests/`。Ingest 步骤 0-1 —— 自适应路由 [rag/probe.py](rag/probe.py) + Docling 解析 [rag/parse.py](rag/parse.py)，解析质量验收与路由实测表在 [docs/docling-e-pipeline.md](docs/docling-e-pipeline.md)。

- [ ] 服务器侧：`~/.bashrc` 设 `HF_HOME=/oblivion/users/jzheng/hf_cache`（Qwen3 推理前）
- [ ] 服务器侧：全语料解析（31 份约 1200 页）。**本地只做抽样**（10 份约 432 页，结果见 [docs/docling-e-pipeline.md](docs/docling-e-pipeline.md)）—— 经典 pipeline 在笔记本上 0.8s/页够用，但全量一小时起，服务器上顺带跑完
- [ ] Ingest 步骤 2 — chunking：HybridChunker + 与 Qwen3-Embedding 对齐的 tokenizer，chunk 带 `locale` · `course` · `source_file` · `page` · `heading_path`
- [ ] Hybrid 检索：Qdrant 本地模式（dense Qwen3-Embedding + sparse BM25）+ Qwen3-Reranker
- [ ] Qwen3 生成回答
- [ ] 用真实课程材料端到端跑通

### M3 — 评估

无现成 gold set，需自建（决策见 `docs/architettura.md`）。

- [ ] 基于课程材料构建 gold 问答集（人工 + LLM 辅助生成，人工校验）
- [ ] RAGAS 指标（忠实度、相关性、context precision/recall）+ 检索指标（hit@k、MRR），可复现评估脚本
- [ ] Langfuse 接入（tracing，自托管）
- [ ] 模型尺寸对比（0.6B / 4B / 8B）：质量与运行成本
- [ ] 消融实验 — 图片描述（Docling `do_picture_description`，Qwen2.5-VL-3B 经 MICC 的 vLLM）：带 / 不带的 RAGAS 差值。动机是死 chunk（只剩标题、正文全是图的 slide），量化见 [docs/docling-e-pipeline.md](docs/docling-e-pipeline.md)
- [ ] 消融实验 — 自适应路由 vs 全经典 vs 全 VLM：质量增益与算力代价。2026-08-02 已有单份对照否决了自动路由用 VLM（见 [docs/docling-e-pipeline.md](docs/docling-e-pipeline.md)），此项用 gold set 在语料级复核

### M4 — 跨语言 🔒

relatore 表示是可选项（«poi si passa (eventualmente) alla parte di traduzione»）：M3 之后经他同意才启动。

- [ ] 意大利语（± 中文）提问混合语料 — IT→EN、ZH→EN。这是真实场景：学生用意大利语问，材料主体是英语
- [ ] 用 M3 的指标对比跨语言 vs 单语言质量

### M5 — 网站（PPM 部分）

- [ ] Django + DRF + Celery/Redis 后端项目
- [ ] docker-compose：PostgreSQL · Redis · Qdrant · Langfuse
- [ ] 上传材料 → Celery 异步 ingest
- [ ] DRF 问答 API（`/api/ask`，SSE 流式，带 `locale` 参数）
- [ ] React + TypeScript SPA（Vite）：问答界面、流式渲染、来源引用展示
- [ ] admin 后台管理材料

### M6 — 部署与论文

- [ ] 部署到 MICC 服务器（或 Runpod）
- [ ] 论文写作
- [ ] 最终交付文档译为意大利语

### M7 — 外部知识源集成 🔜（可选，post-M6）

论文范围外，答辩后视情况启动。

- [ ] MCP / Google Drive 等外部源接入知识库

## 阻塞项 🔒

| 阻塞                                                | 谁解锁              |
| --------------------------------------------------- | ------------------- |
| 跨语言部分是否启动（M4）                            | relatore            |
| 毕业 session / 截止日期                             | 用户 + relatore     |

## 暂缓项

| 项                                          | 状态 | 说明                                                        |
| ------------------------------------------- | ---- | ----------------------------------------------------------- |
| 往年 scritto 真题（语料 + gold set 种子）   | 🔜 M4 后 | 2026-07-30 决定暂不纳入；M2/M3 只用课程 slides/讲义 PDF。加入时走同一 ingest 管线，不为其做特殊设计 |

## Meet 议题（给 relatore）

Meet 🔜 未安排，不阻塞任何里程碑。

自主拍板项（2026-07-30）报备即可，不等答复：Django + DRF + React SPA · Qdrant hybrid · vLLM · RAGAS + 检索指标 · 语料只用课程 PDF · gold set 自建 · EN→EN 起步（语料实测英语为主）· 网站与 RAG 同仓库交付。

待 relatore 答复：

1. 跨语言部分（M4）何时/是否启动 — 论文标题的核心能力，relatore 邮件称 «eventualmente»。
2. 毕业 session 与截止日期。
3. 论文实验跑在 MICC 服务器上是否需要额外报备（技术细节找 sysadmin）。
