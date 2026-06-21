export function truncateLogData(data: unknown, depth = 0): unknown {
  if (!data) return data;
  if (depth > 3) return "[Object/Array]";

  if (Array.isArray(data)) {
    if (data.length > 3) {
      const truncatedItems = data.slice(0, 3).map((item) => truncateLogData(item, depth + 1));
      return [...truncatedItems, `... ${data.length - 3} more items`];
    }
    return data.map((item) => truncateLogData(item, depth + 1));
  }

  if (typeof data === "object") {
    const dict = data as Record<string, unknown>;
    const newObj: Record<string, unknown> = {};
    const keys = Object.keys(dict);
    const maxKeys = 5;
    const processingKeys = keys.slice(0, maxKeys);

    for (const key of processingKeys) {
      newObj[key] = truncateLogData(dict[key], depth + 1);
    }

    if (keys.length > maxKeys) {
      newObj["_truncated"] = `... ${keys.length - maxKeys} more keys`;
    }
    return newObj;
  }

  if (typeof data === "string" && data.length > 50) {
    return data.substring(0, 50) + "...";
  }

  return data;
}
