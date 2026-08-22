"""RAG pipeline over course material — the thesis core.

Must never import Django: the pipeline runs from the CLI during M2/M3 evaluation
and is consumed by the DRF layer only later, at M5.
"""
