import yaml from "js-yaml";
import fs from "fs";
import path from "path";
import { z } from "zod";

// Define the schema for our configuration file
const configSchema = z.object({
  ssl: z
    .object({
      enabled: z.boolean().default(false),
      port: z.number().default(9898),
      certPath: z.string().optional(),
      keyPath: z.string().optional(),
      redirectHttp: z.boolean().default(false),
    })
    .default({}),
});

export type AppConfig = z.infer<typeof configSchema>;

export class ConfigLoader {
  private configPath: string;
  private config: AppConfig;

  constructor(configPath?: string) {
    this.configPath = configPath || path.join(process.cwd(), "config.yaml");
    this.config = this.loadConfig();
  }

  private loadConfig(): AppConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const fileContents = fs.readFileSync(this.configPath, "utf8");
        const doc = yaml.load(fileContents);
        const result = configSchema.safeParse(doc);

        if (result.success) {
          const config = result.data;
          // Allow environment variable to override config file for container environments
          if (process.env.SSL_PORT) {
            config.ssl.port = parseInt(process.env.SSL_PORT, 10);
          }
          return config;
        } else {
          console.error("Invalid config.yaml format:", result.error);
          return configSchema.parse({
            ssl: {
              port: process.env.SSL_PORT ? parseInt(process.env.SSL_PORT, 10) : 9898,
            },
          });
        }
      }
    } catch (error) {
      console.error("Error loading config.yaml:", error);
    }

    return configSchema.parse({
      ssl: {
        port: process.env.SSL_PORT ? parseInt(process.env.SSL_PORT, 10) : 9898,
      },
    });
  }

  public getConfig(): AppConfig {
    return this.config;
  }

  public async saveConfig(newConfig: Partial<AppConfig>): Promise<void> {
    try {
      // Merge current config with updates
      const updatedConfig = {
        ...this.config,
        ...newConfig,
        ssl: {
          ...this.config.ssl,
          ...(newConfig.ssl || {}),
        },
      };

      // Validate before saving
      const result = configSchema.safeParse(updatedConfig);
      if (!result.success) {
        throw new Error("Invalid configuration data");
      }

      this.config = result.data;
      const yamlStr = yaml.dump(this.config);
      await fs.promises.writeFile(this.configPath, yamlStr, "utf8");
    } catch (error) {
      console.error("Error saving config.yaml:", error);
      throw error;
    }
  }

  // Helper to get SSL config specifically
  public getSslConfig() {
    return this.config.ssl;
  }
}

export const configLoader = new ConfigLoader();
