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

export async function validateCertFiles(certPath: string, keyPath: string): Promise<boolean> {
  try {
    if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
      return false;
    }

    // Basic check ensuring files are readable
    await readFile(certPath);
    await readFile(keyPath);
    return true;
  } catch (error) {
    console.error("Certificate validation failed:", error);
    return false;
  }
}
