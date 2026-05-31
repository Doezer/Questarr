/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useIsMobile } from "../src/hooks/use-mobile";

const originalMatchMedia = globalThis.matchMedia;
const originalInnerWidth = globalThis.innerWidth;

describe("useIsMobile", () => {
  afterEach(() => {
    globalThis.matchMedia = originalMatchMedia;
    globalThis.innerWidth = originalInnerWidth;
    vi.restoreAllMocks();
  });

  it("supports legacy MediaQueryList listeners used by jsdom environments", () => {
    const addListener = vi.fn();
    const removeListener = vi.fn();

    globalThis.innerWidth = 767;
    globalThis.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      media: "(max-width: 767px)",
      onchange: null,
      addListener,
      removeListener,
      dispatchEvent: vi.fn(),
    }) as typeof globalThis.matchMedia;

    const { result, unmount } = renderHook(() => useIsMobile());

    expect(result.current).toBe(true);
    expect(addListener).toHaveBeenCalledTimes(1);

    unmount();

    expect(removeListener).toHaveBeenCalledTimes(1);
  });
});
