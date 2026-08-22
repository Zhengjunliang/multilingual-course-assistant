# multilingual-course-assistant

大学课程材料多语言问答：提问语言可以和材料语言不同（如英文提问、意大利语讲义）。基于 RAG 与开源权重 LLM（Qwen 系）；网站为 Django/DRF + Celery/Redis 后端 + React SPA 前端。

Triennale 毕业论文，佛罗伦萨大学（UniFi）信息工程 — relatore Prof. Marco Bertini。

## 状态

✅ M2 完成：ingest 全链（探测 + Docling 解析 + chunking + Qdrant 索引）与 hybrid 检索 + rerank 在**全量语料**（31 deck · 1234 chunk）上跑通，gold 40 题 hit@5 95%（对照组 5/5）；生成侧经本地 Ollama 实测（引用、意语跟随、语料外拒答），记录在 [docs/diario-sperimentale.md](docs/diario-sperimentale.md)。🔜 M2.5（UniFi 校园信息源 + agentic 路由）。尚无 web 业务逻辑。里程碑与阻塞项见 [ROADMAP.md](ROADMAP.md)；约束、技术栈与决策见 [docs/architettura.md](docs/architettura.md)。

## Setup

```powershell
git clone git@github.com:Zhengjunliang/multilingual-course-assistant.git
cd multilingual-course-assistant
uv sync                       # uv 自带 Python 3.12，不动系统的 3.10
Copy-Item .env.example .env   # 填 DJANGO_SECRET_KEY，命令见文件内注释
uv run pre-commit install
```

## 开发

任务入口在 [justfile](justfile)（`scoop install just` 一次性安装）：

```powershell
just lint        # ruff check
just format      # ruff format
just typecheck   # pyright
just test        # pytest（快跑，无覆盖率开销）
just cov         # pytest --cov，带覆盖率门禁，与 CI 相同
just check       # 完整 CI 链：lint + format + 类型 + Django check + 测试
just probe data\corpus\PPM
just parse data\corpus\PPM
just chunk data\parsed
just index data\chunks
just search "What is an ORM?"
just answer "What is an ORM?"    # 需要本地 Ollama 在线
just gold                        # gold 冒烟 hit@5
just crawl                       # 校园 web 源爬取（用户执行；robots · 1 req/s · ≤500 页）
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
uv run python -m rag.gold gold\smoke.jsonl          # gold 冒烟：检索 hit@k
```

embedding 与 reranker（各 0.6B）在本机 GPU 跑，索引与检索完全离线；`rag.answer` 的生成一步调 OpenAI 兼容端点，默认**本地 Ollama**：

```powershell
winget install Ollama.Ollama                  # 或 https://ollama.com/download/windows
ollama pull qwen3:4b-instruct-2507-q4_K_M
```

M3 正式实验改 `.env` 指向服务器 vLLM 隧道（`ssh -L 8000:localhost:8000 <server>`）。端点与模型名在 `.env`（`LLM_BASE_URL` · `LLM_MODEL`）。分工依据见 [docs/architettura.md](docs/architettura.md) 算力策略一节。

## 代码布局

| 路径              | 内容                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------ |
| `config/`         | Django project：settings · urls · asgi/wsgi · env（`.env` 经 pydantic-settings 读入）        |
| `rag/`            | RAG pipeline — **禁止 import Django**，论文核心要能脱离 web 单独跑评估。`probe.py` 探测并路由，`parse.py` 调 Docling，`chunk.py` 切块并挂 payload，`index.py` 编码入 Qdrant，`search.py` hybrid 检索 + rerank，`llm.py` OpenAI 兼容客户端（Streamer/Completer + pydantic JSON 校验助手），`answer.py` 生成带引用回答，`gold.py` 检索冒烟跑分 |
| `tests/`          | pytest；`test_smoke.py` 守着上面那条约束和 Django 配置的完整性                                |
| `data/`           | 课程材料与派生产物（解析输出、Qdrant 本地索引），gitignore，**永不进 git**                    |

`apps/qa/`（DRF）与 `frontend/`（React SPA）🔜 M5，届时再建。

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
