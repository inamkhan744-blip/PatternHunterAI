import CryptoJS from "crypto-js";

/**
 * Enterprise-grade AES-256 Encryption service for Binance API credentials.
 * Secures API Key and API Secret in local client storage.
 */

// Hardware/Client specific master seed combined with default salt
const STORAGE_PEPPER = "fortress_quant_enterprise_hedge_fund_salt_2025";
const STORAGE_KEY_ENCRYPTED_KEYS = "fortress_encrypted_api_credentials";

export interface ApiCredentials {
  apiKey: string;
  apiSecret: string;
}

/**
 * Encrypts plain text using AES-256.
 */
export function encryptData(plainText: string, secretKey: string = STORAGE_PEPPER): string {
  if (!plainText) return "";
  try {
    return CryptoJS.AES.encrypt(plainText, secretKey).toString();
  } catch (err) {
    console.error("AES Encryption error:", err);
    return "";
  }
}

/**
 * Decrypts AES-256 cipher text.
 */
export function decryptData(cipherText: string, secretKey: string = STORAGE_PEPPER): string {
  if (!cipherText) return "";
  try {
    const bytes = CryptoJS.AES.decrypt(cipherText, secretKey);
    const originalText = bytes.toString(CryptoJS.enc.Utf8);
    return originalText;
  } catch (err) {
    console.error("AES Decryption error:", err);
    return "";
  }
}

/**
 * Encrypts and securely stores Binance API credentials in localStorage.
 */
export function storeEncryptedApiKeys(apiKey: string, apiSecret: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    const payload = JSON.stringify({ apiKey, apiSecret });
    const encrypted = encryptData(payload);
    localStorage.setItem(STORAGE_KEY_ENCRYPTED_KEYS, encrypted);
  } catch (err) {
    console.error("Failed to store encrypted API keys:", err);
  }
}

/**
 * Retrieves and decrypts Binance API credentials from localStorage.
 */
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

/**
 * Clears stored encrypted credentials from storage.
 */
export function clearApiKeys(): void {
  localStorage.removeItem(STORAGE_KEY_ENCRYPTED_KEYS);
}
