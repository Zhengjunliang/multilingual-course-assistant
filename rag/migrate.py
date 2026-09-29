"""A one-off move of the embedded index to the Qdrant service, and its proof (#33).

qdrant-client's official `migrate()` copies both collections, vectors and
payloads, so nothing is encoded again and the pages fetched live, which exist
only in the index, move with the rest. What it cannot carry is set afterwards:
the keyword payload indexes (`ensure_payload_indexes`), and the optimizer
settings the server gives a collection that `ensure_collection` creates, read
from a probe collection on the same server, since local mode reports
placeholders. The module is deleted by the commit that records its run in
docs/experiment-log.md, like rag/relabel.py for #96.

    uv run python -m rag.migrate --from data/qdrant --dry-run
    uv run python -m rag.migrate --from data/qdrant
    uv run python -m rag.migrate --from data/qdrant --verify-only

Two of the three gates of the move are checked here. No point is lost: the
counts, the (url, ingest_source) pairs, and every point compared between the
reopened source and the server — the payload equal, the dense vector equal in
direction (a Cosine collection stores it normalised), the sparse vector equal.
Approximate search costs no recall: for each gold question, the dense branch's
top PREFETCH_LIMIT is compared with an exact search under the same filter, on
every collection the server indexes with HNSW (outside the repository: Qdrant,
"Measuring ANN Recall"). The third gate, every gold question before and after,
is `rag.gold` run on each side.

The preflight refuses a target that holds either collection unless given
`--replace`, and a `--replace` that would delete a point the source lacks:
`migrate()` recreates a colliding collection, so a page fetched live into the
server would be lost.
"""

from __future__ import annotations

import argparse
import math
import time
from collections import Counter
from pathlib import Path
from typing import TYPE_CHECKING, Any, NoReturn, cast

from rag.gold import EVAL_SCOPE, load_gold
from rag.index import (
    COLLECTION,
    DEFAULT_DENSE_MODEL,
    DENSE_VECTOR,
    SPARSE_VECTOR,
    WEB_COLLECTION,
    build_dense_encoder,
    ensure_collection,
    ensure_payload_indexes,
    open_client,
)
from rag.probe import configure_cli_logging
from rag.search import PREFETCH_LIMIT, payload_filter

if TYPE_CHECKING:
    from collections.abc import Iterator, Mapping, Sequence

    from qdrant_client import QdrantClient
    from qdrant_client import models as qmodels

    from rag.index import DenseEncoder

COLLECTIONS = (COLLECTION, WEB_COLLECTION)
PROBE = "migration_probe_33"
BATCH = 256
BASE_DIR = Path(__file__).resolve().parent.parent
DEFAULT_GOLD = (BASE_DIR / "gold" / "smoke.jsonl", BASE_DIR / "gold" / "campus.jsonl")

# Per component, after both sides are normalised: float32 rounding is ~6e-8,
# while two distinct 1024-dimensional embeddings differ by at least ~1e-3 in
# some component, so 1e-5 separates the two by orders of magnitude.
DENSE_TOLERANCE = 1e-5
SPARSE_REL_TOL = 1e-6
RECALL_TARGET = 0.99
GREEN_TIMEOUT_SECONDS = 900
GREY_NUDGE_SECONDS = 10
# The lowest level whose reply lists each segment's vector index.
TELEMETRY_DETAILS_LEVEL = 4
MISMATCHES_SHOWN = 10

Pair = tuple[str | None, str | None]


def elapsed(started: float) -> str:
    return f"{time.perf_counter() - started:.1f}s"


def refuse(reason: str) -> NoReturn:
    print(f"REFUSE {reason}")
    raise SystemExit(1)


def batches(
    client: QdrantClient, collection: str, *, payload: bool | Sequence[str], vectors: bool
) -> Iterator[list[qmodels.Record]]:
    """Every point of `collection`, BATCH at a time, to the end."""
    offset = None
    while True:
        records, offset = client.scroll(
            collection, limit=BATCH, offset=offset, with_payload=payload, with_vectors=vectors
        )
        if records:
            yield records
        if offset is None:
            return


