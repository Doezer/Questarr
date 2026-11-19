import { randomUUID } from "node:crypto";
import { safeFetch } from "../ssrf.js";
import { DOWNLOAD_CLIENT_USER_AGENT } from "./utils.js";

export const REAL_DEBRID_API_BASE = "https://api.real-debrid.com/rest/1.0";
const REAL_DEBRID_OAUTH_BASE = "https://api.real-debrid.com/oauth/v2";
/** Public client id Real-Debrid documents for open-source applications. */
export const REAL_DEBRID_OPEN_SOURCE_CLIENT_ID = "X245A4XAIBGVM";
// Fixed grant-type identifier defined by Real-Debrid (an opaque name, not a network request).
const DEVICE_GRANT_TYPE = "http://oauth.net/grant_type/device/1.0"; // NOSONAR

export interface RealDebridCredentials {
  accessToken: string;
  refreshToken?: string | undefined;
  clientId?: string | undefined;
  clientSecret?: string | undefined;
  /** Epoch ms at which the access token expires. */
  expiresAt?: number | undefined;
}

/**
 * Reads the credential stored in the downloader's password field: either the JSON written by
 * the OAuth device flow, or a bare private API token pasted by the user.
 */
export function parseRealDebridCredentials(
  raw: string | null | undefined
): RealDebridCredentials | null {
  const value = raw?.trim();
  if (!value) return null;
  if (!value.startsWith("{")) return { accessToken: value };
  try {
    const parsed = JSON.parse(value) as Partial<RealDebridCredentials>;
    if (typeof parsed.accessToken !== "string" || !parsed.accessToken) return null;
    return {
      accessToken: parsed.accessToken,
      refreshToken: typeof parsed.refreshToken === "string" ? parsed.refreshToken : undefined,
      clientId: typeof parsed.clientId === "string" ? parsed.clientId : undefined,
      clientSecret: typeof parsed.clientSecret === "string" ? parsed.clientSecret : undefined,
      expiresAt: typeof parsed.expiresAt === "number" ? parsed.expiresAt : undefined,
    };
  } catch {
    return null;
  }
}

export function serializeRealDebridCredentials(credentials: RealDebridCredentials): string {
  return JSON.stringify(credentials);
}

async function oauthRequest<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await safeFetch(url, {
    ...init,
    headers: { "User-Agent": DOWNLOAD_CLIENT_USER_AGENT, ...init.headers },
    requireHttps: true,
    timeoutMs: 20_000,
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new RealDebridOAuthError(response.status, body.slice(0, 200));
  }
  return (await response.json()) as T;
}

export class RealDebridOAuthError extends Error {
  constructor(
    readonly status: number,
    detail: string
  ) {
    super(`Real-Debrid OAuth request failed (HTTP ${status})${detail ? `: ${detail}` : ""}`);
    this.name = "RealDebridOAuthError";
  }
}

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  interval: number;
  expires_in: number;
  verification_url: string;
  direct_verification_url?: string;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  token_type: string;
}

/** Refreshes an access token, returning the full replacement credentials. */
export async function refreshRealDebridToken(
  credentials: RealDebridCredentials
): Promise<RealDebridCredentials> {
  if (!credentials.refreshToken || !credentials.clientId || !credentials.clientSecret) {
    throw new Error("Real-Debrid token expired and cannot be refreshed. Reconnect the account.");
  }
  const token = await oauthRequest<TokenResponse>(`${REAL_DEBRID_OAUTH_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      code: credentials.refreshToken,
      grant_type: DEVICE_GRANT_TYPE,
    }).toString(),
  });
  return {
    ...credentials,
    accessToken: token.access_token,
    refreshToken: token.refresh_token || credentials.refreshToken,
    expiresAt: Date.now() + token.expires_in * 1000,
  };
}

// ---------------------------------------------------------------------------
// Device flow. The device code never leaves the server: the browser only sees an opaque flow
// id, the user code to type in, and the verification URL.
// ---------------------------------------------------------------------------

interface DeviceFlow {
  downloaderId: string;
  deviceCode: string;
  expiresAt: number;
}

const pendingFlows = new Map<string, DeviceFlow>();

function pruneFlows(now = Date.now()): void {
  for (const [id, flow] of pendingFlows) {
    if (flow.expiresAt <= now) pendingFlows.delete(id);
  }
}

export interface DeviceFlowStart {
  flowId: string;
  userCode: string;
  verificationUrl: string;
  directVerificationUrl?: string | undefined;
  /** Seconds between polls. */
  interval: number;
  /** Seconds until the user code expires. */
  expiresIn: number;
}

export async function startRealDebridDeviceFlow(downloaderId: string): Promise<DeviceFlowStart> {
  pruneFlows();
  const params = new URLSearchParams({
    client_id: REAL_DEBRID_OPEN_SOURCE_CLIENT_ID,
    new_credentials: "yes",
  });
  const code = await oauthRequest<DeviceCodeResponse>(
    `${REAL_DEBRID_OAUTH_BASE}/device/code?${params.toString()}`
  );
  const flowId = randomUUID();
  pendingFlows.set(flowId, {
    downloaderId,
    deviceCode: code.device_code,
    expiresAt: Date.now() + code.expires_in * 1000,
  });
  return {
    flowId,
    userCode: code.user_code,
    verificationUrl: code.verification_url,
    directVerificationUrl: code.direct_verification_url,
    interval: code.interval,
    expiresIn: code.expires_in,
  };
}

export type DeviceFlowPoll =
  | { status: "pending" }
  | { status: "expired" }
  | { status: "authorized"; credentials: RealDebridCredentials };

/** Polls once. Real-Debrid answers 403 on the credentials endpoint until the user approves. */
export async function pollRealDebridDeviceFlow(
  flowId: string,
  downloaderId: string
): Promise<DeviceFlowPoll> {
  const flow = pendingFlows.get(flowId);
  if (!flow || flow.downloaderId !== downloaderId || flow.expiresAt <= Date.now()) {
    pendingFlows.delete(flowId);
    return { status: "expired" };
  }

  let clientCredentials: { client_id: string; client_secret: string };
  try {
    const params = new URLSearchParams({
      client_id: REAL_DEBRID_OPEN_SOURCE_CLIENT_ID,
      code: flow.deviceCode,
    });
    clientCredentials = await oauthRequest(
      `${REAL_DEBRID_OAUTH_BASE}/device/credentials?${params.toString()}`
    );
  } catch (error) {
    if (error instanceof RealDebridOAuthError && [400, 403].includes(error.status)) {
      return { status: "pending" };
    }
    throw error;
  }

  const token = await oauthRequest<TokenResponse>(`${REAL_DEBRID_OAUTH_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientCredentials.client_id,
      client_secret: clientCredentials.client_secret,
      code: flow.deviceCode,
      grant_type: DEVICE_GRANT_TYPE,
    }).toString(),
  });
  pendingFlows.delete(flowId);
  return {
    status: "authorized",
    credentials: {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      clientId: clientCredentials.client_id,
      clientSecret: clientCredentials.client_secret,
      expiresAt: Date.now() + token.expires_in * 1000,
    },
  };
}
