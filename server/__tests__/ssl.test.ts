import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "path";
import forge from "node-forge";
import { generateSelfSignedCert, validateCertFiles, getCertInfo } from "../ssl";

// Define hoisted mocks
const mocks = vi.hoisted(() => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  readFile: vi.fn(),
  existsSync: vi.fn(),
}));

// Mock 'fs' module completely, including promises
vi.mock("fs", () => ({
  default: {
    existsSync: mocks.existsSync,
    promises: {
      mkdir: mocks.mkdir,
      writeFile: mocks.writeFile,
      readFile: mocks.readFile,
    },
  },
}));

vi.mock("path");
vi.mock("node-forge");

// Mock tls with correct shape for dynamic import
vi.mock("tls", () => ({
  createSecureContext: vi.fn(),
  default: {
    createSecureContext: vi.fn(),
  },
}));

describe("SSL Module", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    // Default successful mocks
    mocks.mkdir.mockImplementation(async (...args) => {
      console.log("Mock mkdir called", args);
    });
    mocks.writeFile.mockImplementation(async (...args) => {
      console.log("Mock writeFile called", args);
    });
    mocks.readFile.mockResolvedValue("");
    mocks.existsSync.mockReturnValue(false);
  });

  describe("generateSelfSignedCert", () => {
    it("should generate and save certificate and key files", async () => {
      // Mock path.join
      vi.mocked(path.join).mockImplementation((...args) => args.join("/"));

      // Mock forge
      const mockKeys = { publicKey: "pub", privateKey: "priv" };
      const mockCert = {
        publicKey: null,
        serialNumber: "",
        validity: { notBefore: new Date(), notAfter: new Date() },
        setSubject: vi.fn(),
        setIssuer: vi.fn(),
        sign: vi.fn(),
      };
      mockCert.validity.notBefore = new Date();
      mockCert.validity.notAfter = new Date();

      vi.mocked(forge.pki.rsa.generateKeyPair).mockReturnValue(mockKeys as any);
      vi.mocked(forge.pki.createCertificate).mockReturnValue(mockCert as any);
      vi.mocked(forge.pki.privateKeyToPem).mockReturnValue("PEM_KEY");
      vi.mocked(forge.pki.certificateToPem).mockReturnValue("PEM_CERT");

      // Mock fs (sync)
      // vi.mocked(fs.default.existsSync).mockReturnValue(false);
      // Already set in beforeEach via mocks.existsSync

      const result = await generateSelfSignedCert();

      expect(result.keyPath).toContain("server.key");
      expect(result.certPath).toContain("server.crt");
      expect(forge.pki.rsa.generateKeyPair).toHaveBeenCalledWith(2048);
      expect(mocks.writeFile).toHaveBeenCalledTimes(2); // Key and Cert
    });
  });

  describe("validateCertFiles", () => {
    it("should return valid: true for valid matching files", async () => {
      mocks.existsSync.mockReturnValue(true);

      mocks.readFile.mockImplementation(async (path: any) => {
        if (path.toString().includes("cert.pem"))
          return "-----BEGIN CERTIFICATE-----\nContent\n-----END CERTIFICATE-----";
        if (path.toString().includes("key.pem"))
          return "-----BEGIN PRIVATE KEY-----\nContent\n-----END PRIVATE KEY-----";
        return "";
      });

      const mockCert = { validity: { notAfter: new Date(Date.now() + 100000) } };
      vi.mocked(forge.pki.certificateFromPem).mockReturnValue(mockCert as any);

      const result = await validateCertFiles("cert.pem", "key.pem");
      if (!result.valid) console.log("validateCertFiles failure debug:", result);
      expect(result.valid).toBe(true);
    });

    it("should return valid: false if certificate is expired", async () => {
      mocks.existsSync.mockReturnValue(true);

      mocks.readFile.mockImplementation(async (path: any) => {
        if (path.toString().includes("cert.pem"))
          return "-----BEGIN CERTIFICATE-----\nContent\n-----END CERTIFICATE-----";
        if (path.toString().includes("key.pem"))
          return "-----BEGIN PRIVATE KEY-----\nContent\n-----END PRIVATE KEY-----";
        return "";
      });

      const mockCert = { validity: { notAfter: new Date(Date.now() - 100000) } }; // Expired
      vi.mocked(forge.pki.certificateFromPem).mockReturnValue(mockCert as any);

      const result = await validateCertFiles("cert.pem", "key.pem");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("expired");
    });
  });

  describe("getCertInfo", () => {
    it("should parse certificate info correctly", async () => {
      mocks.existsSync.mockReturnValue(true);

      mocks.readFile.mockResolvedValue("CERT_CONTENT");

      const mockCert = {
        subject: { attributes: [{ name: "commonName", value: "Test Cert" }] },
        issuer: { attributes: [{ name: "commonName", value: "Test Issuer" }] },
        validity: { notBefore: new Date(), notAfter: new Date() },
      };
      vi.mocked(forge.pki.certificateFromPem).mockReturnValue(mockCert as any);

      const result = await getCertInfo("cert.pem");
      expect(result.valid).toBe(true);
      expect(result.subject).toContain("commonName=Test Cert");
      expect(result.issuer).toContain("commonName=Test Issuer");
      expect(result.selfSigned).toBe(false);
    });

    it("should detect self-signed certificate", async () => {
      mocks.existsSync.mockReturnValue(true);

      mocks.readFile.mockResolvedValue("CERT_CONTENT");

      const mockCert = {
        subject: { attributes: [{ name: "commonName", value: "Self Signed" }] },
        issuer: { attributes: [{ name: "commonName", value: "Self Signed" }] },
        validity: { notBefore: new Date(), notAfter: new Date() },
      };
      vi.mocked(forge.pki.certificateFromPem).mockReturnValue(mockCert as any);

      const result = await getCertInfo("cert.pem");
      expect(result.valid).toBe(true);
      expect(result.selfSigned).toBe(true);
    });
  });
});
