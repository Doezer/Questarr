import { createInterface, type Interface } from "readline";
import { storage } from "../server/storage.js";
import { hashPassword } from "../server/auth.js";
import { logger } from "../server/logger.js";

const ENTER_CODES = new Set([10, 13]);
const CTRL_D_CODE = 4;
const CTRL_C_CODE = 3;
const BACKSPACE_CODES = new Set([8, 127]);

class ExitSignal extends Error {
  constructor(public readonly code: number) {
    super("exit");
  }
}

function fail(message: string): never {
  logger.error(message);
  throw new ExitSignal(1);
}

// Buffered line reader for non-interactive (piped/redirected) stdin. A chunk
// on the pipe can contain multiple lines that readline emits synchronously,
// before the `await` continuation for the next prompt attaches a listener —
// so lines are queued up front rather than read reactively per-prompt.
const lineQueue: string[] = [];
const lineWaiters: Array<{ resolve: (line: string) => void; reject: (err: Error) => void }> = [];
let nonTtyReader: Interface | null = null;
let nonTtyClosed = false;

function readNonTtyLine(): Promise<string> {
  if (!nonTtyReader) {
    nonTtyReader = createInterface({ input: process.stdin });
    nonTtyReader.on("line", (line) => {
      const waiter = lineWaiters.shift();
      if (waiter) {
        waiter.resolve(line);
      } else {
        lineQueue.push(line);
      }
    });
    nonTtyReader.on("close", () => {
      nonTtyClosed = true;
      while (lineWaiters.length > 0) {
        lineWaiters.shift()?.reject(new Error("stdin closed before input was provided"));
      }
    });
  }

  const queued = lineQueue.shift();
  if (queued !== undefined) {
    return Promise.resolve(queued);
  }
  if (nonTtyClosed) {
    return Promise.reject(new Error("stdin closed before input was provided"));
  }
  return new Promise((resolve, reject) => lineWaiters.push({ resolve, reject }));
}

function promptHiddenPassword(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    process.stdout.write(question);

    if (!process.stdin.isTTY) {
      // Non-interactive stdin (piped/redirected): fall back to a plain read,
      // since there's no TTY to suppress echo on.
      readNonTtyLine().then(resolve, reject);
      return;
    }

    const stdin = process.stdin;
    stdin.resume();
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");

    let password = "";
    const onData = (chunk: string) => {
      // A single chunk can contain more than one character (fast typing or a
      // paste), so every code point must be inspected in order rather than
      // just the first one.
      for (const char of chunk) {
        const code = char.codePointAt(0) ?? 0;

        if (ENTER_CODES.has(code) || code === CTRL_D_CODE) {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener("data", onData);
          process.stdout.write("\n");
          resolve(password);
          return;
        }

        if (code === CTRL_C_CODE) {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener("data", onData);
          process.stdout.write("\n");
          reject(new ExitSignal(1));
          return;
        }

        if (BACKSPACE_CODES.has(code)) {
          password = password.slice(0, -1);
          continue;
        }

        password += char;
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  const [username, ...extraArgs] = process.argv.slice(2);

  if (!username || extraArgs.length > 0) {
    fail("Usage: npm run reset-password -- <username>");
  }

  const user = await storage.getUserByUsername(username);

  if (!user) {
    fail(`No user found with username "${username}"`);
  }

  const newPassword = await promptHiddenPassword("New password: ");
  const confirmPassword = await promptHiddenPassword("Confirm password: ");

  if (newPassword !== confirmPassword) {
    fail("Passwords do not match");
  }

  if (newPassword.length < 6) {
    fail("Password must be at least 6 characters");
  }

  const passwordHash = await hashPassword(newPassword);
  const updated = await storage.updateUserPassword(user.id, passwordHash);

  if (!updated) {
    fail(`Failed to update password for user "${username}"`);
  }

  logger.info(`Password reset for user "${username}"`);
}

function closeNonTtyReader() {
  nonTtyReader?.close();
}

// process.exit() is avoided here so Pino's async transport (worker-thread based
// in non-test environments) has a chance to flush pending writes before the
// process ends; process.exitCode + letting the event loop drain naturally
// achieves the same result without losing log output.
try {
  await main();
} catch (error) {
  if (!(error instanceof ExitSignal)) {
    logger.error(
      `Failed to reset password: ${error instanceof Error ? error.message : "unknown error"}`
    );
  }
  process.exitCode = 1;
} finally {
  closeNonTtyReader();
}
