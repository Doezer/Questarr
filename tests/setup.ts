import "@testing-library/jest-dom";
import { vi } from "vitest";

// Set environment variables for testing
process.env.NODE_ENV = "test";
process.env.SQLITE_DB_PATH = ":memory:";

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(String(key), String(value));
    },
  };
}

function ensureStorage(name: "localStorage" | "sessionStorage"): void {
  try {
    const existing = (globalThis as Record<string, unknown>)[name] as Partial<Storage> | undefined;
    if (
      existing &&
      typeof existing.clear === "function" &&
      typeof existing.getItem === "function"
    ) {
      return;
    }
  } catch {
    // Fall through to install in-memory storage.
  }

  const fallback = createMemoryStorage();
  Object.defineProperty(globalThis, name, {
    value: fallback,
    configurable: true,
    writable: true,
  });

  if (typeof window !== "undefined") {
    Object.defineProperty(window, name, {
      value: fallback,
      configurable: true,
      writable: true,
    });
  }
}

ensureStorage("localStorage");
ensureStorage("sessionStorage");

(globalThis as Record<string, unknown>).ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Better class-based mock for ResizeObserver
class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

(globalThis as Record<string, unknown>).ResizeObserver = MockResizeObserver;

class MockIntersectionObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor(_callback: (_entries: unknown[], _observer: unknown) => void, _options?: object) {}
}

(globalThis as Record<string, unknown>).IntersectionObserver = MockIntersectionObserver;

// jsdom does not implement scrollIntoView; stub it to prevent errors in cmdk/Radix popups
if (typeof window !== "undefined") {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();

  // Unlike real browsers, jsdom re-dispatches focus/blur events even when the target
  // is already document.activeElement. Radix's FocusScope and DismissableLayer both
  // react to those events by re-asserting focus, which recurses infinitely in jsdom.
  // Match real-browser semantics by no-oping redundant focus calls.
  //
  // The same-element check alone isn't enough: a modal Popover (focus trap) combined
  // with cmdk's own autofocus (e.g. MultiSelect's Popover+Command) can make two
  // *different* elements steal focus back and forth from each other synchronously,
  // which jsdom happily recurses forever on. Cap re-entrant depth to break that
  // ping-pong while still allowing the few legitimate nested hops real usage needs.
  let focusReentrancyDepth = 0;
  const MAX_FOCUS_REENTRANCY_DEPTH = 20;
  // Warn at most once per run: if the cap is being hit, one message is enough
  // to flag a real regression without flooding output during the very loop
  // this guard exists to contain.
  let hasWarnedAboutFocusReentrancyCap = false;

  function guardFocusReentrancy(): boolean {
    if (focusReentrancyDepth < MAX_FOCUS_REENTRANCY_DEPTH) return true;
    if (!hasWarnedAboutFocusReentrancyCap) {
      hasWarnedAboutFocusReentrancyCap = true;
      // eslint-disable-next-line no-console
      console.warn(
        "[tests/setup] focus/blur reentrancy cap reached; dropping calls to break a synchronous focus/blur loop"
      );
    }
    return false;
  }

  const originalFocus = window.HTMLElement.prototype.focus;
  window.HTMLElement.prototype.focus = function focus(
    this: HTMLElement,
    ...args: Parameters<typeof originalFocus>
  ) {
    if (window.document.activeElement === this) return;
    if (!guardFocusReentrancy()) return;
    focusReentrancyDepth++;
    try {
      originalFocus.apply(this, args);
    } finally {
      focusReentrancyDepth--;
    }
  };

  const originalBlur = window.HTMLElement.prototype.blur;
  window.HTMLElement.prototype.blur = function blur(
    this: HTMLElement,
    ...args: Parameters<typeof originalBlur>
  ) {
    if (window.document.activeElement !== this) return;
    if (!guardFocusReentrancy()) return;
    focusReentrancyDepth++;
    try {
      originalBlur.apply(this, args);
    } finally {
      focusReentrancyDepth--;
    }
  };

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}
