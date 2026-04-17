import { motion } from "framer-motion";
import clsx from "clsx";

function RestaurantGrid({ places, selectedPlaceId, selectedPreferences, onSelectPlace, reviewCountMap }) {
  return (
    <section className="glass-card rounded-3xl p-4 soft-shadow sm:p-5">
      <div className="mb-2 flex items-center justify-end">
        <p className="text-xs text-slate-500">선호 {selectedPreferences.length}개</p>
      </div>

      <div className="space-y-2.5 overflow-y-auto pr-1 lg:max-h-[56vh]">
        {places.map((place) => {
          const isSelected = place.id === selectedPlaceId;
          const visibleReviews = reviewCountMap[place.id] || { ranked: 0, total: 0 };
          return (
            <motion.button
              key={place.id}
              type="button"
              whileHover={{ y: -3 }}
              whileTap={{ scale: 0.99 }}
              onClick={() => onSelectPlace(place.id)}
              className={clsx(
                "glass-panel w-full rounded-2xl p-3 text-left transition-all duration-250",
                isSelected
                  ? "border-orange-300 ring-2 ring-orange-200 shadow-soft"
                  : "hover:border-orange-200 hover:bg-white/95"
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-base font-semibold tracking-tight text-slate-900">{place.name}</h3>
                <p className="text-[11px] font-semibold text-slate-500">
                  {visibleReviews.ranked}/{visibleReviews.total} 리뷰
                </p>
              </div>
            </motion.button>
          );
        })}
      </div>
    </section>
  );
}

export default RestaurantGrid;
