import { z } from "zod";

/**
 * Environment configuration schema with Zod validation.
 * Validates and provides typed access to required environment variables.
 */
const envSchema = z.object({
  // Database configuration
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL must be set. Did you forget to provision a database?"),

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
  HOST: z.string().default("localhost"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
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

/**
 * Typed configuration object for the application.
 */
export const config = {
  database: {
    url: env.DATABASE_URL,
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
  },
} as const;

export type AppConfig = typeof config;
