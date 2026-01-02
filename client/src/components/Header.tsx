import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Plus, Moon, Sun } from "lucide-react";
import AddGameModal from "./AddGameModal";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NotificationCenter } from "./NotificationCenter";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

interface HeaderProps {
  title?: string;
}

export default function Header({
  title = "Dashboard",
}: HeaderProps) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Avoid hydration mismatch by only rendering theme-dependent UI after mounting
  useEffect(() => {
    setMounted(true);
  }, []);

  const handleThemeToggle = () => {
    setTheme(theme === "dark" ? "light" : "dark");
  };

  return (
    <header className="flex items-center justify-between p-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex items-center gap-4">
        <Tooltip>
          <TooltipTrigger asChild>
            <SidebarTrigger data-testid="button-sidebar-toggle" />
          </TooltipTrigger>
          <TooltipContent side="right">
            <p>Toggle Sidebar</p>
          </TooltipContent>
        </Tooltip>
        <h1 className="text-xl font-semibold" data-testid="text-page-title">
          {title}
        </h1>
      </div>

      <div className="flex items-center gap-2">
        <AddGameModal>
          <Button variant="default" size="sm" data-testid="button-add-game" className="gap-2">
            <Plus className="w-4 h-4" />
            Add Game
          </Button>
        </AddGameModal>

        <NotificationCenter />

        <Button
          variant="ghost"
          size="icon"
          onClick={handleThemeToggle}
          data-testid="button-theme-toggle"
          aria-label="Toggle theme"
        >
          {mounted && (theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />)}
          {!mounted && <Sun className="w-4 h-4" />}
        </Button>
      </div>
    </header>
  );
}
