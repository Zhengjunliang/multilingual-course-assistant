# RAG 分析 — relatore 链接的扩展

M1 交付物（relatore 明确要求，2026-07-28 邮件：«espanda l'analisi di RAG/risposte dai link»）。作为关闭 [architettura.md](architettura.md) 中 🔒 «RAG 路线»决策的输入。来源见文末。

## 1. Qwen-Agent 的 RAG 模块

结构：`DocParser` 把 PDF/DOCX/PPTX/HTML/CSV/XLSX 转成记录，按 `parser_page_size` 分块（默认 500 token）；检索是**纯 BM25**（`rank_bm25` 库），上下文上限 `max_ref_token`（默认 20 000）。检索策略可经 `rag_searchers` 配置（keyword、front-page、混合）；默认关键词生成（`SplitQueryThenGenKeyword`）分解 query 并产出**中英双语**关键词。在 `Assistant` 代理中默认启用（`pip install "qwen-agent[rag]"`）。自称 «lightweight»：**无 embedding、无向量库**。

对论文的批判性解读：

- BM25 = **词汇**匹配：意大利语提问和英语材料词汇不重叠 → 论文核心场景（跨语言）**结构性失效**。
- 关键词生成的双语是 zh/en，不是意大利语。
- 优点：零基础设施，最快上手。缺点：无语义检索，embedding 尺寸研究无从谈起。
- **对论文的真实价值：词汇基线** — 实验章节里被语义检索打败的对照组（BM25 vs 语义检索是经典对比）。

## 2. Qwen3 全家桶：embedding + reranker + LLM

Qwen3-Embedding 与 Qwen3-Reranker 系列：两者都有 **0.6B / 4B / 8B** 三档，Apache 2.0，**100+ 语言**，显式声明 **cross-lingual** 能力，instruction-aware（prompt 里可指定任务/语言），支持 MRL（向量维度可缩减）。基准：embedding 8B 位列 MTEB multilingual 榜首（70.58，2025 年 6 月）；reranker 8B MTEB-R 约 69.8（relatore 给的 Medium 文章数字略有出入；以 Qwen 官方博客为准）。

经典 pipeline：query → embedding 检索 → reranking → LLM 生成。

对论文而言这是**架构核心**：

- 跨语言检索发生在 embedding 向量空间里，query 和材料**都不需要翻译**。
- 三档尺寸 × 三个角色（embedding、reranker、LLM）正好构成 relatore 要的成本/质量实验网格。

## 3. «Agentic» RAG（Lightning 模板）

模板页面未登录不可读（JS 加载）；按作者公开材料：代理查询向量库、检索不足时 **fallback 到 web 搜索**。«agentic RAG» 的一般模式：LLM 编排检索 — 决定*是否*检索、改写 query、评估片段相关性、迭代。

对论文：

- web fallback **出域**（课程材料是封闭源；来自 web 的回答不是"课程的回答"）。
- 路由/自检增加 LLM 调用 → 延迟和成本上升，评估可复现性下降。
- 定位为 baseline 稳定后的**可选扩展**（如带理由的拒答"材料中不存在"），不是起点。

## 4. Granite-Docling（文档解析）

`granite-docling-258M`：紧凑 VLM（约 0.3B，Idefics3 架构：siglip2 视觉编码器 + Granite 165M LM），Apache 2.0。输出 **DocTags** — 保留版面语义的标记语言，可导出 Markdown/HTML；表格（OTSL）、公式（LaTeX）、代码、阅读顺序。集成在 `docling` 库的 `VlmPipeline`（模型自动下载）。多语言**实验性**（日语、阿拉伯语、中文），英语为主 — **未提及意大利语**：必须用真实 slide 验证。注意：MICC 显卡（2080 Ti / Titan RTX）都是 Turing 架构，**无 bfloat16**，跑 VLM 要显式用 fp16。

