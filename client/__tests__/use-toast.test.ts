import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useToast, toast, reducer } from "../src/hooks/use-toast";

describe("use-toast reducer", () => {
  it("adds a toast and caps the list at the toast limit", () => {
    const state = reducer(
      { toasts: [{ id: "1", open: true }] },
      { type: "ADD_TOAST", toast: { id: "2", open: true } }
    );
    expect(state.toasts).toHaveLength(1);
    expect(state.toasts[0].id).toBe("2");
  });

  it("updates a matching toast by id", () => {
    const state = reducer(
      { toasts: [{ id: "1", open: true, title: "Old" }] },
      { type: "UPDATE_TOAST", toast: { id: "1", title: "New" } }
    );
    expect(state.toasts[0].title).toBe("New");
  });

  it("leaves non-matching toasts untouched on update", () => {
    const state = reducer(
      { toasts: [{ id: "1", open: true, title: "Old" }] },
      { type: "UPDATE_TOAST", toast: { id: "other", title: "New" } }
    );
    expect(state.toasts[0].title).toBe("Old");
  });

  it("marks a specific toast closed on dismiss with an id", () => {
    const state = reducer(
      {
        toasts: [
          { id: "1", open: true },
          { id: "2", open: true },
        ],
      },
      { type: "DISMISS_TOAST", toastId: "1" }
    );
    expect(state.toasts.find((t) => t.id === "1")?.open).toBe(false);
    expect(state.toasts.find((t) => t.id === "2")?.open).toBe(true);
  });

  it("marks all toasts closed on dismiss without an id", () => {
    const state = reducer(
      {
        toasts: [
          { id: "1", open: true },
          { id: "2", open: true },
        ],
      },
      { type: "DISMISS_TOAST", toastId: undefined }
    );
    expect(state.toasts.every((t) => t.open === false)).toBe(true);
  });

  it("removes a specific toast on REMOVE_TOAST with an id", () => {
    const state = reducer(
      {
        toasts: [
          { id: "1", open: true },
          { id: "2", open: true },
        ],
      },
      { type: "REMOVE_TOAST", toastId: "1" }
    );
    expect(state.toasts.map((t) => t.id)).toEqual(["2"]);
  });

  it("clears all toasts on REMOVE_TOAST without an id", () => {
    const state = reducer(
      { toasts: [{ id: "1", open: true }] },
      { type: "REMOVE_TOAST", toastId: undefined }
    );
    expect(state.toasts).toEqual([]);
  });
});

describe("toast() and useToast()", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.dismiss();
    });
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("adds a toast visible to useToast subscribers", () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      toast({ title: "Hello" });
    });

    expect(result.current.toasts.length).toBeGreaterThan(0);
    expect(result.current.toasts[0].title).toBe("Hello");
  });

  it("update() mutates the toast in place", () => {
    const { result } = renderHook(() => useToast());
    let handle: ReturnType<typeof toast>;

    act(() => {
      handle = toast({ title: "First" });
    });

    act(() => {
      handle.update({ id: handle.id, title: "Second", open: true });
    });

    expect(result.current.toasts[0].title).toBe("Second");
  });

  it("dismiss() closes the toast via onOpenChange", () => {
    const { result } = renderHook(() => useToast());
    let handle: ReturnType<typeof toast>;

    act(() => {
      handle = toast({ title: "Closable" });
    });

    act(() => {
      handle.dismiss();
    });

    expect(result.current.toasts[0].open).toBe(false);
  });

  it("onOpenChange(false) triggers dismiss", () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      toast({ title: "Auto-dismiss" });
    });

    act(() => {
      result.current.toasts[0].onOpenChange?.(false);
    });

    expect(result.current.toasts[0].open).toBe(false);
  });

  it("useToast dismiss(id) closes a specific toast", () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      toast({ title: "Only one due to TOAST_LIMIT" });
    });
    const id = result.current.toasts[0].id;

    act(() => {
      result.current.dismiss(id);
    });

    expect(result.current.toasts[0].open).toBe(false);
  });
});
