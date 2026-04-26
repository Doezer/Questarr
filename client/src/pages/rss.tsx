import RssFeedList from "@/components/RssFeedList";
import RssSettings from "@/components/RssSettings";

export default function RssPage() {
  return (
    <div className="p-6 space-y-6 h-full overflow-y-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">RSS Feeds</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Browse and manage RSS feeds to automatically track releases.
          </p>
        </div>
        <div className="shrink-0 pt-1">
          <RssSettings />
        </div>
      </div>

      <RssFeedList />
    </div>
  );
}
