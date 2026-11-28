// AI calls go straight from this device to the chosen service (OpenAI, Claude or Gemini).
// API keys live in the vault (encrypted). 받아쓰기·사진 설명·의미 검색 always use OpenAI.
import { h, dialog } from './util.js';
import * as vault from './vault.js';
import { prefs } from './prefs.js';
import { guardChat, guardTranscribe } from './usage.js';
import * as privacy from './privacy.js';

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

// ---------- which AI ----------
export const PROVIDERS = {
  openai: { name: 'OpenAI (ChatGPT)', secret: 'openai', keyUrl: 'platform.openai.com/api-keys', keyHint: 'sk-로 시작하는 키',
    fallback: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-4o-mini'] },
  anthropic: { name: 'Claude (Anthropic)', secret: 'anthropic', keyUrl: 'console.anthropic.com/settings/keys', keyHint: 'sk-ant-로 시작하는 키',
    fallback: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] },
  gemini: { name: 'Gemini (Google)', secret: 'gemini', keyUrl: 'aistudio.google.com/apikey', keyHint: 'AIza로 시작하는 키',
    fallback: ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-pro-preview'] }
};
export function currentAi() {
  const p = prefs(), provider = PROVIDERS[p.aiProvider] ? p.aiProvider : 'openai';
  const model = (p.aiModels || {})[provider] || (provider === 'openai' ? p.aiModel : null) || PROVIDERS[provider].fallback[0];
  return { provider, model };
}
async function keyFor(provider) {
  if (!await unlockVaultPrompt('API 키는 비밀번호로 암호화되어 있습니다. 비밀번호를 입력해 주세요.')) throw new Error('비밀번호를 확인하지 않아 AI 기능을 쓸 수 없습니다.');
  const key = await vault.getSecret(PROVIDERS[provider].secret);
  if (!key) throw new Error(`${PROVIDERS[provider].name} API 키가 없습니다. 설정 › AI 연결에서 키를 넣어 주세요.`);
  return key;
}
const failMsg = async (res, who) => {
  let msg = res.statusText; try { const j = await res.json(); msg = j.error?.message || j.error?.status || msg; } catch { }
  if (res.status === 401) return `${who} API 키가 올바르지 않습니다 (${msg}). 설정 › AI 연결에서 키를 다시 넣어 주세요.`;
  if (res.status === 403) return `${who}: 이 키로는 권한이 없습니다 (${msg}).`;
  if (res.status === 400 && /credit|balance|billing/i.test(msg)) return `${who}: 크레딧(잔액)이 부족합니다. 콘솔에서 충전해 주세요 (${msg}).`;
  if (res.status === 404) return `${who}: 이 모델을 쓸 수 없습니다 (${msg}). 설정 › AI 연결에서 다른 모델을 고르세요.`;
  if (res.status === 429) return `${who}: 사용 한도나 잔액이 부족합니다 (${msg}).`;
  return `${who} 오류: ${msg}`;
};

// List the models this key can use (newest first). Falls back to a built-in list when it can't ask.
export async function listModels(provider, key) {
  if (!key) return PROVIDERS[provider].fallback;
  if (provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: 'Bearer ' + key } });
    if (!res.ok) throw new Error(await failMsg(res, 'OpenAI'));
    const j = await res.json();
    return j.data.filter(m => /^(gpt|o\d|chat)/.test(m.id) && !/(audio|realtime|tts|transcribe|image|embedding|search|moderation|instruct|dall|whisper|codex|cyber)/.test(m.id))
      .sort((a, b) => b.created - a.created).map(m => m.id);
  }
  if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/models?limit=100', { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' } });
    if (!res.ok) throw new Error(await failMsg(res, 'Claude'));
    return (await res.json()).data.map(m => m.id);
  }
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=' + encodeURIComponent(key));
  if (!res.ok) throw new Error(await failMsg(res, 'Gemini'));
  return (await res.json()).models.filter(m => (m.supportedGenerationMethods || []).includes('generateContent') && /gemini/.test(m.name) && !/(tts|image|live|embedding|audio|transcribe|translate|omni)/.test(m.name))
    .map(m => m.name.replace(/^models\//, '')).reverse();
}

// Text chat with the AI chosen in 설정. `model` given = an OpenAI-only job (e.g. picture understanding).
// opts: { kind: 'chat'|'summary'|'mindmap'|'code'|'vision', ask: false → 금액 확인 없이 기록만, outHint, onUsage(e),
//         mask: false → 가리기 끔, maskSession: 대화 내내 같은 표시를 쓰기 위한 세션, onPrivacy(info) }
// 민감한 단어는 보내기 직전에 [회사1] 등으로 바꾸고, 답은 원래 단어로 되돌려 돌려줍니다.
// 보내기 전에 예상 토큰·금액을 보여 주고(설정에 따라), 답을 받으면 실제 사용 토큰으로 기록합니다.
const MASK_NOTE = '[안내] 개인정보 보호를 위해 일부 단어가 [회사1], [사람2], [금액1]처럼 대괄호 표시로 바뀌어 있습니다. 표시를 추측해 풀지 말고, 답에서도 같은 표시를 그대로 쓰세요.';
const withNote = p => p.info.total ? [{ role: 'system', content: MASK_NOTE }, ...p.messages] : p.messages;
export async function chat(messages, model, opts = {}) {
  if (!navigator.onLine) throw new Error('인터넷에 연결되어 있지 않습니다.');
  const priv = opts.mask === false ? null : privacy.prepare(messages, opts.maskSession);
  if (model) {
    const done = await guardChat({ provider: 'openai', model, kind: opts.kind || 'vision', messages: priv ? priv.messages : messages, privacy: priv, ask: opts.ask, outHint: opts.outHint });
    const r = await call('chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages: priv ? withNote(priv) : messages }) });
    opts.onUsage?.(done({ inTok: r.usage?.prompt_tokens, outTok: r.usage?.completion_tokens }));
    if (priv) opts.onPrivacy?.(priv.info);
    const out = r.choices?.[0]?.message?.content || '';
    return priv ? priv.unmask(out) : out;
  }
  const { provider, model: m } = currentAi();
  const key = await keyFor(provider);
  const done = await guardChat({ provider, model: m, kind: opts.kind || 'chat', messages: priv ? priv.messages : messages, privacy: priv, trainRisk: privacy.trainRisk(provider), ask: opts.ask, outHint: opts.outHint });
  messages = priv ? withNote(priv) : messages;   // 확인 창에서 더 가린 내용까지 반영된 최종본
  const finish = (u, text) => { opts.onUsage?.(done(u)); if (priv) opts.onPrivacy?.(priv.info); return priv ? priv.unmask(text) : text; };
  const textOf = c => typeof c === 'string' ? c : (c || []).filter(x => x.type === 'text').map(x => x.text).join('\n');
  if (provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify({ model: m, messages }) });
    if (!res.ok) throw new Error(await failMsg(res, 'OpenAI'));
    const j = await res.json();
    return finish({ inTok: j.usage?.prompt_tokens, outTok: j.usage?.completion_tokens }, j.choices?.[0]?.message?.content || '');
  }
  const system = messages.filter(x => x.role === 'system').map(x => textOf(x.content)).join('\n\n');
  const turns = messages.filter(x => x.role !== 'system');
  if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: m, max_tokens: 8000, ...(system ? { system } : {}), messages: turns.map(x => ({ role: x.role === 'assistant' ? 'assistant' : 'user', content: textOf(x.content) })) }) });
    if (!res.ok) throw new Error(await failMsg(res, 'Claude'));
    const j = await res.json(), u = j.usage || {};
    return finish({ inTok: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), outTok: u.output_tokens }, (j.content || []).filter(b => b.type === 'text').map(b => b.text).join(''));
  }
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}), contents: turns.map(x => ({ role: x.role === 'assistant' ? 'model' : 'user', parts: [{ text: textOf(x.content) }] })) }) });
  if (!res.ok) throw new Error(await failMsg(res, 'Gemini'));
  const j = await res.json(), u = j.usageMetadata || {};
  return finish({ inTok: u.promptTokenCount, outTok: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0) }, (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join(''));
}

