import { z } from "zod";

/**
 * Environment configuration schema with Zod validation.
 * Validates and provides typed access to required environment variables.
 */
const envSchema = z.object({
  // Database configuration
  DATABASE_URL: z.string().optional(), // Kept for migration script compatibility
  SQLITE_DB_PATH: z.string().optional(),

  // CORS configuration
  ALLOWED_ORIGINS: z.string().optional(),

  // JWT configuration
  JWT_SECRET: z.string().default("questarr-default-secret-change-me"),

  // IGDB API configuration (optional, but required for game discovery features)
  IGDB_CLIENT_ID: z.string().optional(),
  IGDB_CLIENT_SECRET: z.string().optional(),

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
});

/**
 * Validate environment variables and fail cleanly with descriptive errors if required variables are missing.
 */
function validateEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errorMessages = result.error.errors.map((err) => {
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
  server: {
    port: env.PORT,
    host: env.HOST,
    nodeEnv: env.NODE_ENV,
    isDevelopment: env.NODE_ENV === "development",
    isProduction: env.NODE_ENV === "production",
    isTest: env.NODE_ENV === "test",
    allowedOrigins: env.ALLOWED_ORIGINS
      ? env.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim())
      : ["http://localhost:port".replace("port", env.PORT.toString())],
  },
} as const;

export type AppConfig = typeof config;
