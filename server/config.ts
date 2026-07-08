import { z } from "zod";
import { configLoader } from "./config-loader.js";

const LEGACY_DEFAULT_JWT_SECRET = "questarr-default-secret-change-me";

/**
 * Environment configuration schema with Zod validation.
 * Validates and provides typed access to required environment variables.
 */
const envSchema = z.object({
  // Database configuration
  SQLITE_DB_PATH: z.string().optional(),

  // CORS configuration
  ALLOWED_ORIGINS: z.string().optional(),

  // JWT configuration
  JWT_SECRET: z
    .string()
    .optional()
    .refine((value) => value !== LEGACY_DEFAULT_JWT_SECRET, {
      message:
        "JWT_SECRET is set to an insecure legacy default. Remove it to auto-generate, or set a strong random value.",
    }),

  // IGDB API configuration (optional, but required for game discovery features)
  IGDB_CLIENT_ID: z.string().optional(),
  IGDB_CLIENT_SECRET: z.string().optional(),

  // NexusMods API configuration (optional)
  NEXUSMODS_API_KEY: z.string().optional(),

  // Encryption key for indexer/downloader credentials at rest (optional;
  // auto-generated and persisted to the DB if unset). Must be a 64-char hex
  // string (32 bytes) when provided, for use as an AES-256 key.
  CREDENTIALS_ENCRYPTION_KEY: z
    .string()
    .optional()
    .refine((value) => !value || /^[0-9a-fA-F]{64}$/.test(value), {
      message:
        "CREDENTIALS_ENCRYPTION_KEY must be a 64-character hex string (32 bytes) for AES-256.",
    }),

  // Server configuration
  PORT: z
    .string()
    .default("5000")
    .refine((val) => !isNaN(parseInt(val, 10)) && parseInt(val, 10) > 0, {
      message: "PORT must be a valid positive integer",
    })
    .transform((val) => parseInt(val, 10)),
  HOST: z.string().default("0.0.0.0"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
  DISABLE_HSTS: z
    .string()
    .transform((val) => val === "true")
    .optional(),
  APP_URL: z.string().url().optional(),
});

/**
 * Validate environment variables and fail cleanly with descriptive errors if required variables are missing.
 */
function validateEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errorMessages = result.error.issues.map((err) => {
      const path = err.path.join(".");
      return `  - ${path}: ${err.message}`;
    });

    console.error("❌ Invalid environment configuration:");
    console.error(errorMessages.join("\n"));
    console.error("\nPlease check your environment variables and try again.");
    process.exit(1);
  }

  return result.data;
}

// Validate and export typed configuration
const env = validateEnv();

// Database path logic
const databaseUrl = env.SQLITE_DB_PATH || "sqlite.db";

/**
 * Typed configuration object for the application.
 */
export const config = {
  database: {
    url: databaseUrl,
  },
  auth: {
    jwtSecret: env.JWT_SECRET,
  },
  igdb: {
    clientId: env.IGDB_CLIENT_ID,
    clientSecret: env.IGDB_CLIENT_SECRET,
    isConfigured: !!(env.IGDB_CLIENT_ID && env.IGDB_CLIENT_SECRET),
  },
  nexusmods: {
    apiKey: env.NEXUSMODS_API_KEY,
  },
  credentials: {
    encryptionKey: env.CREDENTIALS_ENCRYPTION_KEY,
  },
  server: {
    port: env.PORT,
    host: env.HOST,
    nodeEnv: env.NODE_ENV,
    isDevelopment: env.NODE_ENV === "development",
    isProduction: env.NODE_ENV === "production",
    isTest: env.NODE_ENV === "test",
    appUrl: env.APP_URL,
    allowedOrigins: env.ALLOWED_ORIGINS
      ? env.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim())
      : ["http://localhost:port".replace("port", env.PORT.toString())],
  },
  ssl: configLoader.getSslConfig(),
} as const;

export type AppConfig = typeof config;
