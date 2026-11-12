import { encryptData, decryptData } from "./CryptoSecurity";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`FAILED: ${msg}`);
    process.exit(1);
  }
  console.log(`✓ PASS: ${msg}`);
}

const mockStorage = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => mockStorage.get(k) || null,
  setItem: (k: string, v: string) => mockStorage.set(k, v),
  removeItem: (k: string) => mockStorage.delete(k),
  clear: () => mockStorage.clear(),
};

async function runTests() {
  console.log("Running CryptoSecurity (AES-256-GCM) Test Suite...");

  const secretData = "my_binance_super_secret_api_key_123456";
  const passphrase = "operator-supplied-passphrase";

  const encrypted = await encryptData(secretData, passphrase);
  assert(encrypted.startsWith("v3_aes_gcm::"), "Ciphertext uses the AES-256-GCM v3 format prefix");
  assert(encrypted !== secretData, "Encrypted output is distinct from plaintext");

  const bundle = encrypted.slice("v3_aes_gcm::".length);
  const [ivB64] = bundle.split(":");
  assert(Buffer.from(ivB64, "base64").length === 12, "A 96-bit random IV is used");

  const decrypted = await decryptData(encrypted, passphrase);
  assert(decrypted === secretData, "Decrypted text exactly matches original plaintext");

  const tampered = encrypted.slice(0, -4) + "AAAA";
  const tamperedResult = await decryptData(tampered, passphrase);
  assert(tamperedResult === "", "Tampered ciphertext is rejected (GCM auth tag failure)");

  const wrongKeyResult = await decryptData(encrypted, "a-different-passphrase");
  assert(wrongKeyResult === "", "Decryption with the wrong key fails closed");

  // Device-key path (random per-browser key, never derived from origin or VITE_*).
  const deviceEncrypted = await encryptData(secretData);
  const deviceDecrypted = await decryptData(deviceEncrypted);
  assert(deviceDecrypted === secretData, "Device-key encryption round-trips");
  assert(
    mockStorage.get("fortress_device_key_v3") !== undefined,
    "Device key is generated locally as random bytes"
  );

  console.log("All CryptoSecurity tests passed successfully!");
}

runTests();
