import { storage } from "./storage.js";
import { decryptCredential, encryptCredential } from "./credential-crypto.js";
import {
  AchievementsBusyError,
  AchievementsUnavailableError,
  getAchievementsStatus,
  resetAchievementsRun,
  runScheduledAchievementsSync,
  setAchievementsEnabled,
  setAchievementsEnabledUnlocked,
  syncAchievements,
  withCommitLock,
  type AchievementProvider,
  type AchievementsResult,
  type AchievementsStatus,
  type ProgressSummary,
} from "./achievement-sync.js";
import { OWNED_GAME_STATUSES, type Game } from "../shared/schema.js";

/**
 * Account handling shared by the providers that sign in with a saved secret (RetroAchievements
 * Web API key, PlayStation NPSSO token, OpenXBL key): the encrypted credentials of a user, saving
 * and removing the account, and the provider the sync engine runs. A provider only says how to
 * check its secret and how to read the progress of the tracked games.
 */

export interface AccountCredentials {
  /** The account the progress belongs to, as the provider reports it. */
  username: string;
  /** Stable id of the account when the name can change (a gamertag rename is not a new account). */
  accountId?: string | undefined;
  /** Decrypted secret (API key, token). Never logged and never returned by the API. */
  secret: string;
}

export interface AccountProgress {
  entries: { game: Game; summary: ProgressSummary }[];
  /** Tracked games the provider has no progress for: their stored rows are removed. */
  dropped: string[];
}

export interface AccountProviderDefinition {
  /** Stored in `game_achievement_progress.provider`. */
  id: string;
  /** Shown in messages, e.g. "PlayStation". */
  label: string;
  failureMessage: string;
  /** `systemConfig` keys of the credentials and of the switch and last-run status. */
  credentialsKey(userId: string): string;
  stateKey(userId: string): string;
  /**
   * Check the secret against the provider and return the canonical account name. `username` is
   * what the user typed, when the provider asks for one. Throws when the secret is refused.
   */
  verify(input: { username: string | null; secret: string }): Promise<string | VerifiedAccount>;
  /** Read the progress of the tracked games. Throws when the provider cannot be read. */
  read(credentials: AccountCredentials, tracked: Game[]): Promise<AccountProgress>;
  /** The error means the secret is refused: one failure is reported instead of one per game. */
  isAuthError(error: unknown): boolean;
}

/** What a provider reports about an accepted secret: the name to show and, optionally, a stable id. */
export interface VerifiedAccount {
  username: string;
  accountId?: string | undefined;
}

export class AccountSecretRequiredError extends Error {}

/** What the user typed: the account name (when the provider asks for one) and the secret. */
export interface AccountInput {
  username?: string | null | undefined;
  secret?: string | undefined;
}

export interface AccountStatus extends AchievementsStatus {
  username: string | null;
}

export interface AccountAchievements {
  provider: AchievementProvider;
  getCredentials(userId: string): Promise<AccountCredentials | null>;
  getStatus(userId: string): Promise<AccountStatus>;
  saveAccount(userId: string, input: AccountInput): Promise<void>;
  clearAccount(userId: string): Promise<void>;
  setEnabled(userId: string, enabled: boolean): Promise<void>;
  sync(userId: string, options?: { force?: boolean; now?: Date }): Promise<AchievementsResult>;
  runScheduled(): Promise<void>;
}

/** Saving and removing the account of one user never overlap, so a removal stays final. */
const accountLocks = new Map<string, Promise<unknown>>();
function withAccountLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const result = (accountLocks.get(key) ?? Promise.resolve()).then(task, task);
  const tail = result.catch(() => undefined);
  accountLocks.set(key, tail);
  void tail.then(() => {
    if (accountLocks.get(key) === tail) accountLocks.delete(key);
  });
  return result;
}

interface StoredCredentials {
  username: string;
  apiKey: string;
  accountId?: string;
}

function parseStored(raw: string | null | undefined): StoredCredentials | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredCredentials>;
    if (typeof parsed.username !== "string" || !parsed.username) return null;
    if (typeof parsed.apiKey !== "string" || !parsed.apiKey) return null;
    return {
      username: parsed.username,
      apiKey: parsed.apiKey,
      ...(typeof parsed.accountId === "string" && parsed.accountId
        ? { accountId: parsed.accountId }
        : {}),
    };
  } catch {
    return null;
  }
}

