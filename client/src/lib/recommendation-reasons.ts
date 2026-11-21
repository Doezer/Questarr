import type { Recommendation, RecommendationReason } from "@shared/recommendations";

/** One-line, human wording of why a game is recommended ("Because you rated Hades 9/10"). */
export function describeRecommendationReason(reason: RecommendationReason): string {
  switch (reason.kind) {
    case "similar":
      return reason.userRating != null
        ? `Because you rated ${reason.label} ${formatRating(reason.userRating)}/10`
        : `Because you like ${reason.label}`;
    case "developer":
      return `More from ${reason.label}`;
    case "genre":
      return `You enjoy ${reason.label} games`;
    case "theme":
      return `Fits your taste for ${reason.label}`;
    case "mode":
      return `You often play ${reason.label}`;
    case "acclaimed":
      return `Critically acclaimed (${reason.label}/100)`;
  }
}

function formatRating(rating: number): string {
  return Number.isInteger(rating) ? String(rating) : rating.toFixed(1);
}

/** The main reason shown under the card, or null when there is none. */
export function primaryRecommendationReason(
  recommendation: Recommendation | undefined
): string | null {
  const first = recommendation?.reasons[0];
  return first ? describeRecommendationReason(first) : null;
}
