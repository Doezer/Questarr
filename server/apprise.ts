import { execFile } from "child_process";
import { logger } from "./logger.js";
import { safeFetch } from "./ssrf.js";
import type { Notification } from "../shared/schema.js";

const appriseLogger = logger.child({ module: "apprise" });

const TYPE_MAP: Record<string, string> = {
  success: "success",
  error: "failure",
  warning: "warning",
  delayed: "warning",
  info: "info",
};

export const APPRISE_MODES = ["api", "cli"] as const;
export type AppriseMode = (typeof APPRISE_MODES)[number];

export interface AppriseSettings {
  mode: AppriseMode;
  apiUrl: string | null;
  key: string | null;
  urls: string | null;
}

type ExecFileResult = { stdout: string; stderr: string };
type ExecFileError = Error & {
  code?: string | number;
  killed?: boolean;
  signal?: NodeJS.Signals | null;
  stdout?: string;
  stderr?: string;
};

const APPRISE_CLI_TIMEOUT_MS = 15_000;

function trimToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function parseAppriseUrls(urls: string | null): string[] {
  if (!urls) return [];
  return urls
    .split(/\r?\n/)
    .map((url) => url.trim())
    .filter((url) => url.length > 0);
}

export function normalizeAppriseMode(value: string | null | undefined): AppriseMode {
  return value === "cli" ? "cli" : "api";
}

export function isAppriseConfigured(settings: AppriseSettings): boolean {
  if (settings.mode === "cli") {
    return parseAppriseUrls(settings.urls).length > 0;
  }

  return !!(
    settings.apiUrl &&
    (trimToNull(settings.key) || parseAppriseUrls(settings.urls).length > 0)
  );
}

export async function readAppriseSettings(storage: {
  getSystemConfig(key: string): Promise<string | undefined>;
}): Promise<AppriseSettings> {
  const [mode, apiUrl, key, urls] = await Promise.all([
    storage.getSystemConfig("apprise.mode"),
    storage.getSystemConfig("apprise.apiUrl"),
    storage.getSystemConfig("apprise.key"),
    storage.getSystemConfig("apprise.urls"),
  ]);

  return {
    mode: normalizeAppriseMode(mode),
    apiUrl: trimToNull(apiUrl),
    key: trimToNull(key),
    urls: trimToNull(urls),
  };
}

function formatCliError(error: unknown, stdout = "", stderr = ""): string {
  const execError = error as ExecFileError | undefined;
  if (execError?.code === "ENOENT") {
    return "Apprise CLI not found";
  }
  if (execError?.killed || execError?.signal) {
    return "Apprise CLI timed out";
  }

  const message =
    trimToNull(stderr) ??
    trimToNull(stdout) ??
    (error instanceof Error ? error.message : String(error));

  return message.length > 200 ? `${message.slice(0, 197)}...` : message;
}

function runAppriseCli(args: string[]): Promise<ExecFileResult> {
  return new Promise((resolve, reject) => {
    execFile(
      "apprise",
      args,
      {
        encoding: "utf8",
        timeout: APPRISE_CLI_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 64 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject({ error, stdout, stderr });
          return;
        }
        resolve({ stdout, stderr });
      }
    );
  });
}

class AppriseClient {
  private settings: AppriseSettings = {
    mode: "api",
    apiUrl: null,
    key: null,
    urls: null,
  };

  configure(settings: Partial<AppriseSettings>): void {
    this.settings = {
      mode: normalizeAppriseMode(settings.mode),
      apiUrl: trimToNull(settings.apiUrl),
      key: trimToNull(settings.key),
      urls: trimToNull(settings.urls),
    };
  }

  getMode(): AppriseMode {
    return this.settings.mode;
  }

  isConfigured(): boolean {
    return isAppriseConfigured(this.settings);
  }

  private buildApiRequest(
    title: string,
    message: string,
    type: string
  ): { endpoint: string; payload: Record<string, string> } | null {
    if (!this.settings.apiUrl) {
      return null;
    }

    if (this.settings.key) {
      return {
        endpoint: `${this.settings.apiUrl}/notify/${this.settings.key}`,
        payload: { title, body: message, type },
      };
    }

    if (this.settings.urls) {
      return {
        endpoint: `${this.settings.apiUrl}/notify/`,
        payload: { urls: this.settings.urls, title, body: message, type },
      };
    }

    return null;
  }

  private async sendViaApi(notification: Notification): Promise<void> {
    const type = TYPE_MAP[notification.type] ?? "info";
    const request = this.buildApiRequest(notification.title, notification.message, type);
    if (!request) {
      appriseLogger.warn("Apprise API is configured without a key or URLs");
      return;
    }

    try {
      const res = await safeFetch(request.endpoint, {
        method: "POST",
        allowPrivate: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request.payload),
      });

      if (!res.ok) {
        appriseLogger.warn(
          { status: res.status, title: notification.title },
          "Apprise notification delivery failed"
        );
      }
    } catch (error) {
      appriseLogger.warn({ error, title: notification.title }, "Apprise send error");
    }
  }

  private async sendViaCli(notification: Notification): Promise<void> {
    const urls = parseAppriseUrls(this.settings.urls);
    if (urls.length === 0) {
      appriseLogger.warn("Apprise CLI is configured without notification URLs");
      return;
    }

    try {
      await runAppriseCli(["-t", notification.title, "-b", notification.message, ...urls]);
    } catch (result) {
      const { error, stdout, stderr } = result as {
        error: unknown;
        stdout?: string;
        stderr?: string;
      };
      appriseLogger.warn(
        { error: formatCliError(error, stdout, stderr), title: notification.title },
        "Apprise CLI send error"
      );
    }
  }

  async send(notification: Notification): Promise<void> {
    if (!this.isConfigured()) return;

    if (this.settings.mode === "cli") {
      await this.sendViaCli(notification);
      return;
    }

    await this.sendViaApi(notification);
  }

  async test(): Promise<{ success: boolean; error?: string }> {
    if (!this.isConfigured()) {
      return { success: false, error: "Apprise is not configured" };
    }

    if (this.settings.mode === "cli") {
      const urls = parseAppriseUrls(this.settings.urls);
      if (urls.length === 0) {
        return { success: false, error: "No notification URLs provided" };
      }

      try {
        await runAppriseCli(["-t", "Questarr", "-b", "Test notification from Questarr", ...urls]);
        return { success: true };
      } catch (result) {
        const { error, stdout, stderr } = result as {
          error: unknown;
          stdout?: string;
          stderr?: string;
        };
        return { success: false, error: formatCliError(error, stdout, stderr) };
      }
    }

    const request = this.buildApiRequest("Questarr", "Test notification from Questarr", "info");
    if (!request) {
      return { success: false, error: "No config key or notification URLs provided" };
    }

    try {
      const res = await safeFetch(request.endpoint, {
        method: "POST",
        allowPrivate: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request.payload),
      });

      if (res.ok) return { success: true };
      const text = await res.text().catch(() => "");
      return {
        success: false,
        error: `Server responded with ${res.status}: ${text}`.slice(0, 200),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  }
}

export const appriseClient = new AppriseClient();
