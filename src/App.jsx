import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Clock3 } from "lucide-react";
import FilterPills from "./components/FilterPills";
import LoadingScene from "./components/LoadingScene";
import GroupAView from "./components/views/GroupAView";
import GroupBView from "./components/views/GroupBView";
import GroupCView from "./components/views/GroupCView";
import EntryScreen from "./components/flow/EntryScreen";
import RestaurantGrid from "./components/flow/RestaurantGrid";
import SurveyModal from "./components/flow/SurveyModal";
import LogScreen from "./components/flow/LogScreen";
import { FILTER_PILLS, MOCK_GRAPH_BY_PLACE, MOCK_PLACES, MOCK_REVIEWS } from "./data/mockReviews";

const GROUP_CODES = ["A", "B", "C"];
const GROUP_QUERY_KEY = "group";
const DEFAULT_FILTERS = [];
const EMPTY_GRAPH = { nodes: [], links: [], clusterKeywords: [] };
const MAX_VISIBLE_REVIEWS = 20;
const DEFAULT_SURVEY = {
  helpfulnessLikert: 4,
  visitIntentPercent: 70,
  bestReviewFeature: "",
};

const nowIso = () => new Date().toISOString();

const parseGroupFromUrl = () => {
  if (typeof window === "undefined") {
    return null;
  }

  const params = new URLSearchParams(window.location.search);
  const raw = (params.get(GROUP_QUERY_KEY) || "").toUpperCase();
  return GROUP_CODES.includes(raw) ? raw : null;
};

const pushGroupToUrl = (groupCode) => {
  if (typeof window === "undefined") {
    return;
  }

  const url = new URL(window.location.href);

  if (groupCode) {
    url.searchParams.set(GROUP_QUERY_KEY, groupCode.toLowerCase());
  } else {
    url.searchParams.delete(GROUP_QUERY_KEY);
  }

  window.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
};

const toggleFilter = (selectedFilters, targetFilter) => {
  if (selectedFilters.includes(targetFilter)) {
    return selectedFilters.filter((filter) => filter !== targetFilter);
  }
  return [...selectedFilters, targetFilter];
};

const getLinkNodeId = (nodeRef) => (typeof nodeRef === "object" ? nodeRef.id : nodeRef);

const NAVER_BASE_PLACE_ORDER = [
  "멘모찌",
  "랑콩뜨레",
  "댓잎장어",
  "비프브라운",
  "동동국밥",
  "투썸플레이스",
  "청학동 칼국수",
  "스테이X머스트",
  "맛있는 고기에 솜씨를 더하다",
  "스시미즈기와",
  "호훈테이블",
  "그리즐리버거",
  "최쉐프",
  "당몽당",
  "하삼동커피",
  "커피에 반하다",
  "커피퍽",
  "노도커피",
  "포밍버터",
];

const normalizePlaceOrderKey = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[·・]/g, "")
    .replace(/[^가-힣a-z0-9]/g, "");

const NAVER_PLACE_ORDER_INDEX = new Map(
  NAVER_BASE_PLACE_ORDER.map((name, idx) => [normalizePlaceOrderKey(name), idx])
);

const makeSessionLog = (groupCode) => ({
  sessionId: `rg-${Date.now()}-${Math.floor(Math.random() * 9000) + 1000}`,
  groupCode,
  createdAt: nowIso(),
  serviceStartedAt: null,
  serviceCompletedAt: null,
  finalPlaceId: null,
  finalPlaceName: null,
  survey: null,
  metrics: {
    taskCompletionMs: 0,
    scrollEvents: 0,
    totalScrollDistancePx: 0,
    maxScrollY: 0,
    filterToggleCount: 0,
    placeSelectionCount: 0,
    totalReviewClicks: 0,
    top3: {
      impressionBatches: 0,
      impressions: 0,
      clicks: 0,
      byReview: {},
    },
  },
  timeline: [],
});

