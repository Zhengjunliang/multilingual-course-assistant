# multilingual-course-assistant

大学课程材料多语言问答：提问语言可以和材料语言不同（如英文提问、意大利语讲义）。基于 RAG 与开源权重 LLM（Qwen 系）；网站为 Django/DRF + Celery/Redis 后端 + React SPA 前端。

Triennale 毕业论文，佛罗伦萨大学（UniFi）信息工程 — relatore Prof. Marco Bertini。

## 状态

🔶 M2 进行中：项目骨架与工程化链就位，ingest 走到解析这一步（探测 + Docling），尚无 chunking、检索与 web 业务逻辑。里程碑与阻塞项见 [ROADMAP.md](ROADMAP.md)；约束、技术栈与决策见 [docs/architettura.md](docs/architettura.md)。

## Setup

```powershell
git clone git@github.com:Zhengjunliang/multilingual-course-assistant.git
cd multilingual-course-assistant
uv sync                       # uv 自带 Python 3.12，不动系统的 3.10
Copy-Item .env.example .env   # 填 DJANGO_SECRET_KEY，命令见文件内注释
uv run pre-commit install
```

## 开发

```powershell
uv run ruff check .                # lint
uv run ruff format .               # format
uv run pyright                     # 类型检查
uv run pytest                      # 测试
uv run python manage.py check      # Django system checks
```

CI（[.github/workflows/ci.yml](.github/workflows/ci.yml)）在 push 与 PR 上跑同一条链，用 `uv sync --locked`，所以 `uv.lock` 必须跟着 commit。

## Ingest（课程材料 → Markdown）

课程 PDF 放 `data/corpus/<课程>/`（gitignore）。解析前先探测、逐份文件选配置，不需要手动指定：

```powershell
uv run python -m rag.probe data\corpus\PPM                       # 只看画像与路由结果，不解析
uv run python -m rag.parse data\corpus\PPM                       # 按路由解析整个目录 -> data\parsed\
uv run python -m rag.parse "data\corpus\PPM\<slides>.pdf" --profile manual --pipeline vlm
```

输出文件名带配置（`<名>.classic.md` · `.classic-formula.md` · `.vlm.md`），同一份 PDF 的不同配置不互相覆盖，便于对比。路由规则与实测见 [docs/docling-e-pipeline.md](docs/docling-e-pipeline.md)。

## 代码布局

| 路径              | 内容                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------ |
| `config/`         | Django project：settings · urls · asgi/wsgi · env（`.env` 经 pydantic-settings 读入）        |
| `rag/`            | RAG pipeline — **禁止 import Django**，论文核心要能脱离 web 单独跑评估。`probe.py` 探测并路由，`parse.py` 调 Docling |
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
