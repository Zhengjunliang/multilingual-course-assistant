# multilingual-course-assistant

大学课程材料多语言问答：提问语言可以和材料语言不同（如英文提问、意大利语讲义）。基于 RAG 与开源权重 LLM（Qwen 系）；网站为 Django/DRF + Celery/Redis 后端 + React SPA 前端。

Triennale 毕业论文，佛罗伦萨大学（UniFi）信息工程 — relatore Prof. Marco Bertini。

## 状态

✅ M2 完成：ingest 全链（探测 + Docling 解析 + chunking + Qdrant 索引）与 hybrid 检索 + rerank 在**全量语料**（31 deck · 1234 chunk）上跑通，gold 40 题 hit@5 95%（对照组 5/5）；生成侧经本地 Ollama 实测（引用、意语跟随、语料外拒答），记录在 [docs/diario-sperimentale.md](docs/diario-sperimentale.md)。🔶 M2.5（UniFi 校园信息源 + agentic 路由）：实现完成，autogrow 分数门重测待记账。🔶 M5 网站（提前到 M3 之前执行）：地基层 + SSE 流式问答 API `/api/ask` 已可用（见下面「问答 API」一节）；React SPA 脚手架已建，开发期在 Vite dev server 上消费同一条流（见「前端」一节）；账号已接上（session 登录 + 开放注册），**全站需登录**（见「账号」一节）；多轮会话已可用（history + query rewriting + 落库，见「多轮会话」一节），SPA 已是成品界面（登录/注册页、会话侧栏、三语、暗亮主题，见「前端」一节）。同源部署与异步 ingest 🔜 后续 Stage。里程碑与阻塞项见 [ROADMAP.md](ROADMAP.md)；约束、技术栈与决策见 [docs/architettura.md](docs/architettura.md)。

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

- 管理后台在 <http://127.0.0.1:8000/admin/>；账号 API 在 `/api/auth/`、问答 API 在 `/api/ask`（都需要登录，见下面两节）
- Django 的根路径 `/` 仍无内容：[config/urls.py](config/urls.py) 只挂了 admin 与 api。问答界面在开发期由 Vite dev server 自己发（`just fe-dev` → <http://localhost:5173/>，见「前端」一节）；由 Django 发编译产物是 🔜 部署 Stage 的事

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
just check       # 完整 CI 链：前端链 + lint + format + 类型 + Django check + 测试

just fe-install  # npm ci（按 frontend/package-lock.json 装依赖）
just fe-dev      # SPA 开发服务器 http://localhost:5173/
just fe          # 前端链：biome + tsc + catalogue key 检查 + 生产构建

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

CI（[.github/workflows/ci.yml](.github/workflows/ci.yml)）在 push 与 PR 上跑同一条链外加 pip-audit 与 `npm audit --omit=dev` 两道依赖审计，用 `uv sync --locked` 与 `npm ci`，所以 `uv.lock` 与 `frontend/package-lock.json` 都必须跟着 commit。依赖更新手动管理（`uv lock --upgrade` / `npm update --prefix frontend` 后跑 `just check`）。

前端链在 CI 里**排在所有 Django 步骤之前**，不是随手排的：部署 Stage 起 `STATICFILES_DIRS` 会指向 `frontend/dist`，而那是不进 git 的构建产物，`check --deploy --fail-level WARNING` 会把「目录不存在」变成失败。`just check` 用 `check: fe` 依赖复现同一顺序。

## 前端

React + TypeScript SPA，Vite 构建，Tailwind + shadcn 风格组件（组件源码在仓库里，不是 npm 包），界面文案三语走 react-i18next。

```powershell
just fe-install   # 一次性
just up; just serve    # 终端 A：PostgreSQL + Django
just fe-dev            # 终端 B：http://localhost:5173/
```

四条路由：`/login` · `/register` · `/`（新会话）· `/c/:id`（打开某个会话）。**URL 决定打开哪个会话** —— 会话是个「地方」，能收藏、能分享给自己、后退键有意义，而不是藏在组件里的一个状态。新会话拿到 id 的那一刻（`start` 事件里）就 `replace` 到 `/c/<id>`，此时答案还在流。

