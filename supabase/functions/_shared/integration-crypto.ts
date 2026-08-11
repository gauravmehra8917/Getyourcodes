// Deno/Web Crypto compatibility for the existing Node credential envelope.
// Wire format: 12-byte IV + 16-byte GCM tag + ciphertext, base64 encoded.

const IV_BYTES = 12;
const GCM_TAG_BYTES = 16;

function base64ToBytes(value: string): Uint8Array {
  const decoded = atob(value);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function joinBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const combined = new Uint8Array(left.length + right.length);
  combined.set(left);
  combined.set(right, left.length);
  return combined;
}

/**
 * Decrypts the repository's Node AES-256-GCM credential format using Web
 * Crypto. Node stores the tag before ciphertext; Web Crypto consumes it after
 * ciphertext, so the two segments are deliberately reordered here.
 */
export async function decryptCredentialsWebCrypto(
  stored: string,
  credentialSecret: string,
): Promise<string> {
  const envelope = base64ToBytes(stored);
  if (envelope.length <= IV_BYTES + GCM_TAG_BYTES) {
    throw new Error("Invalid encrypted credential envelope");
  }

  const iv = envelope.slice(0, IV_BYTES);
  const tag = envelope.slice(IV_BYTES, IV_BYTES + GCM_TAG_BYTES);
  const ciphertext = envelope.slice(IV_BYTES + GCM_TAG_BYTES);
  const keyMaterial = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(credentialSecret),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    keyMaterial,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, tagLength: GCM_TAG_BYTES * 8 },
    key,
    joinBytes(ciphertext, tag),
  );
  return new TextDecoder().decode(plaintext);
}
