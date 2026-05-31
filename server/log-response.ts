function isPrimitiveLogValue(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function shouldPreserveString(key?: string): boolean {
  return key === "message";
}

export function truncateLogData(data: unknown, depth = 0, key?: string): unknown {
  if (!data) return data;

  if (depth > 2) {
    if (Array.isArray(data) && data.every(isPrimitiveLogValue)) {
      return data;
    }

    if (isPrimitiveLogValue(data)) {
      return typeof data === "string" && data.length > 50 && !shouldPreserveString(key)
        ? data.substring(0, 50) + "..."
        : data;
    }

    return "[Object/Array]";
  }

  if (Array.isArray(data)) {
    if (data.length > 3) {
      const truncatedItems = data.slice(0, 3).map((item) => truncateLogData(item, depth + 1, key));
      return [...truncatedItems, `... ${data.length - 3} more items`];
    }
    return data.map((item) => truncateLogData(item, depth + 1, key));
  }

  if (typeof data === "object") {
    const dict = data as Record<string, unknown>;
    const newObj: Record<string, unknown> = {};
    const keys = Object.keys(dict);

    const maxKeys = 5;
    const processingKeys = keys.slice(0, maxKeys);

    for (const key of processingKeys) {
      newObj[key] = truncateLogData(dict[key], depth + 1, key);
    }

    if (keys.length > maxKeys) {
      newObj._truncated = `... ${keys.length - maxKeys} more keys`;
    }
    return newObj;
  }

  if (typeof data === "string" && data.length > 50 && !shouldPreserveString(key)) {
    return data.substring(0, 50) + "...";
  }
  return data;
}
