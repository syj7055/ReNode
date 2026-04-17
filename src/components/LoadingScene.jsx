import { motion } from "framer-motion";

function LoadingScene() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="glass-card rounded-3xl p-6 sm:p-8"
    >
      <div className="mb-5 flex items-center gap-3">
        <motion.div
          animate={{ scale: [1, 1.15, 1], opacity: [0.6, 1, 0.6] }}
          transition={{ duration: 1.4, repeat: Number.POSITIVE_INFINITY }}
          className="h-2.5 w-2.5 rounded-full bg-orange-500"
        />
        <p className="text-sm font-medium text-slate-600">AI가 리뷰 데이터를 수집 중입니다</p>
      </div>

      <div className="space-y-4">
        {Array.from({ length: 5 }).map((_, idx) => (
          <div key={idx} className="glass-panel rounded-2xl p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="skeleton h-4 w-24 rounded-full" />
              <div className="skeleton h-4 w-14 rounded-full" />
            </div>
            <div className="mb-2 skeleton h-3 w-full rounded-full" />
            <div className="mb-2 skeleton h-3 w-[86%] rounded-full" />
            <div className="skeleton h-3 w-[60%] rounded-full" />
          </div>
        ))}
      </div>
    </motion.div>
  );
}

export default LoadingScene;
