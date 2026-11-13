// Imported first by server/index.ts: a staged SQLite restore must be applied before
// server/db.ts opens the database file as a side effect of being imported.
import { applyPendingSqliteRestore } from "./restore-boot.js";

applyPendingSqliteRestore();
