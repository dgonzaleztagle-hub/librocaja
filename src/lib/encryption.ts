import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const algorithm = "aes-256-gcm";

export interface EncryptedSecret {
  version: number;
  ciphertext: string;
  iv: string;
  tag: string;
}

function key() {
  const raw = process.env.SII_CREDENTIALS_KEY;
  if (!raw) throw new Error("Falta SII_CREDENTIALS_KEY");
  const value = Buffer.from(raw, "base64");
  if (value.length !== 32) throw new Error("SII_CREDENTIALS_KEY debe tener 32 bytes en Base64");
  return value;
}

export function encryptSecret(value: string): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { version: 1, ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}

export function decryptSecret(secret: EncryptedSecret) {
  if (secret.version !== 1) throw new Error("Versión de cifrado no compatible");
  const decipher = createDecipheriv(algorithm, key(), Buffer.from(secret.iv, "base64"));
  decipher.setAuthTag(Buffer.from(secret.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(secret.ciphertext, "base64")), decipher.final()]).toString("utf8");
}
