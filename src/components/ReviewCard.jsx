import { motion } from "framer-motion";
import clsx from "clsx";
import { CalendarDays } from "lucide-react";

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
  const compactTags = review.visitTags.slice(0, 6);
  const restTagCount = Math.max(0, review.visitTags.length - compactTags.length);

  return (
    <motion.article
      layout
      whileHover={{ y: -5, scale: 1.002 }}
      transition={{ type: "spring", stiffness: 220, damping: 22 }}
      className={clsx(
        "glass-card relative cursor-pointer rounded-3xl border border-white/80 p-5 transition-shadow duration-300 hover:shadow-soft sm:p-6",
        selected && "ring-2 ring-orange-300 shadow-soft"
      )}
      onClick={onClick}
    >
      {variant === "B" && (
        <div
          className={clsx(
            "score-badge absolute right-4 top-4 rounded-full px-3 py-1 text-[11px] font-semibold",
            scoreBadgeClass(review.helpfulnessScore)
          )}
        >
          유용성 점수 {review.helpfulnessScore}
        </div>
      )}

      <div className="mb-4 flex items-start justify-between gap-3 pr-28 sm:pr-32">
        <div className="flex items-center gap-3">
          <div
            className="grid h-11 w-11 place-items-center rounded-2xl text-sm font-semibold text-white shadow-sm"
            style={{ background: review.avatarColor }}
          >
            {review.author.slice(0, 1)}
          </div>
          <div>
            <p className="text-[15px] font-semibold tracking-tight text-slate-900">{review.author}</p>
            <div className="mt-1 flex items-center gap-2 text-[12px] text-slate-500">
              <CalendarDays size={13} />
              <span>{review.date}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {compactTags.map((tag) => (
          <span key={tag} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600">
            {tag}
          </span>
        ))}
        {restTagCount > 0 && (
          <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-500">
            +{restTagCount}
          </span>
        )}
      </div>

      <p className="text-[15px] leading-7 text-slate-700">
        {variant === "B" ? renderHighlightedText(review.text, review.sharedSentences) : review.text}
      </p>
    </motion.article>
  );
}

export default ReviewCard;
