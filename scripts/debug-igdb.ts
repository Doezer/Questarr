
import { igdbClient } from "../server/igdb.js";

async function run() {
    console.log("=== IGDB DEBUG START ===");

    try {
        // Test 1: Standard Search
        console.log("\n--- Test 1: Single Search 'The Land Beneath Us' ---");
        const singleResults = await igdbClient.searchGames("The Land Beneath Us");
        console.log(`Single Search Results: ${singleResults.length}`);
        if (singleResults.length > 0) {
            console.log(`First match: ${singleResults[0].name} (ID: ${singleResults[0].id})`);
        }

        // Test 2: Batch Search
        console.log("\n--- Test 2: Batch Search ['The Land Beneath Us'] ---");
        const batchResults = await igdbClient.batchSearchGames(["The Land Beneath Us"]);
        console.log(`Batch Results Size: ${batchResults.size}`);
        const match = batchResults.get("The Land Beneath Us");
        console.log(`Batch Match: ${match ? match.name : "NULL"}`);

    } catch (error) {
        console.error("DEBUG SCRIPT FAILED:", error);
    }

    console.log("=== IGDB DEBUG END ===");
}

run();
