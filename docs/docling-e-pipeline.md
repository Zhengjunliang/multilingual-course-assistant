# Docling 与 RAG Pipeline — 原理笔记

面向开发前的概念梳理。决策结论不在这里（属主是 [architettura.md](architettura.md)），路线对比不在这里（属主是 [analisi-rag.md](analisi-rag.md)）。本文只回答：**每个环节在干什么、为什么需要它、本项目怎么落。**

## 1. 全景：RAG 是两条 pipeline，不是一条

初学最容易糊涂的点：「RAG pipeline」这个词被用来指两件不同的事。它们运行时机不同、失败方式不同、评估方式也不同。

```mermaid
flowchart LR
    subgraph Offline["离线 · Ingest pipeline（材料进来时跑一次）"]
        A[课程 PDF] --> A0[探测 · 选解析配置]
        A0 --> B[Docling 解析]
        B --> C[Chunking 切块]
        C --> D[Embedding 向量化]
        D --> E[(Qdrant 索引<br/>dense + sparse)]
    end
    subgraph Online["在线 · Query pipeline（每次提问都跑）"]
        Q[用户问题] --> QE[问题向量化]
        QE --> R[Hybrid 检索 top-k]
        E -.读取.-> R
        R --> RR[Reranker 重排 top-n]
        RR --> P[拼 Prompt]
        P --> L[Qwen3 生成]
        L --> ANS[回答 + 来源引用]
    end
```

三条心法：

- **Ingest 的错误会被永久固化。** PDF 解析把 `perché` 读成 `perche`、把两栏读成一栏，之后再强的 LLM 也救不回来 —— 索引里就是错的。所以 ingest 的第一步就是验证解析质量，顺序不能反。
- **在线部分是线性流水线。** 没有循环、没有条件跳转、没有「模型自己决定下一步」。这一点直接决定了第 5 节的框架取舍。
- **LLM 是最后一步，也是最不重要的一步。** 检索没召回正确片段，生成阶段只能编。论文里 M3 的 RAGAS 指标之所以要分开测 *context precision/recall*（检索）和 *faithfulness*（生成），就是为了把锅分清楚。

## 2. Docling：把 PDF 变成结构化文档

### 2.1 它解决什么问题

PDF 不是文档格式，是**打印指令格式**。文件里存的是「在坐标 (x, y) 用某字体画字符 e」，没有「这是标题」「这是表格第 2 行第 3 列」「这一栏读完读右边那栏」的概念。`pypdf` 之类的库抽出来的文本，多栏 slide 会左右交错，表格会塌成一行乱码，公式会碎掉。

Docling 做的是**文档理解**：还原版面结构、阅读顺序、表格网格、公式、图片标题，输出一个带层级的对象树 `DoclingDocument`。

### 2.2 架构

```mermaid
flowchart TD
    SRC[输入文件<br/>PDF / DOCX / PPTX / HTML] --> DC[DocumentConverter<br/>调度器]
    DC --> BE[Backend<br/>格式相关的原始解析]
    BE --> PIPE{Pipeline}
    PIPE -->|经典| SP[StandardPdfPipeline<br/>layout + TableFormer + OCR]
    PIPE -->|视觉| VP[VlmPipeline<br/>granite-docling-258M]
    SP --> DOC[DoclingDocument<br/>统一文档模型]
    VP --> DOC
    DOC --> EXP[export_to_markdown / json]
    DOC --> CHK[Chunker<br/>HybridChunker]
    CHK --> OUT[chunks + 元数据<br/>标题链 · 页码 · bbox]
```

五个角色分清楚就不会乱：

| 角色 | 职责 | 会碰到的类 |
| --- | --- | --- |
| DocumentConverter | 入口调度：按格式选 backend 和 pipeline | `DocumentConverter` |
| Backend | 格式相关的原始解析（PDF 页面、字符、图元） | 自动选，一般不碰 |
| Pipeline | 编排模型推理，产出结构 | `StandardPdfPipeline` / `VlmPipeline` |
| DoclingDocument | **统一文档模型**，下游一切的唯一源 | `.document` |
| Chunker / Serializer | 切块喂给 embedding；或导出 Markdown/JSON | `HybridChunker` |

