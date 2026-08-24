# Gold set — 冒烟版（M2）+ campus（M2.5）

`smoke.jsonl`：30–50 个 EN→EN 问答对，人工撰写，chunk 大小 / top-k / prompt 的调参依据。M3 扩为全量（决策与流程归 [ROADMAP.md](../ROADMAP.md)）。

campus 集（M2.5，LLM 起草 → Claude 逐题核对 → 人工按 URL 抽查定稿）：

- `campus.jsonl` — 校园信息题（it/en/zh 混合），按 URL 判分；验收门 EN/IT hit@5 ≥ 0.80，ZH 单独报告
- `campus-autogrow.jsonl` — 答案页**故意不在库里**的题（含 modulo PDF 题），M2.5b 自增长验收用（先 0/N，跑完流程 ≥⌈0.7N⌉），PR1 不跑分
- `relevance-gate.jsonl` — M2.5b 相关性门标注集（见下方专节；**非本页 GoldQuestion schema，不可传给 `rag.gold`**）

## 存放

- **问题 + 引用**：本目录 `*.jsonl`，进 git（问题为原创撰写，无版权问题）。
- **参考答案**（含课件/网页原文摘录）：`data/gold/answers/<id>.md`，gitignore，**永不进 git**。

## 格式

`smoke.jsonl` 一行一题：

```json
{"id": "q001", "locale": "en", "question": "...", "source_file": "2-orm_django_2025.pdf", "page": 12, "answer_ref": "data/gold/answers/q001.md"}
```

| 字段 | 说明 |
| --- | --- |
| `id` | `q` + 三位序号，唯一 |
| `locale` | 提问语言；冒烟版全部 `en`，跨语言题（`it`/`zh`）🔜 M2.5/M3 |
| `question` | 学生视角的自然提问，不抄课件原句 |
| `source_file` | 答案所在 PDF 文件名（`data/corpus/PPM/` 下的原名）；campus 题省略（默认 `""`） |
| `page` | 答案主要出处页（1-based，与 chunk payload 的 `page` 同义）；campus 题省略（默认 `0`） |
| `answer_ref` | 参考答案文件相对仓库根的路径 |
| `target` | 路由标签（agent 应查哪个库）；可省，默认 `slides`；campus 题写 `unifi_web` |
| `urls` | campus 题的 ground truth：命中 = top-k 里任一 web chunk 的 `url` ∈ 此列表（尾斜杠不敏感）。带 `urls` 的题按 URL 判分，不看 `source_file`/`page`。同一答案存在于多个页面时列出所有**核实过的**等价页（多参考；只加验证过含答案的页，不加"检索碰巧返回的"页） |

## relevance-gate.jsonl（M2.5b 相关性门标注集）

**不是 GoldQuestion**：缺 `id`/`question`/`answer_ref` 必填项，传给 `uv run python -m rag.gold` 会校验报错。唯一消费方 = M2.5b Stage 7 相关性门质量测量（真机 ≥18/20，先 commit 冻结再测）。20 条 URL 全部取自 `data/webcorpus/registry.jsonl` 出链图的未爬候选（LLM 起草 → Claude 逐条核对 → 用户抽查定稿）。

```json
{"url": "https://...", "label": "relevant", "note": "为何该入库/不该入库"}
```

| 字段 | 说明 |
| --- | --- |
| `url` | 待判定页面；10 相关（含 DSU/CISIA/PDF 边界例）+ 10 无关（含商业页与 unifi 域内登录页硬负例） |
| `label` | `relevant`（应持久入库）/ `irrelevant`（不入库）——判据是「内容值得进校园 KB」，不是域名 |
| `note` | 标注理由，人工抽查与 M3 错误分析用 |

## 撰写规则

1. 每题必须能在 `source_file` + `page` 指向的位置找到依据；写题时先翻到那一页。
2. 按文件/主题分层：31 份 deck 尽量都有题，避免题目只覆盖解析得好的部分。
3. 问题风格多样化：定义（what is）、对比（difference between）、操作（how to）、代码理解各占一部分。
4. 参考答案写要点 + 课件原文摘录（便于人工判卷），不写成完整作文。
5. 一题一个主出处；确实跨页的，`page` 取起始页，答案文件里注明其余页码。
