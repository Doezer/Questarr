import type { ApiKeyScope, User } from "@shared/schema";

declare module "express-serve-static-core" {
  interface Request {
    user?: User;
    // Set when the request authenticated with an integration API key rather
    // than a JWT. Lets handlers tell machine clients apart from browser
    // sessions (for logging and for key-scoped behaviour).
    apiKeyId?: string;
    // Scope of the API key that authenticated this request (see API_KEY_SCOPES).
    apiKeyScope?: ApiKeyScope;
    apiKeyExpiresAt?: Date | null;
    // Set by authenticateToken/optionalAuthenticateToken to record which
    // mechanism authenticated this request, so csrfProtection (server/security.ts)
    // can require a CSRF check only for cookie-authenticated requests.
    authSource?: "cookie" | "bearer";
  }
}
