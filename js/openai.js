// OpenAI calls go straight from this device to api.openai.com. The API key lives in the vault (encrypted).
import { h, dialog } from './util.js';
import * as vault from './vault.js';
import { prefs } from './prefs.js';

export async function unlockVaultPrompt(reason) {
  if (vault.isOpen()) return true;
  if (!await vault.exists()) throw new Error('MY AIDE 비밀번호가 아직 없습니다.');
  const pw = h('input', { type: 'password', autocomplete: 'current-password' });
  const err = h('p', { class: 'error' });
  const r = await dialog({ title: '비밀번호 확인', body: [h('p', { class: 'hint', style: { margin: 0 } }, reason), h('label', { class: 'field' }, 'MY AIDE 비밀번호', pw), err],
    onOpen: (d) => { pw.focus(); pw.addEventListener('keydown', e => { if (e.key === 'Enter') d.querySelector('.btn.primary').click(); }); },
    actions: [{ label: '취소' }, { label: '열기', kind: 'primary', value: 'ok', run: async () => { try { await vault.unlock(pw.value); } catch (e) { err.textContent = e.message; return false; } } }] });
  return r === 'ok';
}

export async function apiKey() {
  if (!await unlockVaultPrompt('OpenAI API 키는 비밀번호로 암호화되어 있습니다. 비밀번호를 입력해 주세요.')) throw new Error('비밀번호를 확인하지 않아 AI 기능을 쓸 수 없습니다.');
  const key = await vault.getSecret('openai');
  if (!key) throw new Error('OpenAI API 키가 없습니다. 설정 › AI 연결에서 키를 넣어 주세요.');
  return key;
}

async function call(path, init) {
  const key = await apiKey();
  if (!navigator.onLine) throw new Error('인터넷에 연결되어 있지 않습니다.');
  const res = await fetch('https://api.openai.com/v1/' + path, { ...init, headers: { ...(init.headers || {}), Authorization: 'Bearer ' + key } });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error.message; } catch {}
    throw new Error(res.status === 401 ? 'OpenAI API 키가 올바르지 않습니다. 설정에서 다시 넣어 주세요.' : 'OpenAI 오류: ' + msg);
  }
  return res.json();
}

export async function chat(messages, model) {
  const r = await call('chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: model || prefs().aiModel || 'gpt-4o-mini', messages }) });
  return r.choices?.[0]?.message?.content || '';
}

export async function transcribe(blob) {
  if (blob.size > 25 * 1024 * 1024) throw new Error('녹음 파일이 25MB를 넘어 한 번에 변환할 수 없습니다. 녹음을 나눠서 해 주세요.');
  const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : blob.type.includes('wav') ? 'wav' : 'webm';
  const form = new FormData();
  form.append('file', blob, 'meeting.' + ext);
  form.append('model', prefs().transcribeModel || 'gpt-4o-mini-transcribe');
  form.append('language', 'ko');
  const r = await call('audio/transcriptions', { method: 'POST', body: form });
  return r.text || '';
}

// Picture understanding for 사진·동영상: a short Korean description + tags as JSON.
export async function describeImage(dataUrl, hint = '') {
  const out = await chat([
    { role: 'system', content: '사진을 보고 한국어로 검색용 정보를 만듭니다. 반드시 JSON 하나만 출력: {"desc":"한두 문장 설명","tags":["장소/사물/사람수/행동/계절/색 등 짧은 낱말 5~12개"]}. 사람의 신원(이름)은 추측하지 마세요.' },
    { role: 'user', content: [{ type: 'text', text: '이 사진을 설명해 주세요.' + (hint ? ' 참고: ' + hint : '') }, { type: 'image_url', image_url: { url: dataUrl, detail: 'low' } }] }
  ], prefs().visionModel || 'gpt-4o-mini');
  const j = JSON.parse(out.replace(/^```(?:json)?\s*|\s*```$/g, '').trim());
  return { desc: String(j.desc || '').slice(0, 300), tags: (j.tags || []).map(t => String(t).slice(0, 20)).slice(0, 15) };
}

// Small text embeddings (256 numbers) for meaning-based search.
export async function embed(texts) {
  const r = await call('embeddings', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: texts, dimensions: 256 }) });
  return r.data.map(d => d.embedding);
}
