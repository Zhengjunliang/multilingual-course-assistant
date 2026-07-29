# ROADMAP

**范围**：Triennale 毕业论文（信息工程，UniFi — relatore Prof. Marco Bertini）：大学课程材料的多语言问答，RAG + 开源权重 LLM（Qwen 系），另含 Django + Celery/Redis 网站（PPM 部分）。relatore 约束、技术栈与开放决策见 [docs/architettura.md](docs/architettura.md)。

## 里程碑

### M0 — 脚手架与基础决策 🔶

已有：仓库、`.gitignore`、`CLAUDE.md`、`README.md`、本 roadmap、`docs/architettura.md`。缺：文档 commit、Django 选择待 relatore 确认。

- [x] 仓库初始化（`.gitignore`、`CLAUDE.md`）
- [x] 技术栈基础决策（表在 `docs/architettura.md`）
- [ ] 文档初始 commit
- [ ] Meet 时向 relatore 确认 Django

### M1 — RAG 学习与分析

目标：关闭 🔒 RAG 路线决策。交付物：`docs/analisi-rag.md`。

- [x] 精读并扩展 relatore 给的链接分析（relatore 明确要求）→ `docs/analisi-rag.md`：
  - [x] Qwen-Agent RAG 模块 — `https://qwenlm.github.io/Qwen-Agent/en/guide/core_moduls/rag/`
  - [x] Qwen3 RAG pipeline（LLM + embedding + reranking）— novita.ai Medium 文章
  - [x] Qwen3 agentic RAG 模板 — Lightning AI
  - [x] Granite-Docling 文档转换 — IBM 公告
- [ ] MICC 接入：生成专用 SSH 密钥并把公钥发给 sysadmin
- [ ] MICC 接入：首次登录、确认 NAS home、加入 Discord
- [ ] 最小实验（MICC 服务器，或 Colab T4 备用）：Docling 解析一个课程 PDF + Qwen3 推理
- [ ] 路线对比：轻量自建 pipeline vs Qwen-Agent RAG vs LlamaIndex（vs 混合）
- [ ] 与 relatore Meet（问题清单在文末）并拍板 RAG 路线
- [ ] 用已关闭的决策更新 `docs/architettura.md` 与 `CLAUDE.md`

### M2 — 单语言 RAG 原型

意大利语材料 + 意大利语提问，notebook/CLI 级别，不做 web。

- [ ] 项目初始化：uv、Python 3.12、目录结构
- [ ] Ingest：Docling → chunking
- [ ] Embedding + 检索（+ 可选 reranking）
- [ ] Qwen3 生成回答
- [ ] 用真实课程材料端到端跑通

### M3 — 评估

- [ ] 基于所选材料构建 gold 问答集
- [ ] 指标（如对源忠实度、相关性）与可复现评估脚本
- [ ] 模型尺寸对比（0.6B / 4B / 8B）：质量与运行成本

### M4 — 跨语言 🔒

relatore 表示是可选项（«poi si passa (eventualmente) alla parte di traduzione»）：M3 之后经他同意才启动。

- [ ] 英文（± 中文）提问意大利语材料
- [ ] 用 M3 的指标对比跨语言 vs 单语言质量

### M5 — 网站（PPM 部分）

- [ ] Django + Celery/Redis 项目
- [ ] 上传材料 → Celery 异步 ingest
- [ ] 问答界面（带 `locale` 字段）
- [ ] admin 后台管理材料

### M6 — 部署与论文

- [ ] 部署到 MICC 服务器（或 Runpod）
- [ ] 论文写作
- [ ] 最终交付文档译为意大利语

## 阻塞项 🔒

| 阻塞                                                | 谁解锁              |
| --------------------------------------------------- | ------------------- |
| RAG 路线（连带：向量库、DB、推理服务）              | M1 学习 + Meet      |
| MICC 校外接入（OpenVPN，文档只有 Linux）            | MICC sysadmin       |
| 期望的评估标准                                      | relatore（Meet）    |
| 目标语言组合                                        | relatore（Meet）    |
| 毕业 session / 截止日期                             | 用户 + relatore     |

## Meet 问题清单（给 relatore）

1. 从哪门课、哪些材料开始？什么格式（slide PDF、讲义、其他）？
2. 期望用什么标准评估回答质量？
3. 语言组合：从英文提问意大利语材料开始？中文是否纳入？
4. 确认：论文实验跑在 MICC 服务器上（技术细节找 sysadmin）？
5. PPM 部分（网站）是否在同一个仓库交付？
6. 是否已有可用作 gold set 的问答数据集？
7. 确认 Django 选择（理由在 `docs/architettura.md`）。