关键点：**`DoclingDocument` 是中间表示**。不管前面走哪条 pipeline、输入是 PDF 还是 PPTX，下游代码只面对同一个对象 → ingest 代码写一次，换 pipeline 只改配置。这正是能对两条 pipeline 做 A/B 对比却不用写两套 ingest 代码的原因。

### 2.3 两条 pipeline

```mermaid
flowchart LR
    subgraph Classic["经典 pipeline · CPU 可跑"]
        C1[页面渲染] --> C2[Layout 模型<br/>识别块类型与阅读顺序]
        C2 --> C3[TableFormer<br/>表格网格结构]
        C3 --> C4[OCR 仅扫描页]
        C4 --> C5[公式 / 代码 富化]
    end
    subgraph Vlm["VLM pipeline · 需要 GPU"]
        V1[整页图片] --> V2[granite-docling-258M<br/>约 0.3B VLM]
        V2 --> V3[DocTags 序列]
    end
```

| 维度 | 经典 pipeline | VlmPipeline（granite-docling） |
| --- | --- | --- |
| 原理 | 多个专用小模型串联，每步职责单一 | 一个视觉语言模型端到端「看图写标记」 |
| 算力 | CPU 可跑，本地笔记本够用 | 实际要 GPU；MICC 的 Turing 卡无 bfloat16，须用 fp16 |
| 数字版 PDF | 已经很稳，是默认选择 | 未必更好，且慢 |
| 扫描件 / 复杂版面 | 依赖 OCR 质量，易错 | 强项 |
| 可调试性 | 每步中间产物可看，出错能定位到具体模型 | 黑盒；错了只能换提示或换模型 |
| 失败模式 | 结构错（栏序、表格边界） | 幻觉（生成原文里没有的内容） |
| 语言覆盖 | OCR 引擎决定 | 英语为主，日/阿/中标为实验性，**意大利语未声明** |

方向：**数字版 slide 走经典 pipeline，VLM 作为对照与扫描件兜底**。这跟 remote-first 的算力策略一致 —— 经典 pipeline 是纯 CPU，本地迭代快，不占共享 GPU。

### 2.4 DocTags：为什么不直接输出 Markdown

granite-docling 不吐 Markdown，吐 **DocTags** —— 一种保留版面语义的标记语言。原因：Markdown 是**有损**的。Markdown 表达不了「这个标题在第 2 页、坐标 (120, 340)」，也表达不了合并单元格的表格。而 RAG 恰恰需要这些：

- **引用溯源**：回答里要给出「来源：第 12 页」，需要 provenance。
- **表格**：DocTags 用 OTSL 编码表格结构，能表达跨行跨列；Markdown 表格做不到。
- **公式**：输出 LaTeX；代码块保留语言。

所以链路是 `DocTags → DoclingDocument → 按需导出 Markdown`。Markdown 是最终展示格式，不是中间格式。中间格式必须无损，这是通用原则。

### 2.5 Chunking：Docling 也管切块

LLM 上下文有限，且检索粒度不能是「整份 PDF」。切块策略直接决定检索质量。

- **HierarchicalChunker**：按文档结构切，一个元素一个 chunk（列表项会合并），自动带上所属标题链和图表标题。
- **HybridChunker**：在前者基础上加 **tokenizer 感知**的两遍精修 —— 先把超长 chunk 按 token 数切开，再把共享同一标题链的过短相邻 chunk 合并。**本项目用这个。**

两个必须理解的细节：