Vite dev server 把 `/api`、`/admin`、`/static` 代理到 `127.0.0.1:8000`，且 **`changeOrigin: false`** —— 转发时保留 `Host: localhost:5173`，Django 的 CSRF origin 校验因此自然通过，不需要 `CSRF_TRUSTED_ORIGINS`。`/admin` 与 `/static` 两条代理留着是为了在 SPA 的 origin 上直接用管理后台。

**登录走 session cookie，不用 token**：SPA 与 Django 同源（开发期靠上面这条代理，部署后由 Django 直接发页面），浏览器自己的 cookie 罐就是全部机制。启动第一件事是 `GET /api/auth/me` —— 它同时回答「有没有人登录」和下发 CSRF cookie，之后每个非 GET 请求从 cookie 读 token 发 `X-CSRFToken`（[frontend/src/api/http.ts](frontend/src/api/http.ts)）。任何请求回 403 就丢掉会话、跳登录页：别处退登或服务端重启都是这个表现。

**不用 `EventSource`**：它只发 GET，而 `/api/ask` 是带 JSON 体的 POST。[frontend/src/api/sse.ts](frontend/src/api/sse.ts) 手写 `fetch` + `ReadableStream` 解析器，换来 `AbortController`（离开页面立刻掐断生成、归还后端的引擎锁）与流式 `TextDecoder`（一个中文字符会被劈在两个网络分片里）。

引用角标**只在 `end` 到达之后**才算：marker 常被劈在两个 `token` 事件里，边流边匹配会先报缺失再报错位。未被引用的来源卡片置灰，那是「检索到但答案没引」的信号。**实时轮次和从数据库读回的旧轮次走同一个组件**（[frontend/src/features/chat/TurnView.tsx](frontend/src/features/chat/TurnView.tsx)）—— 这正是 `citations` 与 `route` 要落库的原因，另建一条历史渲染路径就是给角标和置灰第二个出错的地方。

**排队诚实**：POST 发出那一刻就进「排队中」，因为读者真正感受的等待从那时开始（服务端一次只答一题，最多让下一题等 90 秒才拒绝）。`reason: "busy"` 才自动重试，**最多 2 次**然后停下来让人点；`reason: "unavailable"` 一次都不重试 —— 模型服务没在跑，再问也不会自己起来。

**主题（浅色/深色/跟随系统）存 `localStorage`，不存账号**：主题是「此刻这块屏幕」的属性，白天笔记本晚上手机的人在两边要的答案不一样。界面语言相反，它存在 `User.locale` 上，所以切语言是 `PATCH /api/auth/me`。整套配色是 [frontend/src/index.css](frontend/src/index.css) 里的一组语义变量（`--ink` `--surface` `--muted` …），**没有任何组件写 `dark:` 前缀** —— 换主题只换变量，一个组件因此不可能在一个主题下对、另一个主题下错。

[frontend/src/api/contract.ts](frontend/src/api/contract.ts) 是 [apps/qa/contract.py](apps/qa/contract.py) 的镜像，唯一源在 Python 侧；[tests/test_qa_contract.py](tests/test_qa_contract.py) 把镜像当纯文本读，逐个模型逐个字段断言它没漏，两侧因此不会静默漂移。

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

## 账号

**每个端点都要登录**，包括 `/api/ask`。理由不是保密（语料就是课程材料），是状态：会话属于某个人，匿名调用者没有身份可归属，而给他们发一个临时身份等于并排再造一套弱账号系统。

| 方法与路径 | 作用 |
| ---------- | ---- |
| `GET /api/auth/me` | 我是谁。**未登录也返回 200**，body 里 `{"authenticated": false}`；同时下发 CSRF cookie |
| `PATCH /api/auth/me` | 改界面语言（只有 `locale` 可写） |
| `POST /api/auth/login` | 用户名 + 密码 → session cookie |
| `POST /api/auth/logout` | 结束会话（204） |
| `POST /api/auth/register` | 开放自助注册，注册即登录（201） |

**`me` 未登录返回 200 而不是 403**：只配 `SessionAuthentication` 时 DRF 对未认证发的是 403 而非 401，而 CSRF 校验失败**也是** 403 —— 前端无法区分。把「没人登录」做成正常结果，403 就只剩一个意思：这个请求被拒了。

