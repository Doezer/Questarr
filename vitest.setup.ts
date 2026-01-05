import "@testing-library/jest-dom";
import { vi } from "vitest";

// Set environment variables for testing
process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test_db";
process.env.NODE_ENV = "test";

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
