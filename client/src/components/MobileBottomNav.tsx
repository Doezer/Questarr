import { cn } from "@/lib/utils";
import { mobileBottomNavigation } from "@/components/navigation-items";

interface MobileBottomNavProps {
  activeItem: string;
  onNavigate: (url: string) => void;
}

export default function MobileBottomNav({
  activeItem,
  onNavigate,
}: Readonly<MobileBottomNavProps>) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 px-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-2 backdrop-blur md:hidden"
      aria-label="Primary"
    >
      <div className="grid grid-cols-5 gap-1">
        {mobileBottomNavigation.map((item) => {
          const isActive = activeItem === item.url;

          return (
            <button
              key={item.url}
              type="button"
              onClick={() => onNavigate(item.url)}
              className={cn(
                "flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-[11px] font-medium transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              )}
              aria-current={isActive ? "page" : undefined}
              aria-label={item.title}
            >
              <item.icon className="h-4 w-4" aria-hidden="true" />
              <span className="truncate">{item.title}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
