/**
 * Support infrastructure configuration.
 *
 * WORKER_URL is the Cloudflare Worker endpoint for log collection.
 * It is intentionally hardcoded so end-users of a self-hosted instance
 * cannot redirect logs to a different server.
 *
 * After deploying the worker (`cd worker && wrangler deploy`), replace the
 * placeholder below with the URL printed by Wrangler, e.g.:
 *   https://questarr-log-collector.<your-subdomain>.workers.dev
 */
export const SUPPORT_WORKER_URL = "https://questarr-log-collector.questarr.workers.dev";

export const GITHUB_ISSUES_URL = "https://github.com/Doezer/Questarr/issues/new";