1. **tokenizer 要跟 embedding 模型对齐。** HybridChunker 接收传入的 tokenizer；传错了，切出来的块会超出 Qwen3-Embedding 的输入上限而被静默截断 —— 尾部内容永远检索不到，且不报错。这是最阴险的一类 bug。
2. **`contextualize()`**：返回「元数据富化后的」chunk 文本，即 `标题链 + 正文`。为什么重要：slide 上一句孤立的 `Complessità: O(n log n)` 毫无检索价值，加上标题链 `Algoritmi di ordinamento > Merge sort > Analisi` 之后，语义向量才落在对的位置。**永远用 `contextualize()` 的输出去做 embedding，不要用裸文本。**

每个 chunk 自带的元数据（标题链、页码、bbox、表格上下文）直接决定了前端能不能做「点击引用跳到原 slide 第几页」。

### 2.6 代码形状

```python
from docling.document_converter import DocumentConverter
from docling.chunking import HybridChunker

doc = DocumentConverter().convert("slides.pdf").document   # -> DoclingDocument
chunker = HybridChunker(tokenizer=embedding_tokenizer)     # aligned with Qwen3-Embedding
for chunk in chunker.chunk(doc):
    text = chunker.contextualize(chunk)   # heading path + body -> embedding input
    meta = chunk.meta                     # page / headings / provenance -> payload
```

命令行快速试：`docling slides.pdf`（经典）· `docling --pipeline vlm --vlm-model granite_docling slides.pdf`（VLM）。

### 2.7 要盯的验证点

按 2026-07-31 的语料实测（事实见 [architettura.md](architettura.md) 语料一节）排的优先级：

1. **词间空格**：pypdf 抽出来是 `"Video isa sequenceof framesconsecutivelytransmitted"`，词全粘在一起。Docling 修不修得好决定 BM25 还能不能用 —— 这是本语料最严重的问题。
2. **连字（ligature）**：`micc.uniﬁ.it` 里的 `ﬁ` 是单字符 U+FB01。不归一化成 `fi`，字面检索必漏。`ﬂ` 同理。
3. **重音字符**：`à è é ì ò ù`，意大利语那 8 份里必然出现 —— 坏掉则 BM25 精确匹配全废。
4. **多栏阅读顺序**：slide 常见两栏，顺序错了会把不相干的两句粘成一个 chunk。
5. **图片型页面**：`3.5-HTML5-Part-2` 文字都在图里，经典 pipeline 大概率交白卷 → VlmPipeline 的对照样本。
6. **表格与公式**：单元格边界、合并单元格；视频编码那几份公式密集。
7. **页眉页脚重复文本**：每页都有的课程名会污染每个 chunk。

实测结果 ✅（2026-07-31，经典 pipeline，`rag/parse.py`，4 份样本）：

| 验证点 | 结果 |
| --- | --- |
| 词间空格 | **修好**。pypdf 的 `"Video isa sequenceof frames"` → Docling 的 `"Video is a sequence of frames"` |
| 重音字符 | 正常：`più` · `è` · `ambiguità` · `può` |
| 表格 | 结构还原成真 markdown 表格，边界正确 |
| 标题层级 | 识别出 `##` 层级 → `contextualize()` 有标题链可用 |
| 连字 | **验证通过**。31 份原始 PDF 中 17 份的文字层带连字（`1-intro_django` 74 处 · `2-orm_django` 97 处 · `3.1-web-intro-html` 88 处，含 `micc.uniﬁ.it`）；解析后这三份的 U+FB00–FB04 残留全为 **0**，且 `non-proﬁt` → `non-profit` · `conﬁgured` → `configured` · `deﬁning` → `defining` 逐词还原 —— `normalize_text()` 的 NFKC 在真实数据上有效 |
| 图片型页面 | `3.5-HTML5-Part-2` 即使开 OCR 仍主要是 `<!-- image -->` 占位 → 交给 VlmPipeline |
| HTML 标签转义 | **不一致**：正文 `&lt;div&gt;`，表格内裸 `<header>`。web 课程语料里搜 `<nav>` 可能受影响，待 chunking 后评估 |
| 公式 | 富化关：**全丢**（见下）。富化开：`2.1` 产出 4 个 `$$` LaTeX 块，CIE RGB→XYZ 矩阵的数值正确还原 |
| 图片 | 一律 `<!-- image -->` 空占位，**死 chunk 是本语料最大的检索缺口**（见下表） |

