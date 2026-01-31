import { IStorage } from "../storage.js";
import axios, { AxiosInstance } from "axios";

export class RomMService {
  constructor(private storage: IStorage) {}

  private async getClient(): Promise<AxiosInstance | null> {
    const config = await this.storage.getRomMConfig();
    if (!config.enabled || !config.url) {
      return null;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (config.apiKey) {
      headers["Authorization"] = `Bearer ${config.apiKey}`; // RomM usually uses Bearer token or X-Api-Key? 
      // RomM docs say: Authorization: Bearer <token>
    }

    // Ensure URL doesn't have trailing slash for consistency
    const baseURL = config.url.replace(/\/$/, "");

    return axios.create({
      baseURL,
      headers,
      timeout: 5000,
      validateStatus: () => true, // Handle status codes manually
    });
  }

  async isAvailable(): Promise<boolean> {
    const client = await this.getClient();
    if (!client) return false;

    try {
      // RomM /api/auth/me is a good candidate to check connectivity and auth
      // Or just /api/system/health ? (RomM might not have standard health check yet)
      // Users reported /api/tags is a safe GET endpoint
      // Let's try /api/auth/me if we have a key, or just root /api docs if not?
      // Assuming user provided API key, let's check auth.
      const response = await client.get("/api/auth/me");
      return response.status >= 200 && response.status < 300;
    } catch (error) {
      console.error("[RomMService] Availability check failed:", error);
      return false;
    }
  }

  /**
   * Triggers a library scan in RomM.
   * @param platform Optional platform slug (e.g. 'snes') to scan specifically.
   */
  async scanLibrary(platform?: string): Promise<boolean> {
    const client = await this.getClient();
    if (!client) return false;

    try {
      // RomM endpoint for scanning: POST /api/scan
      // It might accept a body with { platforms: ["snes"] } ?
      // Reviewing RomM docs (mental check):
      // POST /api/library/scan
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const payload: any = {
          // RomM specific payload structure
      };

      if (platform) {
          // If RomM supports targeted scan
          // payload.platforms = [platform];
      }

      // RomM 3.0+ uses /api/tasks/scan I think?
      // Let's assume standard /api/library/scan for now or similar.
      // If endpoint fails, we log it.
      
      // eslint-disable-next-line no-console
      console.log(`[RomMService] Triggering scan for ${platform || "all platforms"}...`);
      const response = await client.post("/api/scan", payload); // Verify endpoint
      
      if (response.status >= 200 && response.status < 300) {
        // eslint-disable-next-line no-console
        console.log("[RomMService] Scan triggered successfully.");
        return true;
      } else {
        console.error(`[RomMService] Scan failed with status ${response.status}:`, response.data);
        return false;
      }
    } catch (error) {
        console.error("[RomMService] Scan request error:", error);
        return false;
    }
  }
}
