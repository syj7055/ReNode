import { motion } from "framer-motion";
import clsx from "clsx";
import { Search } from "lucide-react";

function FilterPills({ filters, selectedFilters, onToggleFilter, searchText, onSearchTextChange }) {
  return (
    <div className="glass-card rounded-3xl p-4 soft-shadow sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Filter Search</p>
          <h2 className="text-xl font-semibold text-slate-900 sm:text-2xl">방문 목적 및 편의시설 필터</h2>
        </div>
        <label className="glass-panel flex w-full items-center gap-2 rounded-2xl px-3 py-2 sm:w-80">
          <Search size={16} className="text-slate-500" />
          <input
            value={searchText}
            onChange={(event) => onSearchTextChange(event.target.value)}
            className="w-full bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
            placeholder="리뷰 키워드 검색"
          />
        </label>
      </div>

      <div className="pill-scroll flex gap-2 overflow-x-auto pb-1">
        {filters.map((filter) => {
          const selected = selectedFilters.includes(filter);
          return (
            <motion.button
              key={filter}
              whileTap={{ scale: 0.95 }}
              whileHover={{ y: -2 }}
              type="button"
              onClick={() => onToggleFilter(filter)}
              className={clsx(
                "shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition-all duration-250",
                selected
                  ? "border-orange-300 bg-orange-50 text-orange-900 shadow-soft"
                  : "border-white/70 bg-white/50 text-slate-600 hover:border-orange-200 hover:bg-white/80"
              )}
            >
              {filter}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

export default FilterPills;
