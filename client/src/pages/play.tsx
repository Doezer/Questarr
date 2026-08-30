import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useLocalStorageState } from "@/hooks/use-local-storage-state";
import { InfiltrationGame, type ObjectiveState, type StealthState } from "@/game/infiltration-game";
import { GHOST_UNLOCK_KEY } from "@/lib/ghost-mode";

function randomSeed() {
  // A fresh procedural layout per run isn't security-sensitive, but crypto.getRandomValues
  // avoids Math.random() static-analysis flags for no real cost.
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

/**
 * `/play?seed=1234` replays an exact layout, which makes a run shareable and lets
 * an automated check drive a known facility. Anything unparseable falls back to a
 * random layout.
 */
function initialSeed() {
  const raw = new URLSearchParams(window.location.search).get("seed");
  if (raw === null) return randomSeed();
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed >>> 0 : randomSeed();
}

const CONTROLS: { keys: string; action: string }[] = [
  { keys: "Left click", action: "Move to a tile" },
  { keys: "Click console", action: "Walk over and hack" },
  { keys: "Right click / F", action: "Throw a distraction" },
  { keys: "Ctrl", action: "Crouch — slower, quieter, harder to see" },
  { keys: "Scroll", action: "Zoom" },
  { keys: "Esc", action: "Pause" },
];

/** Detection bar colour, so the meter reads as a threat level and not just a number. */
function detectionColor(awareness: number): string {
  if (awareness >= 0.66) return "#ff3b3b";
  if (awareness >= 0.3) return "#ffb020";
  return "#35f0b0";
}

/** The single next step, so the HUD never asks the player to hold two goals. */
function objectiveText({ needsKeycard, hasKeycard }: ObjectiveState): string {
  if (needsKeycard && !hasKeycard) return "find the keycard, then reach the console";
  return "reach the console and hack it unseen";
}

export default function PlayPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [, setGhostUnlocked] = useLocalStorageState(GHOST_UNLOCK_KEY, false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<InfiltrationGame | null>(null);
  const progressFillRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLDivElement>(null);
  // Stealth updates ten times a second, so they are written straight to the DOM
  // rather than through React state — the render loop must never re-render.
  const detectionFillRef = useRef<HTMLDivElement>(null);
  const stanceRef = useRef<HTMLSpanElement>(null);
  const exposureRef = useRef<HTMLSpanElement>(null);

  const [paused, setPaused] = useState(true);
  const [won, setWon] = useState(false);
  const [objective, setObjective] = useState<ObjectiveState>({
    needsKeycard: false,
    hasKeycard: false,
  });

  const handleCaught = useCallback(() => {
    toast({ description: "Spotted. Incident report filed — back to the entry point." });
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

  // Written straight to the DOM: this fires on a 10Hz cadence from the render
  // loop, and routing it through state would re-render the page around the canvas.
  const applyStealth = useCallback(({ stance, awareness, illumination }: StealthState) => {
    if (detectionFillRef.current) {
      detectionFillRef.current.style.width = `${Math.round(awareness * 100)}%`;
      detectionFillRef.current.style.backgroundColor = detectionColor(awareness);
    }
    if (stanceRef.current) {
      stanceRef.current.textContent = stance === "crouched" ? "Crouched" : "Standing";
    }
    if (exposureRef.current) {
      const hidden = illumination < 0.25;
      exposureRef.current.textContent = hidden ? "In shadow" : "In the open";
      exposureRef.current.className = hidden ? "text-sky-300" : "text-white/40";
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const game = new InfiltrationGame(canvas, initialSeed(), {
      onPauseChange: setPaused,
      onObjectiveChange: setObjective,
      onCaught: () => callbacksRef.current.onCaught(),
      onWin: () => callbacksRef.current.onWin(),
      onStealthChange: (stealth) => applyStealth(stealth),
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
    // applyStealth is a stable useCallback, so this still mounts exactly once.
  }, [applyStealth]);

  const handleStart = useCallback(() => {
    setWon(false);
    gameRef.current?.setPaused(false);
  }, []);

  const handlePlayAgain = useCallback(() => {
    setWon(false);
    gameRef.current?.regenerate(randomSeed());
    gameRef.current?.setPaused(false);
  }, []);

  const handlePause = useCallback(() => {
    gameRef.current?.setPaused(true);
  }, []);

  const handleExit = useCallback(() => {
    navigate("/");
  }, [navigate]);

  const overlayOpen = paused || won;

  return (
    <div className="fixed inset-0 bg-black">
      <canvas
        ref={canvasRef}
        className="h-full w-full touch-none"
        aria-label="Infiltration game. Click a tile to move, click the console to hack it, right-click to throw a distraction, Ctrl to crouch."
      />

      {/* In-game HUD, always mounted so refs update imperatively without re-render */}
      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-6">
        <div className="flex items-center gap-2 self-start">
          <div className="rounded-md border border-white/10 bg-black/60 px-4 py-2 text-sm text-white/80">
            <span className="text-emerald-400">Objective</span> &mdash; {objectiveText(objective)}
          </div>
          {objective.needsKeycard && (
            <div
              className={
                objective.hasKeycard
                  ? "rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-300"
                  : "rounded-md border border-white/10 bg-black/60 px-4 py-2 text-sm text-white/40"
              }
            >
              {objective.hasKeycard ? "Keycard acquired" : "Keycard"}
            </div>
          )}
        </div>

        <div className="flex flex-col items-center gap-2">
          <div
            ref={promptRef}
            className="rounded-md bg-black/70 px-4 py-2 text-sm text-white opacity-0 transition-opacity"
          >
            Hacking &mdash; stay in range
            <div className="mt-1 h-1.5 w-40 overflow-hidden rounded-full bg-white/20">
              <div ref={progressFillRef} className="h-full w-0 bg-emerald-400" />
            </div>
          </div>
          <div
            className="flex items-center gap-3 rounded-md border border-white/10 bg-black/60 px-4 py-2 text-xs text-white/70"
            role="status"
            aria-label="Stealth status"
          >
            <span ref={stanceRef}>Standing</span>
            <span ref={exposureRef} className="text-white/40">
              In the open
            </span>
            <span className="flex items-center gap-2">
              Detection
              <span className="block h-1.5 w-24 overflow-hidden rounded-full bg-white/20">
                <span ref={detectionFillRef} className="block h-full w-0 bg-emerald-400" />
              </span>
            </span>
          </div>
          <div className="rounded-md bg-black/50 px-3 py-1 text-xs text-white/50">
            Left click to move &middot; Ctrl to crouch &middot; right click to throw &middot; Esc to
            pause
          </div>
        </div>
      </div>

      {!overlayOpen && (
        // The Button itself can't carry the positioning: the shared .hover-elevate
        // utility forces position: relative on every button, which would win over
        // an `absolute` class here and drop it into normal flow below the canvas.
        <div className="absolute right-6 top-6">
          <Button
            variant="outline"
            size="sm"
            aria-label="Pause the infiltration"
            onClick={handlePause}
          >
            Pause
          </Button>
        </div>
      )}

      {paused && !won && (
        <section
          aria-labelledby="play-briefing-title"
          className="absolute inset-0 flex items-center justify-center bg-black/80 text-white"
        >
          <div className="max-w-md space-y-4 rounded-lg border border-white/10 bg-black/60 p-8 text-center">
            <h1 id="play-briefing-title" className="text-2xl font-bold">
              Ghost the Terminal
            </h1>
            <p className="text-sm text-white/70">
              A procedurally generated facility of connected rooms, patrolling guards, and one
              console worth hacking. The door to it is locked, so find the keycard first. Stay out
              of the vision cones &mdash; walls and crates break line of sight.
            </p>
            <dl className="mx-auto grid max-w-xs grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-left text-sm text-white/70">
              {CONTROLS.map(({ keys, action }) => (
                <div key={keys} className="contents">
                  <dt className="font-mono text-white/90">{keys}</dt>
                  <dd>{action}</dd>
                </div>
              ))}
            </dl>
            <div className="flex justify-center gap-2 pt-2">
              <Button onClick={handleStart}>Begin infiltration</Button>
              <Button variant="outline" onClick={handleExit}>
                Exit to Questarr
              </Button>
            </div>
          </div>
        </section>
      )}

      {won && (
        <section
          aria-labelledby="play-win-title"
          className="absolute inset-0 flex items-center justify-center bg-black/80 text-white"
        >
          <div className="max-w-md space-y-4 rounded-lg border border-emerald-400/30 bg-black/60 p-8 text-center">
            <h1 id="play-win-title" className="text-2xl font-bold text-emerald-400">
              Terminal hacked
            </h1>
            <p className="text-sm text-white/70">
              Ghost Mode is now unlocked &mdash; find it under Settings &rarr; General.
            </p>
            <div className="flex justify-center gap-2 pt-2">
              <Button onClick={handlePlayAgain}>Play again (new layout)</Button>
              <Button variant="outline" onClick={handleExit}>
                Exit to Questarr
              </Button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
