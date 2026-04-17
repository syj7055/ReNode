import { AnimatePresence, motion } from "framer-motion";
import { Link2, Sparkles } from "lucide-react";

function ReviewDetailPanel({ review, connectedCount }) {
  return (
    <div className="glass-card h-full rounded-3xl p-5 sm:p-6">
      <AnimatePresence mode="wait">
        {review ? (
          <motion.div
            key={review.id}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.28, ease: "easeOut" }}
            className="space-y-4"
          >
            <div className="flex items-center justify-between rounded-2xl bg-white/55 p-3">
              <span className="text-sm font-medium text-slate-700">선택된 리뷰</span>
              <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-semibold text-orange-800">
                Helpfulness {review.helpfulnessScore}
              </span>
            </div>

            <div className="rounded-2xl bg-white/45 p-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-[0.15em] text-slate-500">리뷰 전문</p>
              <p className="leading-relaxed text-slate-700">{review.text}</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl bg-white/45 p-3">
                <p className="mb-2 flex items-center gap-1 text-xs font-semibold text-slate-500">
                  <Sparkles size={14} />
                  연관 키워드
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {review.keywords.map((keyword) => (
                    <span key={keyword} className="rounded-full bg-cyan-100 px-2 py-1 text-xs text-cyan-800">
                      #{keyword}
                    </span>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl bg-white/45 p-3">
                <p className="mb-2 flex items-center gap-1 text-xs font-semibold text-slate-500">
                  <Link2 size={14} />
                  연결 정보
                </p>
                <p className="text-sm text-slate-700">연결된 리뷰 {connectedCount}개</p>
                <p className="mt-1 text-sm text-slate-700">방문 맥락: {review.purpose}</p>
                <p className="mt-1 text-sm text-slate-700">작성일: {review.date}</p>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="mt-8 rounded-2xl bg-white/45 p-8 text-center text-sm text-slate-500"
          >
            좌측 네트워크에서 노드를 선택하면 상세 정보가 표시됩니다.
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default ReviewDetailPanel;