**CSRF token 只在 `GET /api/auth/me` 下发**，前端启动第一件事就调它：`ensure_csrf_cookie` 通常挂在渲染模板上，而开发期页面由 Vite 发、根本不经过 Django 模板。之后非 GET 请求从 `csrftoken` cookie 读值、发 `X-CSRFToken` 头。

**限流按端点分桶**（[config/settings.py](config/settings.py)）：`ask` 4 次/分钟（按账号）· `auth` 5 次/分钟（登录与注册共用一桶，按 IP —— 匿名调用者只有地址可记账）。⚠ **没有全局上限**：per-caller 限流管不住机器，5 个账号 × 4 次 = 20 次/分钟打进一个每分钟答约 2 题的引擎。真正的容量闸是 `QUEUE_TIMEOUT_SECONDS`。

`just superuser` 建的管理员同样能用这些端点。

## 问答 API

同一条链路的 HTTP 形式：`POST /api/ask`，路由 → 检索 → 生成。**回的是 SSE 事件流**（`text/event-stream`），不是一整块 JSON——一次生成要几十秒，边写边发才看得出系统在工作。没有非流式版本。前置条件和 CLI 一样——Ollama 在跑、`data/qdrant` 已索引——外加 `just up`、`just serve` 和一个账号。

```powershell
$json = @{ question = "What is an ORM?" } | ConvertTo-Json
[System.IO.File]::WriteAllText("$PWD\ask.json", $json, (New-Object System.Text.UTF8Encoding $false))
curl.exe -N -u <用户名>:<密码> -X POST http://127.0.0.1:8000/api/ask `
  -H "Content-Type: application/json" -H "Accept: text/event-stream" `
  --data-binary "@ask.json"
```

`-N` 不能省：不加的话 curl 自己缓冲，看起来仍是一次性返回。

**`-u` 走的是 HTTP Basic，而 Basic 只在 `DJANGO_DEBUG=true` 时启用**（[config/settings.py](config/settings.py) 里那行条件）。认证发生在限流之前（DRF 的 `APIView.initial`），所以密码猜错根本走不到限流那一步 —— 部署时留着它等于给每个端点开一个无限次的猜密码额度。浏览器不用它：SPA 走 session cookie。

**问题走文件而不是 `-d`**，哪怕是英文问题也照此写。PowerShell 把参数交给原生程序时按控制台编码转换，`学费` 与 `Università` 都会变成 `?`；`WriteAllText` + 无 BOM 的 `UTF8Encoding` 是唯一稳的写法。这是个多语言项目，只在示例里成立的写法等于错的写法。

看到的是：

```text
event: start
data: {"question":"What is an ORM?","conversation_id":7,"locale":"en","route":{...},"citations":[...]}

event: token
data: {"text":"An ORM "}

event: end
data: {}
```

可选 `locale`（BCP-47 primary subtag，如 `it`；省略则从问题里检测）与 `conversation_id`（见下面「多轮会话」）。事件契约在 [apps/qa/contract.py](apps/qa/contract.py)，它是唯一源：

| 事件 | 何时 | 内容 |
| ---- | ---- | ---- |
| `start` | 路由与检索之后、生成之前，一次 | `question` · `conversation_id`（这一答归档到哪个会话）· `locale`（实际生成语言）· `route`（复用 `rag.agent.RouteDecision`：`target` · `query` · `fresh` · `reason`）· `citations` |
| `token` | 生成期间，每片一次 | `text`，模型吐出来的原样片段 |
| `end` | 结尾，一次 | 空。**它到了才算答案完整** |
| `error` | 代替 `end` | `detail`，生成中途失败 |

**答案 = 所有 `token` 的 `text` 拼接**，别无其他：切分点由 tokenizer 决定，一个引用 marker 经常被劈成两半。

`citations` 是生成所依据的检索集，按检索顺序逐条，**不去重**（同一页的两个 chunk marker 相同但正文与分数不同；要合并由前端按 `marker` 分组）。每条：`marker`（模型被要求逐字复制的那个标记）· `text`（模型看到的原文）· `kind`（`slides` / `web`）· `score` · `heading_path` · `course` · `locale`，以及 slides 的 `source_file`+`page` 或 web 的 `url`+`fetch_date`。

