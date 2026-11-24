// Device lock: Face ID / Touch ID / Windows Hello through WebAuthn in browsers, Windows Hello in the Windows app.
// This is a local unlock check for this device; data access itself is protected by the Google account and the vault.
import { native } from './native.js';
import { device } from './prefs.js';

const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

export const lock = {
  enabled() { return native.available ? device.get('lock', true) : !!device.get('lockCred', null); },
  async supported() {
    if (native.available) return true;
    return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(() => false));
  },
  async enable() {
    if (native.available) { device.set('lock', true); return; }
    const cred = await navigator.credentials.create({ publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'MY AIDE', id: location.hostname },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'myaide', displayName: 'MY AIDE' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60000
    } });
    device.set('lockCred', b64(cred.rawId));
  },
  disable() { if (native.available) device.set('lock', false); else device.set('lockCred', null); },
  async verify() {
    if (native.available) {
      const r = await native.call('hello.verify', { message: 'MY AIDE 잠금 해제' });
      if (!r || !r.ok) throw new Error(r && r.message || 'Windows 확인을 완료하지 못했습니다.');
      return;
    }
    const id = device.get('lockCred', null);
    if (!id) return;
    await navigator.credentials.get({ publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: 'public-key', id: unb64(id) }],
      userVerification: 'required', timeout: 60000
    } });
  }
};
