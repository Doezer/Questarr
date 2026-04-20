/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLocalStorageState } from "../src/hooks/use-local-storage-state";

describe("useLocalStorageState", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("initialization", () => {
    it("returns the default string value when key is not set", () => {
      const { result } = renderHook(() => useLocalStorageState("test-key", "default"));
      expect(result.current[0]).toBe("default");
    });

    it("returns the default number value when key is not set", () => {
      const { result } = renderHook(() => useLocalStorageState("test-num", 42));
      expect(result.current[0]).toBe(42);
    });

    it("returns the default boolean value when key is not set", () => {
      const { result } = renderHook(() => useLocalStorageState("test-bool", false));
      expect(result.current[0]).toBe(false);
    });

    it("reads an existing string from localStorage on mount", () => {
      localStorage.setItem("test-key", "stored-value");
      const { result } = renderHook(() => useLocalStorageState("test-key", "default"));
      expect(result.current[0]).toBe("stored-value");
    });

    it("reads and deserializes an existing number from localStorage", () => {
      localStorage.setItem("test-num", "99");
      const { result } = renderHook(() => useLocalStorageState("test-num", 0));
      expect(result.current[0]).toBe(99);
    });

    it("reads and deserializes 'true' boolean from localStorage", () => {
      localStorage.setItem("test-bool", "true");
      const { result } = renderHook(() => useLocalStorageState("test-bool", false));
      expect(result.current[0]).toBe(true);
    });

    it("reads and deserializes 'false' boolean from localStorage", () => {
      localStorage.setItem("test-bool", "false");
      const { result } = renderHook(() => useLocalStorageState("test-bool", true));
      expect(result.current[0]).toBe(false);
    });

    it("falls back to default when stored number is NaN", () => {
      localStorage.setItem("test-num", "not-a-number");
      const { result } = renderHook(() => useLocalStorageState("test-num", 10));
      expect(result.current[0]).toBe(10);
    });
  });

  describe("persistence", () => {
    it("writes value to localStorage when state is set", () => {
      const { result } = renderHook(() => useLocalStorageState("test-key", "initial"));

      act(() => {
        result.current[1]("changed");
      });

      expect(localStorage.getItem("test-key")).toBe("changed");
    });

    it("writes number value as string to localStorage", () => {
      const { result } = renderHook(() => useLocalStorageState("test-num", 1));

      act(() => {
        result.current[1](7);
      });

      expect(localStorage.getItem("test-num")).toBe("7");
    });

    it("writes boolean value as string to localStorage", () => {
      const { result } = renderHook(() => useLocalStorageState("test-bool", false));

      act(() => {
        result.current[1](true);
      });

      expect(localStorage.getItem("test-bool")).toBe("true");
    });

    it("reflects the updated state after calling setter", () => {
      const { result } = renderHook(() => useLocalStorageState("test-key", "old"));

      act(() => {
        result.current[1]("new");
      });

      expect(result.current[0]).toBe("new");
    });
  });
});
