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
