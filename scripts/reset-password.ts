import { createInterface } from "readline";
import { storage } from "../server/storage.js";
import { hashPassword } from "../server/auth.js";
import { logger } from "../server/logger.js";

const ENTER_CODES = new Set([10, 13]);
const CTRL_D_CODE = 4;
const CTRL_C_CODE = 3;
const BACKSPACE_CODES = new Set([8, 127]);

// Buffered line reader for non-interactive (piped/redirected) stdin. A chunk
// on the pipe can contain multiple lines that readline emits synchronously,
// before the `await` continuation for the next prompt attaches a listener —
// so lines are queued up front rather than read reactively per-prompt.
const lineQueue: string[] = [];
const lineWaiters: Array<(line: string) => void> = [];
let nonTtyReader: ReturnType<typeof createInterface> | null = null;

function readNonTtyLine(): Promise<string> {
  nonTtyReader ??= createInterface({ input: process.stdin }).on("line", (line) => {
    const waiter = lineWaiters.shift();
    if (waiter) {
      waiter(line);
    } else {
      lineQueue.push(line);
    }
  });

  const queued = lineQueue.shift();
  if (queued !== undefined) {
    return Promise.resolve(queued);
  }
  return new Promise((resolve) => lineWaiters.push(resolve));
}

function promptHiddenPassword(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);

    if (!process.stdin.isTTY) {
      // Non-interactive stdin (piped/redirected): fall back to a plain read,
      // since there's no TTY to suppress echo on.
      readNonTtyLine().then(resolve);
      return;
    }

    const stdin = process.stdin;
    stdin.resume();
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");

    let password = "";
    const onData = (char: string) => {
      const code = char.charCodeAt(0);

      if (ENTER_CODES.has(code) || code === CTRL_D_CODE) {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener("data", onData);
        process.stdout.write("\n");
        resolve(password);
        return;
      }

      if (code === CTRL_C_CODE) {
        process.stdout.write("\n");
        process.exit(1);
      }

      if (BACKSPACE_CODES.has(code)) {
        password = password.slice(0, -1);
        return;
      }

      password += char;
    };
    stdin.on("data", onData);
  });
}

const [username, ...extraArgs] = process.argv.slice(2);

if (!username || extraArgs.length > 0) {
  logger.error("Usage: npm run reset-password -- <username>");
  process.exit(1);
}

const user = await storage.getUserByUsername(username);

if (!user) {
  logger.error(`No user found with username "${username}"`);
  process.exit(1);
}

const newPassword = await promptHiddenPassword("New password: ");
const confirmPassword = await promptHiddenPassword("Confirm password: ");

if (newPassword !== confirmPassword) {
  logger.error("Passwords do not match");
  process.exit(1);
}

if (newPassword.length < 6) {
  logger.error("Password must be at least 6 characters");
  process.exit(1);
}

try {
  const passwordHash = await hashPassword(newPassword);
  const updated = await storage.updateUserPassword(user.id, passwordHash);

  if (!updated) {
    logger.error(`Failed to update password for user "${username}"`);
    process.exit(1);
  }

  logger.info(`Password reset for user "${username}"`);
  process.exit(0);
} catch (error) {
  logger.error(
    `Failed to reset password: ${error instanceof Error ? error.message : "unknown error"}`
  );
  process.exit(1);
}
