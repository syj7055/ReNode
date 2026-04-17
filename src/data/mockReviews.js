import reviewsCsvRaw from "../../resources/reviews_preprocessed.csv?raw";
import similarityEdges from "../../resources/review_similarity_edges.json";

const CHILD_FRIENDLY_TAG = "유아 동반 가능";
const SOLO_DINING_TAG = "혼밥";

const AVATAR_COLORS = ["#f97316", "#0ea5e9", "#22c55e", "#f43f5e", "#f59e0b", "#14b8a6", "#6366f1", "#8b5cf6"];

const normalizeWhitespace = (value) =>
  String(value || "")
    .replace(/\r/g, "")
    .replace(/\s+/g, " ")
    .trim();

const normalizeReviewText = (value) => normalizeWhitespace(String(value || "").replace(/접기/g, ""));

const splitTagList = (value) => {
  if (!value) {
    return [];
  }

  return Array.from(
    new Set(
      String(value)
        .split(/[|,]/)
        .map((item) => normalizeWhitespace(item))
        .filter(Boolean)
    )
  );
};

const parseNumber = (value, fallback = 0) => {
  const normalized = String(value || "")
    .replace(/[^0-9.-]/g, "")
    .trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseBinary = (value) => parseNumber(value, 0) === 1;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const hashText = (text) => {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
};

const pickAvatarColor = (name) => AVATAR_COLORS[hashText(name) % AVATAR_COLORS.length];

const removeBranchSuffix = (name) =>
  normalizeWhitespace(name)
    .replace(/\s*울산구영점$/u, "")
    .replace(/\s*구영점$/u, "")
    .replace(/\s*본점$/u, "")
    .trim();

const inferCategory = (name) => {
  if (/커피|카페|투썸/u.test(name)) return "카페";
  if (/스시|초밥/u.test(name)) return "스시";
  if (/장어/u.test(name)) return "장어";
  if (/국밥|칼국수/u.test(name)) return "한식";
  if (/빵|베이커리|랑콩/u.test(name)) return "베이커리";
  if (/버터|당몽/u.test(name)) return "디저트";
  if (/고기|비프/u.test(name)) return "고기";
  return "다이닝";
};

const SIGNATURE_BY_CATEGORY = {
  "카페": "시그니처 라떼",
  "스시": "숙성 모둠초밥",
  "장어": "숯불 장어 정식",
  "한식": "시그니처 한상",
  "베이커리": "버터 크루아상",
  "디저트": "크림 디저트",
  "고기": "숙성 고기 세트",
  "다이닝": "셰프 스페셜",
};

const extractSharedSentence = (text) => {
  const rawParts = String(text || "")
    .split(/[.!?\n]/)
    .map((part) => normalizeWhitespace(part))
    .filter((part) => part.length >= 12);
  return rawParts[0] ? `${rawParts[0]}.` : "";
};

const parseCsv = (csvText) => {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const text = String(csvText || "").replace(/^\uFEFF/, "");

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        i += 1;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows;
};

const tableRows = parseCsv(reviewsCsvRaw);
const header = tableRows[0] || [];

const records = tableRows
  .slice(1)
  .filter((row) => row.some((cell) => normalizeWhitespace(cell).length > 0))
  .map((row) => {
    const mapped = {};
    header.forEach((key, idx) => {
      mapped[key] = row[idx] || "";
    });
    return mapped;
  })
  .filter((record) => normalizeWhitespace(record.place_id) && normalizeWhitespace(record.review_text));

const purposeFrequency = new Map();
const placeBucket = new Map();
const reviewRows = [];

records.forEach((record, idx) => {
  const placeId = normalizeWhitespace(record.place_id) || `place-${idx + 1}`;
  const rawPlaceName = normalizeWhitespace(record.place_name) || `Place ${idx + 1}`;
  const placeName = removeBranchSuffix(rawPlaceName);
  const purposeTags = splitTagList(record["방문 목적"]);
  const keywordTags = splitTagList(record.keywords);
  const childFriendly = parseBinary(record.child_friendly);
  const soloDining = parseBinary(record.solo_dining);

  purposeTags.forEach((purpose) => {
    purposeFrequency.set(purpose, (purposeFrequency.get(purpose) || 0) + 1);
  });

  const visitTags = Array.from(
    new Set([
      ...purposeTags,
      ...(childFriendly ? [CHILD_FRIENDLY_TAG] : []),
      ...(soloDining ? [SOLO_DINING_TAG] : []),
    ])
  );

  const rating = clamp(parseNumber(record.rating, 4.3), 1, 5);
  const helpfulCount = Math.max(0, parseNumber(record.helpful_count, 0));
  const reviewText = normalizeReviewText(record.review_text);
  const scoreRaw = 56 + helpfulCount * 4 + Math.min(24, reviewText.length / 30) + keywordTags.length * 0.7;
  const helpfulnessScore = clamp(Math.round(scoreRaw), 55, 98);

  const reviewRow = {
    id: `${placeId}-review-${idx + 1}`,
    placeId,
    placeName,
    author: normalizeWhitespace(record.user_name) || "익명 사용자",
    avatarColor: pickAvatarColor(normalizeWhitespace(record.user_name) || `user-${idx}`),
    rating: Number(rating.toFixed(1)),
    helpfulnessScore,
    centrality: Number((0.22 + helpfulnessScore / 130).toFixed(2)),
    date: normalizeWhitespace(record.created_at),
    visitTags,
    purpose: purposeTags[0] || "일상",
    facilities: [
      ...(childFriendly ? [CHILD_FRIENDLY_TAG] : []),
      ...(soloDining ? [SOLO_DINING_TAG] : []),
    ],
    keywords: Array.from(new Set([...(keywordTags.length ? keywordTags : splitTagList(record.visit_info))])),
    sharedSentences: [extractSharedSentence(reviewText)].filter(Boolean),
    text: reviewText,
  };

  reviewRows.push(reviewRow);

  if (!placeBucket.has(placeId)) {
    placeBucket.set(placeId, {
      id: placeId,
      rawName: rawPlaceName,
      name: placeName,
      rows: [],
      ratings: [],
      tags: new Map(),
      keywordFreq: new Map(),
    });
  }

  const bucket = placeBucket.get(placeId);
  bucket.rows.push(reviewRow);
  bucket.ratings.push(reviewRow.rating);

  reviewRow.visitTags.forEach((tag) => {
    bucket.tags.set(tag, (bucket.tags.get(tag) || 0) + 1);
  });

  reviewRow.keywords.forEach((keyword) => {
    bucket.keywordFreq.set(keyword, (bucket.keywordFreq.get(keyword) || 0) + 1);
  });
});

const FILTER_PILLS = [
  ...Array.from(
    new Set([
      ...Array.from(purposeFrequency.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([purpose]) => purpose),
      CHILD_FRIENDLY_TAG,
      SOLO_DINING_TAG,
    ])
  ),
];

const MOCK_PLACES = Array.from(placeBucket.values())
  .map((bucket) => {
    const avgRating =
      bucket.ratings.length > 0 ? bucket.ratings.reduce((sum, value) => sum + value, 0) / bucket.ratings.length : 4.3;
    const tagTop = Array.from(bucket.tags.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([tag]) => tag);
    const signature = Array.from(bucket.keywordFreq.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([keyword]) => keyword)[0];

    const category = inferCategory(bucket.name);

    return {
      id: bucket.id,
      name: bucket.name,
      category,
      district: "울산 울주군 구영리",
      priceBand: "방문자 리뷰 기반",
      rating: Number(avgRating.toFixed(1)),
      tags: tagTop,
      signature: signature || SIGNATURE_BY_CATEGORY[category] || "리뷰 인기 메뉴",
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name, "ko"));

const placeOrderMap = new Map(MOCK_PLACES.map((place, idx) => [place.id, idx]));

const MOCK_REVIEWS = reviewRows.sort((a, b) => {
  const placeOrderGap = (placeOrderMap.get(a.placeId) || 0) - (placeOrderMap.get(b.placeId) || 0);
  if (placeOrderGap !== 0) {
    return placeOrderGap;
  }
  return b.helpfulnessScore - a.helpfulnessScore;
});

const semanticEdgesByPlace = similarityEdges?.by_place || {};
const semanticNodeMetricsByPlace = similarityEdges?.node_metrics_by_place || {};

const getTopKeywordsForReviews = (reviews, limit = 3) => {
  const keywordFreq = new Map();

  reviews.forEach((review) => {
    review.keywords.forEach((keyword) => {
      const normalized = normalizeWhitespace(keyword);
      if (!normalized) {
        return;
      }
      keywordFreq.set(normalized, (keywordFreq.get(normalized) || 0) + 1);
    });
  });

  const topKeywords = Array.from(keywordFreq.entries())
    .sort((a, b) => {
      if (b[1] !== a[1]) {
        return b[1] - a[1];
      }
      return a[0].localeCompare(b[0], "ko");
    })
    .slice(0, limit)
    .map(([keyword]) => keyword);

  while (topKeywords.length < limit) {
    topKeywords.push(`키워드 ${topKeywords.length + 1}`);
  }

  return topKeywords;
};

const normalizeRange = (value, min, max, fallback = 0.5) => {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return fallback;
  }
  return clamp((value - min) / (max - min), 0, 1);
};

const pickPrimaryKeyword = (review, topKeywords) => {
  const matched = topKeywords.find((keyword) => review.keywords.includes(keyword));
  return matched || topKeywords[0];
};

const buildGraphData = (reviews, placeId) => {
  if (!reviews.length) {
    return {
      nodes: [],
      links: [],
      clusterKeywords: [],
    };
  }

  const topKeywords = getTopKeywordsForReviews(reviews, 3);
  const placeMetrics = semanticNodeMetricsByPlace[placeId] || {};
  const links = [];
  const reliabilityScores = reviews.map((review) => review.helpfulnessScore);
  const reliabilityMin = Math.min(...reliabilityScores);
  const reliabilityMax = Math.max(...reliabilityScores);
  const nodeMap = new Map(
    reviews.map((review) => [
      review.id,
      {
        id: review.id,
        reliabilityScore: review.helpfulnessScore,
        size: Number((3.8 + normalizeRange(review.helpfulnessScore, reliabilityMin, reliabilityMax) * 8.2).toFixed(3)),
        colorValue: (() => {
          const value = Number(placeMetrics[review.id]?.color_value);
          return clamp(Number.isFinite(value) ? value : 0, 0, 1);
        })(),
        centralGravity: (() => {
          const value = Number(placeMetrics[review.id]?.central_gravity);
          return clamp(Number.isFinite(value) ? value : 0, 0, 1);
        })(),
        eigenvectorCentrality: (() => {
          const value = Number(placeMetrics[review.id]?.eigenvector_centrality);
          return Number.isFinite(value) ? value : 0;
        })(),
        betweennessCentrality: (() => {
          const value = Number(placeMetrics[review.id]?.betweenness_centrality);
          return Number.isFinite(value) ? value : 0;
        })(),
        primaryKeyword: pickPrimaryKeyword(review, topKeywords),
        helpfulnessScore: review.helpfulnessScore,
        centrality: review.centrality,
        purpose: review.purpose,
      },
    ])
  );
  const reviewIdSet = new Set(reviews.map((review) => review.id));
  const placeEdges = Array.isArray(semanticEdgesByPlace[placeId]) ? semanticEdgesByPlace[placeId] : [];

  placeEdges.forEach((edge) => {
    const source = String(edge?.source || "");
    const target = String(edge?.target || "");
    if (!reviewIdSet.has(source) || !reviewIdSet.has(target)) {
      return;
    }

    const weight = Number(edge?.weight);
    links.push({
      source,
      target,
      weight: Number.isFinite(weight) ? Number(weight.toFixed(4)) : 0,
      reason: "의미 유사도",
    });
  });

  const degree = new Map();
  links.forEach((link) => {
    degree.set(link.source, (degree.get(link.source) || 0) + 1);
    degree.set(link.target, (degree.get(link.target) || 0) + 1);
  });

  const maxDegree = Math.max(1, ...Array.from(degree.values()));
  const nodesByGravity = Array.from(nodeMap.values()).sort((a, b) => b.centralGravity - a.centralGravity);
  const bridgeCount = Math.max(1, Math.ceil(nodesByGravity.length * 0.1));
  const bridgeNodeIds = new Set(nodesByGravity.slice(0, bridgeCount).map((node) => node.id));
  const keywordToClusterIndex = new Map(topKeywords.map((keyword, idx) => [keyword, idx]));

  nodeMap.forEach((node) => {
    const degreeRatio = (degree.get(node.id) || 0) / maxDegree;
    node.clusterIndex = keywordToClusterIndex.get(node.primaryKeyword) ?? 0;
    node.isBridge = bridgeNodeIds.has(node.id);
    node.centrality = Number((0.2 + degreeRatio * 0.45 + node.size / 30).toFixed(2));
  });

  return {
    nodes: Array.from(nodeMap.values()),
    links,
    clusterKeywords: topKeywords,
  };
};

const MOCK_GRAPH_BY_PLACE = Object.fromEntries(
  MOCK_PLACES.map((place) => {
    const placeReviews = MOCK_REVIEWS.filter((review) => review.placeId === place.id);
    return [place.id, buildGraphData(placeReviews, place.id)];
  })
);

export { FILTER_PILLS, MOCK_PLACES, MOCK_REVIEWS, MOCK_GRAPH_BY_PLACE };
