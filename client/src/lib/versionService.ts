// src/lib/versionService.ts
export async function fetchLatestQuestarrVersion(): Promise<string | null> {
  try {
    const res = await fetch("https://api.github.com/repos/Doezer/Questarr/releases/latest");
    if (!res.ok) return null;
    const data = await res.json();
    const tagName: string | undefined = data.tag_name;
    if (!tagName) return null;
    return tagName.replace(/^v/, "");
  } catch (error) {
    console.error("Failed to fetch latest Questarr version:", error);
    return null;
  }
}
