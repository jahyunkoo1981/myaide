// Google sign-in for Drive access (scope drive.file: the app sees only files it created).
// Browser: OAuth redirect flow, which also works inside iPhone/iPad home-screen apps where popups fail.
// Windows app: the app signs in through the system browser and hands tokens over the bridge.
import { native } from './native.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const TOKEN_KEY = 'myaide.token';
const CLIENT_KEY = 'myaide.clientId';

export function clientId() {
  return (window.MYAIDE_CONFIG && window.MYAIDE_CONFIG.googleClientId) || localStorage.getItem(CLIENT_KEY) || '';
}
export function setClientId(v) { localStorage.setItem(CLIENT_KEY, v.trim()); }

function redirectUri() {
  return location.origin + location.pathname.replace(/index\.html$/, '');
}

function saved() {
  try { return JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null'); } catch { return null; }
}

export const auth = {
  error: '',
  // Call once at startup: picks up a token returned in the URL fragment.
  takeRedirect() {
    if (!location.hash.includes('access_token=') && !location.hash.includes('error=')) return;
    const p = new URLSearchParams(location.hash.slice(1));
    const expect = sessionStorage.getItem('myaide.oauthState');
    history.replaceState(null, '', location.pathname + location.search);
    if (p.get('state') !== expect) { this.error = '로그인 확인값이 맞지 않습니다. 다시 시도해 주세요.'; return; }
    if (p.get('access_token')) {
      localStorage.setItem(TOKEN_KEY, JSON.stringify({ token: p.get('access_token'), exp: Date.now() + (Number(p.get('expires_in')) - 60) * 1000 }));
    } else {
      const err = p.get('error');
      this.error = err === 'interaction_required' || err === 'login_required' || err === 'consent_required' ? '' : 'Google 로그인을 완료하지 못했습니다: ' + err;
      sessionStorage.setItem('myaide.silentFailed', '1');
    }
  },
  hasToken() {
    const s = saved();
    return !!(s && s.exp > Date.now());
  },
  everSignedIn() { return localStorage.getItem('myaide.signedIn') === '1'; },
  async token() {
    if (native.available) {
      const r = await native.call('auth.token', { interactive: false });
      if (r && r.token) return r.token;
      throw Object.assign(new Error('Google 다시 연결이 필요합니다.'), { auth: true });
    }
    const s = saved();
    if (s && s.exp > Date.now()) return s.token;
    throw Object.assign(new Error('Google 다시 연결이 필요합니다.'), { auth: true });
  },
  // Leaves the page in the browser flow. Local data is safe in IndexedDB.
  async signIn({ silent = false } = {}) {
    if (native.available) {
      const r = await native.call('auth.token', { interactive: true });
      if (!r || !r.token) throw new Error('Google 로그인을 완료하지 못했습니다.');
      localStorage.setItem('myaide.signedIn', '1');
      return;
    }
    const id = clientId();
    if (!id) throw new Error('Google 클라이언트 ID가 설정되지 않았습니다.');
    const state = crypto.getRandomValues(new Uint32Array(2)).join('');
    sessionStorage.setItem('myaide.oauthState', state);
    localStorage.setItem('myaide.signedIn', '1');
    const q = new URLSearchParams({
      client_id: id, redirect_uri: redirectUri(), response_type: 'token', scope: SCOPE,
      include_granted_scopes: 'true', state
    });
    if (silent) q.set('prompt', 'none');
    location.assign('https://accounts.google.com/o/oauth2/v2/auth?' + q);
    await new Promise(() => {});
  },
  canTrySilent() {
    return !native.available && this.everSignedIn() && !sessionStorage.getItem('myaide.silentFailed') && navigator.onLine;
  },
  async signOut() {
    const s = saved();
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem('myaide.signedIn');
    if (native.available) { await native.call('auth.signOut').catch(() => {}); return; }
    if (s) fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(s.token), { method: 'POST' }).catch(() => {});
  },
  redirectUri
};
