#!/usr/bin/env python3
"""Precompute within-place review similarity edges with Korean Sentence-BERT."""

from __future__ import annotations

import argparse
import csv
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Tuple

import networkx as nx
from sentence_transformers import SentenceTransformer, util


def normalize_text(value: str | None) -> str:
    text = (value or "").replace("\r", " ").replace("\n", " ")
    text = text.replace("\uC811\uAE30", "")
    return " ".join(text.split()).strip()


def load_reviews(csv_path: Path) -> Dict[str, List[dict]]:
    groups: Dict[str, List[dict]] = defaultdict(list)
    filtered_index = 0

    with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            place_id = normalize_text(row.get("place_id"))
            review_text = normalize_text(row.get("review_text"))
            if not place_id or not review_text:
                continue

            filtered_index += 1
            review_id = f"{place_id}-review-{filtered_index}"
            groups[place_id].append(
                {
                    "review_id": review_id,
                    "text": review_text,
                }
            )

    return groups


def min_max_normalize(value: float, minimum: float, maximum: float) -> float:
    if maximum <= minimum:
        return 0.0
    return (value - minimum) / (maximum - minimum)


def build_edges(
    groups: Dict[str, List[dict]],
    model_name: str,
    threshold: float,
    batch_size: int,
    max_text_length: int,
    progress_every: int,
) -> Dict[str, List[dict]]:
    model = SentenceTransformer(model_name)
    by_place: Dict[str, List[dict]] = {}

    place_ids = sorted(groups.keys())
    for idx, place_id in enumerate(place_ids, start=1):
        items = groups[place_id]
        if len(items) < 2:
            by_place[place_id] = []
            if idx % progress_every == 0 or idx == len(place_ids):
                print(f"[progress] places={idx}/{len(place_ids)}", flush=True)
            continue

        texts = [item["text"][:max_text_length] for item in items]
        embeddings = model.encode(
            texts,
            batch_size=batch_size,
            convert_to_tensor=True,
            normalize_embeddings=True,
            show_progress_bar=False,
        )

        scores = util.cos_sim(embeddings, embeddings).cpu()
        n_items = len(items)
        edges: List[dict] = []

        for i in range(n_items):
            for j in range(i + 1, n_items):
                score = float(scores[i, j])
                if score >= threshold:
                    edges.append(
                        {
                            "source": items[i]["review_id"],
                            "target": items[j]["review_id"],
                            "weight": round(score, 6),
                        }
                    )

        by_place[place_id] = edges
        if idx % progress_every == 0 or idx == len(place_ids):
            print(f"[progress] places={idx}/{len(place_ids)}", flush=True)

    return by_place


