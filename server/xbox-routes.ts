import { createAccountRoutes } from "./achievement-account-routes.js";
import { XboxAuthError, XboxRequestError } from "./xbox.js";
import { xboxAccount, xboxCredentialsSchema } from "./xbox-sync.js";

export const xboxRoutes = createAccountRoutes({
  basePath: "/api/xbox-achievements",
  label: "Xbox",
  account: xboxAccount,
  credentialsSchema: xboxCredentialsSchema,
  toSaveInput: (input) => ({ secret: input.apiKey }),
  invalidInputMessage: "Enter your OpenXBL API key (letters, digits, dashes and underscores).",
  secretRequiredMessage: "Enter your OpenXBL API key.",
  unavailableMessage: "Save your OpenXBL API key first.",
  isAuthError: (error) => error instanceof XboxAuthError,
  isRequestError: (error) => error instanceof XboxRequestError,
});
