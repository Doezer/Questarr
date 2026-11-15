import type { QueryClient } from "@tanstack/react-query";
import type { Tag } from "@shared/schema";

export type { Tag };

/** A tag attached to a game, as returned by `GET /api/games/:id/tags`. */
export interface GameTagEntry {
  id: string;
  gameId: string;
  tagId: string;
  tag?: Tag;
}

export const TAGS_KEY = ["/api/tags"] as const;
export const TAG_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
export const DEFAULT_TAG_COLOR = "#3B82F6";

/** The tag list, game tag lists and tag-filtered game lists all change together. */
export function invalidateTagQueries(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({
    predicate: (query) => {
      const [first, , last] = query.queryKey;
      return (
        typeof first === "string" &&
        (first === "/api/tags" ||
          first.startsWith("/api/tags/") ||
          (first === "/api/games" && last === "tags"))
      );
    },
  });
}

/** Find an existing tag by name, ignoring case and surrounding spaces. */
export function findTagByName(tags: readonly Tag[], name: string): Tag | undefined {
  const wanted = name.trim().toLowerCase();
  return tags.find((tag) => tag.name.trim().toLowerCase() === wanted);
}

/** A color that is safe to use in a style attribute, or undefined. */
export function safeTagColor(color: string | null | undefined): string | undefined {
  return color && TAG_COLOR_PATTERN.test(color) ? color : undefined;
}
