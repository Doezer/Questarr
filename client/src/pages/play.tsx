import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useLocalStorageState } from "@/hooks/use-local-storage-state";
import { GhostGame } from "@/game/ghost-game";
import { GHOST_UNLOCK_KEY } from "@/lib/ghost-mode";

function randomSeed() {
  // A fresh procedural layout per run isn't security-sensitive, but crypto.getRandomValues
  // avoids Math.random() static-analysis flags for no real cost.
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

export default function PlayPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [, setGhostUnlocked] = useLocalStorageState(GHOST_UNLOCK_KEY, false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<GhostGame | null>(null);
  const progressFillRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLDivElement>(null);

  const [locked, setLocked] = useState(false);
  const [won, setWon] = useState(false);

  const handleCaught = useCallback(() => {
    toast({ description: "Incident report filed. Reposition and try again." });
  }, [toast]);

  const handleWin = useCallback(() => {
    setWon(true);
    setGhostUnlocked(true);
  }, [setGhostUnlocked]);

  // The game engine effect below intentionally mounts once (recreating it would tear down and
  // rebuild the WebGL context). Route its callbacks through a ref so it always calls the latest
  // handlers rather than closing over whatever was current at mount time.
  const callbacksRef = useRef({ onCaught: handleCaught, onWin: handleWin });
  useEffect(() => {
    callbacksRef.current = { onCaught: handleCaught, onWin: handleWin };
  }, [handleCaught, handleWin]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const game = new GhostGame(canvas, randomSeed(), {
      onLockChange: setLocked,
      onCaught: () => callbacksRef.current.onCaught(),
      onWin: () => callbacksRef.current.onWin(),
      onHackProgress: (progress, canInteract) => {
        if (progressFillRef.current) {
          progressFillRef.current.style.width = `${progress * 100}%`;
        }
        if (promptRef.current) {
          promptRef.current.style.opacity = canInteract && progress < 1 ? "1" : "0";
        }
      },
    });
    gameRef.current = game;
    game.start();

    return () => {
      game.dispose();
      gameRef.current = null;
    };
  }, []);

  const handlePlay = () => {
    setWon(false);
    gameRef.current?.lock();
  };

  const handlePlayAgain = () => {
    setWon(false);
    gameRef.current?.regenerate(randomSeed());
    gameRef.current?.lock();
  };

  return (
    <div className="fixed inset-0 bg-black">
      <canvas ref={canvasRef} className="h-full w-full" />

      {/* In-game HUD, always mounted so refs update imperatively without re-render */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-between p-6">
        <div className="w-2 h-2 rounded-full bg-white/80 mt-[calc(50vh-4px)]" />
        <div
          ref={promptRef}
          className="mb-24 rounded-md bg-black/70 px-4 py-2 text-sm text-white opacity-0 transition-opacity"
        >
          Hold <kbd className="font-mono">E</kbd> to hack
          <div className="mt-1 h-1.5 w-40 overflow-hidden rounded-full bg-white/20">
            <div ref={progressFillRef} className="h-full w-0 bg-emerald-400" />
          </div>
        </div>
      </div>

      {!locked && !won && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-white">
          <div className="max-w-md space-y-4 rounded-lg border border-white/10 bg-black/60 p-8 text-center">
            <h1 className="text-2xl font-bold">Ghost the Terminal</h1>
            <p className="text-sm text-white/70">
              Sneak past the guard and hack the terminal without being seen. A fresh, procedurally
              generated room every run.
            </p>
            <ul className="text-left text-sm text-white/70 space-y-1">
              <li>
                <kbd className="font-mono">WASD</kbd> move, mouse to look
              </li>
              <li>
                <kbd className="font-mono">F</kbd> throw a distraction
              </li>
              <li>
                Hold <kbd className="font-mono">E</kbd> at the terminal to hack it
              </li>
              <li>
                <kbd className="font-mono">Esc</kbd> to pause
              </li>
            </ul>
            <div className="flex justify-center gap-2 pt-2">
              <Button onClick={handlePlay}>Click to play</Button>
              <Button variant="outline" onClick={() => navigate("/")}>
                Exit to Questarr
              </Button>
            </div>
          </div>
        </div>
      )}

      {won && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-white">
          <div className="max-w-md space-y-4 rounded-lg border border-emerald-400/30 bg-black/60 p-8 text-center">
            <h1 className="text-2xl font-bold text-emerald-400">Terminal hacked</h1>
            <p className="text-sm text-white/70">
              Ghost Mode is now unlocked &mdash; find it under Settings &rarr; General.
            </p>
            <div className="flex justify-center gap-2 pt-2">
              <Button onClick={handlePlayAgain}>Play again (new layout)</Button>
              <Button variant="outline" onClick={() => navigate("/")}>
                Exit to Questarr
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
