# multilingual-course-assistant

大学课程材料多语言问答：提问语言可以和材料语言不同（如英文提问、意大利语讲义）。基于 RAG 与开源权重 LLM（Qwen 系）；网站为 Django/DRF + Celery/Redis 后端 + React SPA 前端。

Triennale 毕业论文，佛罗伦萨大学（UniFi）信息工程 — relatore Prof. Marco Bertini。

## 状态

✅ M2 完成：ingest 全链（探测 + Docling 解析 + chunking + Qdrant 索引）与 hybrid 检索 + rerank 在**全量语料**（31 deck · 1234 chunk）上跑通，gold 40 题 hit@5 95%（对照组 5/5）；生成侧经本地 Ollama 实测（引用、意语跟随、语料外拒答），记录在 [docs/diario-sperimentale.md](docs/diario-sperimentale.md)。🔶 M2.5（UniFi 校园信息源 + agentic 路由）：实现完成，autogrow 分数门重测待记账。🔶 M5 网站（提前到 M3 之前执行）：地基层 + 非流式问答 API `/api/ask` 已可用（见下面「问答 API」一节），SSE、SPA、账号、异步 ingest 🔜 后续 Stage。里程碑与阻塞项见 [ROADMAP.md](ROADMAP.md)；约束、技术栈与决策见 [docs/architettura.md](docs/architettura.md)。

## Setup

```powershell
git clone git@github.com:Zhengjunliang/multilingual-course-assistant.git
cd multilingual-course-assistant
uv sync                       # uv 自带 Python 3.12，不动系统的 3.10
Copy-Item .env.example .env   # 填 DJANGO_SECRET_KEY 与 DJANGO_DB_PASSWORD，命令见文件内注释
uv run pre-commit install
docker compose up -d          # PostgreSQL（需 Docker Desktop 引擎在跑）
uv run python manage.py migrate
```

`docker-compose.yml` 只起有状态服务；Django 与后续的 Celery worker 用 `uv run` 跑在宿主机上，因为 `rag/` 的 embedding 与 reranker 要用本机 GPU。整套进容器的部署路径走 `--profile app`（🔜 M5 末），文件顶部有约定说明。

## 开发

### 日常开工

```powershell
just up          # 起 PostgreSQL 容器（Docker Desktop 引擎要先开着）
just serve       # 开发服务器
```

- 管理后台在 <http://127.0.0.1:8000/admin/>；问答 API 在 `/api/ask`（见下节）
- 根路径 `/` 无内容：[config/urls.py](config/urls.py) 只挂了 admin 与 api，Django 显示它的默认欢迎页。问答界面 🔜 M5 后续 Stage（React SPA 一条）

**`just serve` 跑着的时候，终端里的 `just index` / `just search` / `just ask` 会失败**：本地 Qdrant 是嵌入式的，独占 `data/qdrant` 目录锁，网站进程先开就轮不到 CLI（反过来也一样，那时端点返回 503 并说明冲突）。要两边同时用，先 `Ctrl+C` 停掉网站。这条随「Qdrant 改服务进程」🔜 解除，见 [ROADMAP.md](ROADMAP.md) 自主拍板项一节。

收工 `just down`——容器停掉，数据留在命名卷里，下次 `just up` 原样还在。连数据一起清是 `docker compose down -v`（不可逆）。

**改过模型之后必须补两步**，漏掉会让 `just test` 变红（`tests/test_accounts.py` 的 `test_no_pending_migrations` 守着模型与迁移不漂移）：

```powershell
just makemigrations   # 生成迁移文件，进 git
just migrate          # 应用到数据库
```

管理员账号用 `just superuser` 建（交互式）；改密码是 `uv run python manage.py changepassword <用户名>`。

### 任务入口

全部在 [justfile](justfile)（`scoop install just` 一次性安装）：

