import { storage } from "../server/storage.js";
import { hashPassword } from "../server/auth.js";
import { logger } from "../server/logger.js";

const [username, newPassword] = process.argv.slice(2);

if (!username || !newPassword) {
  logger.error("Usage: npm run reset-password -- <username> <newPassword>");
  process.exit(1);
}

if (newPassword.length < 6) {
  logger.error("Password must be at least 6 characters");
  process.exit(1);
}

const user = await storage.getUserByUsername(username);

if (!user) {
  logger.error(`No user found with username "${username}"`);
  process.exit(1);
}

const passwordHash = await hashPassword(newPassword);
await storage.updateUserPassword(user.id, passwordHash);

logger.info(`Password reset for user "${username}"`);
process.exit(0);