**「这条被引用了吗」由客户端算**（`marker in answer`），服务端不提供这个字段：marker 常被劈在两个 `token` 事件里，只有拿到拼完的答案才判得准，而客户端本来就同时握着答案和 marker。4B 模型时常把 marker 缩写成 `[Excerpt 1]`，那就是没引用。

**首次请求慢**（约一分钟）：embedding 与 reranker 要加载进显存。之后常驻。**答案串行**：8GB 显存装不下两路并发的 rerank + 生成，所以端点一次只答一个问题。两道闸：`ask` 桶 4 次/分钟（按账号，见「账号」一节），以及排队上限 90 秒——超过就 503 带 `Retry-After`，而不是把连接吊到超时。**中途 Ctrl+C 掐断流会连带取消生成**，队列立刻让给下一个。

**状态码只在第一个字节之前有效。** 响应头随第一个事件一起发走，所以「生成端点半路死了」只能是 200 里的一条 `error` 事件；路由或检索阶段的失败仍是 503。

503 的 body 带 `reason`：`busy`（前面还有人在问，队列会自己空出来，值得重试）或 `unavailable`（模型服务没在跑，再问也不会自己起来）。没有这个字段客户端会对着一次宕机无限倒计时重试。

## 多轮会话

`POST /api/ask` 可带 `conversation_id` 把这一问接到上一问后面；不带就开一个新会话，新会话的 id 从 `start` 事件里回来。

```powershell
# 第一问不带 id -> start 事件里拿到 conversation_id
# 第二问带上它："How does it differ from Active Record?"
```

**最近 3 轮**（`HISTORY_WINDOW_TURNS`，[apps/qa/models.py](apps/qa/models.py)）随下一问一起进 prompt。窗口有上限不是省钱：4B 模型的上下文和「这一答赖以成立的检索片段」是同一块，历史挤掉片段就是把答案的根据挤掉。

两侧看到的历史**不一样**，这是刻意的：

- **路由器只看学生的历史提问**，不看答案。代词的先行词在学生自己上一句里；而答案里塞满 `[https://www.unifi.it/… · 2026-08-01]` 这类 marker，三轮下来会把任何新问题都往校园库拖。
- **生成侧看完整轮次**，但答案会截断到 400 字符并**去掉所有 marker** —— 那些 marker 指向的是上一轮的片段，这一轮模型手上没有，留着就是在教它编一个指不到东西的引用。

历史**永远拼成同一条 `user` 消息**，不做 role 交替的多轮消息。原因是同一个 4B 模型在路由时被要求「只输出一个 JSON 对象」，真实的 `assistant` 散文轮就是在示范相反的行为 —— 代价是 M2.5b 实测的 fallback 从 0 起飞，而且没有任何现成测试会发现。`tests/test_agent.py` 与 `tests/test_answer.py` 用两个 prompt 的 sha256 把这条钉死。

会话读取（都要登录，只能读自己的）：

| 方法与路径 | 作用 |
| ---------- | ---- |
| `GET /api/conversations` | 侧栏列表。标题由第一条提问派生，不落库；**没有任何消息的会话不列出**（503 会留下一个空会话，见下） |
| `GET /api/conversations/<id>` | 一个会话连同它的消息。别人的会话是 **404 而不是 403** —— 403 等于承认这个 id 指向真实存在的东西 |

**答案边流边存**：提问与空答案在第一个事件之后、`start` 发出之前写入（此前失败还能是 503，那时应该什么都不留下）；答案文本在流停下时补齐。流怎么停的决定 `complete` 是 true 还是 false —— 收到 `end` 为 true，`error` 或读者关掉页面为 false，**半截答案照样留着**。那是学生真实看到的内容，也是 M3 错误分类法的样本。

`citations` 与 `route` 跟着答案一起落库。侧栏点开旧会话时 `start` 事件早就没了，不存这两列的话历史轮次只剩纯文本 —— 来源卡片、引用角标、可见的路由决策三样全没。

