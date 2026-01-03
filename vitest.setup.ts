import "@testing-library/jest-dom";
import { vi } from "vitest";

global.ResizeObserver = vi.fn().mockImplementation(() => ({
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
global.ResizeObserver = MockResizeObserver as any;
