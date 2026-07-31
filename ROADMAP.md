# ROADMAP

**范围**：Triennale 毕业论文（信息工程，UniFi — relatore Prof. Marco Bertini）：大学课程材料的多语言问答（仅 QA，⛔ 出题/判卷），RAG + 开源权重 LLM（Qwen 系），另含网站（PPM 部分）：Django/DRF + Celery/Redis 后端 + React SPA 前端。relatore 约束、技术栈与决策状态见 [docs/architettura.md](docs/architettura.md)。

## 里程碑

### M0 — 脚手架与基础决策 ✅

已有：仓库、`.gitignore`、`CLAUDE.md`、`README.md`、本 roadmap、`docs/architettura.md`、`docs/analisi-rag.md`。技术栈与评估方法自主拍板（2026-07-30），不再挂 relatore 确认；relatore 属主项只剩跨语言启动（M4）。

- [x] 仓库初始化（`.gitignore`、`CLAUDE.md`）
- [x] 技术栈基础决策（表在 `docs/architettura.md`）
- [x] 文档初始 commit（`f5d7285`）
- [x] Django 确认（自主拍板，2026-07-30）

### M1 — RAG 学习与分析 ✅

目标：关闭 🔒 RAG 路线决策。交付物：[docs/analisi-rag.md](docs/analisi-rag.md)。

2026-07-31 决定**不做一次性最小实验**：Docling 的解析质量（重音字符、公式、表格、多栏阅读顺序）与 Qwen3 推理直接在 M2 的真实 ingest 管线里验证 —— 同样的投入产出论文可引用的证据，而不是用完即弃的脚本。

- [x] 精读并扩展 relatore 给的链接分析（relatore 明确要求）→ `docs/analisi-rag.md`：
  - [x] Qwen-Agent RAG 模块 — `https://qwenlm.github.io/Qwen-Agent/en/guide/core_moduls/rag/`
  - [x] Qwen3 RAG pipeline（LLM + embedding + reranking）— novita.ai Medium 文章
  - [x] Qwen3 agentic RAG 模板 — Lightning AI
  - [x] Granite-Docling 文档转换 — IBM 公告
- [x] MICC 接入：生成专用 SSH 密钥并把公钥发给 sysadmin（已登记，sysadmin 确认）
- [x] MICC 接入：首次登录成功（targaryen：2× 2080 Ti 11 GB、CUDA 12.4；ultron：2× Titan RTX 24 GB、CUDA 12.2）
- [x] MICC 接入：加入 Discord（GPU 监控频道）
- [x] MICC 接入：NAS 个人 home 存在（`/oblivion/users/jzheng`、`/equilibrium/jzheng`；路径格式各卷不统一，见 [README.md](README.md)）
- [x] 路线对比 → 自建 pipeline + 各领域最佳组件（分析在 `docs/analisi-rag.md`，决策表在 `docs/architettura.md`）
- [x] 决策收敛落文档（2026-07-30 自主拍板：Django、评估方法、目标语言、语料范围）

### M2 — 单语言 RAG 原型

英语材料 + 英语提问（EN→EN），CLI 级别，不做 web。

语料 2026-07-31 实测（31 份 PPM slides，约 1200 页）：**英语为主，~23 份英语、~8 份意大利语或英意混排**，全部有文字层（无扫描件）。原计划的 IT→IT 因此不成立 —— 单语基线改用占语料 3/4 的英语，relatore 要求的「先同语言再跨语言」递进保持不变。语料事实与决策见 [docs/architettura.md](docs/architettura.md)。

- [x] 项目初始化：uv + Python 3.12、目录结构、工程化链、Django 骨架 — [pyproject.toml](pyproject.toml) · [.pre-commit-config.yaml](.pre-commit-config.yaml) · [.github/workflows/ci.yml](.github/workflows/ci.yml) · `config/` · `rag/` · `tests/`
- [ ] 服务器侧：`~/.bashrc` 设 `HF_HOME=/oblivion/users/jzheng/hf_cache`（Qwen3 推理前）
- [x] Ingest 步骤 1 — Docling 解析（`rag/parse.py`）：经典 pipeline，OCR 默认关。解析质量已验收（词间空格、重音、表格、标题层级），结果表在 [docs/docling-e-pipeline.md](docs/docling-e-pipeline.md)
- [ ] Ingest 步骤 1b — 全语料解析一遍（31 份约 1200 页，约 20 分钟），确认连字与多栏阅读顺序；`3.5-HTML5-Part-2` 单独试 VlmPipeline
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