公式富化实测（2026-08-02，`2.1 IMAGES GENERAL CONCEPTS`，35 页）：

| | `classic` | `classic-formula` |
| --- | --- | --- |
| `<!-- formula-not-decoded -->` | 1 | **0** |
| `$$…$$` LaTeX 块 | **0** | **4** |
| `<!-- image -->` | 53 | 53（无副作用） |

**最值得记的一条：`formula-not-decoded` 的计数严重低估了损失。** 基线只留了 1 个占位符，但开启富化后出来 4 个公式 —— 也就是说另外 3 个公式在基线里**连占位符都没有，被静默丢弃**。靠数占位符来判断"公式丢了多少"是错的，只能靠开一次富化去比。

两处**没有**被救回，与预期一致：`Y ê ê ú ú = X Z é ê ù ú` 这类矩阵（Symbol 字体的大括号字形）和整张变 `......` 的 `XYZ-RGB transformations` 表 —— 它们被 layout 判成 **table** 而非 formula，走的不是富化路径。这是经典 pipeline 的已知损失，VlmPipeline 是唯一可能的补救。

LaTeX 质量诚实记录：矩阵数值（0.4887180 · 0.3106803 · …）与 CIE 标准矩阵一致，但模型在两侧多生成了 `\hat{e}_i \hat{e} =` 和 `\hat{e}_i \hat{e}^i` 这样原文没有的符号。**这是 VLM 的固有失败模式（幻觉），不是配置错误** —— 数值可信，符号外壳需要在引用时留心。

#### 死 chunk 实测（9 份抽样，约 322 页，经典 pipeline）

"死 chunk" = 一个标题下除了 `<!-- image -->` 占位之外没有任何正文的 section。它进索引后既召不回也答不出。

| 抽样文件 | 图片占位 | 死 section |
| --- | --- | --- |
| `1-intro_django_2026`（65p） | 117 | 5 |
| `1.1 Course intro 2025`（11p） | 9 | 6 |
| `1.2 Where ICT goes 2025`（36p） | 53 | 8 |
| `2-orm_django_2025`（46p） | 102 | 9 |
| `2.1 IMAGES GENERAL CONCEPTS`（35p） | 53 | 6 |
| `2.2 IMAGES LOSSLESS COMPRESSION`（38p） | 11 | 4 |
| `3.1b VIDEO GENERAL CONCEPTS`（31p） | 22 | 4 |
| `3.5-HTML5-Part-2`（32p，`classic-ocr`） | 19 | **19** |
| `HTML5_tag_semantici`（28p） | 15 | 2 |
| **合计** | **401** | **63** |

死掉的不是边角内容，正是课程主干：`Django's ORM (Object-Relational Mapping)` · `CRUD examples` · `Create a basic View` · `Components of a Database` · `Overview Client-Server Interaction`。学生问"Django 的 ORM 怎么用"，索引里对应的块是空的。

`3.5-HTML5-Part-2` 的 19/19 是极端情形 —— 每一个 section 都是死的，这正是路由把它判去 VLM 的原因。

**这组数字是 M3 图片描述消融实验的基线**：带 / 不带 `do_picture_description` 的 RAGAS 差值，分母就在这里。

OCR 的取舍（实测，同一份 28 页意大利语 slides）：开 43.8s / 关 27.0s，**产出字符完全相同（11040）**。语料 31 份全有文字层 → `rag/parse.py` 把 `do_ocr` 默认设为 `False`，与 Docling 自身默认相反。唯一例外是图片型的 `3.5`：开 OCR 花 527s，但抽取量从 pypdf 的 10001 涨到 20032，值这个钱。

