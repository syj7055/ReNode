import { motion } from "framer-motion";
import clsx from "clsx";

function FilterPills({ filters, selectedFilters, onToggleFilter }) {
  return (
    <div className="glass-card rounded-3xl p-4 soft-shadow sm:p-5">
      <div className="flex flex-wrap gap-1.5">
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
                "rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-250",
                selected
                  ? "border-orange-300 bg-orange-50 text-orange-900 shadow-soft"
                  : "border-white/70 bg-white/50 text-slate-600 hover:border-orange-200 hover:bg-white/90"
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
