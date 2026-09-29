# RAG analysis — expanding the supervisor's links

The first deliverable of the thesis: in an email of 2026-07-28 the supervisor asked to expand the analysis of RAG and of answers starting from four links. This analysis is the input to the RAG-route decision of [architecture.md](architecture.md), which chose the self-built pipeline. The sources are listed at the end.

## 1. Qwen-Agent's RAG module

Structure: `DocParser` turns PDF, DOCX, PPTX, HTML, CSV and XLSX into records and splits them by `parser_page_size` (500 tokens by default); retrieval is **BM25 only** (the `rank_bm25` library), with a context ceiling of `max_ref_token` (20 000 by default). The retrieval strategy is configured through `rag_searchers` (keyword, front page, hybrid); the default keyword generator (`SplitQueryThenGenKeyword`) splits the query and produces keywords in **Chinese and English**. It is on by default in the `Assistant` agent (`pip install "qwen-agent[rag]"`). It calls itself lightweight: **no embeddings, no vector store**.

What it means for the thesis:

- BM25 is **lexical** matching: an Italian question and English material share no words, so the thesis's core scenario, cross-language questions, **fails by construction**.
- The bilingual keywords are Chinese and English, not Italian.
- For: no infrastructure, the fastest start. Against: no semantic retrieval, so no embedding-size study is possible.
- **Its value for the thesis is as a lexical baseline**: BM25 alone against dense and hybrid retrieval is the comparison of `#25` (🔜 M3). The baseline this repository measures is its own sparse branch (fastembed BM25 in `rag/index.py`), not Qwen-Agent.

## 2. The Qwen3 family: embedding, reranker, LLM

Qwen3-Embedding and Qwen3-Reranker both come in **0.6B, 4B and 8B**, under Apache 2.0, for **100+ languages**, with a stated **cross-lingual** capability; they are instruction-aware (the prompt can name the task or language) and support MRL (the vector dimension can be reduced). Benchmarks: the 8B embedding model was first on the MTEB multilingual leaderboard (70.58, June 2025); the 8B reranker scores about 69.8 on MTEB-R (the Medium article the supervisor sent gives slightly different numbers; the official Qwen blog is the reference).

The classic pipeline: query → embedding retrieval → reranking → LLM generation.

For the thesis this is the **architectural core**:

- Cross-language retrieval happens in the embedding space: **neither the query nor the material is translated**.
- Three sizes × three roles (embedding, reranker, LLM) are exactly the cost/quality grid of experiments the supervisor asked for.

## 3. "Agentic" RAG (the Lightning template)

The template page cannot be read without logging in (it loads through JavaScript); from the author's public material, the agent queries a vector store and **falls back to web search** when retrieval is not enough. The general agentic-RAG pattern: an LLM orchestrates retrieval — it decides *whether* to retrieve, rewrites the query, judges the relevance of the excerpts and iterates.

For the thesis, as analysed on 2026-07-28:

- A web fallback **leaves the domain**: the course material is a closed source, and an answer from the web is not the course's answer.
- Routing and self-checks add LLM calls, so latency and cost rise and reproducibility drops.
- It was positioned as an optional extension once the baseline was stable, not as the starting point.

The direction changed on 2026-08-21: the agent and live fetching entered the project for the campus source, not for course material ([decisions.md](decisions.md), 2026-08-21, *The campus source and the agent*).

## 4. Granite-Docling (document parsing)

`granite-docling-258M` is a compact VLM (about 0.3B; Idefics3 architecture: a siglip2 vision encoder and the Granite 165M language model) under Apache 2.0. It outputs **DocTags**, a markup that keeps the layout semantics and exports to Markdown or HTML, covering tables (OTSL), formulas (LaTeX), code and reading order. It ships in the `docling` library's `VlmPipeline`, which downloads the model itself. Multilingual support is **experimental** (Japanese, Arabic, Chinese) and mainly English — **Italian is not mentioned**, so it had to be checked on real slides. The MICC GPUs (2080 Ti, Titan RTX) are Turing cards **without bfloat16**, so a VLM has to run in fp16 there.

- `docling` also has a classic, non-VLM pipeline, which is reliable on born-digital PDFs; the VLM targets scans and complex layouts.
- For the thesis: the material is mostly slide PDFs, so parsing quality decides everything downstream.

This file analyses the route and does not repeat how the pipelines work: that is [docling-pipeline.md](docling-pipeline.md), and the measured comparison of the two parsing routes is [experiment-log.md](experiment-log.md), entry of 2026-08-02.

## What the analysis implies

