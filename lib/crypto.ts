function b64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}
function bytesToB64(bytes: ArrayBuffer): string {
  const arr = new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s);
}

async function importAesKey(b64: string): Promise<CryptoKey> {
  const keyBytes = b64ToBytes(b64);
  return crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt','decrypt']);
}

export async function encryptAesGcm(plain: string, base64Key: string) {
  const key = await importAesKey(base64Key);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain));
  return { ct: bytesToB64(ct), iv: bytesToB64(iv) };
}

export async function decryptAesGcm(ctB64: string, ivB64: string, base64Key: string): Promise<string> {
  const key = await importAesKey(base64Key);
  const dec = new TextDecoder();
  const ct = b64ToBytes(ctB64);
  const iv = b64ToBytes(ivB64);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return dec.decode(pt);
}
