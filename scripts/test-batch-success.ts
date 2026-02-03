
import { igdbClient } from "../server/igdb.js";
import { cleanReleaseName } from "../shared/title-utils.js";

const testCases = [
    "The_Land_Beneath_Us_Update_v1.9.0.4_NSW-VENOM",
    "Fashion_Police_Squad_Update_v1.0.3_NSW-VENOM",
    "Wingspan.v1.7.1147-TENOKE"
];

async function run() {
    console.log("Starting IGDB Batch Test...");

    // 1. Prepare queries
    const queries = testCases.map(tc => cleanReleaseName(tc));
    console.log("Cleaned Queries:", queries);

    // 2. Run batch search
    try {
        const results = await igdbClient.batchSearchGames(queries);
        console.log(`\nResults (Size: ${results.size}):`);

        for (const [query, match] of results.entries()) {
            console.log(`Query: "${query}" => Match: ${match ? `"${match.name}" (ID: ${match.id})` : "NULL"}`);
        }
    } catch (error) {
        console.error("Batch search failed:", error);
    }
}

run();