const ensureTop3Metric = (top3Metrics, reviewId) => {
  if (!top3Metrics.byReview[reviewId]) {
    top3Metrics.byReview[reviewId] = {
      impressions: 0,
      clicks: 0,
      dwellMs: 0,
      rankHits: [0, 0, 0],
    };
  }

  return top3Metrics.byReview[reviewId];
};

const buildLogExport = (sessionLog) => {
  const top3Entries = Object.entries(sessionLog.metrics.top3.byReview);
  const totalTop3DwellMs = top3Entries.reduce((sum, [, value]) => sum + value.dwellMs, 0);
  const top3Ctr =
    sessionLog.metrics.top3.impressions > 0
      ? sessionLog.metrics.top3.clicks / sessionLog.metrics.top3.impressions
      : 0;
  const top3AvgDwellMs =
    sessionLog.metrics.top3.clicks > 0 ? totalTop3DwellMs / sessionLog.metrics.top3.clicks : 0;

  const summary = {
    sessionId: sessionLog.sessionId,
    groupCode: sessionLog.groupCode,
    finalPlace: sessionLog.finalPlaceName,
    taskCompletionSec: Number((sessionLog.metrics.taskCompletionMs / 1000).toFixed(2)),
    top3CtrPercent: Number((top3Ctr * 100).toFixed(2)),
    top3AvgDwellSec: Number((top3AvgDwellMs / 1000).toFixed(2)),
    scrollEvents: sessionLog.metrics.scrollEvents,
    totalScrollDistancePx: Math.round(sessionLog.metrics.totalScrollDistancePx),
    filterToggleCount: sessionLog.metrics.filterToggleCount,
    placeSelectionCount: sessionLog.metrics.placeSelectionCount,
  };

  const payload = {
    summary,
    session: sessionLog,
  };

  const lines = [
    "=== ReviewGraph Session Log ===",
    `sessionId: ${summary.sessionId}`,
    `groupCode: ${summary.groupCode}`,
    `finalPlace: ${summary.finalPlace}`,
    `taskCompletionSec: ${summary.taskCompletionSec}`,
    `top3CtrPercent: ${summary.top3CtrPercent}`,
    `top3AvgDwellSec: ${summary.top3AvgDwellSec}`,
    `scrollEvents: ${summary.scrollEvents}`,
    `totalScrollDistancePx: ${summary.totalScrollDistancePx}`,
    `filterToggleCount: ${summary.filterToggleCount}`,
    `placeSelectionCount: ${summary.placeSelectionCount}`,
    "",
    "=== JSON ===",
    JSON.stringify(payload, null, 2),
  ];

  return {
    summary,
    text: lines.join("\n"),
  };
};

const rankPlaceReviews = (reviews, preferences, groupCode) => {
  const preferenceSet = new Set(preferences);
  const usePreferenceRanking = groupCode === "B";

  return reviews
    .map((review) => {
      const matchedCount = review.visitTags.filter((tag) => preferenceSet.has(tag)).length;
      const mismatchCount = usePreferenceRanking ? Math.max(0, preferences.length - matchedCount) : 0;
      const preferenceBoost = usePreferenceRanking && preferences.length > 0 ? matchedCount * 1200 : 0;
      const mismatchPenalty = usePreferenceRanking && preferences.length > 0 ? mismatchCount * 14 : 0;
      const groupWeight = groupCode === "B" ? review.helpfulnessScore * 14 : review.helpfulnessScore * 10;
      const rankScore = preferenceBoost + groupWeight + review.centrality * 90 - mismatchPenalty;

      return {
        review,
        rankScore,
      };
    })
    .sort((a, b) => {
      if (b.rankScore !== a.rankScore) {
        return b.rankScore - a.rankScore;
      }
      return b.review.helpfulnessScore - a.review.helpfulnessScore;
    })
    .slice(0, MAX_VISIBLE_REVIEWS)
    .map((item) => item.review);
};