export async function transcribe(blob, { seconds, ask } = {}) {
  if (blob.size > 25 * 1024 * 1024) throw new Error('녹음 파일이 25MB를 넘어 한 번에 변환할 수 없습니다. 녹음을 나눠서 해 주세요.');
  const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : blob.type.includes('wav') ? 'wav' : 'webm';
  const form = new FormData();
  form.append('file', blob, 'meeting.' + ext);
  const tm = prefs().transcribeModel || 'gpt-4o-mini-transcribe';
  form.append('model', tm);
  const done = await guardTranscribe({ model: tm, seconds: seconds || Math.max(30, blob.size / 16000), ask });
  form.append('language', 'ko');
  const r = await call('audio/transcriptions', { method: 'POST', body: form });
  const u = r.usage && r.usage.type === 'tokens' ? { inTok: r.usage.input_tokens, outTok: r.usage.output_tokens } : null;
  done(u);
  return r.text || '';
}

// Picture understanding for 사진·동영상: a short Korean description + tags as JSON.
export async function describeImage(dataUrl, hint = '', opts = {}) {
  const out = await chat([
    { role: 'system', content: '사진을 보고 한국어로 검색용 정보를 만듭니다. 반드시 JSON 하나만 출력: {"desc":"한두 문장 설명","tags":["장소/사물/사람수/행동/계절/색 등 짧은 낱말 5~12개"]}. 사람의 신원(이름)은 추측하지 마세요.' },
    { role: 'user', content: [{ type: 'text', text: '이 사진을 설명해 주세요.' + (hint ? ' 참고: ' + hint : '') }, { type: 'image_url', image_url: { url: dataUrl, detail: 'low' } }] }
  ], visionModel(), { kind: 'vision', ask: false, ...opts });
  const j = JSON.parse(out.replace(/^```(?:json)?\s*|\s*```$/g, '').trim());
  return { desc: String(j.desc || '').slice(0, 300), tags: (j.tags || []).map(t => String(t).slice(0, 20)).slice(0, 15) };
}