### 2.8 自适应路由：谁来决定每份文件用哪套配置

上一节的验收暴露了一个比"某个字符没抽对"更根本的问题。`2.1 IMAGES GENERAL CONCEPTS`（35 页）解析出来有 **53 个 `<!-- image -->`、1 个 `<!-- formula-not-decoded -->`**，其中 5~6 张 slide 除了 `##` 标题外**零可检索文字**（`Camera pixel size`、三张 `HSL and HSV`、`XYZ-RGB transformations`）。这些块进了索引就是**死 chunk** —— 永远召不回、也答不出，而"HSL 和 HSV 有什么区别"恰恰是学生会问的。

原因不是 Docling 能力到顶，是这些富化开关**默认就是关的**：`do_formula_enrichment = False`、`do_picture_description = False`。

那么谁来开？系统最终接受学生上传任意 PDF，上传时没人知道那是纯文字讲义、公式密集的理论课、还是文字全在图里的扫描件。三个显而易见的答案都是错的：

- **让用户选** —— 把一个他答不上来的问题推给他。
- **全开** —— 纯文字讲义要为它永远用不到的模型付几十倍算力。
- **全关** —— 就是上面那个结果。

生产级文档管线（unstructured.io 的 `strategy="auto"`、Azure Document Intelligence 的分层、AWS Textract 的 tiering）走的是同一个三层结构，**没有一层是"让用户选"**：

```mermaid
flowchart LR
    U[上传的 PDF] --> P[① 探测<br/>零模型信号]
    P --> R{路由规则}
    R -->|文字层完好| C[经典 pipeline]
    R -->|有数学字体| CF[经典 + 公式富化]
    R -->|文字层大面积缺失| V[VLM pipeline]
    C --> Q[③ 对产出打质量分]
    CF --> Q
    V --> Q
    Q -.升级重跑 🔜.-> R
```

**① 探测先于解析。** 从 PDF 结构里直接读四个信号 —— 每页文字量、空页比例、图片对象数、字体表里有无数学字体。不加载任何模型、不渲染任何页面。属主是 [rag/probe.py](../rag/probe.py)。

**② 富化自门控。** 关键性质：Docling 的富化模型是**逐 item 触发**的（`standard_pdf_pipeline.py` 里 `CodeFormulaVlmModel` 挂在 `enrichment_pipe` 上）—— layout 没检出公式区域，模型压根不推理。图片描述侧则由 Docling 原生的 `picture_area_threshold`（默认 0.05，只描述占页 5% 以上的图）和 `classification_allow` 挡掉装饰性小图。

**③ 级联升级。** 便宜配置先跑，再对**产出**打质量分（每页实际抽出多少字、多少页零文字、多少张图周围没有文字），只把不合格的部分用贵配置重跑。**本项目只做到"打分并报告"，不做自动重跑** 🔜 M3 —— 重跑阈值必须用 gold set 调，现在拍脑袋定就是给论文埋一个没有依据的常数。

#### 信号在 PPM 语料上的实测分布（31 份，约 1200 页，探测耗时数秒）

| 路由结果 | 份数 | 命中的文件 |
| --- | --- | --- |
| `vlm`（空页比 > 0.3） | **1** | `3.5-HTML5-Part-2`：32 页里 16 页近乎空、91 张图 |
| `classic + formula`（字体表含数学字体） | **4** | `2.1 IMAGES GENERAL` · `2.3 IMAGES LOSSY` · `3.2b VIDEO H261-H262` · `3.3b VIDEO H264-H265` |
| `classic`（裸跑） | **26** | Django · JavaScript · web 全系列 |

零误报：唯一被判去 VLM 的正是独立已知的那份图片型 slides，四份公式富化正是图像/视频压缩理论那几份（`2.1` 就是产出 `formula-not-decoded` 的那份）。路由省掉 27/31 的公式模型加载与 30/31 的 VLM。

#### 规则 v0 与阈值来源