```powershell
just lint        # ruff check
just format      # ruff format
just typecheck   # pyright（含 django-stubs，与 IDE 看到的类型一致）
just test        # pytest（快跑，无覆盖率开销）
just cov         # pytest --cov，带覆盖率门禁，与 CI 相同
just check       # 完整 CI 链：lint + format + 类型 + Django check + 测试

just up          # 起后台服务（PostgreSQL）
just down        # 停后台服务，数据留在命名卷里
just serve       # 开发服务器
just superuser   # 建管理员账号（交互式）
just makemigrations  # 模型改动 -> 迁移文件
just migrate     # 应用数据库迁移

just probe data\corpus\PPM
just parse data\corpus\PPM
just chunk data\parsed
just index data\chunks
just search "What is an ORM?"
just answer "What is an ORM?"    # 需要本地 Ollama 在线
just ask "Quando scadono le tasse?"     # 路由（课程库 / 校园库）+ 检索 + 回答
just gold                        # gold 冒烟 hit@5
just crawl                       # 校园 web 源爬取（用户执行；robots · 1 req/s · ≤500 页）
just webparse data\webcorpus\<run_id>   # 快照解析 -> 可切块工件对
```

不装 just 也可以直接跑对应的 `uv run …` 命令（recipe 内容即命令本身）。

CI（[.github/workflows/ci.yml](.github/workflows/ci.yml)）在 push 与 PR 上跑同一条链外加 pip-audit 依赖审计，用 `uv sync --locked`，所以 `uv.lock` 必须跟着 commit。依赖更新手动管理（`uv lock --upgrade` 后跑 `just check`）。

## Ingest（课程材料 → 可检索的块）

课程 PDF 放 `data/corpus/<课程>/`（gitignore）。解析前先探测、逐份文件选配置，不需要手动指定：

```powershell
uv run python -m rag.probe data\corpus\PPM                       # 只看画像与路由结果，不解析
uv run python -m rag.parse data\corpus\PPM                       # 按路由解析整个目录 -> data\parsed\
uv run python -m rag.parse "data\corpus\PPM\<slides>.pdf" --profile manual --pipeline vlm
uv run python -m rag.chunk data\parsed                           # 切块 -> data\chunks\*.jsonl
```

解析每份产出两个文件：`<名>.<配置>.json`（DoclingDocument，无损，chunking 的输入）与 `<名>.<配置>.meta.json`（溯源 sidecar）。配置名（`classic` · `classic-formula` · `vlm` …）进文件名，同一份 PDF 的不同配置不互相覆盖，便于对比。chunking 输出 `data/chunks/<名>.<配置>.jsonl`，每行一个带完整 payload 的 chunk。路由规则、实测与 payload 契约见 [docs/docling-e-pipeline.md](docs/docling-e-pipeline.md)。

## 检索与问答

```powershell
uv run python -m rag.index data\chunks              # 索引 -> data\qdrant\（本地嵌入式，无服务进程）
uv run python -m rag.search "What is an ORM?"       # hybrid（dense+BM25+RRF）+ Qwen3-Reranker
uv run python -m rag.answer "What is an ORM?"       # 检索 + Qwen3 生成带引用的回答
uv run python -m rag.agent "Quando scadono le tasse?"   # 路由到课程库/校园库 -> 检索 -> 回答
uv run python -m rag.gold gold\smoke.jsonl          # gold 冒烟：检索 hit@k
uv run python -m rag.gold gold\campus.jsonl --routing   # 只跑路由 LLM 的报告，不检索
```

embedding 与 reranker（各 0.6B）在本机 GPU 跑，索引与检索完全离线；`rag.answer` 的生成一步调 OpenAI 兼容端点，默认**本地 Ollama**：

```powershell
winget install Ollama.Ollama                  # 或 https://ollama.com/download/windows
ollama pull qwen3:4b-instruct-2507-q4_K_M
```

