#!/usr/bin/env python3
"""Precompute within-place review similarity edges with Korean Sentence-BERT."""

from __future__ import annotations

import argparse
import csv
import json
import re
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


def split_sentences(value: str | None, min_length: int = 10) -> List[str]:
    normalized = normalize_text(value)
    if not normalized:
        return []

    parts = [normalize_text(part) for part in re.split(r"[.!?\n]+", normalized)]
    seen = set()
    results: List[str] = []

    for part in parts:
        if len(part) < min_length:
            continue
        sentence = part[:140]
        if sentence in seen:
            continue
        seen.add(sentence)
        results.append(sentence)

    if results:
        return results

    compact = normalized[:140]
    return [compact] if compact else []


def parse_number(value: str | None, fallback: float = 0.0) -> float:
    raw = normalize_text(value)
    if not raw:
        return fallback
    cleaned = "".join(ch for ch in raw if (ch.isdigit() or ch in ".-"))
    if not cleaned:
        return fallback
    try:
        return float(cleaned)
    except ValueError:
        return fallback


def get_review_rank_score(helpful_count: float, text: str, keyword_count: int) -> float:
    score_raw = 56.0 + helpful_count * 4.0 + min(24.0, len(text) / 30.0) + keyword_count * 0.7
    return max(55.0, min(98.0, round(score_raw)))


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
            helpful_count = max(0.0, parse_number(row.get("helpful_count"), 0.0))

            filtered_index += 1
            review_id = f"{place_id}-review-{filtered_index}"
            groups[place_id].append(
                {
                    "review_id": review_id,
                    "text": review_text,
                    "keywords": keywords,
                    "helpful_count": helpful_count,
                    "rank_score": get_review_rank_score(helpful_count, review_text, len(keywords)),
                }
            )

    return groups


def min_max_normalize(value: float, minimum: float, maximum: float) -> float:
    if maximum <= minimum:
        return 0.0
    return (value - minimum) / (maximum - minimum)


def compute_shared_sentences_for_place(
    items: List[dict],
    model: SentenceTransformer,
    batch_size: int,
    sentence_similarity_threshold: float,
    max_sentences_per_review: int,
) -> Dict[str, List[dict]]:
    review_count = len(items)
    if review_count == 0:
        return {}

    ranked_items = sorted(
        items,
        key=lambda entry: float(entry.get("rank_score", 0.0)),
        reverse=True,
    )
    focus_items = ranked_items[:20]
    background_items = ranked_items[20:]

    sentence_rows: List[dict] = []
    indices_by_review: Dict[str, List[int]] = defaultdict(list)

    for item in focus_items:
        review_id = str(item["review_id"])
        sentence_candidates = split_sentences(item.get("text"))
        sentence_candidates = sentence_candidates[: max(1, max_sentences_per_review)]

        if not sentence_candidates:
            fallback = normalize_text(item.get("text"))[:140]
            sentence_candidates = [fallback] if fallback else []

        for sentence in sentence_candidates:
            sentence_rows.append(
                {
                    "review_id": review_id,
                    "sentence": sentence,
                }
            )
            indices_by_review[review_id].append(len(sentence_rows) - 1)

    shared_map: Dict[str, List[dict]] = {}

    if sentence_rows:
        sentence_embeddings = model.encode(
            [row["sentence"] for row in sentence_rows],
            batch_size=max(24, min(batch_size, 96)),
            convert_to_tensor=True,
            normalize_embeddings=True,
            show_progress_bar=False,
        )
        sentence_scores = util.cos_sim(sentence_embeddings, sentence_embeddings).cpu()
        max_peer_reviews = max(1, len(focus_items) - 1)

        for item in focus_items:
            review_id = str(item["review_id"])
            sentence_indices = indices_by_review.get(review_id, [])

            best_payload = {
                "sentence": "",
                "score": 0.0,
                "matched_reviews": 0,
            }

            for sentence_idx in sentence_indices:
                matches = set()
                sims: List[float] = []

                for other_idx, other_row in enumerate(sentence_rows):
                    if other_idx == sentence_idx:
                        continue
                    if other_row["review_id"] == review_id:
                        continue

                    similarity = float(sentence_scores[sentence_idx, other_idx])
                    if similarity < sentence_similarity_threshold:
                        continue

                    matches.add(other_row["review_id"])
                    sims.append(similarity)

                if sims:
                    sims.sort(reverse=True)
                    avg_top_sim = sum(sims[:5]) / min(5, len(sims))
                else:
                    avg_top_sim = 0.0

                coverage = len(matches) / max_peer_reviews
                consensus_score = coverage * 0.68 + avg_top_sim * 0.32

                candidate = {
                    "sentence": sentence_rows[sentence_idx]["sentence"],
                    "score": consensus_score,
                    "matched_reviews": len(matches),
                    "avg_top_similarity": avg_top_sim,
                }

                is_better = (
                    candidate["score"] > best_payload["score"]
                    or (
                        candidate["score"] == best_payload["score"]
                        and candidate["matched_reviews"] > best_payload["matched_reviews"]
                    )
                    or (
                        candidate["score"] == best_payload["score"]
                        and candidate["matched_reviews"] == best_payload["matched_reviews"]
                        and len(candidate["sentence"]) > len(best_payload["sentence"])
                    )
                )

                if is_better:
                    best_payload = candidate

            if not best_payload["sentence"] and sentence_indices:
                fallback_sentence = sentence_rows[sentence_indices[0]]["sentence"]
                best_payload = {
                    "sentence": fallback_sentence,
                    "score": 0.0,
                    "matched_reviews": 0,
                }

            shared_map[review_id] = (
                [
                    {
                        "sentence": best_payload["sentence"],
                        "score": round(float(best_payload["score"]), 6),
                        "matched_reviews": int(best_payload["matched_reviews"]),
                    }
                ]
                if best_payload["sentence"]
                else []
            )
    else:
        for item in focus_items:
            review_id = str(item["review_id"])
            fallback_candidates = split_sentences(item.get("text"))
            fallback_sentence = fallback_candidates[0] if fallback_candidates else normalize_text(item.get("text"))[:140]
            shared_map[review_id] = (
                [
                    {
                        "sentence": fallback_sentence,
                        "score": 0.0,
                        "matched_reviews": 0,
                    }
                ]
                if fallback_sentence
                else []
            )

    for item in background_items:
        review_id = str(item["review_id"])
        fallback_candidates = split_sentences(item.get("text"))
        fallback_sentence = fallback_candidates[0] if fallback_candidates else normalize_text(item.get("text"))[:140]
        shared_map[review_id] = (
            [
                {
                    "sentence": fallback_sentence,
                    "score": 0.0,
                    "matched_reviews": 0,
                }
            ]
            if fallback_sentence
            else []
        )

    for item in items:
        review_id = str(item["review_id"])
        if review_id not in shared_map:
            shared_map[review_id] = []

    return shared_map


