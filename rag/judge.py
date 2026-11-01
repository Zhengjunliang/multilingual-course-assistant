"""The four RAGAS metrics behind one typed method.

The only module that imports RAGAS, whose types are incomplete, so that what
the type checker cannot see stays here. The judge is an OpenAI-compatible
endpoint (`JUDGE_*` in config/env.py) that RAGAS drives through its instructor
adapter; answer relevancy compares questions with the index's own
Qwen3-Embedding rather than a second embedding model.
"""

from __future__ import annotations

import logging
import math
import os
from typing import TYPE_CHECKING, Any

from rag.eval import METRICS

if TYPE_CHECKING:
    from pydantic import SecretStr

    from rag.index import DenseEncoder

logger = logging.getLogger(__name__)

# What the judge's requests carry, past RAGAS's defaults (temperature 0.01,
# top_p 0.1, max_tokens 1024): greedy and seeded, so a run repeats; 2048 tokens,
# since 1024 cuts the JSON of a long answer's statements and 2048 still leaves
# the prompt 6144 of the judge's 8192; and Qwen3 in non-thinking mode, which
# its model card asks of greedy decoding. A server whose chat template has no
# `enable_thinking` ignores it.
JUDGE_SAMPLING: dict[str, Any] = {
    "temperature": 0.0,
    "top_p": 1.0,
    "seed": 0,
    "max_tokens": 2048,
    "extra_body": {"chat_template_kwargs": {"enable_thinking": False}},
}


class Judge:
    def __init__(self, base_url: str, api_key: SecretStr, model: str, dense: DenseEncoder) -> None:
        # RAGAS posts an event to its authors' server for every LLM call unless
        # this is set before its first call (ragas/_analytics.py): an evaluation
        # sends nothing off the machine it runs on.
        os.environ["RAGAS_DO_NOT_TRACK"] = "true"
        from openai import AsyncOpenAI
        from ragas.embeddings.base import BaseRagasEmbedding
        from ragas.llms import llm_factory
        from ragas.metrics.collections import (
            AnswerRelevancy,
            ContextPrecisionWithReference,
            ContextRecall,
            Faithfulness,
        )

        class Embeddings(BaseRagasEmbedding):
            """Answer relevancy compares the question with questions the judge
            writes back from the answer: two questions, so both sides are
            encoded alike, as documents, without the retrieval instruction a
            query gets."""

            def embed_text(self, text: str, **kwargs: Any) -> list[float]:
                return dense.encode_documents([text])[0]

            async def aembed_text(self, text: str, **kwargs: Any) -> list[float]:
                return self.embed_text(text)

        client = AsyncOpenAI(base_url=base_url, api_key=api_key.get_secret_value())
        llm = llm_factory(model, provider="openai", client=client, **JUDGE_SAMPLING)
        self._faithfulness = Faithfulness(llm=llm)
        # Under greedy decoding the default three generated questions are one
        # question three times.
        self._relevancy = AnswerRelevancy(llm=llm, embeddings=Embeddings(), strictness=1)
        self._precision = ContextPrecisionWithReference(llm=llm)
        self._recall = ContextRecall(llm=llm)

    async def score(
        self, question: str, answer: str, contexts: list[str], reference: str
    ) -> dict[str, float | str]:
        """Each metric's value, "nan" where RAGAS returns none (faithfulness
        finds no statement in an answer that only refuses), "failed" where the
        call raises (the judge's JSON fails validation, the server refuses)."""
        calls = {
            "faithfulness": lambda: self._faithfulness.ascore(
                user_input=question, response=answer, retrieved_contexts=contexts
            ),
            "answer_relevancy": lambda: self._relevancy.ascore(
                user_input=question, response=answer
            ),
            "context_precision": lambda: self._precision.ascore(
                user_input=question, reference=reference, retrieved_contexts=contexts
            ),
            "context_recall": lambda: self._recall.ascore(
                user_input=question, retrieved_contexts=contexts, reference=reference
            ),
        }
        scores: dict[str, float | str] = {}
        for name in METRICS:
            try:
                value = (await calls[name]()).value
            # Any failure: it is counted, never averaged as 0, and the run goes on.
            except Exception as error:
                logger.warning("%s failed: %s: %s", name, type(error).__name__, error)
                scores[name] = "failed"
                continue
            scores[name] = "nan" if value is None or math.isnan(value) else float(value)
        return scores
