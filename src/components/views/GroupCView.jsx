import { useEffect, useMemo, useState } from "react";
import ReviewNetworkGraph from "../network/ReviewNetworkGraph";
import ReviewDetailPanel from "../network/ReviewDetailPanel";

const getNodeId = (nodeRef) => (typeof nodeRef === "object" ? nodeRef.id : nodeRef);

function GroupCView({ reviews, graphData }) {
  const [selectedReviewId, setSelectedReviewId] = useState(reviews[0]?.id ?? null);

  useEffect(() => {
    if (!reviews.length) {
      setSelectedReviewId(null);
      return;
    }

    const exists = reviews.some((review) => review.id === selectedReviewId);
    if (!exists) {
      setSelectedReviewId(reviews[0].id);
    }
  }, [reviews, selectedReviewId]);

  const filteredGraph = useMemo(() => {
    const visibleSet = new Set(reviews.map((review) => review.id));
    return {
      nodes: graphData.nodes.filter((node) => visibleSet.has(node.id)),
      links: graphData.links.filter((link) => visibleSet.has(getNodeId(link.source)) && visibleSet.has(getNodeId(link.target))),
    };
  }, [graphData, reviews]);

  const selectedReview = reviews.find((review) => review.id === selectedReviewId) || null;

  const connectedCount = useMemo(() => {
    if (!selectedReviewId) {
      return 0;
    }

    return filteredGraph.links.filter((link) => {
      const sourceId = getNodeId(link.source);
      const targetId = getNodeId(link.target);
      return sourceId === selectedReviewId || targetId === selectedReviewId;
    }).length;
  }, [filteredGraph.links, selectedReviewId]);

  return (
    <section className="space-y-4">
      <div className="glass-card rounded-3xl p-4 sm:p-5">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Group C | Network Visualization</p>
        <h3 className="mt-1 text-xl font-semibold text-slate-900">리뷰 관계 네트워크 + 상세 패널</h3>
        <p className="mt-2 text-sm text-slate-600">
          노드 크기와 색은 유용성 중심성을 나타내며, 노드를 클릭하면 연결 엣지가 강조되고 우측 패널에 세부 정보가 애니메이션으로 표시됩니다.
        </p>
      </div>

      {reviews.length ? (
        <div className="grid gap-4 lg:grid-cols-[1.9fr_1fr]">
          <div className="glass-card rounded-3xl p-3 sm:p-4">
            <ReviewNetworkGraph
              graphData={filteredGraph}
              selectedReviewId={selectedReviewId}
              onSelectReviewId={setSelectedReviewId}
            />
          </div>
          <ReviewDetailPanel review={selectedReview} connectedCount={connectedCount} />
        </div>
      ) : (
        <div className="glass-card rounded-2xl p-8 text-center text-slate-500">조건에 맞는 리뷰가 없습니다.</div>
      )}
    </section>
  );
}

export default GroupCView;
