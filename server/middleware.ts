import rateLimit from "express-rate-limit";
import { body, param, query, validationResult } from "express-validator";
import type { Request, Response, NextFunction } from "express";
import { TORRENT_DOWNLOADER_TYPES, USENET_DOWNLOADER_TYPES } from "../shared/downloader-types.js";
import { storage } from "./storage.js";
import { expressLogger } from "./logger.js";
import { reportServerError } from "./error-telemetry.js";

const DOWNLOADER_TYPES = [...TORRENT_DOWNLOADER_TYPES, ...USENET_DOWNLOADER_TYPES];

// Dynamic rate limiter for IGDB API endpoints to prevent blacklisting
// IGDB has a limit of 4 requests per second, we default to 3 to be conservative
// The rate limit can be configured per user in settings
export const igdbRateLimiter = rateLimit({
  windowMs: 1000, // 1 second
  max: async (req: Request) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return 20; // Default for unauthenticated requests
      }

      const settings = await storage.getUserSettings(userId);
      return settings?.igdbRateLimitPerSecond ?? 20;
    } catch (error) {
      console.error("Error fetching user rate limit:", error);
      return 20; // Fallback to default on error
    }
  },
  message: "Too many IGDB requests, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
});

// Rate limiter for sensitive endpoints (write operations)
export const sensitiveEndpointLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // limit each IP to 30 requests per minute
  message: "Too many requests, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter for authentication/login endpoints
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // limit each IP to 20 requests per 15 minutes
  message: "Too many authentication attempts, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
});

// General API rate limiter (lenient, just to prevent abuse)
export const generalApiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // limit each IP to 100 requests per minute
  message: "Too many requests, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
});

// Validation middleware to check for validation errors
export const validateRequest = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const details = errors.array();
    expressLogger.warn(
      { path: req.path, method: req.method, validationErrors: details },
      "Validation failed"
    );
    return res.status(400).json({
      error: "Validation failed",
      details,
    });
  }
  next();
};

// Sanitization rules for game search queries
export const sanitizeSearchQuery = [
  query("q")
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage("Search query must be between 1 and 200 characters"),
  query("search")
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage("Search query must be at most 200 characters"),
  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("Limit must be between 1 and 100")
    .toInt(),
  query("includeUndated")
    .optional()
    .isBoolean()
    .withMessage("includeUndated must be a boolean")
    .toBoolean(),
  query("platform")
    .optional()
    .isInt({ min: 1 })
    .withMessage("Platform must be a valid IGDB platform ID")
    .toInt(),
  query("year")
    .optional()
    .isInt({ min: 1950, max: 2100 })
    .withMessage("Year must be between 1950 and 2100")
    .toInt(),
];

// Sanitization rules for game ID parameters
export const sanitizeGameId = [
  param("id")
    .trim()
    .matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    .withMessage("Invalid game ID format"),
];

// Sanitization rules for download record ID parameters
export const sanitizeDownloadId = [
  param("downloadId")
    .trim()
    .matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    .withMessage("Invalid download ID format"),
];

// Sanitization rules for IGDB ID parameters
export const sanitizeIgdbId = [
  param("id").trim().isInt({ min: 1 }).withMessage("Invalid IGDB ID").toInt(),
];

// Sanitization rules for game status updates
export const sanitizeGameStatus = [
  body("status")
    .trim()
    .isIn(["wanted", "owned", "shelved", "completed", "downloading"])
    .withMessage("Invalid status value"),
];

