import forge from "node-forge";
import fs from "fs";
import path from "path";
import { promisify } from "util";

const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);

const SSL_DIR = path.join(process.cwd(), "config", "ssl");

export async function ensureSslDir() {
  if (!fs.existsSync(SSL_DIR)) {
    await mkdir(SSL_DIR, { recursive: true });
  }
}

export async function generateSelfSignedCert(expiryDays: number = 365) {
  await ensureSslDir();

  console.log("Generating 2048-bit key-pair...");
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();

  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

  const attrs = [
    {
      name: "commonName",
      value: "Questarr Self-Signed",
    },
    {
      name: "countryName",
      value: "US",
    },
    {
      shortName: "ST",
      value: "Virginia",
    },
    {
      name: "localityName",
      value: "Blacksburg",
    },
    {
      name: "organizationName",
      value: "Questarr",
    },
    {
      shortName: "OU",
      value: "Questarr",
    },
  ];

  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey);

  const pemKey = forge.pki.privateKeyToPem(keys.privateKey);
  const pemCert = forge.pki.certificateToPem(cert);

  const keyPath = path.join(SSL_DIR, "server.key");
  const certPath = path.join(SSL_DIR, "server.crt");

  await writeFile(keyPath, pemKey);
  await writeFile(certPath, pemCert);

  return {
    keyPath,
    certPath,
  };
}

export async function validateCertFiles(
  certPath: string,
  keyPath: string
): Promise<{ valid: boolean; error?: string; expiry?: Date }> {
  try {
    if (!fs.existsSync(certPath)) {
      return { valid: false, error: "Certificate file missing" };
    }
    if (!fs.existsSync(keyPath)) {
      return { valid: false, error: "Private key file missing" };
    }

    // Read files
    const certPem = await readFile(certPath, "utf8");
    const keyPem = await readFile(keyPath, "utf8");

    // 1. Basic Content Check
    if (!certPem.includes("BEGIN CERTIFICATE")) {
      return { valid: false, error: "Invalid certificate format (PEM expected)" };
    }
    if (!keyPem.includes("PRIVATE KEY")) {
      return { valid: false, error: "Invalid private key format (PEM expected)" };
    }

    // 2. Parse with node-forge to check details
    let cert;
    try {
      cert = forge.pki.certificateFromPem(certPem);
    } catch {
      return { valid: false, error: "Failed to parse certificate content" };
    }

    // Check expiry
    const now = new Date();
    if (cert.validity.notAfter < now) {
      return {
        valid: false,
        error: `Certificate expired on ${cert.validity.notAfter.toISOString()}`,
        expiry: cert.validity.notAfter,
      };
    }

    // 3. Verify Key Match using Node's crypto/tls (most reliable for runtime)
    // tls.createSecureContext will throw if the key doesn't match the cert
    try {
      const { createSecureContext } = await import("tls");
      createSecureContext({
        cert: certPem,
        key: keyPem,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { valid: false, error: `Certificate and key do not match or are invalid: ${message}` };
    }

    return { valid: true, expiry: cert.validity.notAfter };
  } catch (error) {
    console.error("Certificate validation failed:", error);
    return { valid: false, error: "Unknown validation error" };
  }
}
