
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Indexer } from "../../shared/schema";
import { newznabClient } from "../newznab.js";

// Mock dependencies
vi.mock("../logger.js", () => ({
    routesLogger: {
        info: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
    },
}));

vi.mock("../ssrf.js", () => ({
    isSafeUrl: vi.fn().mockResolvedValue(true),
}));

describe("NewznabClient", () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();
        fetchMock = vi.fn();
        global.fetch = fetchMock;
    });

    const mockIndexer: Indexer = {
        id: "idx-1",
        name: "Test Indexer",
        url: "https://indexer.example.com",
        apiKey: "apikey123",
        protocol: "newznab",
        enabled: true,
        priority: 1,
        categories: [],
        rssEnabled: true,
        autoSearchEnabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const mockXmlSearchResponse = `
    <?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0" xmlns:newznab="http://www.newznab.com/DTD/2010/feeds/attributes/">
        <channel>
            <title>Indexer Search</title>
            <item>
                <title>Test Release 1</title>
                <link>https://indexer.example.com/get/123.nzb</link>
                <pubDate>Sun, 01 Feb 2026 12:00:00 +0000</pubDate>
                <category>PC > Games</category>
                <newznab:attr name="size" value="1073741824" />
                <newznab:attr name="grabs" value="50" />
            </item>
            <item>
                <title>Test Release 2</title>
                <enclosure url="https://indexer.example.com/get/456.nzb" length="2048" type="application/x-nzb" />
                <pubDate>Sat, 31 Jan 2026 12:00:00 +0000</pubDate>
                <newznab:attr name="size" value="2048" />
            </item>
        </channel>
    </rss>
    `;

    describe("search", () => {
        it("should parse search results correctly", async () => {
            fetchMock.mockResolvedValueOnce({
                ok: true,
                text: async () => mockXmlSearchResponse,
            });

            const results = await newznabClient.search(mockIndexer, { query: "test" });

            expect(results).toHaveLength(2);
            expect(results[0].title).toBe("Test Release 1");
            expect(results[0].size).toBe(1073741824);
            expect(results[0].indexerName).toBe("Test Indexer");

            // Verify URL params
            const callUrl = new URL(fetchMock.mock.calls[0][0] as string);
            expect(callUrl.searchParams.get("apikey")).toBe("apikey123");
            expect(callUrl.searchParams.get("t")).toBe("search");
            expect(callUrl.searchParams.get("q")).toBe("test");
        });

        it("should handle error responses", async () => {
            fetchMock.mockResolvedValueOnce({
                ok: false,
                status: 500,
                statusText: "Server Error",
            });

            await expect(newznabClient.search(mockIndexer, { query: "fail" }))
                .rejects.toThrow("Newznab search failed");
        });
    });

    describe("searchMultipleIndexers", () => {
        it("should aggregate results from multiple indexers", async () => {
            // Mock responses for two indexers
            fetchMock
                .mockResolvedValueOnce({
                    ok: true,
                    text: async () => mockXmlSearchResponse.replace("Test Release 1", "Indexer 1 Release"),
                })
                .mockResolvedValueOnce({
                    ok: true,
                    text: async () => mockXmlSearchResponse.replace("Test Release 1", "Indexer 2 Release"),
                });

            const indexers = [
                { ...mockIndexer, name: "Indexer 1" },
                { ...mockIndexer, name: "Indexer 2" },
            ];

            const { results, errors } = await newznabClient.searchMultipleIndexers(indexers, { query: "multi" });

            expect(errors).toHaveLength(0);
            expect(results.items.length).toBeGreaterThan(0);
            expect(results.total).toBe(4); // 2 items per indexer * 2 indexers
        });

        it("should handle partial failures", async () => {
            // First succeeds, second fails
            fetchMock
                .mockResolvedValueOnce({
                    ok: true,
                    text: async () => mockXmlSearchResponse,
                })
                .mockResolvedValueOnce({
                    ok: false,
                    status: 500,
                });

            const indexers = [
                { ...mockIndexer, name: "Indexer 1" },
                { ...mockIndexer, name: "Indexer 2" },
            ];

            const { results, errors } = await newznabClient.searchMultipleIndexers(indexers, { query: "partial" });

            expect(errors).toHaveLength(1);
            expect(errors[0].indexer).toBe("Indexer 2");
            expect(results.items).toHaveLength(2); // Only results from first indexer
        });
    });

    describe("getCategories", () => {
        const mockCapsXml = `
        <caps>
            <categories>
                <category id="1000" name="Console">
                     <subcat id="1010" name="NDS"/>
                </category>
                <category id="4000" name="PC"/>
            </categories>
        </caps>
        `;

        it("should parse capabilities xml", async () => {
            fetchMock.mockResolvedValueOnce({
                ok: true,
                text: async () => mockCapsXml,
            });

            const categories = await newznabClient.getCategories(mockIndexer);
            expect(categories).toHaveLength(3); // Console, Console > NDS, PC
            const names = categories.map(c => c.name);
            expect(names).toContain("Console");
            expect(names).toContain("Console > NDS");
        });
    });

    describe("testConnection", () => {
        it("should return success on valid caps response", async () => {
            fetchMock.mockResolvedValueOnce({
                ok: true,
                text: async () => "<caps><server version='1.0'/></caps>",
            });

            const result = await newznabClient.testConnection(mockIndexer);
            expect(result.success).toBe(true);
        });

        it("should return failure on error response", async () => {
            fetchMock.mockResolvedValueOnce({
                ok: true,
                text: async () => "<error code='100' description='Invalid API Key'/>",
            });

            const result = await newznabClient.testConnection(mockIndexer);
            expect(result.success).toBe(false);
            expect(result.message).toContain("Invalid API Key");
        });
    });
});
