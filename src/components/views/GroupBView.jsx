import ReviewCard from "../ReviewCard";

function GroupBView({ reviews, selectedReviewId, onReviewOpen }) {
  return (
    <section className="space-y-4">
      <div className="glass-card rounded-3xl p-4 sm:p-5">
        <h3 className="text-xl font-semibold tracking-tight text-slate-900">유용성 점수 + 핵심문장 강조</h3>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          상단 노출 이유를 이해할 수 있도록 카드 우측에 유용성 점수를 표시하고, 공통 핵심 문장을 하이라이트합니다.
        </p>
      </div>

      <div className="space-y-4">
        {reviews.length > 0 ? (
          reviews.map((review) => (
            <ReviewCard
              key={review.id}
              review={review}
              variant="B"
              selected={selectedReviewId === review.id}
              onClick={() => onReviewOpen(review.id, "list")}
            />
          ))
        ) : (
          <div className="glass-card rounded-2xl p-8 text-center text-slate-500">조건에 맞는 리뷰가 없습니다.</div>
        )}
      </div>
    </section>
  );
}

export default GroupBView;
