/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useViewControls } from "../src/hooks/use-view-controls";

describe("useViewControls", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("uses libraryViewMode and libraryListDensity keys for pageKey=library", () => {
    const { result } = renderHook(() => useViewControls("library"));

    act(() => {
      result.current.setViewMode("list");
    });

    expect(localStorage.getItem("libraryViewMode")).toBe("list");

    act(() => {
      result.current.setListDensity("compact");
    });

    expect(localStorage.getItem("libraryListDensity")).toBe("compact");
  });

  it("defaults to grid and comfortable", () => {
    const { result } = renderHook(() => useViewControls("library"));
    expect(result.current.viewMode).toBe("grid");
    expect(result.current.listDensity).toBe("comfortable");
  });

  it("uses wishlistViewMode and wishlistListDensity keys for pageKey=wishlist", () => {
    const { result } = renderHook(() => useViewControls("wishlist"));

    act(() => {
      result.current.setViewMode("list");
    });

    expect(localStorage.getItem("wishlistViewMode")).toBe("list");
  });
});
