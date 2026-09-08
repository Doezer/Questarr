import { User } from "@shared/schema";

declare module "express-serve-static-core" {
  interface Request {
    user?: User;
    // Set by authenticateToken/optionalAuthenticateToken to record which
    // mechanism authenticated this request, so csrfProtection (server/security.ts)
    // can require a CSRF check only for cookie-authenticated requests.
    authSource?: "cookie" | "bearer";
  }
}
