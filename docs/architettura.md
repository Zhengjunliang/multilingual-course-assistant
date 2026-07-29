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

决策已做；仓库中尚无任何依赖（引入时间：RAG 部分 🔜 M2，网站 🔜 M5）。

| 组件           | 选择                                | 动机                                                                     |
| -------------- | ----------------------------------- | ------------------------------------------------------------------------ |
| 语言           | Python 3.12（uv 管理）              | ML 生态；Flask/Django 是 relatore 指定范围                               |
| 包管理         | uv                                  | lockfile、内置 Python 版本管理（系统 3.10 不动）                         |
| Web            | Django 5.x                          | admin 免费当材料后台，auth/ORM/i18n 内置（多语言域加分），Celery 集成成熟 |
| 异步任务       | Celery + Redis                      | relatore 指定                                                            |
| LLM            | Qwen3 系列（0.6B–8B 尺寸对比）      | relatore 指定；本地 8 GB：≤4B fp16 或 8B Q4                              |
| Embedding/Rerank | Qwen3-Embedding / Qwen3-Reranker  | 与 LLM 同源的一体化方案，relatore 链接指向的路线                          |
| 文档解析       | Docling（Granite-Docling）          | relatore 建议                                                            |

选 Django 不选 Flask 的理由：对单人开发 Django **减少**代码量（admin、auth、ORM、i18n 内置）；Flask 需手动拼装。待 Meet 时向 relatore 确认。

## 开放决策 🔒

由 M1 学习 + 与 relatore 的 Meet 关闭。条目未关闭前**禁止**引入其依赖或配置文件（规则在 CLAUDE.md）。

| 决策         | 候选项                                                    | 谁解锁                    |
| ------------ | --------------------------------------------------------- | ------------------------- |
| RAG 路线     | 轻量自建 pipeline · Qwen-Agent RAG · LlamaIndex · 混合    | M1 学习 + Meet            |
| 向量库       | FAISS/Chroma（轻量）· pgvector · Qdrant                   | 随 RAG 路线               |
| 数据库       | SQLite（dev，可能够用）· PostgreSQL                       | 随向量库                  |
| 推理服务     | vLLM（服务器端，remote-first 策略下优先）· Ollama         | MICC 上的尺寸实验（M1）   |
| 评估方法     | 指标、gold set 构建方式、开源权重 LLM-as-judge            | relatore（Meet）          |
| 目标语言     | 从 EN→IT 开始？是否加中文？                               | relatore（Meet）          |

## 算力策略：remote-first

所有 GPU 工作跑在 MICC 服务器上；笔记本只用于写代码、git 和 SSH — **本地不装推理栈**（不装 CUDA/Ollama）。Colab 是服务器满载时的零配置备用。relatore 邮件提到的是 2080Ti 机器；实际收到的接入是 MICC 服务器（sysadmin 2026-07-28 邮件）。

## 硬件拓扑

| 环境                 | GPU / 显存                | 用途                                       |
| -------------------- | ------------------------- | ------------------------------------------ |
| MICC Dream Machines  | 多种（6 台：targaryen · lannister · nikita · harlock · theflash · lechuck）| 常规实验；通过监控挑空闲机器 |
| MICC ultron          | 2× RTX 24 GB              | 大实验、模型尺寸对比                        |
| 开发笔记本           | RTX 4070 Laptop, 8 GB     | 只写代码 + SSH，不做推理                    |
| Google Colab         | T4 16 GB（免费）          | 零配置备用                                  |
| Runpod / Lightning   | 可变                      | 按量付费选项，仅当 MICC 不够用              |

MICC 接入 🔶：账号已建（sysadmin 2026-07-28 邮件）；缺公钥发送与首次登录。校外接入 🔒：待与 sysadmin 确认（MICC OpenVPN，文档只覆盖 Linux）。存储：共享 NAS `andromeda` · `equilibrium` · `oblivion`，home 配额 100 GB。GPU 监控：专用 Discord 频道 / Grafana（micc-authentik 登录）。**凭据永不进仓库。**

## 开发环境注意（Windows）

- 系统 Python 3.10：不动；项目版本由 uv 管理（🔜 M2）。
- Redis 无原生 Windows 版：本地经 Docker 或 WSL2。
- Windows 上 Celery：dev 用 `solo` pool；部署在 Linux 上。
