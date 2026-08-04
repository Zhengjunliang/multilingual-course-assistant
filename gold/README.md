# Gold set — 冒烟版（M2）

30–50 个 EN→EN 问答对，人工撰写。用途：chunk 大小 / top-k / prompt 的调参依据 —— 没有它，M2 所有调参决定都是盲做。M3 扩为全量（决策与流程归 [ROADMAP.md](../ROADMAP.md)）。

## 存放

- **问题 + 页码引用**：本目录 `smoke.jsonl`，进 git（本人撰写，无版权问题）。
- **参考答案**（含课件原文摘录）：`data/gold/answers/<id>.md`，gitignore，**永不进 git**。

## 格式

`smoke.jsonl` 一行一题：

```json
{"id": "q001", "locale": "en", "question": "...", "source_file": "2-orm_django_2025.pdf", "page": 12, "answer_ref": "data/gold/answers/q001.md"}
```

| 字段 | 说明 |
| --- | --- |
| `id` | `q` + 三位序号，唯一 |
| `locale` | 提问语言；冒烟版全部 `en`，M4 起出现 `it`/`zh` |
| `question` | 学生视角的自然提问，不抄课件原句 |
| `source_file` | 答案所在 PDF 文件名（`data/corpus/PPM/` 下的原名） |
| `page` | 答案主要出处页（1-based，与 chunk payload 的 `page` 同义） |
| `answer_ref` | 参考答案文件相对仓库根的路径 |

## 撰写规则

1. 每题必须能在 `source_file` + `page` 指向的位置找到依据；写题时先翻到那一页。
2. 按文件/主题分层：31 份 deck 尽量都有题，避免题目只覆盖解析得好的部分。
3. 问题风格多样化：定义（what is）、对比（difference between）、操作（how to）、代码理解各占一部分。
4. 参考答案写要点 + 课件原文摘录（便于人工判卷），不写成完整作文。
5. 一题一个主出处；确实跨页的，`page` 取起始页，答案文件里注明其余页码。