def version_pairs(client: QdrantClient, collection: str) -> Counter[Pair]:
    """Points per (url, ingest_source): the measure of `count_web_versions`, and
    for slides the single pair (None, None)."""
    pairs: Counter[Pair] = Counter()
    for batch in batches(client, collection, payload=["url", "ingest_source"], vectors=False):
        for record in batch:
            payload = record.payload or {}
            pairs[(payload.get("url"), payload.get("ingest_source"))] += 1
    return pairs


def preflight(
    source: QdrantClient, target: QdrantClient, *, replace: bool, verify_only: bool
) -> dict[str, Counter[Pair]]:
    names = {collection.name for collection in source.get_collections().collections}
    if names != set(COLLECTIONS):
        refuse(f"source holds {sorted(names)}, not {list(COLLECTIONS)}")
    pairs = {name: version_pairs(source, name) for name in COLLECTIONS}
    live = {url: n for (url, origin), n in pairs[WEB_COLLECTION].items() if origin == "live"}
    print(
        f"source: {COLLECTION} {pairs[COLLECTION].total()} | "
        f"{WEB_COLLECTION} {pairs[WEB_COLLECTION].total()} "
        f"({sum(live.values())} live points over {len(live)} urls)"
    )
    if verify_only:
        return pairs
    present = [name for name in COLLECTIONS if target.collection_exists(name)]
    if present and not replace:
        refuse(f"target has {', '.join(present)}; pass --replace")
    only_target = [
        (name, pair, n)
        for name in present
        for pair, n in version_pairs(target, name).items()
        if pair not in pairs[name]
    ]
    if only_target:
        lost = sum(n for _, _, n in only_target)
        shown = ", ".join(
            f"{name}:{url}:{origin}" for name, (url, origin), _ in only_target[:MISMATCHES_SHOWN]
        )
        refuse(f"--replace would delete {lost} points that exist only on the target: {shown}")
    return pairs


def differing(
    left: qmodels.CollectionConfig, right: qmodels.CollectionConfig, sections: Sequence[str]
) -> list[tuple[str, Any, Any]]:
    """(section.field, left value, right value) for every field that differs."""
    a, b = left.model_dump(mode="json"), right.model_dump(mode="json")
    found: list[tuple[str, Any, Any]] = []
    for section in sections:
        x: dict[str, Any] = a[section] or {}
        y: dict[str, Any] = b[section] or {}
        found += [
            (f"{section}.{key}", x.get(key), y.get(key))
            for key in sorted(x.keys() | y.keys())
            if x.get(key) != y.get(key)
        ]
    return found


# WAL is compared on its own: `update_collection` cannot change it.
CONFIG_SECTIONS = (
    "params",
    "hnsw_config",
    "optimizer_config",
    "quantization_config",
    "strict_mode_config",
    "metadata",
)


def config_differences(
    migrated: qmodels.CollectionConfig, probe: qmodels.CollectionConfig
) -> list[str]:
    return [field for field, _, _ in differing(migrated, probe, CONFIG_SECTIONS)]


def dense_dimension(client: QdrantClient) -> int:
    vectors = client.get_collection(COLLECTION).config.params.vectors
    if not isinstance(vectors, dict) or DENSE_VECTOR not in vectors:
        raise ValueError(f"{COLLECTION} has no named {DENSE_VECTOR} vector")
    return vectors[DENSE_VECTOR].size


def set_to_probe(target: QdrantClient, name: str, probe: qmodels.CollectionConfig) -> None:
    """Give `name` the probe's optimizer and HNSW settings where they differ."""
    from qdrant_client import models

    found = differing(target.get_collection(name).config, probe, CONFIG_SECTIONS)
    if not found:
        return
    print(
        f"config: {name} set to probe: "
        + ", ".join(f"{field} {old} -> {new}" for field, old, new in found)
    )
    optimizer = None
    if any(field.startswith("optimizer_config.") for field, _, _ in found):
        fields = {k: v for k, v in probe.optimizer_config.model_dump().items() if v is not None}
        # A server reports "auto" as None, which a Diff reads as "leave it".
        threads = probe.optimizer_config.max_optimization_threads
        fields["max_optimization_threads"] = (
            models.MaxOptimizationThreadsSetting.AUTO if threads is None else threads
        )
        optimizer = models.OptimizersConfigDiff(**fields)
    hnsw = None
    if any(field.startswith("hnsw_config.") for field, _, _ in found):
        hnsw = models.HnswConfigDiff(**probe.hnsw_config.model_dump())
    if optimizer is not None or hnsw is not None:
        target.update_collection(name, optimizers_config=optimizer, hnsw_config=hnsw)


