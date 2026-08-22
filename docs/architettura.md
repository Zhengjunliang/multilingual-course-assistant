# 架构与技术栈

决策来源：relatore 的指示（2026-07-28 邮件）+ 此处记录的自主选择。文中里程碑见 [ROADMAP.md](../ROADMAP.md)。

## relatore 的约束

- **目标**：多语言回答大学课程相关问题 — 提问语言与材料语言不同（如英文提问、意大利语材料）。
- **只用开源权重 LLM**（Qwen 系）；禁用专有 API（OpenAI/Claude）。需评估最优模型尺寸以降低运行成本。
- **渐进路线**：先做与材料同语言的问答，再（视情况）做跨语言部分；必须能**评估回答质量**。
- **文档解析**：考虑用 Granite-Docling 做材料转换。
- **PPM 部分**：完整网站，Flask/Django + Celery/Redis 异步任务。
- **算力**：先用 Google Colab（免费 T4）试验；后接入 relatore 提供的 GPU 机器；备选 Runpod / Lightning。**偏离（2026-07-31 自主拍板）**：跳过 Colab，直接用 MICC 机器 — 接入已完成且 ultron 有 24 GB，Colab 的 16 GB + 会话超时 + 每次重装环境不构成优势。理由见下方算力策略。
- **新方向（2026-08-21 口头）**：agentic RAG（relatore 转的 Lightning «agentic RAG powered by Qwen3» 模板思路，分析见 [analisi-rag.md](analisi-rag.md)）+ UniFi 网站第二知识源 —— Erasmus/外国学生用自己的语言问校园信息（ingegneria、报名、学费、日历等）。落地清单在 [ROADMAP.md](../ROADMAP.md) M2.5。

relatore 给的起步链接在 ROADMAP.md 的 M1 一节（已扩展成 `docs/analisi-rag.md`，M1 交付物）。

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

选 Django 不选 Flask 的理由：对单人开发 Django **减少**代码量（admin、auth、ORM、i18n 内置）；Flask 需手动拼装。前端选 React SPA 弃 HTMX 的理由：PPM 展示性与流式交互。两项 2026-07-30 拍板确认（PPM 无 UI 评分要求，前端自主）。

## 决策状态

原则（2026-07-29 拍板，2026-07-30 收敛）：技术决策自主，**不挂 relatore 确认** — 有依据即定，实验验证后关闭；🔒 只留 relatore 真正属主的项（跨语言启动、截止日期）。依赖规则：🔒 项**禁止**引入依赖或配置文件；🔶 项自 M2 起可引入（实验推翻则原地替换 — 规则在 CLAUDE.md）。

| 决策       | 选择                                                                                                          | 状态 | 验证条件                  |
| ---------- | ------------------------------------------------------------------------------------------------------------- | ---- | ------------------------- |
| RAG 路线   | 自建 pipeline：Docling → chunk → hybrid 检索 → rerank → Qwen3；Qwen-Agent/纯 BM25 做对照基线（分析见 [analisi-rag.md](analisi-rag.md)）；不用 LlamaIndex/LangGraph 全家桶（可解释性优先） | ✅   | M2 端到端跑通：gold 40 题 hit@5 95%（[diario-sperimentale.md](diario-sperimentale.md)） |
| 向量库     | Qdrant：原生 hybrid（dense Qwen3-Embedding + sparse fastembed BM25 + RRF）、locale/课程 payload 过滤（fusion 下必须放 prefetch 分支内，实测顶层 filter 被静默忽略）；M2 用 qdrant-client 本地模式（无服务器进程，[rag/index.py](../rag/index.py)、[rag/search.py](../rag/search.py)），M5 起 Docker；降级备选 pgvector | ✅   | 31 deck 全量（1234 chunk），gold 40 题 hit@5 38/40 |
| 数据库     | M2 原型无 DB（文件 + Qdrant 本地）；M5 起 PostgreSQL（Docker）                                                 | 🔶   | M5                        |
| 推理服务   | OpenAI 兼容端点是唯一契约：开发期本地 Ollama（Qwen3-4B q4），M3 正式实验 vLLM（MICC 服务器，流式；Turing 卡**无 bfloat16**，一律 fp16）—— 切换只改 `.env` 的 `LLM_BASE_URL`/`LLM_MODEL` | 🔶   | M3 模型尺寸对比           |
| 校园信息源 | UniFi 网站第二知识源：爬取+索引为骨架（复用 ingest 管线，Qdrant `unifi_web` collection），实时抓取为增量层；发现 = sitemap + 范围规则，种子板块 ≤500 页起步，查询缺口驱动扩张；HTML 解析走 Docling HTML backend | 🔶   | M2.5 campus gold 跑分     |
| agent 编排 | 分期：路由器（选库 + query 改写 + 带理由拒答）→ 实时补抓 + 自评重试（硬上限 1）；显式控制流 + 每步受 pydantic 校验的 JSON 决策，⛔ 原生 tool-calling（4B 量化协议遵从性不可靠） | 🔶   | M2.5 路由准确率           |
| 可观测性   | Langfuse 自托管（Docker），LLM tracing                                                                         | 🔶   | M3 接入                   |
| 评估方法   | RAGAS（faithfulness · answer relevancy · context precision/recall，judge = 开源权重 Qwen3 大尺寸）+ 检索指标（hit@k、MRR）；gold set 自建（无现成数据集） | 🔶   | M3 跑通                   |
| 目标语言   | EN→EN 基线（M2）；任意语言提问 → 同语言回答是双场景核心（2026-08-21 拍板，原 M4 并入，见 [ROADMAP.md](../ROADMAP.md)），评估语言 EN/IT/ZH。语料不按语言拆库：Qwen3-Embedding 本身是多语言的，chunk 带 `locale` payload 供过滤 | 🔶   | M3 双场景评估             |

