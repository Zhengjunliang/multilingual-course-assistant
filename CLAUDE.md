# CLAUDE.md — multilingual-course-assistant

> 每次会话自动加载。保持精简（<150 行）：只写 Claude 无法从代码推断的内容。
> 规则用祈使句；§1 随项目演进更新，删除过时内容。

## 1. 项目概览

- **项目**：multilingual-course-assistant — 大学课程材料多语言问答（RAG，开源权重 LLM，Qwen 系；仅 QA，⛔ 出题/判卷）+ 网站（PPM 部分）：Django/DRF + Celery 后端、React SPA 前端，同一仓库。**Triennale 毕业论文**，UniFi，relatore Prof. Marco Bertini；单人开发（Junliang Zheng）。
- **当前阶段 🔶 M2**：骨架（`pyproject.toml` 集中 uv · ruff · pyright · pytest 配置、Django project `config/`、`.pre-commit-config.yaml`、`.github/workflows/ci.yml`）+ ingest 前三步 —— `rag/probe.py`（解析前探测，逐份文件决定是否开 OCR / 公式富化；VLM 不进自动路由）、`rag/parse.py`（Docling 解析 → DoclingDocument JSON + 溯源 sidecar）与 `rag/chunk.py`（HybridChunker 切块 + payload）。无检索、生成与 web 业务逻辑。
- **范围**：定义在 `ROADMAP.md`（里程碑 M0–M7、阻塞项、暂缓项、Meet 议题）；relatore 的约束在 `docs/architettura.md`。**禁用专有 LLM API**（OpenAI/Claude）：只用开源权重模型。语料只用课程 slides/讲义 PDF（scritto 真题暂缓 🔜）。MCP/外部知识源 🔜 M7（可选，论文范围外）。
- **技术栈 🔶 全部自主已定**：Python 3.12 via uv · Django 5 + DRF · Celery+Redis · Qwen3（LLM/embedding/reranker）· Docling · React+TS SPA（Vite）· 自建 RAG pipeline · Qdrant hybrid · vLLM · RAGAS · Langfuse · PostgreSQL · 工程化链 — 唯一决策表在 `docs/architettura.md`，🔶 项待实验验证（推翻则原地替换）。依赖规则：**🔒 项禁止引入依赖或配置文件**；🔶 项用 `uv add` 引入，且**只在真正要用它的里程碑加** — 装了不用的依赖是噪音，也让 `uv.lock` 里出现无法解释的东西。
- **目录结构 ✅**：`config/`（Django project：settings · urls · asgi/wsgi · env）· `rag/`（RAG pipeline 包）· `tests/` · `docs/` · `data/`（课程材料与派生产物，gitignore，永不进 git）· `.github/workflows/ci.yml`。**`rag/` 禁止 import Django** — 论文核心要能脱离 web 单独跑评估，`tests/test_smoke.py` 守着这条。后续目录到里程碑再建，未定前不建"顺手"目录：`apps/qa/`（DRF）与 `frontend/`（React SPA）🔜 M5。
- **语言域**：业务领域是多语言的；所有数据模型和面向用户的文本从一开始就带 `locale` 字段/参数，禁止硬编码语言字符串。
- **深入文档**：具体主题放 `docs/`，本文件只放指针。

## 2. 代理执行规则

1. **写代码前**：先读相关现有文件理解代码风格再动手，禁止凭直觉写。
2. **Contract-first**：存在共享契约（类型、数据 schema、API）时，契约是**唯一源**；先改契约，再改消费方，同一次修改内保持两侧同步。
3. **大任务分阶段**：跨多层（数据 / 服务 / 界面）的修改拆成独立 Stage，禁止单次会话覆盖所有层。
4. **大文件拆分**：单文件超 250 行时，先改逻辑层再改视图层，禁止一次改两层。
5. **语言**：变量/函数英文；代码注释英文；commit 消息英文；仓库文档中文（见 §5）。**与用户对话始终用中文**，无论提问用什么语言。
6. **唯一正确实现，消除噪音**：只保留一份正确实现。refactor **原地替换**，禁止平行/备选版本，禁止保留"备用"旧代码（历史在 git 里）。死代码 = 噪音，彻底删除。
7. **输出格式遵官方，禁止造字段**：API 响应 / config / manifest / SDK 参数严格按官方 schema，禁止发明字段。有疑问先查官方文档再实现。
8. **完成前先验证**：每次修改要有可执行的检查（测试 / build / lint 通过，或截图证明），禁止因为"看着对"就收工。
9. **禁止假完成**：占位 TODO、stub 测试、`test.skip`/`.only`、未实现分支是**阻塞**，不是完成证据。要么实现，要么明确声明阻塞。
10. **风格规则交给 linter**：格式/命名由 linter/formatter 强制，本文件不重复。
11. **危险操作交用户，写操作限项目内**：AI **永不执行**递归/批量删除、注册表/系统配置修改、系统级安装卸载。项目目录**外**只读。项目**内**单文件删除（refactor/死代码）允许，但删前列出文件 + 理由。不可逆操作：打印命令，用户执行。
12. **远程服务只读**：对任何托管服务（云 DB、存储、auth 服务、付费 API）AI **永不执行**写入或连接线上环境的命令 — 迁移、seed、reset、DDL/DML、admin API、部署。打印命令，用户在自己的终端执行。AI 仅限**完全离线**操作：从本地文件生成客户端/类型、编辑迁移文件、读取 schema。
13. **问而不猜**：缺决策（范围、栈、领域命名）且不同理解会导致不同工作时，问**一个**带 2-4 个选项的靶向问题；不默默替用户选。