def check_config(source: QdrantClient, target: QdrantClient, *, update: bool) -> bool:
    """The migrated collections against a collection `ensure_collection` creates
    on the same server; the probe is deleted whatever happens."""
    ensure_collection(target, dense_dimension(source), PROBE)
    try:
        probe = target.get_collection(PROBE).config
        ok = True
        for name in COLLECTIONS:
            if update:
                set_to_probe(target, name, probe)
            migrated = target.get_collection(name).config
            differences = config_differences(migrated, probe)
            if differences:
                print(f"config: {name} DIFFERS from probe: {', '.join(differences)}")
                ok = False
            else:
                print(f"config: {name} matches probe")
            wal = differing(migrated, probe, ("wal_config",))
            if wal:
                shown = ", ".join(f"{field} {old} vs {new}" for field, old, new in wal)
                print(f"wal: {name} differs from probe (recorded): {shown}")
            else:
                print(f"wal: {name} matches probe")
    finally:
        target.delete_collection(PROBE)
    return ok


def wait_green(target: QdrantClient, name: str) -> qmodels.CollectionInfo:
    """Block until the optimizer has finished with `name`: recall means nothing
    while HNSW is still being built."""
    from qdrant_client import models

    started = time.perf_counter()
    grey_since: float | None = None
    while True:
        info = target.get_collection(name)
        if info.status == models.CollectionStatus.GREEN:
            return info
        if info.status == models.CollectionStatus.RED:
            raise RuntimeError(f"{name} is red: {info.optimizer_status}")
        now = time.perf_counter()
        if now - started > GREEN_TIMEOUT_SECONDS:
            raise TimeoutError(f"{name} still {info.status.value} after {GREEN_TIMEOUT_SECONDS}s")
        if info.status == models.CollectionStatus.GREY:
            # Optimizations pending but paused: Qdrant's documented trigger is
            # any update operation, and an empty optimizer diff is the one
            # that changes nothing (outside the repository: Qdrant, "Grey
            # Collection Status").
            if grey_since is None:
                grey_since = now
            elif now - grey_since > GREY_NUDGE_SECONDS:
                target.update_collection(name, optimizers_config=models.OptimizersConfigDiff())
                grey_since = None
        else:
            grey_since = None
        time.sleep(1)


def dense_index_from_telemetry(telemetry: Mapping[str, Any], name: str) -> tuple[int, int, int]:
    """(segments whose dense vectors have an HNSW index, all segments, dense
    vectors indexed in those segments) of `name`, from the `result` of
    GET /telemetry at TELEMETRY_DETAILS_LEVEL. The collection-level
    `indexed_vectors_count` cannot say this: it does not tell vector names apart."""
    matching = [c for c in telemetry["collections"]["collections"] if c.get("id") == name]
    if not matching:
        raise ValueError(f"telemetry lists no collection {name}")
    segments: list[Any] = []
    for shard in matching[0]["shards"]:
        local: Any = shard.get("local")
        if local is not None:
            segments += local.get("segments") or ()
    if not segments:
        raise ValueError(f"telemetry lists no segment of {name}")
    hnsw = [
        s for s in segments if s["config"]["vector_data"][DENSE_VECTOR]["index"]["type"] == "hnsw"
    ]
    indexed = sum(int(s["info"]["vector_data"][DENSE_VECTOR]["num_indexed_vectors"]) for s in hnsw)
    return len(hnsw), len(segments), indexed


def dense_index_state(target: QdrantClient, name: str) -> tuple[int, int, int]:
    """Read as plain JSON: qdrant-client 1.19.0's telemetry model rejects the
    per-segment detail a 1.19.1 server sends at this level."""
    import httpx

    response = httpx.get(
        f"{target.init_options['url']}/telemetry",
        params={"details_level": TELEMETRY_DETAILS_LEVEL, "anonymize": "false"},
        timeout=60,
    )
    response.raise_for_status()
    return dense_index_from_telemetry(response.json()["result"], name)


