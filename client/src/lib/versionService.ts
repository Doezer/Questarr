// src/lib/versionService.ts
export async function fetchLatestQuestarrVersion(): Promise<string | null> {
  try {
    const res = await fetch("https://api.github.com/repos/Doezer/Questarr/releases/latest", {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!res.ok) {
      if (res.status === 403) {
        console.warn(
          "GitHub Releases API rate-limited or forbidden while checking latest Questarr version.",
          {
            status: res.status,
            rateLimitRemaining: res.headers.get("x-ratelimit-remaining"),
            rateLimitReset: res.headers.get("x-ratelimit-reset"),
          }
        );
      } else if (res.status === 404) {
        console.warn("GitHub Releases API returned 404 while checking latest Questarr version.");
      } else {
        console.warn("GitHub Releases API request failed while checking latest Questarr version.", {
          status: res.status,
          statusText: res.statusText,
        });
      }
      return null;
    }

    const data = await res.json();
    const tagName: string | undefined = data.tag_name;
    if (!tagName) return null;
    return tagName.replace(/^v/, "");
  } catch (error) {
    console.error("Failed to fetch latest Questarr version:", error);
    return null;
  }
}
