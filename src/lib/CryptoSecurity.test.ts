import { encryptData, decryptData, storeEncryptedApiKeys, getDecryptedApiKeys, clearApiKeys, rotateStoredApiKeys } from "./CryptoSecurity";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`FAILED: ${msg}`);
    process.exit(1);
  }
  console.log(`✓ PASS: ${msg}`);
}

const mockStorage = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => mockStorage.get(k) || null,
  setItem: (k: string, v: string) => mockStorage.set(k, v),
  removeItem: (k: string) => mockStorage.delete(k),
  clear: () => mockStorage.clear(),
};

async function runTests() {
  console.log("Running CryptoSecurity Test Suite...");

  const secretData = "my_binance_super_secret_api_key_123456";
  const encrypted = encryptData(secretData);
  assert(encrypted.startsWith("v2_aes_gcm::"), "Ciphertext uses authenticated V2 format prefix");
  assert(encrypted !== secretData, "Encrypted output is distinct from plaintext");

  const decrypted = decryptData(encrypted);
  assert(decrypted === secretData, "Decrypted text exactly matches original plaintext");

  const tampered = encrypted.slice(0, -4) + "abcd";
  const tamperedResult = decryptData(tampered);
  assert(tamperedResult === "", "Tampered ciphertext is rejected and returns empty string");

  storeEncryptedApiKeys("test_key_abc", "test_secret_xyz");
  const retrieved = getDecryptedApiKeys();
  assert(retrieved.apiKey === "test_key_abc", "Stored apiKey retrieved and decrypted accurately");
  assert(retrieved.apiSecret === "test_secret_xyz", "Stored apiSecret retrieved and decrypted accurately");

  const rotated = rotateStoredApiKeys(undefined, "new_rotation_key_999");
  assert(rotated === true, "Key rotation succeeds");
  const storedEncrypted = mockStorage.get("fortress_encrypted_api_credentials");
  const decryptedWithNewKey = decryptData(storedEncrypted!, "new_rotation_key_999");
  assert(JSON.parse(decryptedWithNewKey).apiKey === "test_key_abc", "Credentials preserved after rotation");

  clearApiKeys();
  const cleared = getDecryptedApiKeys();
  assert(cleared.apiKey === "" && cleared.apiSecret === "", "Clearing credentials removes all traces");

  console.log("All CryptoSecurity tests passed successfully!");
}

runTests();