评估方法自主拍板（2026-07-30）：relatore 只要求"能评估回答质量"，未指定指标。gold set 无现成数据集，M2 建冒烟版、M3 扩全量（见 [ROADMAP.md](../ROADMAP.md)）。

## 实验可复现性 🔜 M3

依赖层的可复现已就位（`uv.lock` + CI `--locked`）；模型层的对应物是下面这份每实验必录清单，M3 评估脚本落地时执行：

- **模型身份**：HF 模型 revision（pin 到 commit，`Qwen3-8B` 这样的名字不是固定 artifact）+ 量化方案。量化 8B 与 fp16 8B 是**不同模型**：尺寸对比实验里两者不得跨机混比，否则尺寸轴与精度轴混杂。
- **推理配置**：vLLM 版本、seed、采样参数（temperature / top_p / max_tokens）。
- **数据身份**：语料快照哈希与解析配置随 chunk payload 携带（字段属主见 [docling-e-pipeline.md](docling-e-pipeline.md)）。

## 语料与交付范围

- **语料 ✅**：PPM 课程 slides，31 份 PDF、约 1200 页、约 65 万字符，在 `data/corpus/PPM/`（gitignore，版权材料永不进 git）。2026-07-31 用 pypdf 实测：
  - **语言**：英语为主（~23 份：Django 全系列、Docker、JavaScript、图像/视频压缩理论、REST、Flask），意大利语或英意混排 ~8 份（`3.1-web-intro-html`、`3.6`–`3.8`、`HTML5_tag_semantici`）。**单文件内也会混语言**，所以 `locale` 是 chunk 级属性，不是文件级。
  - **文字层**：31 份全部有，无扫描件 → OCR 非必需项。
  - **例外**：`3.5-HTML5-Part-2` 32 页里 16 页近乎为空，内容在图里 → 路由为其开 OCR（抽取量 10001 → 20032 字符）。仍余 19 个死 section，VLM 也救不回。
  - **两个已知坑，均已验收 ✅**：朴素抽取丢词间空格（`"Video isa sequenceof frames"`）→ Docling 还原成 `"Video is a sequence of frames"`；连字（U+FB01 等）出现在 17 份 PDF 的文字层里，单份多达 97 处（`non-proﬁt` · `conﬁgured` · `micc.uniﬁ.it`），不归一化 BM25 必漏召回 → `rag/parse.py` 的 NFKC 归一化后残留为 0。
  - **新发现的坑**：图片与公式在 Docling 默认配置下全部丢弃，抽样 9 份约 322 页里有 **63 个死 section**（只剩标题、正文全是图片占位）。这是本语料最大的检索缺口，也是自适应路由与 M3 图片描述消融实验的动机。明细见 [docling-e-pipeline.md](docling-e-pipeline.md)。
  - 往年 scritto 真题暂缓 🔜（见 [ROADMAP.md](../ROADMAP.md) 暂缓项）。
- **能力边界**：检索问答（QA）。出题 / 自动判卷 ⛔ 超出范围。
- **交付**：React SPA + DRF API（SSE 流式问答）+ Django admin 材料后台，与 RAG 部分**同一仓库**。
- **外部知识源**（MCP、Google Drive 等）🔜 M7（可选，post-M6，见 [ROADMAP.md](../ROADMAP.md)）。

## 工程化 ✅

ruff（lint + format）· pyright（`rag/` strict）· pytest + pytest-django + 覆盖率门禁（pytest-cov）· pre-commit（含泄密与 lockfile 守卫、commit 消息格式）· GitHub Actions CI（check 链 + pip-audit 依赖审计）；依赖更新手动（pip-audit 兜底安全漏洞）。工具配置集中在 [pyproject.toml](../pyproject.toml)，hook 在 [.pre-commit-config.yaml](../.pre-commit-config.yaml)，流水线在 [.github/workflows/ci.yml](../.github/workflows/ci.yml)（`uv sync --locked` → lint → format → 类型 → Django check → 测试+覆盖率）；日常命令见 [README.md](../README.md)。配置与密钥经 `.env` 由 pydantic-settings 读入（`config/env.py`，不 import Django，将来与 `rag/` 共用同一来源），`.env` 永不进 git。docker-compose 🔜 M5（PostgreSQL · Redis · Qdrant · Langfuse）。

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