## 3. Git

1. **Commit 归用户**：AI 可以改文件、`git add`、`git diff`、`git status`；**永不执行 `git commit`** — 把完整命令打印出来，用户在自己终端执行。一个逻辑单元一个 commit，消息用英文，Conventional Commits 格式（`feat:` · `fix:` · `docs:` · `chore:` · `refactor:` · `test:`）。
2. **禁止生成签名**：commit 消息和 PR 正文**不含** `Co-Authored-By: Claude …`、`🤖 Generated with …` 等任何 AI 工具签名。消息以最后一行内容结束。
3. **远程与账号归用户**：AI **永不执行** `git push`，也不做远程/账号级操作（建删仓库、改 `git remote`、任何 `gh` 写操作、`git config --global`、`gh auth`）。其余场景**打印命令，用户在自己终端执行**。
4. **永不重写共享历史**：无明确要求不 `push --force`、不对未提交工作 `reset --hard`、不 rebase 已发布的 commit。
5. **分支**：在 `main` 上工作（个人仓库）。实验性修改先提议开分支。

## 4. 领域不变量

🔜 论文范围细化后填写。只放违反即 bug 的业务规则，不放偏好。本节为空时，不发明不变量。

## 5. 文档约定

**开发期语言：中文。** 仓库文档用中文写（单人开发，理解优先），原地维护，**无平行翻译版本**。**最终 tesi 交付物在 M6 译成意大利语**（论文正文与随附最终文档）。代码标识符/注释/commit 用英文（§2.5）。

**地图** — 根目录文件 + `docs/`。仓库内不散落其他计划/清单文件：

| 文件           | 内容                                                                     | 状态 |
| -------------- | ------------------------------------------------------------------------ | ---- |
| `README.md`    | 入口：是什么、怎么跑、怎么开发、CI                                        | ✅   |
| `CLAUDE.md`    | 代理规则、项目概览、文档约定                                              | ✅   |
| `ROADMAP.md`   | 范围、里程碑、可勾选清单、阻塞项                                          | ✅   |
| `docs/*.md`    | 一主题一文件，主题存在才建（`docs/architettura.md`、`docs/analisi-rag.md`、`docs/docling-e-pipeline.md`）| ✅   |

**一条信息一个属主。** 属主写全文，其他文件一行 + 链接，永不复制。不知道属主是谁时，定属主也是本次修改的一部分。

**图**：mermaid（GitHub 原生渲染）；ASCII 仅限内联微型图（如目录树）。状态标记放在图上方的正文里，永不放进 mermaid 语法内。

**状态标记**（全仓库统一）：✅ 已实现 — **必须**引用真实路径或可执行命令 · 🔜 计划中 — **必须**注明里程碑 · 🔶 部分 — 说明有什么、缺什么 · 🔒 阻塞 — 说明谁解锁 · ⛔ 超出范围。`[ ] [~] [x]` 勾选框**只**存在于 `ROADMAP.md`。禁止时间性表述（"已经做了""目前""即将"）：状态只用标记表达。

**计划中的设计 ≠ 错误的设计。** 🔜 块可以描述尚不存在的东西，**不能**描述代码已否决的东西。与代码或真实契约矛盾的内容，先按真实模型重写再打标记。

**链接**：文件之间只链**文件，永不链 `#anchor`**（标题会变，锚点静默失效）；章节用文字点名。锚点仅限同文件内部。**仓库外**引用用纯文本 + 备注（仓库外），不做链接。