M3 正式实验改 `.env` 指向服务器 vLLM 隧道（`ssh -L 8000:localhost:8000 <server>`）。端点与模型名在 `.env`（`LLM_BASE_URL` · `LLM_MODEL`）。分工依据见 [docs/architettura.md](docs/architettura.md) 算力策略一节。

## 问答 API

同一条链路的 HTTP 形式：`POST /api/ask`，路由 → 检索 → 生成，返回答案 + 路由决策 + 引用清单。前置条件和 CLI 一样——Ollama 在跑、`data/qdrant` 已索引——外加 `just up` 与 `just serve`。

```powershell
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$json = @{ question = "学费什么时候交？" } | ConvertTo-Json
$body = [System.Text.Encoding]::UTF8.GetBytes($json)
Invoke-RestMethod http://127.0.0.1:8000/api/ask -Method Post -Body $body `
  -ContentType "application/json; charset=utf-8" -TimeoutSec 300
```

**body 必须显式转成 UTF-8 字节。** Windows PowerShell 5.1 的 `Invoke-RestMethod` 在 `Content-Type` 不带 charset 时按 ASCII 编码字符串 body，`学费` 和 `Università` 一样会变成 `?` —— 这是个多语言项目，直接传字符串的写法在这里是错的。

可选 `locale`（BCP-47 primary subtag，如 `it`；省略则从问题里检测）。响应契约在 [apps/qa/contract.py](apps/qa/contract.py)，它是唯一源：

| 字段 | 内容 |
| ---- | ---- |
| `answer` | 生成的答案全文 |
| `locale` | 实际用于生成的语言 |
| `route` | 路由决策，直接复用 `rag.agent.RouteDecision`（`target` · `query` · `fresh` · `reason`） |
| `citations` | 生成所依据的检索集，按检索顺序逐条，**不去重**（同一页的两个 chunk marker 相同但正文与分数不同；要合并由前端按 `marker` 分组） |

`citations` 每条的字段：`marker`（模型被要求逐字复制的那个标记）· `cited`（marker 是否**逐字**出现在 `answer` 里）· `text`（模型看到的原文）· `kind`（`slides` / `web`）· `score` · `heading_path` · `course` · `locale`，以及 slides 的 `source_file`+`page` 或 web 的 `url`+`fetch_date`。

`cited` 是纯子串判断，不是「这条被用到了吗」的推断——4B 模型时常把 marker 缩写成 `[Excerpt 1]`，那时 `cited` 就是 `false`。判 false 只代表「没有逐字出现」。

**首次请求慢**（约一分钟）：embedding 与 reranker 要加载进显存。之后常驻。**答案串行**：8GB 显存装不下两路并发的 rerank + 生成，所以端点一次只答一个问题。两道闸：匿名限流 10 次/分钟（按 `REMOTE_ADDR`，登录后 30 次/分钟），以及排队上限 90 秒——超过就 503 带 `Retry-After`，而不是把连接吊到超时。

错误按类型分：400 校验失败 · 429 限流 · 503 依赖不可用（生成端点没响应、索引被别的进程占着、还没索引过、前面的问题还没答完）。DRF 自带的校验消息跟随 `Accept-Language`（`LANGUAGE_CODE` 是 `it`，默认意大利语）；本项目自己的 503 文案已标记待译，但仓库还没有 `locale/` 目录，所以目前是英文。

**深挖循环（`deepen`）不在这个端点里**：它会联网抓页并写入共享索引，最多 3 次抓取。演示自增长仍用 CLI 的 `just ask`。它进 web 的路径是「账号 + Celery 异步」，见 [ROADMAP.md](ROADMAP.md)。

## 代码布局

| 路径              | 内容                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------ |
| `config/`         | Django project：settings（单一模块，安全响应头按 `DEBUG` 与 `DJANGO_BEHIND_TLS` 条件生效）· urls · asgi/wsgi · env（`.env` 经 pydantic-settings 读入，`rag/` 与 Django 两侧共用） |
| `apps/accounts/`  | 自定义 User（`AUTH_USER_MODEL`）。`AbstractUser` + `locale`（偏好语言，取值域对齐 `settings.LANGUAGES`）；admin 里可见可筛 |
| `apps/qa/`        | 问答 API。`contract.py` 响应契约（唯一源，Stage 3 的 SSE 与 SPA 都消费它）· `serializers.py` 请求校验 · `engine.py` 进程级模型资源 + 串行的 `ask()`（路由→检索→回答，复用 `rag/`，不重写逻辑）· `views.py` 只做 HTTP 翻译 |
| `rag/`            | RAG pipeline — **禁止 import Django**，论文核心要能脱离 web 单独跑评估。`probe.py` 探测并路由，`parse.py` 调 Docling，`crawl.py` 抓校园 web 源快照 + registry，`webparse.py` 快照转可切块工件，`chunk.py` 切块并挂 payload，`index.py` 编码入 Qdrant，`search.py` hybrid 检索 + rerank，`llm.py` OpenAI 兼容客户端（Streamer/Completer + pydantic JSON 校验助手），`answer.py` 生成带引用回答，`agent.py` 路由问题到课程库/校园库（只读控制流），`gold.py` 检索冒烟跑分与 `--routing` 路由报告，`golddraft.py` 起草 gold 题（人工把关后才进 `gold/`） |
| `tests/`          | pytest；`test_smoke.py` 守着上面那条约束和 Django 配置的完整性                                |
| `data/`           | 课程材料与派生产物（解析输出、Qdrant 本地索引），gitignore，**永不进 git**                    |

`frontend/`（React SPA）🔜 M5 后续 Stage，届时再建。

## MICC 服务器日常使用

接入方式与硬件规格见 [docs/architettura.md](docs/architettura.md)。SSH 别名在本机 `~/.ssh/config`（`ssh targaryen` 等）。

### 开工

1. 看 GPU 面板（Grafana / Discord `#gpu-monitoring-dream-`）：挑 **VRAM 柱空 + CPU 低**的机器。日常用 2080 Ti 机器；ultron（24 GB）只在实验需要大显存时用，不日常占用。
2. 登录后 `nvidia-smi` 二次确认；避开有人的卡，用 `CUDA_VISIBLE_DEVICES=<id>` 指定空卡。
3. 长任务放 tmux（断线不死）：`tmux new -s tesi`；重连 `tmux attach -t tesi`。

