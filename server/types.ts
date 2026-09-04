import { User } from "@shared/schema";

declare module "express-serve-static-core" {
  interface Request {
    user?: User;
    // Set when the request authenticated with an integration API key rather
    // than a JWT. Lets handlers tell machine clients apart from browser
    // sessions (for logging and for key-scoped behaviour).
    apiKeyId?: string;
  }
}