def check_counts(
    source: QdrantClient, target: QdrantClient, source_pairs: Mapping[str, Counter[Pair]]
) -> bool:
    """Counted apart from `migrate()`'s own `assert`, which `python -O` drops."""
    ok = True
    for name in COLLECTIONS:
        src, dst = source.count(name).count, target.count(name).count
        print(f"counts: {name} {src} {'=' if src == dst else '!='} {dst}")
        ok = ok and src == dst
    target_pairs = {name: version_pairs(target, name) for name in COLLECTIONS}
    kinds = sum(len(pairs) for pairs in source_pairs.values())
    if all(target_pairs[name] == source_pairs[name] for name in COLLECTIONS):
        print(f"versions: {kinds} (url, ingest_source) pairs equal")
        return ok
    for name in COLLECTIONS:
        changed = sorted(
            str(pair)
            for pair in source_pairs[name].keys() | target_pairs[name].keys()
            if source_pairs[name][pair] != target_pairs[name][pair]
        )
        if changed:
            print(f"versions: {name} DIFFER on {', '.join(changed[:MISMATCHES_SHOWN])}")
    return False


def direction(vector: Sequence[float]) -> list[float]:
    norm = math.sqrt(math.fsum(x * x for x in vector))
    return [x / norm for x in vector] if norm else list(vector)


def dense_of(record: qmodels.Record) -> list[float]:
    vectors = cast("Mapping[str, Any]", record.vector)
    return [float(x) for x in vectors[DENSE_VECTOR]]


def sparse_of(record: qmodels.Record) -> dict[int, float]:
    vectors = cast("Mapping[str, Any]", record.vector)
    sparse = cast("qmodels.SparseVector | None", vectors.get(SPARSE_VECTOR))
    if sparse is None:
        return {}
    return dict(zip(sparse.indices, sparse.values, strict=True))


def check_points(source: QdrantClient, target: QdrantClient) -> bool:
    """Every source point read back from the target by id."""
    ok = True
    worst = 0.0
    sparse_same = total = 0
    for name in COLLECTIONS:
        identical = seen = 0
        for batch in batches(source, name, payload=True, vectors=True):
            stored = target.retrieve(
                name, ids=[record.id for record in batch], with_payload=True, with_vectors=True
            )
            found = {str(record.id): record for record in stored}
            for record in batch:
                seen += 1
                other = found.get(str(record.id))
                kind = None
                if other is None:
                    kind = "missing"
                elif other.payload != record.payload:
                    kind = "payload"
                else:
                    a, b = direction(dense_of(record)), direction(dense_of(other))
                    gap = (
                        max((abs(x - y) for x, y in zip(a, b, strict=True)), default=0.0)
                        if len(a) == len(b)
                        else math.inf
                    )
                    worst = max(worst, gap)
                    left, right = sparse_of(record), sparse_of(other)
                    sparse_same += left == right
                    if gap > DENSE_TOLERANCE:
                        kind = "dense"
                    elif left.keys() != right.keys() or not all(
                        math.isclose(left[i], right[i], rel_tol=SPARSE_REL_TOL) for i in left
                    ):
                        kind = "sparse"
                if kind is None:
                    identical += 1
                elif seen - identical <= MISMATCHES_SHOWN:
                    print(f"MISMATCH {name} {record.id} {kind}")
        print(f"points identical: {name} {identical}/{seen}")
        total += seen
        ok = ok and identical == seen
    print(f"max dense diff: {worst:.2e}")
    print(f"sparse equal: {sparse_same}/{total}")
    return ok


def nearest(
    target: QdrantClient,
    collection: str,
    vector: list[float],
    query_filter: qmodels.Filter | None,
    params: qmodels.SearchParams | None,
) -> set[str]:
    """The ids of the dense branch's top PREFETCH_LIMIT."""
    response = target.query_points(
        collection,
        query=vector,
        using=DENSE_VECTOR,
        limit=PREFETCH_LIMIT,
        query_filter=query_filter,
        search_params=params,
        with_payload=False,
    )
    return {str(point.id) for point in response.points}