export const visionModel = () => prefs().visionModel || (currentAi().provider === 'openai' ? currentAi().model : 'gpt-5.6-luna');

// Small text embeddings (256 numbers) for meaning-based search. 1회 0.001원 미만이라 묻지 않고 기록만 합니다.
export async function embed(texts) {
  const done = await guardChat({ provider: 'openai', model: 'text-embedding-3-small', kind: 'embed', messages: texts.map(t => ({ role: 'user', content: t })), ask: false, outHint: 0 });
  const r = await call('embeddings', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: texts, dimensions: 256 }) });
  done({ inTok: r.usage?.prompt_tokens, outTok: 0 });
  return r.data.map(d => d.embedding);
}

// ---------- 기록 찾아보기 도구를 쓰는 대화 (AIDE) ----------
// AI가 답하는 중에 tools 중 필요한 것을 부르면 run(name, args)로 MY AIDE에서 찾아 돌려주고, 최종 답이 나올 때까지 반복합니다.
// 사진(image_url)도 세 회사 형식에 맞춰 보냅니다. 가리기 규칙은 보내는 글·도구 결과 모두에 적용되고, 답은 원래 단어로 되돌립니다.
const dataUrlParts = u => { const m = /^data:([^;]+);base64,(.*)$/.exec(u || ''); return m ? { mime: m[1], data: m[2] } : null; };
function toAnthropic(content) {
  if (typeof content === 'string') return content;
  return content.map(c => c.type === 'text' ? { type: 'text', text: c.text } : (() => { const p = dataUrlParts(c.image_url?.url); return p ? { type: 'image', source: { type: 'base64', media_type: p.mime, data: p.data } } : { type: 'text', text: '[사진]' }; })());
}
function toGemini(content) {
  if (typeof content === 'string') return [{ text: content }];
  return content.map(c => c.type === 'text' ? { text: c.text } : (() => { const p = dataUrlParts(c.image_url?.url); return p ? { inline_data: { mime_type: p.mime, data: p.data } } : { text: '[사진]' }; })());
}
const upperTypes = s => JSON.parse(JSON.stringify(s), (k, v) => k === 'type' && typeof v === 'string' ? v.toUpperCase() : v);

