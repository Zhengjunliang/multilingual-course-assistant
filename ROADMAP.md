# ROADMAP

**范围**：Triennale 毕业论文（信息工程，UniFi — relatore Prof. Marco Bertini）：大学课程材料的多语言问答（语料含往年 scritto 真题，仅 QA，⛔ 出题/判卷），RAG + 开源权重 LLM（Qwen 系），另含网站（PPM 部分）：Django/DRF + Celery/Redis 后端 + React SPA 前端。relatore 约束、技术栈与决策状态见 [docs/architettura.md](docs/architettura.md)。

## 里程碑

### M0 — 脚手架与基础决策 🔶

已有：仓库、`.gitignore`、`CLAUDE.md`、`README.md`、本 roadmap、`docs/architettura.md`、初始 commit（`f5d7285`）。缺：Meet 确认项（Django、前端与技术栈升级 — 问题 7/8/9）。

- [x] 仓库初始化（`.gitignore`、`CLAUDE.md`）
- [x] 技术栈基础决策（表在 `docs/architettura.md`）
- [x] 文档初始 commit（`f5d7285`）
- [ ] Meet 时向 relatore 确认 Django

### M1 — RAG 学习与分析

目标：关闭 🔒 RAG 路线决策。交付物：`docs/analisi-rag.md`。

- [x] 精读并扩展 relatore 给的链接分析（relatore 明确要求）→ `docs/analisi-rag.md`：
  - [x] Qwen-Agent RAG 模块 — `https://qwenlm.github.io/Qwen-Agent/en/guide/core_moduls/rag/`
  - [x] Qwen3 RAG pipeline（LLM + embedding + reranking）— novita.ai Medium 文章
  - [x] Qwen3 agentic RAG 模板 — Lightning AI
  - [x] Granite-Docling 文档转换 — IBM 公告
- [x] MICC 接入：生成专用 SSH 密钥并把公钥发给 sysadmin（已登记，sysadmin 确认）
- [x] MICC 接入：首次登录成功（targaryen：2× 2080 Ti 11 GB、CUDA 12.4；ultron：2× Titan RTX 24 GB、CUDA 12.2）
- [x] MICC 接入：加入 Discord（GPU 监控频道）
- [ ] MICC 接入：NAS 个人 home 🔒（sysadmin 补建 — 已确认 `/oblivion/users/` 与 `/equilibrium/` 下均缺）、设 `HF_HOME`
- [ ] 最小实验（MICC 服务器，或 Colab T4 备用）：Docling 解析一个课程 PDF + Qwen3 推理
- [x] 路线对比 → 自建 pipeline + 各领域最佳组件（分析在 `docs/analisi-rag.md`，决策表在 `docs/architettura.md`）
- [ ] 与 relatore Meet（问题清单在文末）并确认已定/🔶 倾向栈
- [ ] 用 Meet 结论更新 `docs/architettura.md` 与 `CLAUDE.md`

### M2 — 单语言 RAG 原型

意大利语材料 + 意大利语提问，CLI 级别，不做 web。可基于 🔶 倾向栈在 Meet 前启动（依赖规则见 `docs/architettura.md`）；语料含往年 scritto 真题 PDF。

- [ ] 项目初始化：uv、Python 3.12、目录结构、工程化链（ruff · pyright · pytest · pre-commit · CI）
- [ ] Ingest：Docling → chunking（slides + 真题 PDF）
- [ ] Hybrid 检索：Qdrant 本地模式（dense Qwen3-Embedding + sparse BM25）+ Qwen3-Reranker
- [ ] Qwen3 生成回答
- [ ] 用真实课程材料端到端跑通

### M3 — 评估

- [ ] 基于所选材料构建 gold 问答集（往年 scritto 真题做种子）
- [ ] RAGAS 指标（忠实度、相关性、context precision/recall）+ 检索指标（hit@k、MRR），可复现评估脚本
- [ ] Langfuse 接入（tracing，自托管）
- [ ] 模型尺寸对比（0.6B / 4B / 8B）：质量与运行成本

### M4 — 跨语言 🔒

relatore 表示是可选项（«poi si passa (eventualmente) alla parte di traduzione»）：M3 之后经他同意才启动。

- [ ] 英文（± 中文）提问意大利语材料
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
| 期望的评估标准                                      | relatore（Meet）    |
| 目标语言组合                                        | relatore（Meet）    |
| 毕业 session / 截止日期                             | 用户 + relatore     |
| MICC NAS 个人 home（只阻塞 M1 实验）                | MICC sysadmin       |

## Meet 问题清单（给 relatore）

1. 从哪门课、哪些材料开始？什么格式（slide PDF、讲义、其他）？往年 scritto 真题可否提供（语料 + gold set 种子）？
2. 期望用什么标准评估回答质量？
3. 语言组合：从英文提问意大利语材料开始？中文是否纳入？
4. 确认：论文实验跑在 MICC 服务器上（技术细节找 sysadmin）？
5. PPM 部分（网站）是否在同一个仓库交付？
6. 是否已有可用作 gold set 的问答数据集？
7. 确认 Django 选择（理由在 `docs/architettura.md`）。
8. PPM 网站的 UI 有什么要求/评分标准？前端采用 React SPA + DRF（理由在 `docs/architettura.md`）是否满足 PPM 要求？
9. 确认技术栈升级：Qdrant hybrid 检索、vLLM、RAGAS、Langfuse（决策表在 `docs/architettura.md`）。
