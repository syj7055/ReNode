import { motion } from "framer-motion";
import clsx from "clsx";

const GROUPS = ["A", "B", "C"];

function ExperimentSwitcher({ activeGroup, onGroupChange }) {
  return (
    <div className="fixed right-6 top-6 z-50 sm:right-8 sm:top-8">
      <div className="glass-card rounded-2xl p-1.5 shadow-glow">
        <div className="flex items-center gap-1">
          {GROUPS.map((group) => {
            const isActive = activeGroup === group;
            return (
              <button
                key={group}
                type="button"
                onClick={() => onGroupChange(group)}
                className={clsx(
                  "relative overflow-hidden rounded-xl px-4 py-2 text-sm font-semibold transition-all duration-300",
                  isActive ? "text-slate-900" : "text-slate-500 hover:text-slate-700"
                )}
              >
                {isActive && (
                  <motion.span
                    layoutId="active-exp-group"
                    className="absolute inset-0 rounded-xl bg-gradient-to-r from-orange-200 via-amber-100 to-cyan-100"
                    transition={{ type: "spring", stiffness: 260, damping: 22 }}
                  />
                )}
                <span className="relative">실험군 {group}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default ExperimentSwitcher;
