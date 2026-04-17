import { useMemo } from "react";
import ReviewNetworkGraph from "../network/ReviewNetworkGraph";
import ReviewDetailPanel from "../network/ReviewDetailPanel";

const getNodeId = (nodeRef) => (typeof nodeRef === "object" ? nodeRef.id : nodeRef);

function GroupCView({ reviews, graphData, selectedReviewId, onReviewOpen }) {
  const selectedReview = reviews.find((review) => review.id === selectedReviewId) || null;

  const connectedCount = useMemo(() => {
    if (!selectedReviewId) {
      return 0;
    }

    return graphData.links.filter((link) => {
      const sourceId = getNodeId(link.source);
      const targetId = getNodeId(link.target);
      return sourceId === selectedReviewId || targetId === selectedReviewId;
    }).length;
  }, [graphData.links, selectedReviewId]);

  return (
    <section className="space-y-4">
      <div className="glass-card rounded-3xl p-4 sm:p-5">
        <h3 className="text-xl font-semibold tracking-tight text-slate-900">리뷰 관계 네트워크 + 상세 패널</h3>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          노드를 선택하면 연결된 리뷰 관계가 강조되고, 우측 패널에서 세부 내용을 확인할 수 있습니다.
        </p>
      </div>

      {reviews.length ? (
        <div className="grid gap-4 lg:grid-cols-[1.9fr_1fr]">
          <div className="glass-card rounded-3xl p-3 sm:p-4">
            <ReviewNetworkGraph
              graphData={graphData}
              selectedReviewId={selectedReviewId}
              onSelectReviewId={(reviewId) => onReviewOpen(reviewId, "network")}
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
