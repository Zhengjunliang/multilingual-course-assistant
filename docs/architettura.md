# 架构与技术栈

决策来源：relatore 的指示（2026-07-28 邮件）+ 此处记录的自主选择。文中里程碑见 [ROADMAP.md](../ROADMAP.md)。

## relatore 的约束

- **目标**：多语言回答大学课程相关问题 — 提问语言与材料语言不同（如英文提问、意大利语材料）。
- **只用开源权重 LLM**（Qwen 系）；禁用专有 API（OpenAI/Claude）。需评估最优模型尺寸以降低运行成本。
- **渐进路线**：先做与材料同语言的问答，再（视情况）做跨语言部分；必须能**评估回答质量**。
- **文档解析**：考虑用 Granite-Docling 做材料转换。
- **PPM 部分**：完整网站，Flask/Django + Celery/Redis 异步任务。
- **算力**：先用 Google Colab（免费 T4）试验；后接入 relatore 提供的 GPU 机器；备选 Runpod / Lightning。

relatore 给的起步链接在 ROADMAP.md 的 M1 一节（已扩展成 `docs/analisi-rag.md`，M1 交付物）。

## 已定技术栈

决策已做；仓库中尚无任何依赖（引入时间：RAG 部分 🔜 M2，网站前后端 🔜 M5）。选型原则（2026-07-29 拍板）：**市面最好的开源方案**；硬约束只有两条 — 后端 Django + Celery/Redis（relatore 指定）、模型层开源权重 Qwen 全家桶（论文硬约束，且 Qwen3-Embedding 8B 是 MTEB multilingual 榜首，非妥协项）。

| 组件           | 选择                                | 动机                                                                     |
| -------------- | ----------------------------------- | ------------------------------------------------------------------------ |
| 语言           | Python 3.12（uv 管理）              | ML 生态；Flask/Django 是 relatore 指定范围                               |
| 包管理         | uv                                  | lockfile、内置 Python 版本管理（系统 3.10 不动）                         |
| Web            | Django 5.x                          | admin 免费当材料后台，auth/ORM/i18n 内置（多语言域加分），Celery 集成成熟 |
| API            | DRF（Django REST Framework）+ SSE 流式 | 问答 API 与页面并行交付（2026-07-29 拍板）；为 M7 外部集成留口          |
| 前端           | React + TypeScript SPA（Vite）      | 市面主流组合；流式回答、引用高亮等交互展示性最强（2026-07-29 拍板）      |
| 异步任务       | Celery + Redis                      | relatore 指定                                                            |
| LLM            | Qwen3 系列（0.6B–8B 尺寸对比）      | relatore 指定；2080 Ti（11 GB）上 8B 需量化，ultron（24 GB）可 8B fp16   |
| Embedding/Rerank | Qwen3-Embedding / Qwen3-Reranker  | 与 LLM 同源的一体化方案，relatore 链接指向的路线                          |
| 文档解析       | Docling（Granite-Docling）          | relatore 建议；开源最强 PDF→结构化，经典 pipeline 与 VlmPipeline 对比    |

选 Django 不选 Flask 的理由：对单人开发 Django **减少**代码量（admin、auth、ORM、i18n 内置）；Flask 需手动拼装。待 Meet 时向 relatore 确认。前端选 React SPA 弃 HTMX 的理由：PPM 展示性与流式交互；待 Meet 确认满足 PPM 评分要求（问题清单 8）。

## 决策状态

原则（2026-07-29 拍板）：技术决策不等 Meet 死锁 — 有依据即定 🔶 倾向，实验验证 + Meet 确认后关闭；🔒 只留 relatore 属主项。依赖规则：🔒 项**禁止**引入依赖或配置文件；🔶 项自 M2 起可引入（Meet 后如变更，原地替换 — 规则在 CLAUDE.md）。