// Sanitization rules for adding games
export const sanitizeGameData = [
  body("title")
    .trim()
    .isLength({ min: 1, max: 500 })
    .withMessage("Title must be between 1 and 500 characters"),
  body("igdbId")
    .optional({ nullable: true })
    .isInt({ min: 1 })
    .withMessage("Invalid IGDB ID")
    .toInt(),
  body("summary")
    .optional()
    .trim()
    .isLength({ max: 5000 })
    .withMessage("Summary must be at most 5000 characters"),
  body("coverUrl").optional({ checkFalsy: true }).trim().isURL().withMessage("Invalid cover URL"),
  body("releaseDate")
    .optional({ nullable: true, checkFalsy: true })
    .trim()
    .matches(/^\d{4}-\d{2}-\d{2}$/)
    .withMessage("Invalid date format, use YYYY-MM-DD"),
  body("rating")
    .optional({ nullable: true })
    .isFloat({ min: 0, max: 10 })
    .withMessage("Rating must be between 0 and 10")
    .toFloat(),
  body("platforms").optional().isArray().withMessage("Platforms must be an array"),
  body("platforms.*")
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage("Platform name must be at most 100 characters"),
  body("genres").optional().isArray().withMessage("Genres must be an array"),
  body("genres.*")
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage("Genre name must be at most 100 characters"),
  body("publishers").optional().isArray().withMessage("Publishers must be an array"),
  body("publishers.*")
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage("Publisher name must be at most 200 characters"),
  body("developers").optional().isArray().withMessage("Developers must be an array"),
  body("developers.*")
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage("Developer name must be at most 200 characters"),
];

// Sanitization rules for indexer data
export const sanitizeIndexerData = [
  body("name")
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage("Name must be between 1 and 200 characters"),
  body("url")
    .trim()
    .custom((value) => {
      if (!value) return false;
      // Allow standard URLs and localhost/internal URLs
      try {
        const url = new URL(value);
        return ["http:", "https:"].includes(url.protocol);
      } catch {
        return false;
      }
    })
    .withMessage("Invalid URL"),
  body("apiKey")
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage("API key must be at most 500 characters"),
  body("protocol")
    .optional()
    .trim()
    .isIn(["torznab", "newznab", "g4u"])
    .withMessage("Invalid protocol"),
  body("enabled").optional().isBoolean().withMessage("Enabled must be a boolean").toBoolean(),
];

// Sanitization rules for partial indexer updates (PATCH)
export const sanitizeIndexerUpdateData = [
  body("name")
    .optional()
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage("Name must be between 1 and 200 characters"),
  body("url")
    .optional()
    .trim()
    .custom((value) => {
      if (!value) return true;
      // Allow standard URLs and localhost/internal URLs
      try {
        const url = new URL(value);
        return ["http:", "https:"].includes(url.protocol);
      } catch {
        return false;
      }
    })
    .withMessage("Invalid URL"),
  body("apiKey")
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage("API key must be at most 500 characters"),
  body("protocol")
    .optional()
    .trim()
    .isIn(["torznab", "newznab", "g4u"])
    .withMessage("Invalid protocol"),
  body("enabled").optional().isBoolean().withMessage("Enabled must be a boolean").toBoolean(),
  body("priority")
    .optional()
    .isInt({ min: 1 })
    .withMessage("Priority must be a positive integer")
    .toInt(),
  body("categories").optional().isArray().withMessage("Categories must be an array"),
  body("rssEnabled")
    .optional()
    .isBoolean()
    .withMessage("RSS enabled must be a boolean")
    .toBoolean(),
  body("autoSearchEnabled")
    .optional()
    .isBoolean()
    .withMessage("Auto search enabled must be a boolean")
    .toBoolean(),
];

// Sanitization rules for downloader data
// Accepts hostname, IP address, or FQDN -- shared by every downloader URL
// validator below so the pattern (and any future fix to it) lives in one
// place instead of being copy-pasted per route.
const DOWNLOADER_HOSTNAME_REGEX =
  /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
const DOWNLOADER_IP_REGEX = /^(\d{1,3}\.){3}\d{1,3}$/;

/**
 * A downloader's `url` field accepts either a full http(s) URL, or (for a
 * recognized downloader type) a bare hostname/IP/FQDN. Shared by
 * sanitizeDownloaderData, sanitizeDownloaderTestData, and
 * sanitizeDownloaderUpdateData.
 */
function isValidDownloaderUrl(value: string, type: unknown): boolean {
  if (/^https?:\/\/.+/.test(value)) return true;
  if (typeof type === "string" && (DOWNLOADER_TYPES as readonly string[]).includes(type)) {
    return DOWNLOADER_HOSTNAME_REGEX.test(value) || DOWNLOADER_IP_REGEX.test(value);
  }
  return false;
}

