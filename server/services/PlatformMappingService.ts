import { IStorage } from "../storage.js";
import { InsertPlatformMapping, PlatformMapping } from "../../shared/schema.js";

const DEFAULT_MAPPINGS: { igdbPlatformId: number; sourcePlatformName: string }[] = [
  { igdbPlatformId: 18, sourcePlatformName: "nes" },
  { igdbPlatformId: 19, sourcePlatformName: "snes" },
  { igdbPlatformId: 4, sourcePlatformName: "n64" },
  { igdbPlatformId: 21, sourcePlatformName: "ngc" },
  { igdbPlatformId: 5, sourcePlatformName: "wii" },
  { igdbPlatformId: 33, sourcePlatformName: "gb" },
  { igdbPlatformId: 22, sourcePlatformName: "gbc" },
  { igdbPlatformId: 24, sourcePlatformName: "gba" },
  { igdbPlatformId: 20, sourcePlatformName: "nds" },
  { igdbPlatformId: 37, sourcePlatformName: "3ds" },
  { igdbPlatformId: 130, sourcePlatformName: "switch" },
  { igdbPlatformId: 7, sourcePlatformName: "psx" },
  { igdbPlatformId: 8, sourcePlatformName: "ps2" },
  { igdbPlatformId: 9, sourcePlatformName: "ps3" },
  { igdbPlatformId: 38, sourcePlatformName: "psp" },
  { igdbPlatformId: 35, sourcePlatformName: "gamegear" },
  { igdbPlatformId: 64, sourcePlatformName: "sms" },
  { igdbPlatformId: 29, sourcePlatformName: "genesis" },
  { igdbPlatformId: 23, sourcePlatformName: "dc" },
  { igdbPlatformId: 59, sourcePlatformName: "atari2600" },
  { igdbPlatformId: 80, sourcePlatformName: "neogeoaes" },
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
    return mapping ? mapping.sourcePlatformName : null;
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
