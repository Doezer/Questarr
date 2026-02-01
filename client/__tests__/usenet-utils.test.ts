import { describe, it, expect } from "vitest";
import { isUsenetItem } from "../src/lib/downloads-utils";

describe("isUsenetItem", () => {
    it("should return true for items with grabs or age", () => {
        expect(isUsenetItem({ grabs: 10 })).toBe(true);
        expect(isUsenetItem({ age: 5 })).toBe(true);
        expect(isUsenetItem({ grabs: 0, age: 0 })).toBe(true);
    });

    it("should return false for items with seeders", () => {
        expect(isUsenetItem({ seeders: 10 })).toBe(false);
        expect(isUsenetItem({ seeders: 0 })).toBe(false);
    });

    it("should return false for empty items (default to torrent)", () => {
        expect(isUsenetItem({})).toBe(false);
    });
});
