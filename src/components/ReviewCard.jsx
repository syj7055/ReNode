import { motion } from "framer-motion";
import clsx from "clsx";
import { CalendarDays, Star } from "lucide-react";

const scoreBadgeClass = (score) => {
  if (score >= 90) {
    return "bg-emerald-100 text-emerald-800";
  }
  if (score >= 80) {
    return "bg-amber-100 text-amber-800";
  }
  return "bg-orange-100 text-orange-800";
};

const renderHighlightedText = (text, highlights = []) => {
  if (!highlights.length) {
    return text;
  }

  const safeHighlights = highlights.filter(Boolean);
  if (!safeHighlights.length) {
    return text;
  }

  const parts = [];
  let cursor = 0;

  while (cursor < text.length) {
    let nearestIndex = -1;
    let nearestHighlight = "";

    for (const highlight of safeHighlights) {
      const index = text.indexOf(highlight, cursor);
      if (index !== -1 && (nearestIndex === -1 || index < nearestIndex)) {
        nearestIndex = index;
        nearestHighlight = highlight;
      }
    }

    if (nearestIndex === -1) {
      parts.push(text.slice(cursor));
      break;
    }

    if (nearestIndex > cursor) {
      parts.push(text.slice(cursor, nearestIndex));
    }

    parts.push(
      <span key={`${nearestHighlight}-${nearestIndex}`} className="keyword-highlight">
        {nearestHighlight}
      </span>
    );

    cursor = nearestIndex + nearestHighlight.length;
  }

  return parts;
};

function ReviewCard({ review, variant = "A", onClick, selected }) {
  return (
    <motion.article
      layout
      whileHover={{ y: -4 }}
      transition={{ type: "spring", stiffness: 220, damping: 20 }}
      className={clsx(
        "glass-card relative cursor-pointer rounded-3xl p-5 sm:p-6",
        selected && "ring-2 ring-orange-300"
      )}
      onClick={onClick}
    >
      {variant === "B" && (
        <div
          className={clsx(
            "score-badge absolute right-4 top-4 rounded-full px-3 py-1 text-xs font-semibold",
            scoreBadgeClass(review.helpfulnessScore)
          )}
        >
          AI 유용성 점수 {review.helpfulnessScore}
        </div>
      )}

      <div className="mb-4 flex items-start justify-between gap-2 pr-28 sm:pr-32">
        <div className="flex items-center gap-3">
          <div
            className="grid h-10 w-10 place-items-center rounded-xl text-sm font-semibold text-white"
            style={{ background: review.avatarColor }}
          >
            {review.author.slice(0, 1)}
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">{review.author}</p>
            <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
              <CalendarDays size={13} />
              <span>{review.date}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 rounded-full bg-white/70 px-2.5 py-1 text-xs font-semibold text-amber-700">
          <Star size={13} className="fill-amber-400 text-amber-400" />
          {review.rating}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {review.visitTags.map((tag) => (
          <span key={tag} className="rounded-full bg-slate-100/80 px-2.5 py-1 text-xs font-medium text-slate-600">
            {tag}
          </span>
        ))}
      </div>

      <p className="leading-relaxed text-slate-700">
        {variant === "B" ? renderHighlightedText(review.text, review.sharedSentences) : review.text}
      </p>
    </motion.article>
  );
}

export default ReviewCard;