### 存储

- **模型缓存与数据集放 NAS home，不放服务器本地 `/home`**（本地盘小且全员共享 — targaryen 首测 94.9%）。
- NAS 卷 `/andromeda` `/equilibrium` `/fishtank` `/oblivion` 挂在每台服务器上。个人目录路径**各卷不统一**：`/oblivion/users/<user>` 带 `users/`，`/equilibrium/<user>` 不带；andromeda 与 fishtank 下没有，需要时找 sysadmin。
- 挑卷看剩余容量（2026-07-30 实测：oblivion 已用 60%、剩 2.87 TB 最空；equilibrium 94%；andromeda 满）。本项目用 `/oblivion/users/jzheng`。
- HF 缓存重定向：服务器 `~/.bashrc` 加 `export HF_HOME=/oblivion/users/jzheng/hf_cache`。
- 共享数据集在 `/<卷>/DATASETS`、`/<卷>/datasets` 或 `/home/DATASETS`（各机命名不统一，`ls` 确认）；数据集放个人目录会被清理（NAS 规则）。

### 收工

- `nvidia-smi` 确认无自己的残留进程；有就 `kill <PID>`。Jupyter kernel 也占显存，用完关。
- 不跑东西的 tmux session 关掉：`tmux kill-session -t tesi`。
- 显存跑完即释放，不挂着占。

## 语言约定

开发期文档为中文；最终 tesi 交付物在 M6 译为意大利语。详见 [CLAUDE.md](CLAUDE.md) 文档约定一节。