- `docling` 库还有经典非 VLM pipeline，对数字版 PDF 已经很稳；VLM 主要针对扫描件和复杂版面。
- 对论文：材料多为 slide PDF → 解析质量决定下游一切。最小实验里要在同一份课程 PDF 上**两条 pipeline 都跑**。

Docling 架构、DocTags、chunking 与两条 pipeline 的原理讲解见 [docling-e-pipeline.md](docling-e-pipeline.md)（本文件只做路线分析，不重复原理）。

## 架构启示

1. **Embedding-first**：跨语言靠多语言 embedding，不靠翻译（翻译是 relatore 说的可选第二阶段）。
2. 天然实验变量：embedding 尺寸 × reranker 尺寸 × LLM 尺寸，度量回答质量与成本（时间/显存）。
3. BM25（经 Qwen-Agent 或直接 `rank_bm25`）作为对照基线。

## 路线对比（🔒 决策的输入）

| 标准                 | 轻量自建 pipeline        | Qwen-Agent RAG      | LlamaIndex          |
| -------------------- | ------------------------ | ------------------- | ------------------- |
| 实验可控性（论文）   | 完全                     | 差（BM25 固定）     | 中（抽象层厚）      |
| 跨语言               | 原生（Qwen3-Embedding）  | 弱                  | 可行（插件）        |
| 基础设施需求         | 极小（轻量向量库）       | 无                  | 中                  |
| 论文中的可解释性     | 高（每步都是自己的代码） | 中                  | 中低                |
| 起步速度             | 中                       | 高                  | 高                  |

带去 Meet 的提案：**轻量自建 pipeline**（docling → chunk → Qwen3-Embedding → rerank → Qwen3）为主系统，**Qwen-Agent/BM25 做实验基线**；LlamaIndex 仅当需要现成组件时考虑（LlamaIndex 有 Docling reader）。拍板结果与当前状态见 [architettura.md](architettura.md) 决策表（本文件是 M1 分析记录，不是决策属主）。

## 最小实验提案（M1）⛔ 已否决

⛔ 2026-07-31 决定**不做**本节的一次性最小实验：Docling 的解析质量（重音字符、公式、表格、多栏阅读顺序）与 Qwen3 推理直接在 M2 的真实 ingest 管线里验证——同样的投入产出论文可引用的证据，而不是用完即弃的 notebook。M2 实测（[diario-sperimentale.md](diario-sperimentale.md)）证实该验证路径成立。提案原文保留如下，仅作 M1 分析记录：

在 MICC 服务器上，一个 notebook：

1. 一份真实课程 PDF → `docling` 经典 pipeline **和** `VlmPipeline`（granite-docling）；对比意大利语 Markdown 质量。
2. 简单 chunking → Qwen3-Embedding-0.6B → 内存索引（FAISS 之类）。
3. 5–10 个意大利语问题 → top-k → Qwen3 4B 生成回答 → 人工检查。
4. （时间允许）同样的问题换英文问 → 跨语言的第一次非正式测量。

预期产出：确认解析和检索在意大利语上成立，为 Meet 上的路线决策提供实际数据。

## 来源

relatore 链接（2026-07-28 邮件）及本分析使用的补充来源，纯文本（仓库外）：

- `https://qwenlm.github.io/Qwen-Agent/en/guide/core_moduls/rag/`
- `https://medium.com/@marketing_novita.ai/qwen-3-in-rag-pipelines-all-in-one-llm-embedding-and-reranking-solution-619fe1acfe11`
- `https://lightning.ai/akshay-ddods/templates/agentic-rag-powered-by-qwen-3`（未登录不可读；模式按作者公开材料重构，repo `github.com/patchy631/ai-engineering-hub`）
- `https://www.ibm.com/new/announcements/granite-docling-end-to-end-document-conversion`（403；改用官方 model card）
- `https://qwenlm.github.io/blog/qwen3-embedding/`（Qwen3-Embedding/Reranker 官方博客）
- `https://huggingface.co/ibm-granite/granite-docling-258M`（官方 model card）
