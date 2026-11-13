/** @vitest-environment jsdom */
import React from "react";
import { act, render } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { usePlaySessionsSocket } from "../src/hooks/use-play-sessions-socket";

const state = vi.hoisted(() => ({ on: vi.fn(), off: vi.fn(), invalidate: vi.fn() }));
vi.mock("@/lib/socket", () => ({ getSocket: () => ({ on: state.on, off: state.off }) }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: state.invalidate }),
}));
function Observer() {
  usePlaySessionsSocket();
  return null;
}
beforeEach(() => vi.clearAllMocks());
it("invalidates play-time queries on playSessionsUpdated and removes its listener", () => {
  const { unmount } = render(<Observer />);
  const handler = state.on.mock.calls.find(
    ([event]) => event === "playSessionsUpdated"
  )?.[1] as () => void;
  expect(handler).toBeTypeOf("function");
  act(() => handler());
  const keys = state.invalidate.mock.calls.map(([arg]) => arg.queryKey).filter(Boolean);
  expect(keys).toEqual([
    ["/api/stats/play-time"],
    ["/api/steam/playtime"],
    ["/api/play-sessions/active"],
  ]);
  const predicate = state.invalidate.mock.calls.find(([arg]) => arg.predicate)?.[0]
    .predicate as (q: { queryKey: unknown[] }) => boolean;
  expect(predicate({ queryKey: ["/api/games/abc/play-sessions"] })).toBe(true);
  expect(predicate({ queryKey: ["/api/games/abc/journal"] })).toBe(false);
  unmount();
  expect(state.off).toHaveBeenCalledWith("playSessionsUpdated", handler);
});