export async function chatTools(messages, tools, run, opts = {}) {
  if (!navigator.onLine) throw new Error('인터넷에 연결되어 있지 않습니다.');
  const priv = opts.mask === false ? null : privacy.prepare(messages, opts.maskSession);
  const { provider, model } = currentAi();
  const key = await keyFor(provider);
  const maskOut = s => priv ? privacy.maskText(s, priv.session) : s;
  const unmaskArgs = o => { if (!priv) return o; try { return JSON.parse(privacy.unmaskText(JSON.stringify(o), priv.session)); } catch { return o; } };
  const sum = { provider, model, kind: opts.kind || 'chat', inTok: 0, outTok: 0, usd: 0, estimated: false, rounds: 0 };
  const calls = [];
  let pending = '';   // 다음 회차 예상 금액용
  const textOf = c => typeof c === 'string' ? c : (c || []).filter(x => x.type === 'text').map(x => x.text).join('\n');
  const doTool = async (name, rawArgs) => {
    const args = unmaskArgs(rawArgs || {});
    let result;
    try { result = await run(name, args); } catch (e) { result = { error: e.message }; }
    calls.push({ name, args });
    opts.onTool?.(name, args);
    const out = maskOut(JSON.stringify(result)).slice(0, 30000);
    pending += out;
    return out;
  };
  const guard = async (round, msgsForEstimate) => {
    const done = await guardChat({ provider, model, kind: sum.kind, messages: msgsForEstimate, privacy: round === 0 ? priv : null, trainRisk: round === 0 && privacy.trainRisk(provider),
      ask: round === 0 ? opts.ask : false, outHint: round === 0 ? undefined : 400, note: round === 0 && tools.length ? '필요하면 AI가 MY AIDE 기록을 찾아 읽느라 몇 번 더 주고받아서, 실제 금액은 이보다 2~4배 늘 수 있습니다.' : undefined });
    return u => { const e = done(u); sum.inTok += e.inTok; sum.outTok += e.outTok; sum.usd += e.usd; sum.estimated ||= e.estimated; sum.rounds++; };
  };
  const finish = text => { opts.onUsage?.({ ...sum }); if (priv) opts.onPrivacy?.(priv.info); opts.onCalls?.(calls); return priv ? priv.unmask(text) : text; };
  const MAX = 8;
  const rec0 = await guard(0, priv ? priv.messages : messages);   // 확인 창(더 가리기 포함)을 먼저 거친 뒤 보낼 내용을 만듦
  const nextRec = round => round === 0 ? rec0 : guard(round, [{ role: 'user', content: pending }]);
  let msgs = priv ? withNote(priv) : messages;
  const system = msgs.filter(x => x.role === 'system').map(x => textOf(x.content)).join('\n\n');
  const turns = msgs.filter(x => x.role !== 'system');

  if (provider === 'openai') {
    const native = msgs.slice();
    let noEffort = false;
    for (let round = 0; round < MAX; round++) {
      const rec = await nextRec(round); pending = '';
      // gpt-5.x 등 추론 모델은 chat/completions에서 도구를 쓸 때 reasoning_effort를 'none'으로 해야 함 (OpenAI 제한)
      const useTools = tools.length && round < MAX - 1;
      const payload = { model, messages: native, ...(useTools ? { tools: tools.map(t => ({ type: 'function', function: t })) } : {}) };
      if (useTools && !noEffort && /^(gpt-5|o\d)/.test(model)) payload.reasoning_effort = 'none';
      let res = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify(payload) });
      if (res.status === 400 && payload.reasoning_effort) {
        const txt = await res.clone().text();
        if (/reasoning_effort|reasoning\.effort|Unsupported value/i.test(txt)) {   // 이 모델은 'none'을 모름 → 빼고 다시
          noEffort = true; delete payload.reasoning_effort;
          res = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify(payload) });
        }
      }
      if (!res.ok) throw new Error(await failMsg(res, 'OpenAI'));
      const j = await res.json(); rec({ inTok: j.usage?.prompt_tokens, outTok: j.usage?.completion_tokens });
      const msg = j.choices?.[0]?.message || {};
      if (!msg.tool_calls?.length) return finish(msg.content || '');
      native.push(msg);
      for (const tc of msg.tool_calls) {
        let a = {}; try { a = JSON.parse(tc.function.arguments || '{}'); } catch { }
        native.push({ role: 'tool', tool_call_id: tc.id, content: await doTool(tc.function.name, a) });
      }
    }
  } else if (provider === 'anthropic') {
    const native = turns.map(x => ({ role: x.role === 'assistant' ? 'assistant' : 'user', content: toAnthropic(x.content) }));
    for (let round = 0; round < MAX; round++) {
      const rec = await nextRec(round); pending = '';
      const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model, max_tokens: 8000, ...(system ? { system } : {}), messages: native, ...(tools.length && round < MAX - 1 ? { tools: tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters })) } : {}) }) });
      if (!res.ok) throw new Error(await failMsg(res, 'Claude'));
      const j = await res.json(), u = j.usage || {};
      rec({ inTok: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), outTok: u.output_tokens });
      const uses = (j.content || []).filter(b => b.type === 'tool_use');
      if (!uses.length) return finish((j.content || []).filter(b => b.type === 'text').map(b => b.text).join(''));
      native.push({ role: 'assistant', content: j.content });
      const results = [];
      for (const b of uses) results.push({ type: 'tool_result', tool_use_id: b.id, content: await doTool(b.name, b.input) });
      native.push({ role: 'user', content: results });
    }
  } else {
    const contents = turns.map(x => ({ role: x.role === 'assistant' ? 'model' : 'user', parts: toGemini(x.content) }));
    for (let round = 0; round < MAX; round++) {
      const rec = await nextRec(round); pending = '';
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}), contents,
          ...(tools.length && round < MAX - 1 ? { tools: [{ functionDeclarations: tools.map(t => ({ name: t.name, description: t.description, parameters: upperTypes(t.parameters) })) }] } : {}) }) });
      if (!res.ok) throw new Error(await failMsg(res, 'Gemini'));
      const j = await res.json(), u = j.usageMetadata || {};
      rec({ inTok: u.promptTokenCount, outTok: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0) });
      const cand = j.candidates?.[0]?.content || { role: 'model', parts: [] };
      const fcs = (cand.parts || []).filter(p => p.functionCall);
      if (!fcs.length) return finish((cand.parts || []).map(p => p.text || '').join(''));
      contents.push({ role: 'model', parts: cand.parts });
      const parts = [];
      for (const p of fcs) parts.push({ functionResponse: { name: p.functionCall.name, response: { result: await doTool(p.functionCall.name, p.functionCall.args) } } });
      contents.push({ role: 'user', parts });
    }
  }
  return finish('기록을 찾다가 너무 길어져서 멈췄습니다. 질문을 조금 좁혀서 다시 물어봐 주세요.');
}
