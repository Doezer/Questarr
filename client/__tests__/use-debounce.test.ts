/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDebounce } from "../src/hooks/use-debounce";

describe("useDebounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the initial value immediately", () => {
    const { result } = renderHook(() => useDebounce("initial", 300));
    expect(result.current).toBe("initial");
  });

  it("does not update immediately on value change", () => {
    const { result, rerender } = renderHook(({ value }) => useDebounce(value, 300), {
      initialProps: { value: "initial" },
    });

    rerender({ value: "updated" });

    expect(result.current).toBe("initial");
  });

  it("updates value after the delay has passed", () => {
    const { result, rerender } = renderHook(({ value }) => useDebounce(value, 300), {
      initialProps: { value: "initial" },
    });

    rerender({ value: "updated" });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current).toBe("updated");
  });

  it("only uses the latest value when changed multiple times before delay", () => {
    const { result, rerender } = renderHook(({ value }) => useDebounce(value, 300), {
      initialProps: { value: "first" },
    });

    rerender({ value: "second" });
    act(() => {
      vi.advanceTimersByTime(100);
    });

    rerender({ value: "third" });
    act(() => {
      vi.advanceTimersByTime(100);
    });

    // Delay not yet elapsed since last change
    expect(result.current).toBe("first");

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current).toBe("third");
  });

  it("clears the previous timer on rapid re-renders", () => {
    const { result, rerender } = renderHook(({ value }) => useDebounce(value, 500), {
      initialProps: { value: "a" },
    });

    rerender({ value: "b" });
    act(() => {
      vi.advanceTimersByTime(499);
    });
    rerender({ value: "c" });

    // 499ms into the "b" timer, but "c" reset it — value should still be "a"
    expect(result.current).toBe("a");

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(result.current).toBe("c");
  });

  it("works with zero delay", () => {
    const { result, rerender } = renderHook(({ value }) => useDebounce(value, 0), {
      initialProps: { value: "start" },
    });

    rerender({ value: "end" });

    act(() => {
      vi.advanceTimersByTime(0);
    });

    expect(result.current).toBe("end");
  });

  it("cancels pending update on unmount", () => {
    const { result, rerender, unmount } = renderHook(({ value }) => useDebounce(value, 300), {
      initialProps: { value: "initial" },
    });

    rerender({ value: "updated" });
    unmount();

    act(() => {
      vi.advanceTimersByTime(300);
    });

    // Value should remain what it was before unmount
    expect(result.current).toBe("initial");
  });

  it("works with non-string types (numbers)", () => {
    const { result, rerender } = renderHook(({ value }) => useDebounce(value, 200), {
      initialProps: { value: 0 },
    });

    rerender({ value: 42 });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(result.current).toBe(42);
  });
});
