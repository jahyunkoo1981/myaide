import { h, today, fmtTime, toast, download, confirmBox } from '../util.js';
import * as db from '../db.js';
import * as sync from '../sync.js';
import { prefs, save as savePrefs } from '../prefs.js';

async function snapshot() {
  const rows = (await db.rawAll()).filter(r => !r.deleted);
  return { app: 'MY AIDE', version: 2, createdAt: Date.now(), records: rows.map(r => ({ col: r.col, id: r.id, data: r.data, updatedAt: r.updatedAt })) };
}

// Saves a full JSON backup next to the data (Drive › MY AIDE › backups, or the local data folder) and trims old ones.
export async function snapshotToStore(auto = false) {
  const b = sync.state.backend;
  if (!b) throw new Error('저장소가 연결되지 않았습니다.');
  if (!b.folders && b.init) await b.init();
  const snap = await snapshot();
  const blob = new Blob([JSON.stringify(snap)], { type: 'application/json' });
  await b.saveBackup(`MY AIDE 백업 ${fmtTime(Date.now()).replace(/[: ]/g, '-')}${auto ? ' (자동)' : ''}.json`, blob);
  await db.kvSet('backup.last', Date.now());
  const keep = prefs().keepBackups || 30;
  const list = await b.listBackups();
  for (const old of list.slice(keep)) await b.deleteFile(old.fileId).catch(() => {});
  return snap.records.length;
}

async function restore(json) {
  const snap = JSON.parse(json);
  if (snap.app !== 'MY AIDE' || !Array.isArray(snap.records)) throw new Error('MY AIDE 백업 파일이 아닙니다.');
  for (const r of snap.records) await db.put(r.col, r.id, r.data);
  return snap.records.length;
}

export async function mount(root) {
  const body = h('div', { class: 'pad settings' });
  root.append(h('div', { class: 'view-head' }, h('h1', null, '백업')), body);

  const draw = async () => {
    const b = sync.state.backend;
    const last = await db.kvGet('backup.last', 0);
    const days = h('select', { style: { width: 'auto' }, onchange: e => savePrefs({ autoBackupDays: Number(e.target.value) }) },
      [[0, '끄기'], [1, '매일'], [3, '3일마다'], [7, '매주']].map(([v, t]) => h('option', { value: v, selected: prefs().autoBackupDays === v }, t)));
    const keep = h('input', { type: 'number', min: 1, max: 365, value: prefs().keepBackups, style: { width: '90px' }, onchange: e => savePrefs({ keepBackups: Math.max(1, Number(e.target.value) || 30) }) });
    const listBox = h('div', null, h('p', { class: 'muted' }, '목록을 불러오는 중…'));
    body.replaceChildren(
      h('section', null, h('h2', null, '저장 위치'),
        h('p', { style: { margin: 0 } }, b ? b.describe() : '-'),
        h('p', { class: 'hint' }, b && b.kind === 'drive'
          ? '모든 기록은 입력하는 즉시 이 기기에 저장되고, 인터넷이 연결되면 Google Drive로 올라갑니다. 녹음 파일은 MY AIDE › files 폴더에 따로 저장됩니다.'
          : '이 PC의 데이터 폴더에만 저장됩니다. 다른 기기와 동기화하지 않습니다.'),
        h('p', { class: 'hint' }, '마지막 동기화 ' + (sync.state.lastSync ? fmtTime(sync.state.lastSync) : '-') + ' · 전송 대기 ' + sync.state.pending + '건')),
      h('section', null, h('h2', null, '전체 백업'),
        h('p', { class: 'hint', style: { margin: 0 } }, '모든 기록을 JSON 파일 하나로 저장합니다. 계정정보는 암호화된 그대로 들어갑니다.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', onclick: async e => { e.target.disabled = true; try { const n = await snapshotToStore(false); toast(`기록 ${n}건을 백업했습니다`); draw(); } catch (err) { toast(err.message, 'err'); } e.target.disabled = false; } }, '지금 백업'),
          h('button', { class: 'btn', onclick: async () => download(`MY AIDE 백업 ${today()}.json`, new Blob([JSON.stringify(await snapshot())], { type: 'application/json' })) }, '이 기기로 내려받기'),
          h('button', { class: 'btn', onclick: pickRestore }, '백업 파일로 복원')),
        h('div', { class: 'row' }, h('label', { class: 'row', style: { gap: '6px' } }, '자동 백업', days), h('label', { class: 'row', style: { gap: '6px' } }, '보관 개수', keep)),
        h('p', { class: 'hint' }, '자동 백업은 MY AIDE를 열 때 정한 주기가 지났으면 실행됩니다. 마지막 백업: ' + (last ? fmtTime(last) : '없음'))),
      h('section', null, h('h2', null, '저장된 백업'), listBox));
    try {
      if (!b.folders && b.init) await b.init();
      const list = await b.listBackups();
      listBox.replaceChildren(...(list.length ? list.map(f => h('div', { class: 'file-row' },
        h('div', null, h('div', null, f.name), h('div', { class: 'p' }, (f.time ? fmtTime(Date.parse(f.time)) : '') + (f.size ? ` · ${Math.round(f.size / 1024)} KB` : ''))),
        h('div', { class: 'row' },
          h('button', { class: 'btn small', onclick: async () => download(f.name, await b.readBackup(f.fileId)) }, '내려받기'),
          h('button', { class: 'btn small', onclick: async () => restoreFrom(await (await b.readBackup(f.fileId)).text()) }, '복원'))))
        : [h('p', { class: 'muted' }, '저장된 백업이 없습니다.')]));
    } catch (e) { listBox.replaceChildren(h('p', { class: 'muted' }, '백업 목록을 불러오지 못했습니다: ' + e.message)); }
  };

  async function restoreFrom(text) {
    if (!await confirmBox('백업 내용을 현재 기록 위에 덮어씁니다. 백업에 없는 최근 기록은 그대로 남습니다. 복원할까요?', '복원', true)) return;
    try { const n = await restore(text); toast(`기록 ${n}건을 복원했습니다`); } catch (e) { toast(e.message, 'err'); }
  }
  function pickRestore() {
    const input = h('input', { type: 'file', accept: '.json,application/json' });
    input.onchange = async () => { if (input.files[0]) restoreFrom(await input.files[0].text()); };
    input.click();
  }
  await draw();
}