错误按类型分：400 校验失败 · **403 没登录或 CSRF token 不对** · 429 限流 · 503 依赖不可用（路由端点没响应、索引被别的进程占着、还没索引过、前面的问题还没答完）。403 的两种含义靠 `GET /api/auth/me` 区分（见「账号」一节）。请求带 `Accept: text/event-stream` 时这些错误体也框成一条 `error` 事件；不带（curl 默认 `*/*`）就是普通 JSON。DRF 自带的校验消息跟随 `Accept-Language`（`LANGUAGE_CODE` 是 `it`，默认意大利语）；本项目自己的 503 与 `error` 文案已标记待译，但仓库还没有 `locale/` 目录，所以目前是英文。

**深挖循环（`deepen`）不在这个端点里**：它会联网抓页并写入共享索引，最多 3 次抓取。演示自增长仍用 CLI 的 `just ask`。它进 web 的路径是「账号 + Celery 异步」，见 [ROADMAP.md](ROADMAP.md)。

## 代码布局

| 路径              | 内容                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------ |
| `config/`         | Django project：settings（单一模块，安全响应头按 `DEBUG` 与 `DJANGO_BEHIND_TLS` 条件生效）· urls · asgi/wsgi · env（`.env` 经 pydantic-settings 读入，`rag/` 与 Django 两侧共用） |
| `apps/accounts/`  | 账号。自定义 User（`AUTH_USER_MODEL`）= `AbstractUser` + `locale`（偏好语言，取值域对齐 `settings.LANGUAGES`），admin 里可见可筛；`serializers.py` 注册/登录/账号表示 · `views.py` session 登录与 CSRF cookie 发放点 |
| `apps/qa/`        | 问答 API。`contract.py` SSE 事件契约（唯一源，SPA 消费它）· `serializers.py` 请求校验与会话读取形状 · `models.py` `Conversation` / `Message` + 历史窗口常量 · `conversations.py` 这条链路**唯一**的 ORM 落点（开会话 / 切历史 / 落库 / 收尾）· `engine.py` 进程级模型资源 + 串行的 `stream_answer()`（路由→检索→生成，复用 `rag/`，不重写逻辑；锁随流的关闭释放，**零查询**）· `views.py` HTTP 翻译、SSE 分帧、答案落库时机 · `conversation_views.py` 会话读取端点 |
| `rag/`            | RAG pipeline — **禁止 import Django**，论文核心要能脱离 web 单独跑评估。`probe.py` 探测并路由，`parse.py` 调 Docling，`crawl.py` 抓校园 web 源快照 + registry，`webparse.py` 快照转可切块工件，`chunk.py` 切块并挂 payload，`index.py` 编码入 Qdrant，`search.py` hybrid 检索 + rerank，`llm.py` OpenAI 兼容客户端（Streamer/Completer + pydantic JSON 校验助手），`answer.py` 生成带引用回答，`agent.py` 路由问题到课程库/校园库（只读控制流），`gold.py` 检索冒烟跑分与 `--routing` 路由报告，`golddraft.py` 起草 gold 题（人工把关后才进 `gold/`） |
| `frontend/`       | React + TypeScript SPA（Vite）。`src/api/` 契约镜像 · SSE 解析器 · CSRF 与 JSON 请求 · 账号与会话调用 · `src/auth/` 会话上下文与路由守卫 · `src/routes/` 登录 / 注册 / 聊天页 · `src/features/chat/` 提问状态机（排队、重试、中止）与轮次渲染 · `src/lib/markers.ts` 引用角标与置灰判定 · `src/theme/` 主题 · `src/i18n/` 三份 catalogue · `src/components/ui/` shadcn 风格组件（源码在仓库里）。自带 biome + tsc + catalogue 检查，`just fe` 一条跑完 |
| `tests/`          | pytest；`test_smoke.py` 守着上面那条约束和 Django 配置的完整性，`test_qa_contract.py` 守着 SSE 契约与它的 TS 镜像不漂移，`test_qa_engine.py` **不带 `django_db`**，用「没有 marker 的测试碰数据库就报错」这条 pytest-django 规则守着引擎层零查询 |
| `data/`           | 课程材料与派生产物（解析输出、Qdrant 本地索引），gitignore，**永不进 git**                    |

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
