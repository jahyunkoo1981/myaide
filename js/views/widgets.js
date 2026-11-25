// 바탕화면 위젯 settings: pick menus to float on the Windows desktop as small windows.
import { h, icon, toast } from '../util.js';
import { native } from '../native.js';
import { TABS, FIXED } from '../prefs.js';

const WCOLORS = [['', '기본'], ['#EEF0FD', '라벤더'], ['#E6F5EF', '민트'], ['#FDF3E7', '피치'], ['#FBEEF1', '로즈'], ['#E8F4FA', '하늘'], ['#FFF7DA', '레몬'], ['#F3F4F9', '그레이']];
// Every menu can float on the desktop (this settings page itself excluded).
const SKIP = new Set(['widgets']);

export async function mount(root) {
  const head = h('div', { class: 'view-head' }, h('h1', null, '바탕화면 위젯'));
  if (!native.available) {
    root.append(head, h('div', { class: 'pad' }, h('div', { class: 'empty' }, h('b', null, 'Windows 앱에서 쓰는 기능입니다'),
      'MY AIDE.exe에서 원하는 메뉴를 바탕화면에 작은 창으로 띄워 둘 수 있습니다. 휴대폰·태블릿에서는 홈 화면에 MY AIDE를 추가해 쓰세요.')));
    return;
  }
  let st = await native.call('widget.state');
  const listBox = h('div', { class: 'widget-list' });
  const draw = () => {
    const open = new Set(st.open || []);
    listBox.replaceChildren(...TABS.concat(FIXED).filter(t => !SKIP.has(t.key)).map(t => {
      const on = open.has(t.key);
      return h('div', { class: 'widget-row nav-' + t.group },
        h('span', { class: 'ic' }, icon(t.icon)),
        h('div', null, h('b', null, t.label), h('div', { class: 'hint', style: { margin: 0 } }, on ? '바탕화면에 떠 있습니다' : '꺼짐'),
          h('div', { class: 'wcolors', role: 'group', 'aria-label': t.label + ' 위젯 색' }, WCOLORS.map(([c, name]) => {
            const cur = (st.colors || {})[t.key] || '';
            return h('button', { type: 'button', class: 'wcolor', title: name, 'aria-pressed': String(cur === c), style: { background: c || '#FBFBFE' }, onclick: () => call('widget.color', { key: t.key, color: c || null }) });
          }))),
        h('div', { class: 'row' },
          on ? h('button', { class: 'btn small', onclick: () => call('widget.focus', { key: t.key }) }, '앞으로') : null,
          h('button', { class: 'btn small ' + (on ? 'ghost' : 'primary'), onclick: () => call(on ? 'widget.close' : 'widget.open', { key: t.key, title: t.label }) }, on ? '끄기' : '띄우기')));
    }));
  };
  const call = async (m, a) => { try { st = await native.call(m, a); draw(); syncControls(); } catch (e) { toast(e.message, 'err'); } };
  const top = h('input', { type: 'checkbox', onchange: e => call('widget.settings', { topMost: e.target.checked }) });
  const auto = h('input', { type: 'checkbox', onchange: e => call('widget.settings', { reopen: e.target.checked }) });
  const opVal = h('span', { class: 'muted' });
  const op = h('input', { type: 'range', min: 40, max: 100, step: 5, style: { width: '200px' },
    oninput: e => { opVal.textContent = e.target.value + '%'; }, onchange: e => call('widget.settings', { opacity: Number(e.target.value) / 100 }) });
  const syncControls = () => { top.checked = !!st.topMost; auto.checked = st.reopen !== false; op.value = Math.round((st.opacity || 1) * 100); opVal.textContent = op.value + '%'; };
  syncControls(); draw();
  native.on('widgets', d => { st = d; draw(); syncControls(); });

  root.append(head, h('div', { class: 'pad settings' },
    h('section', null, h('h2', null, '위젯으로 띄울 메뉴'), h('p', { class: 'hint', style: { margin: 0 } }, '띄운 창은 끌어서 옮기고 가장자리를 끌어 크기를 바꿉니다. 위치와 크기는 기억됩니다. MY AIDE에 로그인되어 있을 때 내용이 보입니다.'), listBox),
    h('section', null, h('h2', null, '위젯 설정'),
      h('label', { class: 'check' }, top, '항상 다른 창 위에 표시'),
      h('label', { class: 'check' }, auto, 'MY AIDE를 켜면 띄워 둔 위젯도 다시 열기'),
      h('label', { class: 'row' }, '투명도', op, opVal),
      h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => call('widget.closeAll') }, '위젯 모두 끄기'),
        h('button', { class: 'btn small', title: '화면 밖으로 나간 위젯을 주 모니터 오른쪽 위로 모읍니다', onclick: async () => { await call('widget.resetPositions'); toast('위젯 위치를 처음 자리로 되돌렸습니다'); } }, '위치 초기화')))));
}
