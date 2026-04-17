import ReviewCard from "../ReviewCard";

function GroupBView({ reviews }) {
  return (
    <section className="space-y-4">
      <div className="glass-card rounded-3xl p-4 sm:p-5">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Group B | Algorithm Applied</p>
        <h3 className="mt-1 text-xl font-semibold text-slate-900">유용성 점수 및 핵심문장 강조 뷰</h3>
        <p className="mt-2 text-sm text-slate-600">
          상단 노출 이유를 설명하기 위해 카드 우측에 AI 유용성 점수를 표시하고, 다른 사용자 리뷰에서 반복되는 문장을 형광펜 하이라이트로 강조했습니다.
        </p>
      </div>

      <div className="space-y-4">
        {reviews.length > 0 ? (
          reviews
            .slice()
            .sort((a, b) => b.helpfulnessScore - a.helpfulnessScore)
            .map((review) => <ReviewCard key={review.id} review={review} variant="B" />)
        ) : (
          <div className="glass-card rounded-2xl p-8 text-center text-slate-500">조건에 맞는 리뷰가 없습니다.</div>
        )}
      </div>
    </section>
  );
}

export default GroupBView;