def compute_node_metrics(
    groups: Dict[str, List[dict]],
    by_place_edges: Dict[str, List[dict]],
) -> Tuple[Dict[str, Dict[str, dict]], dict]:
    graph = nx.Graph()
    node_to_place: Dict[str, str] = {}

    for place_id, items in groups.items():
        for item in items:
            review_id = item["review_id"]
            graph.add_node(review_id)
            node_to_place[review_id] = place_id

    for edges in by_place_edges.values():
        for edge in edges:
            source = str(edge["source"])
            target = str(edge["target"])
            weight = float(edge["weight"])
            distance = max(1e-6, 1.0 - weight)
            graph.add_edge(source, target, weight=weight, distance=distance)

    eigenvector: Dict[str, float] = {node_id: 0.0 for node_id in graph.nodes}
    for component_nodes in nx.connected_components(graph):
        component = graph.subgraph(component_nodes).copy()
        if component.number_of_nodes() == 1:
            only_node = next(iter(component_nodes))
            eigenvector[only_node] = 0.0
            continue

        try:
            partial = nx.eigenvector_centrality(
                component,
                max_iter=2000,
                tol=1e-06,
                weight="weight",
            )
        except Exception:
            partial = nx.degree_centrality(component)

        for node_id, value in partial.items():
            eigenvector[node_id] = float(value)

    if graph.number_of_nodes() <= 1:
        betweenness: Dict[str, float] = {node_id: 0.0 for node_id in graph.nodes}
    else:
        betweenness = {
            node_id: float(value)
            for node_id, value in nx.betweenness_centrality(
                graph,
                normalized=True,
                weight="distance",
            ).items()
        }

    eigen_values = [float(eigenvector.get(node_id, 0.0)) for node_id in graph.nodes]
    betweenness_values = [float(betweenness.get(node_id, 0.0)) for node_id in graph.nodes]

    eigen_min = min(eigen_values) if eigen_values else 0.0
    eigen_max = max(eigen_values) if eigen_values else 0.0
    between_min = min(betweenness_values) if betweenness_values else 0.0
    between_max = max(betweenness_values) if betweenness_values else 0.0

    node_metrics_by_place: Dict[str, Dict[str, dict]] = defaultdict(dict)

    for node_id in graph.nodes:
        place_id = node_to_place.get(node_id)
        if not place_id:
            continue

        eig = float(eigenvector.get(node_id, 0.0))
        bet = float(betweenness.get(node_id, 0.0))
        color_value = min_max_normalize(eig, eigen_min, eigen_max)
        central_gravity = min_max_normalize(bet, between_min, between_max)

        node_metrics_by_place[place_id][node_id] = {
            "eigenvector_centrality": round(eig, 8),
            "betweenness_centrality": round(bet, 8),
            "color_value": round(color_value, 8),
            "central_gravity": round(central_gravity, 8),
        }

    metric_meta = {
        "eigenvector_min": round(eigen_min, 8),
        "eigenvector_max": round(eigen_max, 8),
        "betweenness_min": round(between_min, 8),
        "betweenness_max": round(between_max, 8),
    }

    return dict(node_metrics_by_place), metric_meta


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Compute cosine similarity edges between reviews in the same place "
            "using Sentence-BERT."
        )
    )
    parser.add_argument(
        "--input",
        default="resources/reviews_preprocessed.csv",
        help="Input CSV path",
    )
    parser.add_argument(
        "--output",
        default="resources/review_similarity_edges.json",
        help="Output JSON path",
    )
    parser.add_argument(
        "--model",
        default="snunlp/KR-SBERT-V40K-klueNLI-augSTS",
        help="SentenceTransformer model name",
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=0.7,
        help="Cosine similarity threshold",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=64,
        help="Embedding batch size",
    )
    parser.add_argument(
        "--max-text-length",
        type=int,
        default=700,
        help="Max text length used per review",
    )
    parser.add_argument(
        "--progress-every",
        type=int,
        default=10,
        help="Print progress every N places",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    input_path = Path(args.input)
    output_path = Path(args.output)

    groups = load_reviews(input_path)
    by_place_edges = build_edges(
        groups=groups,
        model_name=args.model,
        threshold=args.threshold,
        batch_size=args.batch_size,
        max_text_length=args.max_text_length,
        progress_every=max(1, args.progress_every),
    )

    node_metrics_by_place, metric_meta = compute_node_metrics(
        groups=groups,
        by_place_edges=by_place_edges,
    )

    payload = {
        "meta": {
            "model": args.model,
            "threshold": args.threshold,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "place_count": len(groups),
            "review_count": sum(len(v) for v in groups.values()),
            "edge_count": sum(len(v) for v in by_place_edges.values()),
            "within_place_only": True,
            "metrics": metric_meta,
        },
        "by_place": by_place_edges,
        "node_metrics_by_place": node_metrics_by_place,
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    meta = payload["meta"]
    print("[done] similarity edge preprocessing completed")
    print(f"[meta] model={meta['model']}")
    print(f"[meta] threshold={meta['threshold']}")
    print(f"[meta] review_count={meta['review_count']}")
    print(f"[meta] edge_count={meta['edge_count']}")
    print(
        f"[meta] color_value_range={meta['metrics']['eigenvector_min']}..{meta['metrics']['eigenvector_max']}"
    )
    print(
        f"[meta] central_gravity_range={meta['metrics']['betweenness_min']}..{meta['metrics']['betweenness_max']}"
    )
    print(f"[meta] output={output_path}")


if __name__ == "__main__":
    main()
