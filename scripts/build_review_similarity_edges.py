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


def split_keywords(value: str | None) -> List[str]:
    normalized = normalize_text(value)
    if not normalized:
        return []

    seen = set()
    results: List[str] = []

    for token in (
        normalized.replace("/", "|").replace(",", "|").replace(";", "|").split("|")
    ):
        keyword = normalize_text(token)
        if not keyword or keyword in seen:
            continue
        seen.add(keyword)
        results.append(keyword)

    return results


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

            keywords = split_keywords(row.get("keywords"))
            if not keywords:
                keywords = split_keywords(row.get("visit_info"))

            filtered_index += 1
            review_id = f"{place_id}-review-{filtered_index}"
            groups[place_id].append(
                {
                    "review_id": review_id,
                    "text": review_text,
                    "keywords": keywords,
                }
            )

    return groups


def min_max_normalize(value: float, minimum: float, maximum: float) -> float:
    if maximum <= minimum:
        return 0.0
    return (value - minimum) / (maximum - minimum)


def build_edges(
    groups: Dict[str, List[dict]],
    model: SentenceTransformer,
    threshold: float,
    batch_size: int,
    max_text_length: int,
    progress_every: int,
    keyword_threshold: float,
    keyword_fallback_threshold: float,
    keyword_top_gap: float,
    max_keywords_per_review: int,
) -> Tuple[Dict[str, List[dict]], Dict[str, Dict[str, List[dict]]]]:
    by_place: Dict[str, List[dict]] = {}
    related_keywords_by_place: Dict[str, Dict[str, List[dict]]] = {}

    place_ids = sorted(groups.keys())
    for idx, place_id in enumerate(place_ids, start=1):
        items = groups[place_id]
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

        keyword_map_for_place: Dict[str, List[dict]] = {}
        keyword_candidates = sorted(
            {
                keyword
                for item in items
                for keyword in item.get("keywords", [])
                if normalize_text(keyword)
            }
        )

        if keyword_candidates:
            keyword_embeddings = model.encode(
                keyword_candidates,
                batch_size=max(32, min(batch_size, 128)),
                convert_to_tensor=True,
                normalize_embeddings=True,
                show_progress_bar=False,
            )
            keyword_scores = util.cos_sim(embeddings, keyword_embeddings).cpu()
            keyword_to_index = {keyword: i for i, keyword in enumerate(keyword_candidates)}

            for review_idx, item in enumerate(items):
                review_id = item["review_id"]
                own_keywords = [
                    keyword
                    for keyword in item.get("keywords", [])
                    if keyword in keyword_to_index
                ]

                scored: List[dict] = []
                for keyword in keyword_candidates:
                    score = float(keyword_scores[review_idx, keyword_to_index[keyword]])
                    if score < keyword_threshold:
                        continue

                    # Slightly prefer original review tags among hard-matched keywords.
                    ranking_score = score + (0.025 if keyword in own_keywords else 0.0)
                    scored.append(
                        {
                            "keyword": keyword,
                            "score": score,
                            "ranking_score": ranking_score,
                        }
                    )

                if not scored and own_keywords:
                    for keyword in own_keywords:
                        score = float(keyword_scores[review_idx, keyword_to_index[keyword]])
                        if score >= keyword_fallback_threshold:
                            scored.append(
                                {
                                    "keyword": keyword,
                                    "score": score,
                                    "ranking_score": score + 0.02,
                                }
                            )

                if not scored and own_keywords:
                    best_keyword = max(
                        own_keywords,
                        key=lambda kw: float(keyword_scores[review_idx, keyword_to_index[kw]]),
                    )
                    best_score = float(keyword_scores[review_idx, keyword_to_index[best_keyword]])
                    scored.append(
                        {
                            "keyword": best_keyword,
                            "score": best_score,
                            "ranking_score": best_score + 0.02,
                        }
                    )

                scored.sort(key=lambda item: item["keyword"])
                scored.sort(key=lambda item: item["ranking_score"], reverse=True)

                if scored:
                    top_score = scored[0]["ranking_score"]
                    scored = [
                        entry
                        for entry in scored
                        if float(entry["ranking_score"]) >= float(top_score) - keyword_top_gap
                    ]

                keyword_map_for_place[review_id] = [
                    {
                        "keyword": entry["keyword"],
                        "score": round(float(entry["score"]), 6),
                    }
                    for entry in scored[:max_keywords_per_review]
                ]
        else:
            for item in items:
                review_id = item["review_id"]
                keyword_map_for_place[review_id] = [
                    {
                        "keyword": keyword,
                        "score": 0.0,
                    }
                    for keyword in item.get("keywords", [])[:max_keywords_per_review]
                ]

        by_place[place_id] = edges
        related_keywords_by_place[place_id] = keyword_map_for_place
        if idx % progress_every == 0 or idx == len(place_ids):
            print(f"[progress] places={idx}/{len(place_ids)}", flush=True)

    return by_place, related_keywords_by_place


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
        default=0.72,
        help="Cosine similarity threshold",
    )
    parser.add_argument(
        "--keyword-threshold",
        type=float,
        default=0.58,
        help="Hard cosine threshold for review-keyword mapping",
    )
    parser.add_argument(
        "--keyword-fallback-threshold",
        type=float,
        default=0.5,
        help="Fallback cosine threshold (applied only to original review keywords)",
    )
    parser.add_argument(
        "--keyword-top-gap",
        type=float,
        default=0.08,
        help="Keep only keywords within this score gap from the best keyword",
    )
    parser.add_argument(
        "--max-keywords-per-review",
        type=int,
        default=4,
        help="Max number of mapped related keywords saved per review",
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
    model = SentenceTransformer(args.model)
    by_place_edges, related_keywords_by_place = build_edges(
        groups=groups,
        model=model,
        threshold=args.threshold,
        batch_size=args.batch_size,
        max_text_length=args.max_text_length,
        progress_every=max(1, args.progress_every),
        keyword_threshold=args.keyword_threshold,
        keyword_fallback_threshold=args.keyword_fallback_threshold,
        keyword_top_gap=max(0.0, args.keyword_top_gap),
        max_keywords_per_review=max(1, args.max_keywords_per_review),
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
            "keyword_mapping": {
                "enabled": True,
                "keyword_threshold": args.keyword_threshold,
                "keyword_fallback_threshold": args.keyword_fallback_threshold,
                "keyword_top_gap": max(0.0, args.keyword_top_gap),
                "max_keywords_per_review": max(1, args.max_keywords_per_review),
            },
            "metrics": metric_meta,
        },
        "by_place": by_place_edges,
        "node_metrics_by_place": node_metrics_by_place,
        "related_keywords_by_place": related_keywords_by_place,
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
