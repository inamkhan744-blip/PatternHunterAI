import CryptoJS from "crypto-js";

/**
 * Enterprise-grade Authenticated Encryption service for API credentials.
 * Supports AES-256 with dynamic salt, cryptographically secure IV, and HMAC integrity.
 * Provides backward compatibility for existing stored credentials.
 */

const STORAGE_KEY_ENCRYPTED_KEYS = "fortress_encrypted_api_credentials";
const KEY_VERSION_PREFIX = "v2_aes_gcm::";

export interface ApiCredentials {
  apiKey: string;
  apiSecret: string;
}

function getDerivedMasterKey(customSalt?: string): string {
  const envKey = (typeof import.meta !== "undefined" && (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_ENCRYPTION_MASTER_KEY) || "";
  if (envKey) return envKey;

  const clientSeed = typeof window !== "undefined" ? window.location.origin + (window.navigator?.userAgent || "") : "node_environment";
  const baseSalt = customSalt || "fortress_v2_quant_auth_engine";
  return CryptoJS.SHA256(`${clientSeed}::${baseSalt}::fortress_quant_enterprise`).toString(CryptoJS.enc.Hex);
}

export function encryptData(plainText: string, secretKey?: string): string {
  if (!plainText) return "";
  try {
    const key = secretKey || getDerivedMasterKey();
    const iv = CryptoJS.lib.WordArray.random(16);
    const salt = CryptoJS.lib.WordArray.random(16);

    const derived = CryptoJS.PBKDF2(key, salt, { keySize: 256 / 32, iterations: 1000 });

    const encrypted = CryptoJS.AES.encrypt(plainText, derived, {
      iv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7,
    });

    const ivHex = iv.toString(CryptoJS.enc.Hex);
    const saltHex = salt.toString(CryptoJS.enc.Hex);
    const cipherHex = encrypted.ciphertext.toString(CryptoJS.enc.Hex);

    const hmac = CryptoJS.HmacSHA256(`${saltHex}:${ivHex}:${cipherHex}`, key).toString(CryptoJS.enc.Hex);

    return `${KEY_VERSION_PREFIX}${saltHex}:${ivHex}:${cipherHex}:${hmac}`;
  } catch (err) {
    console.error("Authenticated encryption error:", err);
    return "";
  }
}

export function decryptData(cipherBundle: string, secretKey?: string): string {
  if (!cipherBundle) return "";
  try {
    const key = secretKey || getDerivedMasterKey();

    if (cipherBundle.startsWith(KEY_VERSION_PREFIX)) {
      const payload = cipherBundle.slice(KEY_VERSION_PREFIX.length);
      const parts = payload.split(":");
      if (parts.length !== 4) return "";

      const [saltHex, ivHex, cipherHex, expectedHmac] = parts;

      const computedHmac = CryptoJS.HmacSHA256(`${saltHex}:${ivHex}:${cipherHex}`, key).toString(CryptoJS.enc.Hex);
      if (computedHmac !== expectedHmac) {
        console.error("Integrity check failed: Ciphertext has been tampered with or corrupted");
        return "";
      }

      const salt = CryptoJS.enc.Hex.parse(saltHex);
      const iv = CryptoJS.enc.Hex.parse(ivHex);
      const ciphertext = CryptoJS.enc.Hex.parse(cipherHex);

      const derived = CryptoJS.PBKDF2(key, salt, { keySize: 256 / 32, iterations: 1000 });
      const cipherParams = CryptoJS.lib.CipherParams.create({ ciphertext });
      const decrypted = CryptoJS.AES.decrypt(
        cipherParams,
        derived,
        { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }
      );

      return decrypted.toString(CryptoJS.enc.Utf8);
    }

    const legacySalt = "fortress_quant_enterprise_hedge_fund_salt_2025";
    const bytes = CryptoJS.AES.decrypt(cipherBundle, secretKey || legacySalt);
    const legacyText = bytes.toString(CryptoJS.enc.Utf8);
    if (legacyText) {
      return legacyText;
    }
    return "";
  } catch (err) {
    console.error("Authenticated decryption error:", err);
    return "";
  }
}

export function storeEncryptedApiKeys(apiKey: string, apiSecret: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (!apiKey.trim() && !apiSecret.trim()) {
      clearApiKeys();
      return;
    }
    const payload = JSON.stringify({ apiKey: apiKey.trim(), apiSecret: apiSecret.trim() });
    const encrypted = encryptData(payload);
    localStorage.setItem(STORAGE_KEY_ENCRYPTED_KEYS, encrypted);
  } catch (err) {
    console.error("Failed to store encrypted API keys:", err);
  }
}

export function getDecryptedApiKeys(): ApiCredentials {
  if (typeof localStorage === "undefined") {
    return { apiKey: "", apiSecret: "" };
  }
  try {
    const encrypted = localStorage.getItem(STORAGE_KEY_ENCRYPTED_KEYS);
    if (!encrypted) {
      return { apiKey: "", apiSecret: "" };
    }
    const decrypted = decryptData(encrypted);
    if (!decrypted) {
      return { apiKey: "", apiSecret: "" };
    }
    const parsed = JSON.parse(decrypted) as ApiCredentials;
    return {
      apiKey: parsed.apiKey || "",
      apiSecret: parsed.apiSecret || "",
    };
  } catch (err) {
    console.error("Failed to retrieve decrypted API keys:", err);
    return { apiKey: "", apiSecret: "" };
  }
}

export function clearApiKeys(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY_ENCRYPTED_KEYS);
  } catch {
    // ignore
  }
}

export function rotateStoredApiKeys(oldKey?: string, newKey?: string): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    const encrypted = localStorage.getItem(STORAGE_KEY_ENCRYPTED_KEYS);
    if (!encrypted) return true;
    const decrypted = decryptData(encrypted, oldKey);
    if (!decrypted) return false;
    const reEncrypted = encryptData(decrypted, newKey);
    localStorage.setItem(STORAGE_KEY_ENCRYPTED_KEYS, reEncrypted);
    return true;
  } catch {
    return false;
  }
}
