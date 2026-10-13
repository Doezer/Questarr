/** IGDB video as returned by the API (`video_id` is a YouTube id). */
export interface IGDBVideo {
  name?: string;
  video_id?: string;
}

/** Keep only well-formed 11-character YouTube ids so a bad IGDB value can never reach an embed URL. */
export function toVideos(
  videos: IGDBVideo[] | undefined
): Array<{ name: string; videoId: string }> {
  return (videos ?? [])
    .filter((v): v is { name?: string; video_id: string } => /^[\w-]{11}$/.test(v.video_id ?? ""))
    .map((v) => ({ name: v.name?.trim() || "Video", videoId: v.video_id }));
}