| 条件 | 决策 | 依据 |
| --- | --- | --- |
| `empty_page_ratio > 0.3` | `pipeline = vlm` | 文字层大面积缺失 → 内容在图里。语料实测：除 `3.5` 的 0.50 外全部 ≤ 0.24 |
| 字体表含 `Symbol` · `CM*` · `MT*` · `STIX` 等 | `formula = True` | 数学字体提供文本字体没有的积分号、大括号、希腊字母 |
| 其余 | 经典 pipeline，全关 | 26/31 属于此类 |
| **任何情况** | `ocr` **不自动开** | 实测：有文字层的 PDF 开 OCR 产出字节完全相同却多耗 62% 时间。文字层真缺失的该走 VLM（它同时读版面），OCR 只留作手动覆盖 |

阈值（`EMPTY_PAGE_CHARS = 50`、`NEEDS_VISION_RATIO = 0.3`）是**本语料实测值，不是通用真理**，换语料要重标。

数学字体判定会**故意误报**：PowerPoint 也用 `SymbolMT` 画项目符号。这个方向是有意选的 —— 富化逐 item 自门控，误报的代价是一次模型加载，漏报的代价是公式永久从索引里消失。**不对称的代价，就该配不对称的门槛。**

#### 一个必须记下来的不一致：同一个开关，两个默认值

`rag/parse.py` 的 CLI 里公式富化默认**关**；M5 的 Celery worker 里应该默认**开**。理由是进程生命周期：CLI 每次运行都要重付一次模型下载与加载，而常驻 worker 只付一次，之后逐 item 自门控 ≈ 免费。

不写下来，将来自己看到这个不一致只会以为是 bug。

## 3. Ingest pipeline 逐步

| 步骤 | 干什么 | 关键选择 | 出错的表现 |
| --- | --- | --- | --- |
| 0. Probe | PDF → 文件画像 → 解析配置 | 信号与阈值（见 2.8） | 该开的富化没开 → 公式/图片永久丢失 |
| 1. Parse | PDF → DoclingDocument | 经典 vs VLM pipeline | 乱码、栏序错、表格塌 |
| 2. Chunk | 文档 → 带元数据的块 | HybridChunker + 对齐的 tokenizer | 块太大被截断 / 太小丢上下文 |
| 3. Contextualize | 块 → 富化文本 | 标题链前缀 | 短块检索不到 |
| 4. Embed | 文本 → 稠密向量 | Qwen3-Embedding 尺寸（0.6B/4B/8B） | 跨语言对不齐 |
| 5. Index | 向量 + 原文 + payload 入库 | Qdrant，dense + sparse 双命名向量 | 过滤字段缺失 |

payload 里从第一天就要带的字段：`locale`（多语言域的硬要求，见 CLAUDE.md）、`course`、`source_file`、`page`、`heading_path`。补数据比一开始就写进去贵得多。

## 4. Query pipeline 逐步

```mermaid
sequenceDiagram
    participant U as 用户
    participant API as DRF /api/ask
    participant E as Qwen3-Embedding
    participant Q as Qdrant
    participant R as Qwen3-Reranker
    participant L as Qwen3 LLM
    U->>API: 问题 + locale
    API->>E: 问题向量化
    E-->>API: query vector
    API->>Q: hybrid 查询（dense + BM25，RRF 融合）
    Q-->>API: top-k 候选（k 约 20-50）
    API->>R: (问题, 每个候选) 逐对打分
    R-->>API: top-n 精排（n 约 3-8）
    API->>L: system + 上下文片段 + 问题
    L-->>API: 流式 token
    API-->>U: SSE 流式回答 + 引用
```

四个必须分清的概念：

