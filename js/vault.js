// Client-side decryption of data/vault.json (AES-256-GCM, key from PBKDF2-SHA256) with WebCrypto.
const KEY_STORE = 'mca.vaultKey';
const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64e = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));

export async function fetchVault() {
  const r = await fetch('data/vault.json', { cache: 'no-cache' }).catch(() => null) || await caches.match('data/vault.json');
  if (!r || !r.ok) throw new Error('vault unavailable');
  return r.json();
}

async function deriveKey(passphrase, vault) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: b64d(vault.salt), iterations: vault.iterations },
    base, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
}

async function decryptWith(key, vault) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(vault.iv) }, key, b64d(vault.ciphertext));
  return JSON.parse(new TextDecoder().decode(pt));
}

/** Try the key remembered on this device. Returns payload or null. */
export async function unlockWithStoredKey(vault) {
  let saved; try { saved = JSON.parse(localStorage.getItem(KEY_STORE) || 'null'); } catch { saved = null; }
  if (!saved || saved.salt !== vault.salt || saved.iterations !== vault.iterations) return null;
  try {
    const key = await crypto.subtle.importKey('raw', b64d(saved.key), { name: 'AES-GCM' }, false, ['decrypt']);
    return await decryptWith(key, vault);
  } catch { forgetKey(); return null; }
}

/** Derive from passphrase; throws Error('bad-passphrase') if wrong. Optionally remembers the derived key (not the passphrase). */
export async function unlockWithPassphrase(vault, passphrase, remember) {
  const key = await deriveKey(passphrase, vault);
  let payload;
  try { payload = await decryptWith(key, vault); } catch { throw new Error('bad-passphrase'); }
  if (remember) {
    const raw = await crypto.subtle.exportKey('raw', key);
    try { localStorage.setItem(KEY_STORE, JSON.stringify({ salt: vault.salt, iterations: vault.iterations, key: b64e(raw) })); } catch {}
  } else forgetKey();
  return payload;
}

export function forgetKey() { try { localStorage.removeItem(KEY_STORE); } catch {} }
export const hasCrypto = !!(window.crypto && crypto.subtle);
