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
      {reviews.length ? (
        <div className="grid gap-4 lg:grid-cols-[3fr_1fr]">
          <div className="glass-card rounded-3xl p-2 sm:p-3">
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