1. **Embedding first**: cross-language retrieval rests on multilingual embeddings, not on translation (translation is the optional second phase the supervisor mentioned).
2. The experiment variables come for free: embedding size × reranker size × LLM size, measured on answer quality and cost (time, GPU memory).
3. BM25 is the lexical baseline to beat (`#25`, 🔜 M3).

## Route comparison

| Criterion | Lightweight self-built pipeline | Qwen-Agent RAG | LlamaIndex |
| --- | --- | --- | --- |
| Experimental control (thesis) | full | poor (BM25 fixed) | medium (thick abstraction) |
| Cross-language | native (Qwen3-Embedding) | weak | feasible (plugins) |
| Infrastructure | minimal (a light vector store) | none | medium |
| Explainability in the thesis | high (every step is own code) | medium | medium-low |
| Speed of starting | medium | high | high |

The proposal taken to the meeting: a **lightweight self-built pipeline** (Docling → chunking → Qwen3-Embedding → rerank → Qwen3) as the main system, with BM25 as the experimental baseline; LlamaIndex only if a ready component were needed (it has a Docling reader). The decision and its state are in [architecture.md](architecture.md); this file is the analysis, not the owner of the decision. The one-off minimal experiment this analysis also proposed was not run ([decisions.md](decisions.md), 2026-07-31, *The retrieval pipeline replaces a throwaway experiment, and MICC replaces Colab*).

## Why not LangChain, LangGraph or LlamaIndex

None of the three adds a capability here — parsing is Docling, vectors are Qwen3, the store is Qdrant. They add **orchestration and a common interface**: LangChain is adapters and glue (LCEL chains), LangGraph is stateful graph orchestration (loops, branches, breakpoints), LlamaIndex is an all-in-one RAG framework. The pipeline is self-built, for five reasons:

1. **The control flow is small enough to write out.** Ingest is a straight line; the query side is a router and a deepening loop of at most three steps (`route()` and `deepen()` in `rag/agent.py`), an explicit state machine in plain code whose diagram is in [unifi-web-source.md](unifi-web-source.md). A graph framework would add a layer without adding a capability.
2. **What the thesis measures is what a framework hides.** The experiment grid (embedding × reranker × LLM size × top-k × chunking strategy) is a set of explicit variables in the project's code; in a framework it is scattered over default values in several layers, and a framework may rewrite prompts or add retries silently, which breaks reproducibility.
3. **Explainability is what makes the thesis writable.** "We called `as_query_engine()`" is not a chapter; "we implemented RRF and compared k = 10, 30 and 50" is.
4. **Little code is saved.** The self-built pipeline is a few hundred lines, each understood; a framework saves the cost of connecting twenty vector stores, and this project connects one.
5. **Dependency risk.** LangChain's API changes aggressively, and a breaking change during the thesis would be pure loss.

A framework pays off when many data sources are switched at will, or when a workflow is truly agentic — the LLM deciding whether to retrieve once more, a state machine with loops. The deepening loop is this project's one such part, and it is built explicitly. Not using a framework is not ignoring it: the related-work chapter and the defence need this mapping.

| Framework term | This project |
| --- | --- |
| `DocumentLoader` | `DocumentConverter().convert()` in `rag/parse.py` |
| `TextSplitter` | `HybridChunker` in `rag/chunk.py` |
| `Embeddings` | Qwen3-Embedding, run locally with sentence-transformers (`rag/index.py`) |
| `VectorStore` / `Retriever` | `qdrant-client` against the Qdrant service (`docker-compose.yml`); embedded only in tests and with `--qdrant DIR` |
| `Chain` / LCEL | a plain Python function |
| `Graph` / `StateGraph` | the explicit loop `deepen()` in `rag/agent.py` |
| `Callbacks` / tracing | Langfuse (🔜 M3 `#26`) |

## Sources

The supervisor's links (email of 2026-07-28) and the further sources this analysis used, as plain text (outside the repository):

- `https://qwenlm.github.io/Qwen-Agent/en/guide/core_moduls/rag/`
- `https://medium.com/@marketing_novita.ai/qwen-3-in-rag-pipelines-all-in-one-llm-embedding-and-reranking-solution-619fe1acfe11`
- `https://lightning.ai/akshay-ddods/templates/agentic-rag-powered-by-qwen-3` (not readable without logging in; the pattern is reconstructed from the author's public material, repository `github.com/patchy631/ai-engineering-hub`)
- `https://www.ibm.com/new/announcements/granite-docling-end-to-end-document-conversion` (403; the official model card was used instead)
- `https://qwenlm.github.io/blog/qwen3-embedding/` (the official Qwen3-Embedding and Reranker blog)
- `https://huggingface.co/ibm-granite/granite-docling-258M` (the official model card)
