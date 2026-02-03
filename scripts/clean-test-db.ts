import fs from "fs";
import { logger } from "../server/logger.js";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, "..", "data", "test.db");

if (fs.existsSync(dbPath)) {
  logger.info("Cleaning test database: %s", dbPath);
  try {
    fs.unlinkSync(dbPath);
    logger.info("Test database removed.");
  } catch (err) {
    logger.error("Failed to remove test database: %s", err);
    process.exit(1);
  }
} else {
  logger.info("No test database found to clean.");
}
