import { useState, useEffect, type Dispatch, type SetStateAction } from "react";

type Widen<T> = T extends boolean ? boolean : T extends number ? number : T;

/**
 * Like useState, but persists the value to localStorage under the given key.
 * Reads the initial value from localStorage (falling back to `defaultValue`),
 * and writes back on every change.
 */
export function useLocalStorageState<T extends string | number | boolean>(
  key: string,
  defaultValue: T
): [Widen<T>, Dispatch<SetStateAction<Widen<T>>>] {
  type W = Widen<T>;
  const [value, setValue] = useState<W>(() => {
    const stored = localStorage.getItem(key);
    if (stored === null) return defaultValue as W;

    // Deserialize based on the type of the default value
    if (typeof defaultValue === "boolean") return (stored === "true") as W;
    if (typeof defaultValue === "number") {
      const parsed = Number(stored);
      return (Number.isNaN(parsed) ? defaultValue : parsed) as W;
    }
    return stored as W;
  });

  useEffect(() => {
    localStorage.setItem(key, String(value));
  }, [key, value]);

  return [value, setValue];
}
