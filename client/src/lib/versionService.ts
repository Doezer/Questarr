import { useEffect, useState } from "react";

export async function fetchLatestQuestarrVersion(): Promise<string | null> {
  try {
    const res = await fetch("https://raw.githubusercontent.com/Doezer/Questarr/main/package.json");
    if (!res.ok) return null;
    const data = await res.json();
    return data.version || null;
  } catch {
    return null;
  }
}

export function useLatestQuestarrVersion(): string | null {
  const [latest, setLatest] = useState<string | null>(null);
  useEffect(() => {
    fetchLatestQuestarrVersion().then(setLatest);
  }, []);
  return latest;
}