- **Dense（稠密）检索**：文本 → 向量 → 比余弦相似度。匹配的是**语义**，所以 `sorting algorithm` 能命中 `algoritmi di ordinamento` —— 这就是跨语言能力的来源，query 和材料**都不需要翻译**。弱点：精确的专有名词、缩写、代码标识符容易漏。
- **Sparse（稀疏）/ BM25**：词频统计，匹配的是**字面词**。弱点正好互补：跨语言结构性失效（英文问题与意大利语材料词汇零重叠）。
- **Hybrid + RRF**：两路各自检索，用 Reciprocal Rank Fusion 按**排名**（不是分数 —— 两路分数量纲不同没法直接比）融合。Qdrant 原生支持，一次查询搞定。
- **Rerank**：检索用的是 **bi-encoder**（问题和文档分别编码，可以预先算好 → 快，但两者从未「见过」对方）；reranker 是 **cross-encoder**（问题和文档拼在一起进模型 → 准，但每对都要现算 → 慢）。所以是两段式：检索粗筛几十个 → 重排精选几个。这不是可选优化，是质量的主要来源之一。

**Top-k 的取舍**：k 太小召回不到；k 太大 → 上下文塞满噪音，LLM 反而被带偏（"lost in the middle"），且延迟和显存都涨。k 是 M3 要调的实验变量，不是拍脑袋的常量。

## 5. LangChain / LangGraph / LlamaIndex：是什么，为什么本项目不用

### 5.1 它们各自是什么

```mermaid
flowchart TD
    subgraph L1["框架层（可选）"]
        LC[LangChain<br/>组件胶水 + LCEL 链式编排]
        LG[LangGraph<br/>有状态图：节点 · 边 · 循环]
        LI[LlamaIndex<br/>面向 RAG 的一体化框架]
    end
    subgraph L2["能力层（不可省）"]
        P[文档解析<br/>Docling]
        C[切块]
        EM[Embedding<br/>Qwen3]
        VS[向量库<br/>Qdrant]
        RK[Reranker<br/>Qwen3]
        LLM[生成<br/>Qwen3]
    end
    LC --> L2
    LG --> LC
    LI --> L2
```

- **LangChain**：一层**适配器 + 胶水**。给上百种 loader、splitter、vectorstore、LLM provider 统一接口，再用 LCEL（`prompt | llm | parser`）把它们串成链。卖点是换组件只改一行。
- **LangGraph**：LangChain 团队做的**有状态图编排**。把工作流建成图：节点是函数，边是转移，共享一个 state 对象，**支持条件分支、循环、人工介入、断点续跑**。它解决的是「模型自己决定下一步做什么」这类控制流。
- **LlamaIndex**：更聚焦 RAG 的框架，索引/检索/查询引擎抽象成型，开箱即用程度最高（也有 Docling reader）。

注意：**这三个都不提供任何新能力**。解析还是 Docling、向量还是 Qwen3、库还是 Qdrant。它们提供的是**编排和统一接口**。

### 5.2 为什么自建

决策已定（属主见 [architettura.md](architettura.md)：自建 pipeline，不用 LlamaIndex/LangGraph 全家桶），理由在这里展开：

1. **控制流根本不需要图。** 第 1 节和第 4 节画的是**线性流程**：解析→切块→向量化→索引，检索→重排→生成。没有循环、没有条件跳转、没有 agent 自主决策。LangGraph 是为循环和分支设计的，用在直线流程上是纯粹的抽象税。
2. **论文要测量的东西，正是框架藏起来的东西。** 实验网格是 embedding 尺寸 × reranker 尺寸 × LLM 尺寸 × top-k × chunk 策略。这些参数在自己的代码里是显式变量；在框架里散落在各层默认值中，而且框架会悄悄改 prompt 模板、悄悄加重试 —— 实验就不可复现了。
3. **可解释性 = 论文的可写性。** 答辩要讲清楚每一步在做什么。「调了 `VectorStoreIndex.as_query_engine()`」不构成一个章节；「实现了 RRF 融合并对比了 k=10/30/50」才是。
4. **代码量并没有省多少。** 这条 pipeline 自己写量级在几百行，且每一行都懂。框架省的是「接 20 种向量库」的适配成本，而本项目只接一种。
5. **依赖风险。** LangChain 的 API 迭代激进，论文周期内的 breaking change 是纯损耗。

