import { AchievementAccountSync } from "./AchievementAccountSync";

/** Save a PlayStation NPSSO token, turn the trophy sync on or off and run it on demand. */
export function PsnAchievementsSync() {
  return (
    <AchievementAccountSync
      idPrefix="psn-achievements"
      apiPath="/api/psn-achievements"
      label="PlayStation"
      secretLabel="NPSSO token"
      secretBodyKey="npsso"
      saveHint="Save your NPSSO token above to use this."
      description={
        <>
          Track the trophy progress of your PlayStation games. A game is matched by its title and
          its platform (PS5, PS4, PS3, Vita), so its platform must be set. Sign in to{" "}
          <a
            href="https://www.playstation.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline-offset-4 hover:underline"
          >
            playstation.com
          </a>
          , then open{" "}
          <a
            href="https://ca.account.sony.com/api/v1/ssocookie"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline-offset-4 hover:underline"
          >
            ca.account.sony.com/api/v1/ssocookie
          </a>{" "}
          and copy the 64-character <code>npsso</code> value. It is a session token: keep it
          private, and save a new one when PlayStation stops accepting it.
        </>
      }
    />
  );
}