// The three downloader body validators below (create, test-connection, update)
// share most of their field rules -- these factories keep each rule defined
// once instead of copy-pasted per validator array.
function optionalTrimmedString(field: string, max: number, label: string) {
  return body(field)
    .optional()
    .trim()
    .isLength({ max })
    .withMessage(`${label} must be at most ${max} characters`);
}

function optionalDownloadPath(field = "downloadPath") {
  return optionalTrimmedString(field, 500, "Download path")
    .custom((value) => !value.includes(".."))
    .withMessage("Download path cannot contain '..'");
}

function optionalBoolean(field: string, label: string) {
  return body(field)
    .optional()
    .isBoolean({ strict: true })
    .withMessage(`${label} must be a boolean`)
    .toBoolean();
}

const downloaderUsername = () => optionalTrimmedString("username", 200, "Username");
const downloaderPassword = () => optionalTrimmedString("password", 200, "Password");
const downloaderCategory = () => optionalTrimmedString("category", 100, "Category");
const downloaderLabel = () => optionalTrimmedString("label", 100, "Label");
const downloaderUrlPath = () => optionalTrimmedString("urlPath", 200, "URL path");
const downloaderAllowSelfSignedCertificate = () =>
  optionalBoolean("allowSelfSignedCertificate", "Allow self-signed certificate");

export const sanitizeDownloaderData = [
  body("name")
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage("Name must be between 1 and 200 characters"),
  body("type").trim().isIn(DOWNLOADER_TYPES).withMessage("Invalid downloader type"),
  body("url")
    .trim()
    .custom((value, { req }) => isValidDownloaderUrl(value, req.body.type))
    .withMessage("Invalid URL or hostname"),
  downloaderUsername(),
  downloaderPassword(),
  body("enabled").optional().isBoolean().withMessage("Enabled must be a boolean").toBoolean(),
  optionalDownloadPath(),
  downloaderLabel(),
  downloaderUrlPath(),
  downloaderAllowSelfSignedCertificate(),
];

// Sanitization rules for POST /api/downloaders/test -- validates the full
// request body before it's used to build a temporary Downloader and test a
// live connection, rather than only checking allowSelfSignedCertificate's
// type. Distinct from sanitizeDownloaderData because this route never takes
// a `name` (the server synthesizes one) and has its own body shape.
export const sanitizeDownloaderTestData = [
  body("type").trim().isIn(DOWNLOADER_TYPES).withMessage("Invalid downloader type"),
  body("url")
    .trim()
    .custom((value, { req }) => isValidDownloaderUrl(value, req.body.type))
    .withMessage("Invalid URL or hostname"),
  body("port").optional().isInt({ min: 1, max: 65535 }).withMessage("Invalid port").toInt(),
  optionalBoolean("useSsl", "useSsl"),
  downloaderUrlPath(),
  downloaderUsername(),
  downloaderPassword(),
  optionalDownloadPath(),
  downloaderCategory(),
  downloaderLabel(),
  optionalBoolean("addStopped", "addStopped"),
  optionalBoolean("removeCompleted", "removeCompleted"),
  optionalTrimmedString("postImportCategory", 100, "Post-import category"),
  downloaderAllowSelfSignedCertificate(),
];

// Sanitization rules for partial downloader updates (PATCH)
export const sanitizeDownloaderUpdateData = [
  body("name")
    .optional()
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage("Name must be between 1 and 200 characters"),
  body("type").optional().trim().isIn(DOWNLOADER_TYPES).withMessage("Invalid downloader type"),
  body("url")
    .optional()
    .trim()
    .custom((value, { req }) => {
      if (!value) return true; // Optional field
      return isValidDownloaderUrl(value, req.body.type);
    })
    .withMessage("Invalid URL or hostname"),
  downloaderUsername(),
  downloaderPassword(),
  body("enabled").optional().isBoolean().withMessage("Enabled must be a boolean").toBoolean(),
  body("priority")
    .optional()
    .isInt({ min: 1 })
    .withMessage("Priority must be a positive integer")
    .toInt(),
  optionalDownloadPath(),
  downloaderCategory(),
  downloaderLabel(),
  downloaderUrlPath(),
  downloaderAllowSelfSignedCertificate(),
];

