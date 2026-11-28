import { h, uid, today, ymd, WEEK, debounce, confirmBox, toast, download, fmtTime, listItem } from '../util.js';
import * as db from '../db.js';
import * as sync from '../sync.js';
import { chat, transcribe } from '../openai.js';
import * as safe from '../recorder.js';

const SUMMARY_PROMPT = `다음은 회의 녹취록입니다. 한국어로 업무용 회의록을 작성하세요.
형식:
## 요약 (3~5줄)
## 결정 사항
## 할 일 (담당자 · 기한이 언급되면 함께)
## 확인 필요
녹취록에 없는 내용은 만들지 마세요.`;

export async function mount(root, ctx) {
  let items = [], openId = null, current = null, dirty = false;
  let rec = null;
  const list = h('div', { class: 'list' });
  // Month calendar: days with meetings are tinted and show how many; pick a day to filter the list.
  let calMonth = today().slice(0, 7), dayFilter = null;
  const cal = h('div', { class: 'mcal' });
  const drawCal = () => {
    const [y, m] = calMonth.split('-').map(Number);
    const first = new Date(y, m - 1, 1), start = new Date(first); start.setDate(1 - first.getDay());
    const counts = new Map(); items.forEach(i => { if (i.date) counts.set(i.date, (counts.get(i.date) || 0) + 1); });
    const shift = d => { const t = new Date(y, m - 1 + d, 1); calMonth = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`; drawCal(); };
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const key = ymd(d), n = counts.get(key) || 0;
      if (i >= 35 && d.getMonth() !== m - 1) break;
      cells.push(h('button', { type: 'button', class: 'd' + (d.getMonth() !== m - 1 ? ' out' : '') + (n ? ' has' : '') + (key === today() ? ' today' : '') + (key === dayFilter ? ' sel' : ''),
        title: n ? `${key} 회의 ${n}건` : key, onclick: () => { dayFilter = dayFilter === key ? null : key; drawCal(); drawList(); } }, d.getDate(), n ? h('b', null, n) : null));
    }
    const monthCount = items.filter(i => (i.date || '').startsWith(calMonth)).length;
    cal.replaceChildren(
      h('div', { class: 'mh' }, h('button', { class: 'btn small ghost icon-btn', onclick: () => shift(-1), 'aria-label': '이전 달' }, '‹'), `${y}년 ${m}월`, h('button', { class: 'btn small ghost icon-btn', onclick: () => shift(1), 'aria-label': '다음 달' }, '›')),
      h('div', { class: 'grid' }, ...WEEK.map(w => h('div', { class: 'w' }, w)), ...cells),
      h('div', { class: 'foot' }, h('span', null, `이번 달 회의 ${monthCount}건`), dayFilter ? h('button', { class: 'btn small ghost', style: { minHeight: '22px', padding: '0 6px' }, onclick: () => { dayFilter = null; drawCal(); drawList(); } }, dayFilter.slice(5) + ' 보기 해제') : h('span', null, '날짜를 누르면 그날만')));
  };
  const pane = h('section', { class: 'editor-pane' });
  const split = h('div', { class: 'split' },
    h('aside', { class: 'list-pane' },
      h('div', { class: 'list-tools' }, h('div', { class: 'row' }, h('strong', { class: 'grow', style: { fontSize: '17px' } }, '회의록'),
        h('button', { class: 'btn small primary', onclick: create }, '+ 새 회의록'))),
      cal, list),
    pane);
  root.append(split);

  const load = async () => { items = (await db.all('meetings')).sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.updatedAt - a.updatedAt); };
  const drawList = () => { drawCal(); const shown = dayFilter ? items.filter(m => m.date === dayFilter) : items; list.replaceChildren(...(shown.length ? shown.map(m => listItem({ selected: m.id === openId, onOpen: () => ctx.go('meetings', m.id), onDelete: () => removeMeeting(m),
    date: m.date || '', title: m.title || '제목 없는 회의', sub: (m.summary || m.transcript || '').slice(0, 60) }))
    : [h('div', { class: 'list-empty' }, dayFilter ? '이 날은 회의록이 없습니다.' : '회의를 녹음하면 녹취록과 요약을 만들 수 있습니다.')])); };

  async function removeMeeting(m) {
    if (!await confirmBox(`‘${m.title || '제목 없는 회의'}’ 회의록을 삭제할까요? 녹음 파일도 목록에서 사라집니다.`, '삭제', true)) return;
    if (m.id === openId) { save.cancel(); dirty = false; }
    await db.remove('meetings', m.id); toast('삭제했습니다');
    items = items.filter(x => x.id !== m.id);
    if (m.id === openId) ctx.go('meetings'); else drawList();
  }

  async function create() {
    const id = uid();
    await db.put('meetings', id, { title: '', date: dayFilter || today(), transcript: '', summary: '', audio: [] });
    ctx.go('meetings', id);
  }

  const state = h('span', { class: 'save-state' });
  const save = debounce(async () => {
    if (!dirty || !openId) return; dirty = false;
    const { id, updatedAt, ...d } = current; await db.put('meetings', openId, d); state.textContent = '저장됨';
  }, 700);
  const touch = () => { dirty = true; state.textContent = '저장 중…'; save(); };

  async function open(id) {
    save.flush();
    openId = id; split.classList.toggle('has-open', !!id);
    if (!id) { pane.replaceChildren(h('div', { class: 'pad empty' }, h('b', null, '회의록'), '새 회의록을 만들고 녹음을 시작하세요. iPhone·iPad 마이크도 쓸 수 있습니다.')); drawList(); return; }
    const data = await db.get('meetings', id);
    if (!data) { pane.replaceChildren(h('div', { class: 'pad empty' }, h('b', null, '찾을 수 없습니다'))); return; }
    current = { audio: [], ...data };
    if (current.date) calMonth = current.date.slice(0, 7);
    const title = h('input', { class: 'doc-title', value: current.title, placeholder: '회의 제목', oninput: e => { current.title = e.target.value; touch(); } });
    const date = h('input', { type: 'date', value: current.date, onchange: e => { current.date = e.target.value; touch(); } });
    const transcript = h('textarea', { rows: 10, placeholder: '녹취록 — 직접 적거나 ‘녹취록 만들기’로 채웁니다.', oninput: e => { current.transcript = e.target.value; touch(); } }, current.transcript || '');
    const summary = h('textarea', { rows: 10, placeholder: '업무 요약 — 직접 적거나 ‘AI 요약’으로 채웁니다.', oninput: e => { current.summary = e.target.value; touch(); } }, current.summary || '');
    const audioBox = h('div');
    const recBtn = h('button', { class: 'btn primary', onclick: () => rec ? stopRec() : startRec() }, '● 녹음 시작');
    const recInfo = h('span', { class: 'muted' });
    // 녹음 파일 가져오기: 아이폰 통화 녹음(메모 앱에서 공유·저장), 삼성 통화 녹음, 음성 메모 등
    const audioIn = h('input', { type: 'file', accept: 'audio/*,.m4a,.mp3,.wav,.aac,.amr,.3gp,.webm,.ogg,.caf', multiple: true, hidden: true, onchange: async () => {
      const files = [...audioIn.files]; audioIn.value = '';
      for (const f of files) {
        const duration = await new Promise(res => { const a = new Audio(); a.preload = 'metadata'; a.onloadedmetadata = () => res(isFinite(a.duration) ? Math.round(a.duration) : 0); a.onerror = () => res(0); a.src = URL.createObjectURL(f); setTimeout(() => res(0), 4000); });
        const blobId = 'audio-' + uid();
        await db.putBlob(blobId, f, { name: f.name });
        current.audio.push({ blobId, duration, mime: f.type || 'audio/mp4', at: f.lastModified || Date.now(), name: f.name });
      }
      if (files.length) { if (!current.title) { current.title = files[0].name.replace(/\.[^.]+$/, ''); title.value = current.title; } touch(); save.flush(); drawAudio(); toast(`${files.length}개 파일을 넣었습니다 — ‘녹취록 만들기’로 글자로 바꿀 수 있습니다`); }
    } });
    const importBtn = h('button', { class: 'btn', title: '통화 녹음·음성 메모 파일을 회의록에 넣습니다', onclick: () => audioIn.click() }, '녹음 파일 가져오기');
    const busy = h('span', { class: 'muted' });

    const drawAudio = () => audioBox.replaceChildren(...(current.audio.length ? current.audio.map((a, i) => {
      const player = h('audio', { controls: true, preload: 'none', style: { width: '100%', maxWidth: '420px' } });
      const loadBtn = h('button', { class: 'btn small', onclick: async () => {
        try { loadBtn.textContent = '불러오는 중…'; const b = await sync.getBlob(a.blobId); player.src = URL.createObjectURL(b); player.play(); loadBtn.remove(); }
        catch (e) { loadBtn.textContent = '재생'; toast(e.message, 'err'); }
      } }, '재생');
      return h('div', { class: 'file-row' }, h('div', null, h('div', null, `${a.name ? a.name : '녹음 ' + (i + 1)}${a.duration ? ' · ' + fmtDur(a.duration) : ''}${a.recovered ? ' · 복구됨' : ''}`), h('div', { class: 'p' }, fmtTime(a.at)), player),
        h('div', { class: 'row' }, loadBtn,
          h('button', { class: 'btn small', onclick: async () => { const b = await sync.getBlob(a.blobId); download(`${current.title || '회의'} ${i + 1}.${b.type.includes('mp4') ? 'm4a' : 'webm'}`, b); } }, '저장'),
          h('button', { class: 'btn small', onclick: () => runTranscribe(a) }, '녹취록 만들기'),
          h('button', { class: 'btn small ghost danger', onclick: async () => { if (await confirmBox('이 녹음을 회의록에서 뺄까요?', '빼기', true)) { current.audio.splice(i, 1); touch(); save.flush(); drawAudio(); } } }, '빼기')));
    }) : [h('p', { class: 'muted' }, '녹음이 없습니다.')]));

    async function startRec() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
        const mr = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 32000 } : undefined);
        const chunks = [];
        const live = await safe.begin(openId, mr.mimeType || type);   // safety copy on this device, every 3 s
        let pending = Promise.resolve();
        mr.ondataavailable = e => { if (e.data.size) { chunks.push(e.data); pending = pending.then(() => safe.keep(live, e.data)).catch(() => {}); } };
        rec = { mr, stream, chunks, live, flushed: () => pending, start: Date.now(), timer: setInterval(() => { recInfo.replaceChildren(h('span', { class: 'rec-dot' }), ' 녹음 중 ' + fmtDur((Date.now() - rec.start) / 1000), h('span', { class: 'rec-safe' }, ' · 자동 저장 중')); }, 500) };
        mr.start(3000);
        recBtn.textContent = '■ 녹음 끝내고 저장';
      } catch (e) { toast('마이크를 쓸 수 없습니다: ' + (e.name === 'NotAllowedError' ? '마이크 권한을 허용해 주세요.' : e.message), 'err'); }
    }
    async function stopRec() {
      const r = rec; rec = null;
      clearInterval(r.timer);
      await new Promise(res => { r.mr.onstop = res; r.mr.stop(); });
      r.stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(r.chunks, { type: r.mr.mimeType || 'audio/webm' });
      const blobId = 'audio-' + uid();
      await db.putBlob(blobId, blob, { name: `${current.title || '회의'} ${today()}.${blob.type.includes('mp4') ? 'm4a' : 'webm'}` });
      current.audio.push({ blobId, duration: Math.round((Date.now() - r.start) / 1000), mime: blob.type, at: Date.now() });
      touch(); save.flush();
      await r.flushed(); await safe.finish(r.live);
      recBtn.textContent = '● 녹음 시작'; recInfo.textContent = '';
      drawAudio(); toast('녹음을 저장했습니다');
    }
    async function runTranscribe(a) {
      busy.textContent = '녹취록을 만드는 중… (몇 분 걸릴 수 있습니다)';
      try {
        const text = await transcribe(await sync.getBlob(a.blobId), { seconds: a.duration });
        current.transcript = (current.transcript ? current.transcript + '\n\n' : '') + text;
        transcript.value = current.transcript; touch(); busy.textContent = '녹취록을 넣었습니다.';
      } catch (e) { busy.textContent = ''; toast(e.message, e.cancelled ? undefined : 'err'); }
    }
    async function runSummary() {
      if (!current.transcript.trim()) return toast('요약할 녹취록이 없습니다.', 'err');
      busy.textContent = '요약하는 중…';
      try {
        current.summary = await chat([{ role: 'system', content: SUMMARY_PROMPT }, { role: 'user', content: `회의 제목: ${current.title}\n날짜: ${current.date}\n\n${current.transcript}` }], null, { kind: 'summary' });
        summary.value = current.summary; touch(); busy.textContent = '요약을 넣었습니다.';
      } catch (e) { busy.textContent = ''; toast(e.message, e.cancelled ? undefined : 'err'); }
    }

    pane.replaceChildren(h('div', { class: 'doc-body' }, h('div', { class: 'pad', style: { display: 'grid', gap: '16px', maxWidth: '900px' } },
      h('div', { class: 'doc-meta' }, h('button', { class: 'btn small ghost back-btn', onclick: () => ctx.go('meetings') }, '‹ 목록'), date, state, h('span', { class: 'grow' }),
        h('button', { class: 'btn small ghost danger', onclick: async () => {
          if (!await confirmBox('이 회의록을 삭제할까요? 녹음 파일도 목록에서 사라집니다.', '삭제', true)) return;
          save.cancel(); dirty = false; await db.remove('meetings', openId); ctx.go('meetings');
        } }, '삭제')),
      title,
      h('div', { class: 'row' }, recBtn, importBtn, audioIn, recInfo),
      h('section', null, h('h3', { style: { margin: '0 0 6px' } }, '녹음'), audioBox),
      h('section', null, h('div', { class: 'row', style: { marginBottom: '6px' } }, h('h3', { style: { margin: 0 }, class: 'grow' }, '녹취록')), transcript),
      h('section', null, h('div', { class: 'row', style: { marginBottom: '6px' } }, h('h3', { style: { margin: 0 }, class: 'grow' }, '업무 요약'),
        h('button', { class: 'btn small', onclick: runSummary }, 'AI 요약')), summary),
      busy)));
    drawAudio(); drawList();
    if (!current.title) title.focus();
  }

  const onChange = async e => { if (e.detail.col === 'meetings') { await load(); drawList(); } };
  db.events.addEventListener('change', onChange);
  window.addEventListener('pagehide', save.flush);
  await load();
  await open(ctx.param);
  return { open, cleanup: () => { save.flush(); if (rec) { const r = rec; rec = null; clearInterval(r.timer); r.mr.onstop = () => r.flushed().then(() => { safe.release(); return safe.recoverPending({ force: true }); }).then(sec => { if (sec) toast(`녹음 ${fmtDur(sec)}을(를) 회의록에 저장했습니다`); }); try { r.mr.stop(); } catch { } r.stream.getTracks().forEach(t => t.stop()); } db.events.removeEventListener('change', onChange); window.removeEventListener('pagehide', save.flush); } };
}

const fmtDur = s => { s = Math.round(s || 0); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
