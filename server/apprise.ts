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

class AppriseClient {
  private apiUrl: string | null = null;
  private key: string | null = null;
  private urls: string | null = null;

  configure(apiUrl: string | null, key: string | null, urls: string | null): void {
    this.apiUrl = apiUrl && apiUrl.trim().length > 0 ? apiUrl.trim() : null;
    this.key = key && key.trim().length > 0 ? key.trim() : null;
    this.urls = urls && urls.trim().length > 0 ? urls.trim() : null;
  }

  isConfigured(): boolean {
    return this.apiUrl !== null;
  }

  private buildRequest(
    title: string,
    message: string,
    type: string
  ): { endpoint: string; payload: Record<string, string> } | null {
    if (this.key) {
      return {
        endpoint: `${this.apiUrl}/notify/${this.key}`,
        payload: { title, body: message, type },
      };
    }
    if (this.urls) {
      return {
        endpoint: `${this.apiUrl}/notify/`,
        payload: { urls: this.urls, title, body: message, type },
      };
    }
    return null;
  }

  async send(notification: Notification): Promise<void> {
    if (!this.isConfigured()) return;

    const type = TYPE_MAP[notification.type] ?? "info";
    const request = this.buildRequest(notification.title, notification.message, type);
    if (!request) {
      appriseLogger.warn("Apprise is configured with an API URL but no key or URLs — skipping");
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

  async test(): Promise<{ success: boolean; error?: string }> {
    if (!this.isConfigured()) {
      return { success: false, error: "Apprise is not configured" };
    }

    const request = this.buildRequest("Questarr", "Test notification from Questarr", "info");
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