def check_recall(
    target: QdrantClient,
    dense: DenseEncoder,
    gold_files: Sequence[Path],
    hnsw: Mapping[str, bool],
) -> bool:
    """ANN against exact search, for the dense branch as `rag.gold` filters it:
    the evaluation scope on slides, the crawl snapshot on unifi_web."""
    from qdrant_client import models

    recalls: dict[str, list[tuple[str, float]]] = {name: [] for name in COLLECTIONS}
    for path in gold_files:
        for question in load_gold(path):
            vector = dense.encode_query(question.question)
            if question.target == COLLECTION:
                query_filter = payload_filter(None, scope=EVAL_SCOPE)
            else:
                query_filter = payload_filter(None, scope=None, ingest_source="crawl")
            approximate = nearest(target, question.target, vector, query_filter, None)
            exact = nearest(
                target, question.target, vector, query_filter, models.SearchParams(exact=True)
            )
            recall = len(approximate & exact) / len(exact) if exact else 1.0
            recalls[question.target].append((question.id, recall))
    ok = True
    for name, results in recalls.items():
        if not results:
            continue
        values = [recall for _, recall in results]
        print(
            f"recall@{PREFETCH_LIMIT} {name}: mean {sum(values) / len(values):.3f} "
            f"min {min(values):.3f} over {len(values)} questions"
        )
        below = [f"{qid}={recall:.2f}" for qid, recall in results if recall < 1.0]
        if below:
            print(f"below 1.00: {' '.join(below)}")
        if not hnsw[name]:
            print("gate: exact by construction")
        elif sum(values) / len(values) >= RECALL_TARGET:
            print("gate: PASS")
        else:
            print("gate: FAIL")
            ok = False
    return ok


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--from", dest="source", required=True, metavar="DIR")
    parser.add_argument(
        "--to", dest="target", default=None, metavar="URL", help="default: QDRANT_URL"
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="stop after the preflight")
    mode.add_argument(
        "--verify-only", action="store_true", help="check a finished move again, moving nothing"
    )
    parser.add_argument(
        "--replace",
        action="store_true",
        help="recreate the collections the target holds, unless that deletes a point the "
        "source lacks",
    )
    parser.add_argument(
        "--gold",
        type=Path,
        action="append",
        default=None,
        metavar="FILE",
        help="gold set whose questions measure recall; repeatable (default: smoke and campus)",
    )
    parser.add_argument("--dense-model", default=DEFAULT_DENSE_MODEL)
    args = parser.parse_args(argv)

    configure_cli_logging()
    started = time.perf_counter()
    source = open_client(args.source)
    print(f"open: source in {elapsed(started)}")
    target = open_client(args.target)
    print(f"open: target qdrant {target.info().version}")
    try:
        source_pairs = preflight(source, target, replace=args.replace, verify_only=args.verify_only)
        if args.dry_run:
            print("dry run: nothing moved")
            return
        if not args.verify_only:
            started = time.perf_counter()
            source.migrate(
                target, collection_names=list(COLLECTIONS), recreate_on_collision=args.replace
            )
            print(f"migrate: {', '.join(COLLECTIONS)} in {elapsed(started)}")
            for name in COLLECTIONS:
                created = ensure_payload_indexes(target, name)
                print(f"payload indexes: {name} created {len(created)}")
        checks = [check_config(source, target, update=not args.verify_only)]
        started = time.perf_counter()
        for name in COLLECTIONS:
            info = wait_green(target, name)
            print(
                f"status: {name} green, {info.points_count} points in "
                f"{info.segments_count} segments ({elapsed(started)})"
            )
        hnsw: dict[str, bool] = {}
        for name in COLLECTIONS:
            with_hnsw, segments, indexed = dense_index_state(target, name)
            hnsw[name] = with_hnsw > 0
            if with_hnsw:
                print(
                    f"dense index: {name} hnsw {with_hnsw}/{segments} segments, "
                    f"{indexed} vectors indexed"
                )
            else:
                print(f"dense index: {name} plain (exact by construction)")
        started = time.perf_counter()
        checks.append(check_counts(source, target, source_pairs))
        checks.append(check_points(source, target))
        print(f"compare: {elapsed(started)}")
        started = time.perf_counter()
        encoder = build_dense_encoder(args.dense_model)
        checks.append(check_recall(target, encoder, args.gold or DEFAULT_GOLD, hnsw))
        print(f"recall: {elapsed(started)}")
    finally:
        source.close()
        target.close()
    print(f"result: {'PASS' if all(checks) else 'FAIL'}")
    if not all(checks):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
