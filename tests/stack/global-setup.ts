import { startServices } from "./services";

/** Starts the real download clients and the fake indexer; Playwright calls the teardown. */
export default async function globalSetup(): Promise<() => Promise<void>> {
  return startServices();
}