function App() {
  const initialGroupRef = useRef(parseGroupFromUrl());
  const [groupCode, setGroupCode] = useState(initialGroupRef.current);
  const [phase, setPhase] = useState(initialGroupRef.current ? "service" : "entry");

  const [selectedPreferences, setSelectedPreferences] = useState(DEFAULT_FILTERS);
  const [selectedPlaceId, setSelectedPlaceId] = useState(null);
  const [selectedReviewId, setSelectedReviewId] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showSurvey, setShowSurvey] = useState(false);
  const [survey, setSurvey] = useState(DEFAULT_SURVEY);
  const [logSummary, setLogSummary] = useState(null);
  const [logText, setLogText] = useState("");

  const serviceStartTsRef = useRef(0);
  const activeReviewRef = useRef(null);
  const topThreeIdsRef = useRef([]);
  const sessionLogRef = useRef(makeSessionLog(initialGroupRef.current || "A"));

  const resetServiceState = useCallback((nextGroupCode) => {
    setSelectedPreferences(DEFAULT_FILTERS);
    setSelectedPlaceId(null);
    setSelectedReviewId(null);
    setIsLoading(false);
    setShowSurvey(false);
    setSurvey(DEFAULT_SURVEY);
    setLogSummary(null);
    setLogText("");

    serviceStartTsRef.current = 0;
    activeReviewRef.current = null;
    topThreeIdsRef.current = [];
    sessionLogRef.current = makeSessionLog(nextGroupCode);
  }, []);

  const closeActiveReview = useCallback((reason = "closed") => {
    const active = activeReviewRef.current;
    if (!active) {
      return;
    }

    const dwellMs = Date.now() - active.openedAt;

    if (active.isTop3) {
      const top3Metric = ensureTop3Metric(sessionLogRef.current.metrics.top3, active.reviewId);
      top3Metric.dwellMs += dwellMs;
    }

    sessionLogRef.current.timeline.push({
      at: nowIso(),
      event: "review_closed",
      reviewId: active.reviewId,
      reason,
      dwellMs,
    });

    activeReviewRef.current = null;
  }, []);

  const reviewsByPlace = useMemo(() => {
    const buckets = new Map(MOCK_PLACES.map((place) => [place.id, []]));

    MOCK_REVIEWS.forEach((review) => {
      if (!buckets.has(review.placeId)) {
        buckets.set(review.placeId, []);
      }
      buckets.get(review.placeId).push(review);
    });

    return buckets;
  }, []);

  const sortedPlaces = useMemo(() => {
    const base = [...MOCK_PLACES];

    if (groupCode === "A") {
      return base.sort((a, b) => {
        const aIdx = NAVER_PLACE_ORDER_INDEX.get(normalizePlaceOrderKey(a.name));
        const bIdx = NAVER_PLACE_ORDER_INDEX.get(normalizePlaceOrderKey(b.name));

        const aRank = Number.isFinite(aIdx) ? aIdx : Number.MAX_SAFE_INTEGER;
        const bRank = Number.isFinite(bIdx) ? bIdx : Number.MAX_SAFE_INTEGER;

        if (aRank !== bRank) {
          return aRank - bRank;
        }
        return a.name.localeCompare(b.name, "ko");
      });
    }

    const preferenceSet = new Set(selectedPreferences);
    if (preferenceSet.size === 0) {
      return base.sort((a, b) => a.name.localeCompare(b.name, "ko"));
    }

    const placeScoreMap = new Map();
    base.forEach((place) => {
      let signal = 0;
      let matchedReviews = 0;
      let helpfulnessSum = 0;

      const reviews = reviewsByPlace.get(place.id) || [];
      reviews.forEach((review) => {
        const hitCount = review.visitTags.reduce((acc, tag) => acc + (preferenceSet.has(tag) ? 1 : 0), 0);
        if (hitCount <= 0) {
          return;
        }

        signal += hitCount;
        matchedReviews += 1;
        helpfulnessSum += review.helpfulnessScore;
      });

      placeScoreMap.set(place.id, {
        signal,
        matchedReviews,
        avgHelpfulness: matchedReviews > 0 ? helpfulnessSum / matchedReviews : 0,
      });
    });

    return base.sort((a, b) => {
      const aScore = placeScoreMap.get(a.id) || { signal: 0, matchedReviews: 0, avgHelpfulness: 0 };
      const bScore = placeScoreMap.get(b.id) || { signal: 0, matchedReviews: 0, avgHelpfulness: 0 };

      if (bScore.signal !== aScore.signal) {
        return bScore.signal - aScore.signal;
      }
      if (bScore.matchedReviews !== aScore.matchedReviews) {
        return bScore.matchedReviews - aScore.matchedReviews;
      }
      if (bScore.avgHelpfulness !== aScore.avgHelpfulness) {
        return bScore.avgHelpfulness - aScore.avgHelpfulness;
      }
      if (b.rating !== a.rating) {
        return b.rating - a.rating;
      }
      return a.name.localeCompare(b.name, "ko");
    });
  }, [groupCode, reviewsByPlace, selectedPreferences]);

  const placeReviews = useMemo(() => {
    if (!selectedPlaceId) {
      return [];
    }

    const scoped = MOCK_REVIEWS.filter((review) => review.placeId === selectedPlaceId);
    return rankPlaceReviews(scoped, selectedPreferences, groupCode);
  }, [groupCode, selectedPlaceId, selectedPreferences]);

  const graphDataForPlace = useMemo(() => {
    if (!selectedPlaceId) {
      return EMPTY_GRAPH;
    }

    const baseGraph = MOCK_GRAPH_BY_PLACE[selectedPlaceId] || EMPTY_GRAPH;
    const visibleReviewIds = new Set(placeReviews.map((review) => review.id));

    return {
      nodes: baseGraph.nodes.filter((node) => visibleReviewIds.has(node.id)),
      links: baseGraph.links.filter((link) => {
        const sourceId = getLinkNodeId(link.source);
        const targetId = getLinkNodeId(link.target);
        return visibleReviewIds.has(sourceId) && visibleReviewIds.has(targetId);
      }),
      clusterKeywords: baseGraph.clusterKeywords || [],
    };
  }, [placeReviews, selectedPlaceId]);

  const selectedPlace = useMemo(
    () => MOCK_PLACES.find((place) => place.id === selectedPlaceId) || null,
    [selectedPlaceId]
  );

  const top3ReviewIds = useMemo(() => placeReviews.slice(0, 3).map((review) => review.id), [placeReviews]);

  useEffect(() => {
    topThreeIdsRef.current = top3ReviewIds;
  }, [top3ReviewIds]);

  useEffect(() => {
    if (phase !== "service" || !groupCode || serviceStartTsRef.current) {
      return;
    }

    serviceStartTsRef.current = performance.now();
    sessionLogRef.current.groupCode = groupCode;
    sessionLogRef.current.serviceStartedAt = nowIso();
    sessionLogRef.current.timeline.push({
      at: nowIso(),
      event: "service_started",
      groupCode,
    });
  }, [groupCode, phase]);

  useEffect(() => {
    if (phase !== "service") {
      return undefined;
    }

    let previousY = window.scrollY;

    const handleScroll = () => {
      const currentY = window.scrollY;
      const delta = Math.abs(currentY - previousY);
      previousY = currentY;

      const metrics = sessionLogRef.current.metrics;
      metrics.scrollEvents += 1;
      metrics.totalScrollDistancePx += delta;
      metrics.maxScrollY = Math.max(metrics.maxScrollY, currentY);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [phase]);

  useEffect(
    () => () => {
      closeActiveReview("unmount");
    },
    [closeActiveReview]
  );

  useEffect(() => {
    const handlePopState = () => {
      const nextGroupCode = parseGroupFromUrl();

      if (!nextGroupCode) {
        setGroupCode(null);
        setPhase("entry");
        setShowSurvey(false);
        return;
      }

      setGroupCode(nextGroupCode);
      resetServiceState(nextGroupCode);
      setPhase("service");
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [resetServiceState]);

  useEffect(() => {
    if (phase !== "service" || !selectedPlaceId) {
      return;
    }

    setIsLoading(true);
    setSelectedReviewId(null);

    const timer = window.setTimeout(() => {
      setIsLoading(false);
    }, 800);

    return () => window.clearTimeout(timer);
  }, [groupCode, phase, selectedPlaceId, selectedPreferences]);

  useEffect(() => {
    if (isLoading || placeReviews.length === 0) {
      return;
    }

    setSelectedReviewId((prev) => {
      if (prev && placeReviews.some((review) => review.id === prev)) {
        return prev;
      }
      return placeReviews[0].id;
    });
  }, [isLoading, placeReviews]);

  useEffect(() => {
    if (phase !== "service" || isLoading || !selectedPlaceId || top3ReviewIds.length === 0) {
      return;
    }

    const top3Metrics = sessionLogRef.current.metrics.top3;
    top3Metrics.impressionBatches += 1;
    top3Metrics.impressions += top3ReviewIds.length;

    top3ReviewIds.forEach((reviewId, idx) => {
      const metric = ensureTop3Metric(top3Metrics, reviewId);
      metric.impressions += 1;
      metric.rankHits[idx] += 1;
    });

    sessionLogRef.current.timeline.push({
      at: nowIso(),
      event: "top3_impression",
      placeId: selectedPlaceId,
      reviewIds: top3ReviewIds,
    });
  }, [isLoading, phase, selectedPlaceId, top3ReviewIds]);

  const handleSelectMode = (nextGroupCode) => {
    pushGroupToUrl(nextGroupCode);
    setGroupCode(nextGroupCode);
    resetServiceState(nextGroupCode);
    setPhase("service");
  };

  const handleToggleFilter = (filter) => {
    closeActiveReview("preference_changed");
    setSelectedPreferences((prev) => toggleFilter(prev, filter));

    const log = sessionLogRef.current;
    log.metrics.filterToggleCount += 1;
    log.timeline.push({
      at: nowIso(),
      event: "preference_toggled",
      filter,
    });
  };

  const handleSelectPlace = (placeId) => {
    if (placeId === selectedPlaceId) {
      return;
    }

    closeActiveReview("place_changed");
    setSelectedPlaceId(placeId);

    const log = sessionLogRef.current;
    log.metrics.placeSelectionCount += 1;
    log.timeline.push({
      at: nowIso(),
      event: "place_selected",
      placeId,
    });
  };

  const handleReviewOpen = useCallback(
    (reviewId, source = "list") => {
      if (!reviewId) {
        return;
      }

      closeActiveReview("review_switched");
      setSelectedReviewId(reviewId);

      const log = sessionLogRef.current;
      const isTop3 = topThreeIdsRef.current.includes(reviewId);

      log.metrics.totalReviewClicks += 1;
      if (isTop3) {
        const top3Metrics = log.metrics.top3;
        top3Metrics.clicks += 1;
        const reviewMetric = ensureTop3Metric(top3Metrics, reviewId);
        reviewMetric.clicks += 1;
      }

      log.timeline.push({
        at: nowIso(),
        event: "review_opened",
        reviewId,
        source,
        isTop3,
      });

      activeReviewRef.current = {
        reviewId,
        openedAt: Date.now(),
        isTop3,
      };
    },
    [closeActiveReview]
  );

  const handleFinalizePlace = () => {
    if (!selectedPlace || isLoading) {
      return;
    }

    closeActiveReview("final_decision");

    const log = sessionLogRef.current;
    log.serviceCompletedAt = nowIso();
    log.finalPlaceId = selectedPlace.id;
    log.finalPlaceName = selectedPlace.name;
    log.metrics.taskCompletionMs = serviceStartTsRef.current
      ? Math.max(0, Math.round(performance.now() - serviceStartTsRef.current))
      : 0;
    log.timeline.push({
      at: nowIso(),
      event: "place_confirmed",
      placeId: selectedPlace.id,
    });

    setShowSurvey(true);
  };

  const handleSubmitSurvey = (event) => {
    event.preventDefault();

    const log = sessionLogRef.current;
    log.survey = {
      helpfulnessLikert: survey.helpfulnessLikert,
      visitIntentPercent: survey.visitIntentPercent,
      bestReviewFeature: survey.bestReviewFeature,
      submittedAt: nowIso(),
    };
    log.timeline.push({
      at: nowIso(),
      event: "survey_submitted",
    });

    const exported = buildLogExport(log);
    setLogSummary(exported.summary);
    setLogText(exported.text);
    setShowSurvey(false);
    setPhase("logs");
  };

  const handleRestart = () => {
    closeActiveReview("restart");
    pushGroupToUrl(null);
    setGroupCode(null);
    setShowSurvey(false);
    setPhase("entry");
  };

  if (phase === "entry") {
    return <EntryScreen onSelectMode={handleSelectMode} />;
  }

  if (phase === "logs" && logSummary) {
    return <LogScreen summary={logSummary} logText={logText} onRestart={handleRestart} />;
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-[1820px] px-3 pb-10 pt-6 sm:px-6">
      <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <FilterPills
            filters={FILTER_PILLS}
            selectedFilters={selectedPreferences}
            onToggleFilter={handleToggleFilter}
          />

          <RestaurantGrid
            places={sortedPlaces}
            selectedPlaceId={selectedPlaceId}
            selectedPreferences={selectedPreferences}
            onSelectPlace={handleSelectPlace}
          />
        </aside>

        <section className="space-y-4">
          <div className="glass-card rounded-3xl p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
                  {selectedPlace ? `${selectedPlace.name} 리뷰` : "Place를 선택하면 추천 리뷰가 표시됩니다"}
                </h2>
                {selectedPlace && (
                  <p className="mt-1 text-sm text-slate-600">
                    {groupCode === "A"
                      ? `네이버 지도 기본 정렬 기준으로 상위 ${placeReviews.length}개를 노출합니다.`
                      : groupCode === "B"
                        ? `선호 키워드 우선순위 + 유용성 점수 기반으로 상위 ${placeReviews.length}개를 노출합니다.`
                        : `유용성 점수 + 네트워크 중심성 기반으로 상위 ${placeReviews.length}개를 노출합니다.`}
                  </p>
                )}
              </div>

              <button
                type="button"
                disabled={!selectedPlace || isLoading}
                onClick={handleFinalizePlace}
                className="inline-flex items-center gap-1 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                <Clock3 size={14} />
                이 Place로 최종 결정
              </button>
            </div>
          </div>

          {!selectedPlace ? (
            <div className="glass-card rounded-2xl p-10 text-center text-slate-500">왼쪽 사이드바에서 Place를 선택해 주세요.</div>
          ) : (
            <AnimatePresence mode="wait">
              {isLoading ? (
                <LoadingScene
                  key={`loading-${selectedPlaceId}-${selectedPreferences.join("|")}-${groupCode}`}
                  message="선호 키워드를 반영해 상위 리뷰를 다시 정렬하고 있습니다"
                />
              ) : (
                <motion.div
                  key={`view-${groupCode}-${selectedPlaceId}`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.22, ease: "easeOut" }}
                >
                  {groupCode === "A" && (
                    <GroupAView
                      reviews={placeReviews}
                      selectedReviewId={selectedReviewId}
                      onReviewOpen={handleReviewOpen}
                    />
                  )}
                  {groupCode === "B" && (
                    <GroupBView
                      reviews={placeReviews}
                      selectedReviewId={selectedReviewId}
                      onReviewOpen={handleReviewOpen}
                    />
                  )}
                  {groupCode === "C" && (
                    <GroupCView
                      reviews={placeReviews}
                      graphData={graphDataForPlace}
                      selectedReviewId={selectedReviewId}
                      onReviewOpen={handleReviewOpen}
                    />
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </section>
      </div>

      {showSurvey && (
        <SurveyModal
          value={survey}
          onChange={setSurvey}
          onSubmit={handleSubmitSurvey}
          onCancel={() => setShowSurvey(false)}
        />
      )}
    </main>
  );
}

export default App;
