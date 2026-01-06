// src/lib/versionService.ts
export async function fetchLatestQuestarrVersion(): Promise<string | null> {
  try {
    const res = await fetch("https://raw.githubusercontent.com/Doezer/Questarr/main/package.json");
    if (!res.ok) return null;
    const data = await res.json();
    return data.version || null;
  } catch (error) {
    console.error("Failed to fetch latest Questarr version:", error);
    return null;
  }
}
