import { igdbClient } from "../server/igdb.js";
import { cleanReleaseName } from "../shared/title-utils.js";
import { logger } from "../server/logger.js";

const testCases = [
  "The_Land_Beneath_Us_Update_v1.9.0.4_NSW-VENOM",
  "Fashion_Police_Squad_Update_v1.0.3_NSW-VENOM",
  "Wingspan.v1.7.1147-TENOKE",
];

async function run() {
  logger.info("Starting IGDB Batch Test...");

  // 1. Prepare queries
  const queries = testCases.map((tc) => cleanReleaseName(tc));
  logger.info("Cleaned Queries: %s", queries);

  // 2. Run batch search
  try {
    const results = await igdbClient.batchSearchGames(queries);
    logger.info("\nResults (Size: %s):", results.size);

    for (const [query, match] of Array.from(results.entries())) {
      logger.info(
        "Query: %s => Match: %s",
        query,
        match ? `"${match.name}" (ID: ${match.id})` : "NULL"
      );
    }
  } catch (error) {
    logger.error("Batch search failed: %s", error);
  }
}

run();