def build_shared_sentences(
    groups: Dict[str, List[dict]],
    model: SentenceTransformer,
    batch_size: int,
    progress_every: int,
    sentence_similarity_threshold: float,
    max_sentences_per_review: int,
) -> Dict[str, Dict[str, List[dict]]]:
    shared_sentences_by_place: Dict[str, Dict[str, List[dict]]] = {}
    place_ids = sorted(groups.keys())

    for idx, place_id in enumerate(place_ids, start=1):
        shared_sentences_by_place[place_id] = compute_shared_sentences_for_place(
            items=groups[place_id],
            model=model,
            batch_size=batch_size,
            sentence_similarity_threshold=sentence_similarity_threshold,
            max_sentences_per_review=max_sentences_per_review,
        )

        if idx % progress_every == 0 or idx == len(place_ids):
            print(f"[progress] shared_sentences places={idx}/{len(place_ids)}", flush=True)

    return shared_sentences_by_place


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
    sentence_similarity_threshold: float,
    max_sentences_per_review: int,
) -> Tuple[
    Dict[str, List[dict]],
    Dict[str, Dict[str, List[dict]]],
    Dict[str, Dict[str, List[dict]]],
]:
    by_place: Dict[str, List[dict]] = {}
    related_keywords_by_place: Dict[str, Dict[str, List[dict]]] = {}
    shared_sentences_by_place: Dict[str, Dict[str, List[dict]]] = {}

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

                # Ensure at least one keyword is retained for each review.
                if not scored:
                    fallback_pool = own_keywords if own_keywords else keyword_candidates
                    if fallback_pool:
                        best_keyword = max(
                            fallback_pool,
                            key=lambda kw: float(keyword_scores[review_idx, keyword_to_index[kw]]),
                        )
                        best_score = float(keyword_scores[review_idx, keyword_to_index[best_keyword]])
                        scored.append(
                            {
                                "keyword": best_keyword,
                                "score": best_score,
                                "ranking_score": best_score + (0.02 if best_keyword in own_keywords else 0.0),
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

        shared_sentences_for_place = compute_shared_sentences_for_place(
            items=items,
            model=model,
            batch_size=batch_size,
            sentence_similarity_threshold=sentence_similarity_threshold,
            max_sentences_per_review=max_sentences_per_review,
        )

        by_place[place_id] = edges
        related_keywords_by_place[place_id] = keyword_map_for_place
        shared_sentences_by_place[place_id] = shared_sentences_for_place
        if idx % progress_every == 0 or idx == len(place_ids):
            print(f"[progress] places={idx}/{len(place_ids)}", flush=True)

    return by_place, related_keywords_by_place, shared_sentences_by_place


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
        default=0.64,
        help="Hard cosine threshold for review-keyword mapping",
    )
    parser.add_argument(
        "--keyword-fallback-threshold",
        type=float,
        default=0.6,
        help="Fallback cosine threshold (applied only to original review keywords)",
    )
    parser.add_argument(
        "--keyword-top-gap",
        type=float,
        default=0.04,
        help="Keep only keywords within this score gap from the best keyword",
    )
    parser.add_argument(
        "--max-keywords-per-review",
        type=int,
        default=2,
        help="Max number of mapped related keywords saved per review",
    )
    parser.add_argument(
        "--sentence-sim-threshold",
        type=float,
        default=0.58,
        help="Cosine threshold for cross-review sentence matching",
    )
    parser.add_argument(
        "--max-sentences-per-review",
        type=int,
        default=4,
        help="Max candidate sentences evaluated per review",
    )
    parser.add_argument(
        "--only-shared-sentences",
        action="store_true",
        help="Update only shared sentence highlights and keep existing graph resources",
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

    progress_every = max(1, args.progress_every)
    sentence_similarity_threshold = max(0.0, min(1.0, args.sentence_sim_threshold))
    max_sentences_per_review = max(1, args.max_sentences_per_review)

    existing_payload: dict = {}
    existing_meta: dict = {}

    if args.only_shared_sentences and output_path.exists():
        try:
            loaded = json.loads(output_path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                existing_payload = loaded
                raw_meta = existing_payload.get("meta", {})
                if isinstance(raw_meta, dict):
                    existing_meta = raw_meta
        except Exception:
            existing_payload = {}
            existing_meta = {}

    if args.only_shared_sentences:
        shared_sentences_by_place = build_shared_sentences(
            groups=groups,
            model=model,
            batch_size=args.batch_size,
            progress_every=progress_every,
            sentence_similarity_threshold=sentence_similarity_threshold,
            max_sentences_per_review=max_sentences_per_review,
        )

        by_place_edges = existing_payload.get("by_place", {})
        if not isinstance(by_place_edges, dict):
            by_place_edges = {}

        related_keywords_by_place = existing_payload.get("related_keywords_by_place", {})
        if not isinstance(related_keywords_by_place, dict):
            related_keywords_by_place = {}

        node_metrics_by_place = existing_payload.get("node_metrics_by_place", {})
        if not isinstance(node_metrics_by_place, dict):
            node_metrics_by_place = {}

        metric_meta = existing_meta.get("metrics", {}) if isinstance(existing_meta.get("metrics", {}), dict) else {}
        if not metric_meta:
            metric_meta = {
                "eigenvector_min": 0.0,
                "eigenvector_max": 0.0,
                "betweenness_min": 0.0,
                "betweenness_max": 0.0,
            }
    else:
        by_place_edges, related_keywords_by_place, shared_sentences_by_place = build_edges(
            groups=groups,
            model=model,
            threshold=args.threshold,
            batch_size=args.batch_size,
            max_text_length=args.max_text_length,
            progress_every=progress_every,
            keyword_threshold=args.keyword_threshold,
            keyword_fallback_threshold=args.keyword_fallback_threshold,
            keyword_top_gap=max(0.0, args.keyword_top_gap),
            max_keywords_per_review=max(1, args.max_keywords_per_review),
            sentence_similarity_threshold=sentence_similarity_threshold,
            max_sentences_per_review=max_sentences_per_review,
        )

        node_metrics_by_place, metric_meta = compute_node_metrics(
            groups=groups,
            by_place_edges=by_place_edges,
        )

    keyword_mapping_meta = {
        "enabled": True,
        "keyword_threshold": args.keyword_threshold,
        "keyword_fallback_threshold": args.keyword_fallback_threshold,
        "keyword_top_gap": max(0.0, args.keyword_top_gap),
        "max_keywords_per_review": max(1, args.max_keywords_per_review),
    }
    if args.only_shared_sentences and isinstance(existing_meta.get("keyword_mapping"), dict):
        keyword_mapping_meta = existing_meta["keyword_mapping"]

    threshold_meta = (
        float(existing_meta.get("threshold", args.threshold))
        if args.only_shared_sentences
        else args.threshold
    )

    payload = {
        "meta": {
            "model": args.model,
            "threshold": threshold_meta,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "place_count": len(groups),
            "review_count": sum(len(v) for v in groups.values()),
            "edge_count": sum(len(v) for v in by_place_edges.values()),
            "within_place_only": True,
            "keyword_mapping": keyword_mapping_meta,
            "sentence_highlight": {
                "enabled": True,
                "sentence_similarity_threshold": sentence_similarity_threshold,
                "max_sentences_per_review": max_sentences_per_review,
                "top_reviews_per_place": 20,
            },
            "update_mode": "shared_sentences_only" if args.only_shared_sentences else "full_rebuild",
            "metrics": metric_meta,
        },
        "by_place": by_place_edges,
        "node_metrics_by_place": node_metrics_by_place,
        "related_keywords_by_place": related_keywords_by_place,
        "shared_sentences_by_place": shared_sentences_by_place,
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
