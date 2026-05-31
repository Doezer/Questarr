/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useIsMobile } from "../src/hooks/use-mobile";

const originalMatchMedia = window.matchMedia;
const originalInnerWidth = window.innerWidth;

describe("useIsMobile", () => {
  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    window.innerWidth = originalInnerWidth;
    vi.restoreAllMocks();
  });

  it("supports legacy MediaQueryList listeners used by jsdom environments", () => {
    const addListener = vi.fn();
    const removeListener = vi.fn();

    window.innerWidth = 767;
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      media: "(max-width: 767px)",
      onchange: null,
      addListener,
      removeListener,
      dispatchEvent: vi.fn(),
    }) as typeof window.matchMedia;

    const { result, unmount } = renderHook(() => useIsMobile());

    expect(result.current).toBe(true);
    expect(addListener).toHaveBeenCalledTimes(1);

    unmount();

    expect(removeListener).toHaveBeenCalledTimes(1);
  });
});