// Sanitization rules for download add requests
export const sanitizeDownloaderDownloadData = [
  body("url")
    .trim()
    .custom((value) => {
      // Allow standard URLs and localhost/internal URLs
      try {
        const url = new URL(value);
        return ["http:", "https:", "magnet:"].includes(url.protocol);
      } catch {
        return false;
      }
    })
    .withMessage("Invalid download URL"),
  body("title")
    .trim()
    .isLength({ min: 1, max: 500 })
    .withMessage("Title must be between 1 and 500 characters"),
  body("category")
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage("Category must be at most 100 characters"),
  body("downloadType")
    .optional()
    .trim()
    .isIn(["torrent", "usenet"])
    .withMessage("Invalid download type"),
  body("downloadPath")
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage("Download path must be at most 500 characters")
    // 🛡️ Sentinel: Add path traversal validation.
    // Disallow '..' in download paths to prevent writing files outside the intended directory.
    .custom((value) => !value.includes(".."))
    .withMessage("Download path cannot contain '..'"),
  body("priority")
    .optional()
    .isInt({ min: 0, max: 10 })
    .withMessage("Priority must be between 0 and 10")
    .toInt(),
  body("gameId")
    .optional()
    .trim()
    .matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    .withMessage("Invalid game ID format"),
  body("password")
    .optional()
    .isLength({ max: 200 })
    .withMessage("Password must be at most 200 characters"),
];

// Sanitization rules for indexer search queries
export const sanitizeIndexerSearchQuery = [
  query("query")
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage("Search query must be between 1 and 200 characters"),
  query("category")
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage("Category must be at most 500 characters"),
  query("cat")
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage("Category alias (cat) must be at most 500 characters"),
  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("Limit must be between 1 and 100")
    .toInt(),
  query("offset")
    .optional()
    .isInt({ min: 0, max: Number.MAX_SAFE_INTEGER })
    .withMessage("Offset must be a non-negative integer within safe bounds")
    .toInt(),
];

// Sanitization rules for the game-status route param
export const sanitizeGameStatusParam = [
  param("status")
    .trim()
    .isIn(["wanted", "owned", "shelved", "completed", "downloading"])
    .withMessage("Invalid status value"),
];

// Sanitization rules for the Quick Add (match-and-add) title
export const sanitizeMatchAndAddTitle = [
  body("title")
    .trim()
    .isLength({ min: 1, max: 500 })
    .withMessage("Title must be between 1 and 500 characters"),
];

// Sanitization rules for NexusMods game-domain lookup
export const sanitizeNexusModsGameDomainQuery = [
  query("title")
    .trim()
    .isLength({ min: 1, max: 500 })
    .withMessage("title must be between 1 and 500 characters"),
];

// Sanitization rules for NexusMods trending-mods lookup
export const sanitizeNexusModsTrendingModsQuery = [
  query("domain")
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage("domain must be between 1 and 200 characters"),
  query("limit")
    .optional()
    .isInt({ min: 1, max: 20 })
    .withMessage("limit must be between 1 and 20")
    .toInt(),
];

// 🛡️ Sentinel: Global error handler middleware
// Standardizes error responses and prevents leakage of sensitive details in production
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  const status = err.status || err.statusCode || 500;

  // Log the error using our logger instead of relying on default express handler logging
  // Use error level for 5xx, warn/info for client errors
  if (status >= 500) {
    expressLogger.error({ err, path: req.path, method: req.method }, "Request error");
    // Fire-and-forget: detect + report unhandled server errors for the automatic
    // error-telemetry pipeline. Never let this delay or fail the response.
    void reportServerError(err, {
      source: "expressErrorHandler",
      path: req.path,
      method: req.method,
    });
  } else {
    expressLogger.warn({ err, path: req.path, method: req.method }, "Request error");
  }

  // Determine the error message to show to the client
  // Sanitize error messages in production to prevent information leakage
  let message = err.message || "Internal Server Error";
  if (req.app.get("env") === "production" && status >= 500) {
    message = "Internal Server Error";
  }

  // Include details if available (e.g., validation errors)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response: { error: string; details?: any } = { error: message };
  if (err.details) {
    response.details = err.details;
  }

  // If headers already sent, we can't send a JSON response
  if (res.headersSent) {
    return next(err);
  }

  res.status(status).json(response);
};
