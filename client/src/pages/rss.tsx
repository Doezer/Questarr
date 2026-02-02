import RssFeedList from "@/components/RssFeedList";
import RssSettings from "@/components/RssSettings";

export default function RssPage() {
    return (
        <div className="container mx-auto p-6 space-y-6 h-full overflow-y-auto">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">RSS Feeds</h1>
                    <p className="text-muted-foreground mt-1">
                        Browse and manage RSS feeds to automatically track releases.
                    </p>
                </div>
                <RssSettings />
            </div>

            <div className="mt-6">
                <RssFeedList />
            </div>
        </div>
    );
}
