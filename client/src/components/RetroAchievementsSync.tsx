import { AchievementAccountSync, type AchievementAccountStatus } from "./AchievementAccountSync";

export type RetroAchievementsStatus = AchievementAccountStatus;

/** Save a RetroAchievements account, turn its achievement sync on or off and run it on demand. */
export function RetroAchievementsSync() {
  return (
    <AchievementAccountSync
      idPrefix="retroachievements"
      apiPath="/api/retroachievements"
      label="RetroAchievements"
      usernameLabel="RetroAchievements username"
      secretLabel="Web API key"
      secretBodyKey="apiKey"
      saveHint="Save your username and Web API key above to use this."
      description={
        <>
          Track the achievement progress of your retro games (emulation and ROM libraries). A game
          is matched by its title and its console, so its platform must be set. Find your Web API
          key in your{" "}
          <a
            href="https://retroachievements.org/controlpanel.php"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline-offset-4 hover:underline"
          >
            RetroAchievements settings
          </a>
          .
        </>
      }
    />
  );
}
