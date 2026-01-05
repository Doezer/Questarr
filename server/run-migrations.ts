import { runMigrations } from "./migrate.js";
import { logger } from "./logger.js";

// Standalone migration runner script
(async () => {
  try {
    await runMigrations();
    logger.info("Migration script completed");
    process.exit(0);
  } catch (error) {
    logger.error({ error }, "Migration script failed");
    process.exit(1);
  }
})();
