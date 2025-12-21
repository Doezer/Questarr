import { useState, useEffect } from "react";

// ⚡ Bolt: This custom hook encapsulates the logic for debouncing a value.
// It is a reusable and efficient way to prevent expensive operations
// (like API calls) from being triggered too frequently. By delaying the
// update of the debounced value, it ensures that the operation only
// runs after the user has stopped providing input for a specified time.
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    // Cleanup the timeout if value or delay changes before it fires
    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}
