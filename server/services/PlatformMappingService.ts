import { IStorage } from "../storage.js";
import { InsertPlatformMapping, PlatformMapping } from "../../shared/schema.js";

const DEFAULT_MAPPINGS: { igdbPlatformId: number; rommPlatformName: string }[] = [
  { igdbPlatformId: 18, rommPlatformName: "nes" },
  { igdbPlatformId: 19, rommPlatformName: "snes" },
  { igdbPlatformId: 4, rommPlatformName: "n64" },
  { igdbPlatformId: 21, rommPlatformName: "ngc" },
  { igdbPlatformId: 5, rommPlatformName: "wii" },
  { igdbPlatformId: 33, rommPlatformName: "gb" },
  { igdbPlatformId: 22, rommPlatformName: "gbc" },
  { igdbPlatformId: 24, rommPlatformName: "gba" },
  { igdbPlatformId: 20, rommPlatformName: "nds" },
  { igdbPlatformId: 37, rommPlatformName: "3ds" },
  { igdbPlatformId: 130, rommPlatformName: "switch" },
  { igdbPlatformId: 7, rommPlatformName: "psx" },
  { igdbPlatformId: 8, rommPlatformName: "ps2" },
  { igdbPlatformId: 9, rommPlatformName: "ps3" },
  { igdbPlatformId: 38, rommPlatformName: "psp" },
  { igdbPlatformId: 35, rommPlatformName: "gamegear" },
  { igdbPlatformId: 64, rommPlatformName: "sms" },
  { igdbPlatformId: 29, rommPlatformName: "genesis" },
  { igdbPlatformId: 23, rommPlatformName: "dc" },
  { igdbPlatformId: 59, rommPlatformName: "atari2600" },
  { igdbPlatformId: 80, rommPlatformName: "neogeoaes" },
];

export class PlatformMappingService {
  constructor(private storage: IStorage) {}

  async initializeDefaults(): Promise<void> {
    if (typeof this.storage.seedPlatformMappingsIfEmpty === "function") {
      const result = await this.storage.seedPlatformMappingsIfEmpty(DEFAULT_MAPPINGS);
      if (result?.seeded) {
        console.log(`Seeding default platform mappings complete (${result.count} rows).`);
      }
      return;
    }

    const existing = await this.storage.getPlatformMappings();
    if (existing.length === 0) {
      for (const map of DEFAULT_MAPPINGS) {
        await this.storage.addPlatformMapping(map);
      }
    }
  }

  async getAllMappings(): Promise<PlatformMapping[]> {
    return this.storage.getPlatformMappings();
  }

  async getRomMPlatform(igdbId: number): Promise<string | null> {
    const mapping = await this.storage.getPlatformMapping(igdbId);
    return mapping ? mapping.rommPlatformName : null;
  }

  async addMapping(mapping: InsertPlatformMapping): Promise<PlatformMapping> {
    return this.storage.addPlatformMapping(mapping);
  }

  async updateMapping(
    id: string,
    updates: Partial<InsertPlatformMapping>
  ): Promise<PlatformMapping | undefined> {
    return this.storage.updatePlatformMapping(id, updates);
  }

  async removeMapping(id: string): Promise<boolean> {
    return this.storage.removePlatformMapping(id);
  }
}
