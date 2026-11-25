import { createAccountRoutes } from "./achievement-account-routes.js";
import { RetroAchievementsAuthError, RetroAchievementsRequestError } from "./retroachievements.js";
import { credentialsSchema, getRetroAchievementsAccount } from "./retroachievements-sync.js";

export const retroAchievementsRoutes = createAccountRoutes({
  basePath: "/api/retroachievements",
  label: "RetroAchievements",
  account: getRetroAchievementsAccount(),
  credentialsSchema,
  toSaveInput: (input) => ({ username: input.username, secret: input.apiKey }),
  invalidInputMessage:
    "Enter your RetroAchievements username and a Web API key (letters and digits only).",
  secretRequiredMessage: "Enter your RetroAchievements Web API key.",
  unavailableMessage: "Save your RetroAchievements username and Web API key first.",
  isAuthError: (error) => error instanceof RetroAchievementsAuthError,
  isRequestError: (error) => error instanceof RetroAchievementsRequestError,
});
