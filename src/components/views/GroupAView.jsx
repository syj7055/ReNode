import { useEffect, useState } from "react";
import { AnimatePresence } from "framer-motion";
import LoadingScene from "../LoadingScene";
import ReviewCard from "../ReviewCard";

function GroupAView({ reviews }) {
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setIsLoading(false), 1500);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Group A | Control</p>
          <h3 className="text-xl font-semibold text-slate-900">포털형 리뷰 리스트 (대조군)</h3>
        </div>
        <p className="text-sm text-slate-500">총 {reviews.length}건</p>
      </div>

      <AnimatePresence mode="wait">
        {isLoading ? (
          <LoadingScene key="loading" />
        ) : (
          <div key="list" className="space-y-4">
            {reviews.length > 0 ? (
              reviews.map((review) => <ReviewCard key={review.id} review={review} variant="A" />)
            ) : (
              <div className="glass-card rounded-2xl p-8 text-center text-slate-500">조건에 맞는 리뷰가 없습니다.</div>
            )}
          </div>
        )}
      </AnimatePresence>
    </section>
  );
}

export default GroupAView;