| 决策       | 选择 / 倾向                                                                                                   | 状态 | 验证条件                  |
| ---------- | ------------------------------------------------------------------------------------------------------------- | ---- | ------------------------- |
| RAG 路线   | 自建 pipeline：Docling → chunk → hybrid 检索 → rerank → Qwen3；Qwen-Agent/纯 BM25 做对照基线（分析见 [analisi-rag.md](analisi-rag.md)）；不用 LlamaIndex/LangGraph 全家桶（可解释性优先） | 🔶   | M1 最小实验 + Meet 问题 9 |
| 向量库     | Qdrant：原生 hybrid（dense Qwen3-Embedding + sparse BM25）、locale/课程 payload 过滤、量化；M2 用 qdrant-client 本地模式（无服务器进程），M5 起 Docker；降级备选 pgvector | 🔶   | M2 实测                   |
| 数据库     | M2 原型无 DB（文件 + Qdrant 本地）；M5 起 PostgreSQL（Docker）                                                 | 🔶   | M5                        |
| 推理服务   | vLLM（MICC 服务器端，OpenAI 兼容端点 + 流式）；Colab 备用时直接 transformers                                   | 🔶   | M1 ultron 尺寸实验        |
| 可观测性   | Langfuse 自托管（Docker），LLM tracing                                                                         | 🔶   | M3 接入                   |
| 评估方法   | 提案：RAGAS（faithfulness · answer relevancy · context precision/recall，judge = 开源权重 Qwen3 大尺寸）+ 检索指标（hit@k、MRR）+ 真题 gold set | 🔒   | relatore（Meet 问题 2/6） |
| 目标语言   | 倾向：IT→IT（M2）→ EN→IT（M4）→ 中文可选                                                                       | 🔒   | relatore（Meet 问题 3）   |

## 语料与交付范围

- **语料**：课程 slides/讲义 + **往年 scritto 真题 PDF**，同一 ingest 管线进知识库；真题同时是 M3 gold set 的种子。
- **能力边界**：检索问答（QA）。出题 / 自动判卷 ⛔ 超出范围。
- **交付**：React SPA + DRF API（SSE 流式问答）+ Django admin 材料后台。
- **外部知识源**（MCP、Google Drive 等）🔜 M7（可选，post-M6，见 [ROADMAP.md](../ROADMAP.md)）。

## 工程化 🔜 M2

ruff（lint + format）· pyright · pytest · pre-commit · GitHub Actions CI · pydantic-settings（配置/密钥经 `.env`）· docker-compose 🔜 M5（PostgreSQL · Redis · Qdrant · Langfuse）。

## 算力策略：remote-first

所有 GPU 工作跑在 MICC 服务器上；笔记本只用于写代码、git 和 SSH — **本地不装推理栈**（不装 CUDA/Ollama）。Colab 是服务器满载时的零配置备用。relatore 邮件说的 "2080Ti 机器" 即 Dream Machines 本身（每台 2× 2080 Ti）。

日常开发循环（**代码不需要同步到服务器**）：vLLM 在服务器 tmux 常驻，暴露 OpenAI 兼容端点（LLM + embedding + rerank）；本地经 SSH 隧道（`ssh -L 8000:localhost:8000 <server>`）调用，代码里只配 base_url。单测/CI mock 掉 LLM client，零网络零 GPU。只有正式实验（M3 评估、尺寸对比）才在服务器上 `git pull` 执行。

## 硬件拓扑

| 环境                 | GPU / 显存                | 用途                                       |
| -------------------- | ------------------------- | ------------------------------------------ |
| MICC Dream Machines  | 每台 2× RTX 2080 Ti（doc 标 12 GB，实际规格 11 GB）；6 台：targaryen · lannister · lechuck · theflash · harlock · nikita | 常规实验；通过监控挑空闲机器 |
| MICC ultron          | 2× Titan RTX 24 GB        | 大实验、8B fp16、模型尺寸对比               |
| 开发笔记本           | RTX 4070 Laptop, 8 GB     | 只写代码 + SSH，不做推理                    |
| Google Colab         | T4 16 GB（免费）          | 零配置备用                                  |
| Runpod / Lightning   | 可变                      | 按量付费选项，仅当 MICC 不够用              |

MICC 接入 🔶：账号与公钥登记 ✅（sysadmin 确认）；首次登录 ✅（targaryen：2× 2080 Ti 11 GB、CUDA 12.4；ultron：2× Titan RTX 24 GB、CUDA 12.2，用户 `jzheng`）；缺 NAS 个人 home 🔒（sysadmin 补建）。服务器侧工作暂停只影响 M1 实验与大模型推理，不阻塞 M2 本地开发。校外接入 ✅：Dream Machines 公网直连 `ssh <user>@<server>.micc.unifi.it`，无需 VPN（OpenVPN 已弃用，sysadmin 确认；另有可选 MICC VPN，本项目不用）。服务器规格与 IP 见 doc portal：`https://doc.portal.micc.unifi.it`（仓库外，需登录）。存储：共享 NAS `andromeda` · `equilibrium` · `oblivion`，home 配额 100 GB。GPU 监控：专用 Discord 频道 / Grafana（micc-authentik 登录）。**凭据永不进仓库。**

## 开发环境注意（Windows）

- 系统 Python 3.10：不动；项目版本由 uv 管理（🔜 M2）。
- Redis 无原生 Windows 版：本地经 Docker 或 WSL2。
- Windows 上 Celery：dev 用 `solo` pool；部署在 Linux 上。
