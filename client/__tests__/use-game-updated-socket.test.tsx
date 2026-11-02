/** @vitest-environment jsdom */
import React from "react";
import { act, render } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useGameUpdatedSocket } from "../src/hooks/use-game-updated-socket";

const state = vi.hoisted(() => ({ on: vi.fn(), off: vi.fn(), invalidate: vi.fn() }));
vi.mock("@/lib/socket", () => ({ getSocket: () => ({ on: state.on, off: state.off }) }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: state.invalidate }),
}));
function Observer() {
  useGameUpdatedSocket();
  return null;
}
beforeEach(() => vi.clearAllMocks());
it("refreshes cached games on initial connection, reconnect and updates, and removes listeners", () => {
  const { unmount } = render(<Observer />);
  const connect = state.on.mock.calls.find(([event]) => event === "connect")?.[1] as () => void;
  const update = state.on.mock.calls.find(([event]) => event === "gameUpdated")?.[1] as () => void;
  expect(connect).toBeTypeOf("function");
  act(() => {
    connect();
    connect();
    update();
  });
  expect(state.invalidate).toHaveBeenCalledTimes(3);
  expect(state.invalidate).toHaveBeenCalledWith({ queryKey: ["/api/games"] });
  unmount();
  expect(state.off).toHaveBeenCalledWith("connect", connect);
  expect(state.off).toHaveBeenCalledWith("gameUpdated", update);
});