### 5.3 什么时候框架才真正划算

诚实地说，下面这些场景自建就是重复造轮子：

- 需要接十几种数据源 / 多个 LLM provider 并随时切换。
- **真正的 agentic 工作流**：LLM 决定是否检索、改写 query、评估片段够不够、不够就再检索一轮 —— 这是带循环和条件的状态机，LangGraph 的主场。
- 需要断点续跑、人工审核介入、多 agent 协作。

对应到本项目：第三点不需要；第二点是 M7 的可选扩展方向（[analisi-rag.md](analisi-rag.md) 已把 web fallback 判为出域）。**真到那一步再引入 LangGraph 也不迟 —— 自建的线性 pipeline 可以整体变成图里的一个节点，不需要重写。** 这是先自建的另一个好处：不锁死。

### 5.4 概念对照表（框架术语 ↔ 本项目做法）

| 框架术语 | 本项目对应 |
| --- | --- |
| `DocumentLoader` | `DocumentConverter().convert()` |
| `TextSplitter` | `HybridChunker` |
| `Embeddings` | Qwen3-Embedding，经 vLLM 的 OpenAI 兼容端点 |
| `VectorStore` / `Retriever` | `qdrant-client`（本地模式 → Docker） |
| `Chain` / LCEL | 一个普通 Python 函数 |
| `Graph` / `StateGraph` | 用不上（无循环无分支） |
| `Callbacks` / tracing | Langfuse 直接接 |

懂这些术语仍然必要：读别人的教程、写论文相关工作章节、答辩被问到「为什么不用 LangChain」，都需要能准确说出它们是什么。**不用 ≠ 不懂。**

## 6. 术语速查

| 术语 | 一句话 |
| --- | --- |
| Chunk | 检索的最小单位；一段带元数据的文本 |
| Embedding | 文本 → 定长向量，语义相近则向量相近 |
| Dense / Sparse | 语义向量检索 / BM25 词频检索 |
| Hybrid + RRF | 两路检索按排名融合 |
| Bi-encoder | 分别编码，可预计算，快 → 用于检索 |
| Cross-encoder | 拼一起编码，准但慢 → 用于重排 |
| Top-k / top-n | 检索候选数 / 重排后进 prompt 的数量 |
| DocTags | granite-docling 的无损版面标记语言 |
| OTSL | DocTags 里的表格结构编码 |
| Provenance | chunk 在原文的位置（页码、bbox）→ 引用溯源 |
| Grounding / Faithfulness | 回答是否真的由检索片段支撑，不是编的 |
| Agentic RAG | LLM 自己编排检索（带循环 / 分支） |

## 7. 落到 M2

| Pipeline 步骤 | 模块职责 | 实验变量（M3 要调的） |
| --- | --- | --- |
| Probe | PDF → 画像 → 解析配置 | 路由阈值；路由 vs 全经典 vs 全 VLM 的质量/算力对比 |
| Parse | PDF → DoclingDocument | 经典 vs VLM pipeline；是否开图片描述 |
| Chunk | 切块 + contextualize | chunk 大小、是否富化 |
| Embed | 文本 → 向量 | Qwen3-Embedding 0.6B / 4B / 8B |
| Index | 写入 Qdrant | hybrid 融合、量化 |
| Retrieve + Rerank | 查询 + 精排 | top-k、reranker 尺寸 |
| Generate | 拼 prompt + 调 LLM | LLM 尺寸、prompt 模板 |

模块划分只是职责示意，实际目录结构在 M2 实现时确定（规则见 CLAUDE.md：未定前不建「顺手」目录）。

最短路径：真实课程 PDF → 两条 pipeline 各跑一遍 → 按 2.7 的清单比对输出（词间空格、连字、重音、栏序、图片型页面）→ 选定 pipeline 后再往下接 chunking。**先验证解析，再谈检索。**
