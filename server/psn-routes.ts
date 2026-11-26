import { createAccountRoutes } from "./achievement-account-routes.js";
import { PsnAuthError, PsnRequestError } from "./psn.js";
import { psnAccount, psnCredentialsSchema } from "./psn-sync.js";

export const psnRoutes = createAccountRoutes({
  basePath: "/api/psn-achievements",
  label: "PlayStation",
  account: psnAccount,
  credentialsSchema: psnCredentialsSchema,
  toSaveInput: (input) => ({ secret: input.npsso }),
  invalidInputMessage: "Enter your PlayStation NPSSO token (letters and digits only).",
  secretRequiredMessage: "Enter your PlayStation NPSSO token.",
  unavailableMessage: "Save your PlayStation NPSSO token first.",
  isAuthError: (error) => error instanceof PsnAuthError,
  isRequestError: (error) => error instanceof PsnRequestError,
});