export function createAccountAchievements(def: AccountProviderDefinition): AccountAchievements {
  async function getCredentials(userId: string): Promise<AccountCredentials | null> {
    return (await readAccount(userId)).credentials;
  }

  /**
   * The saved account from one read of its record: the credentials when the secret decrypts, and
   * the account key (stable id, else name) even when it no longer does. Storage errors propagate.
   */
  async function readAccount(
    userId: string
  ): Promise<{ credentials: AccountCredentials | null; key: string | null }> {
    const stored = parseStored(await storage.getSystemConfig(def.credentialsKey(userId)));
    if (!stored) return { credentials: null, key: null };
    const key = (stored.accountId ?? stored.username).toLowerCase();
    try {
      const secret = await decryptCredential(stored.apiKey);
      return {
        credentials: secret
          ? { username: stored.username, accountId: stored.accountId, secret }
          : null,
        key,
      };
    } catch {
      // Do not log the value: a secret that no longer decrypts counts as not saved.
      return { credentials: null, key };
    }
  }

  const provider: AchievementProvider = {
    id: def.id,
    label: def.label,
    failureMessage: def.failureMessage,
    stateKey: def.stateKey,

    async isAvailable(userId) {
      return (await getCredentials(userId)) !== null;
    },

    async identity(userId) {
      const { credentials, key } = await readAccount(userId);
      return credentials ? key : null;
    },

    async scheduledUserIds() {
      const ids: string[] = [];
      for (const user of await storage.getAllUsers()) {
        if (await getCredentials(user.id)) ids.push(user.id);
      }
      return ids;
    },

    async collect(userId, games) {
      const credentials = await getCredentials(userId);
      if (!credentials) return { entries: [], failed: 0 };
      const tracked = games.filter(
        (g) => g.status === "playing" || OWNED_GAME_STATUSES.has(g.status)
      );
      try {
        const { entries, dropped } = await def.read(credentials, tracked);
        return { entries, failed: 0, dropped };
      } catch (error) {
        // The request can hold the secret: report the failure without the error.
        // At least one failure, so a failed read of an empty library is not recorded as a success.
        return { entries: [], failed: def.isAuthError(error) ? 1 : Math.max(1, tracked.length) };
      }
    },
  };

  return {
    provider,
    getCredentials,

    async getStatus(userId) {
      // One view of the account: a removal cannot land between the reads of the three parts.
      return withCommitLock(provider, userId, async () => {
        const [status, credentials] = await Promise.all([
          getAchievementsStatus(provider, userId),
          getCredentials(userId),
        ]);
        return {
          ...status,
          available: credentials !== null,
          username: credentials?.username ?? null,
        };
      });
    },

    /**
     * Save the account after the provider accepted the secret. A different account drops the
     * stored progress, so the new account starts from a fresh baseline instead of notifying the
     * difference. The cleanup runs before the new credentials are written: a failed cleanup leaves
     * the old account saved, and a retry cleans up again.
     */
    saveAccount(userId, input) {
      return withAccountLock(`${def.id}:${userId}`, async () => {
        const { credentials: current, key: previousKey } = await readAccount(userId);
        const secret = input.secret ?? current?.secret;
        if (!secret) throw new AccountSecretRequiredError();
        const verified = await def.verify({ username: input.username ?? null, secret });
        const { username, accountId } =
          typeof verified === "string" ? { username: verified, accountId: undefined } : verified;
        const accountChanged =
          previousKey !== null && previousKey !== (accountId ?? username).toLowerCase();
        const secretChanged = current !== null && current.secret !== secret;
        const encryptedSecret = await encryptCredential(secret);
        await withCommitLock(provider, userId, async () => {
          if (accountChanged) {
            // The run is invalidated first, so a sync still in flight cannot write the old account back.
            await resetAchievementsRun(provider, userId);
            await storage.deleteAchievementProgress(userId, def.id);
          } else if (secretChanged) {
            // A request made with the old secret must not record its failure against the new one.
            await resetAchievementsRun(provider, userId);
          }
          await storage.setSystemConfig(
            def.credentialsKey(userId),
            JSON.stringify({
              username,
              apiKey: encryptedSecret,
              ...(accountId ? { accountId } : {}),
            })
          );
        });
      });
    },

    /** Forget the account: credentials, switch and stored progress. */
    clearAccount(userId) {
      return withAccountLock(`${def.id}:${userId}`, () =>
        withCommitLock(provider, userId, async () => {
          // Progress goes first: if its deletion fails the account stays saved and a retry finishes.
          await setAchievementsEnabledUnlocked(provider, userId, false);
          // Also invalidates a run that started while the sync was on.
          await resetAchievementsRun(provider, userId);
          await storage.deleteAchievementProgress(userId, def.id);
          await storage.setSystemConfig(def.credentialsKey(userId), "");
        })
      );
    },

    setEnabled: (userId, enabled) => setAchievementsEnabled(provider, userId, enabled),

    sync: (userId, options) =>
      syncAchievements(provider, userId, { ...options, requireEnabled: true }),

    runScheduled: () => runScheduledAchievementsSync(provider),
  };
}

export { AchievementsBusyError, AchievementsUnavailableError };
