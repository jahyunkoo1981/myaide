// 폰 메뉴 고르기 (기준정보): 폰에서는 여기서 고른 메뉴만, 고른 순서대로 홈 타일·아래 막대·전체 메뉴에 나옵니다.
import { h, icon, toast } from '../util.js';
import { TABS, prefs, save as savePrefs } from '../prefs.js';

export function phoneMenuEditor(onSaved) {
  let order = [...(prefs().phoneTabs || [])].filter(k => TABS.some(t => t.key === k));
  const rest = () => TABS.filter(t => !order.includes(t.key));
  const box = h('div', { class: 'pm' });
  const draw = () => box.replaceChildren(
    h('div', { class: 'pm-sec' }, '폰에 보일 메뉴 (위에서부터 홈 화면 순서)'),
    ...(order.length ? order.map((k, i) => { const t = TABS.find(x => x.key === k); return h('div', { class: 'pm-row on' },
      h('span', { class: 'pm-ico' }, icon(t.icon)), h('b', { class: 'grow' }, t.label),
      h('button', { type: 'button', class: 'pm-btn', 'aria-label': t.label + ' 위로', disabled: i === 0, onclick: () => { [order[i - 1], order[i]] = [order[i], order[i - 1]]; draw(); } }, '▲'),
      h('button', { type: 'button', class: 'pm-btn', 'aria-label': t.label + ' 아래로', disabled: i === order.length - 1, onclick: () => { [order[i + 1], order[i]] = [order[i], order[i + 1]]; draw(); } }, '▼'),
      h('button', { type: 'button', class: 'pm-btn out', 'aria-label': t.label + ' 빼기', onclick: () => { order.splice(i, 1); draw(); } }, '빼기')); })
      : [h('p', { class: 'hint' }, '하나 이상 골라 주세요.')]),
    rest().length ? h('div', { class: 'pm-sec' }, '폰에서 숨긴 메뉴') : null,
    ...rest().map(t => h('div', { class: 'pm-row' }, h('span', { class: 'pm-ico' }, icon(t.icon)), h('span', { class: 'grow' }, t.label),
      h('button', { type: 'button', class: 'pm-btn in', onclick: () => { order.push(t.key); draw(); } }, '+ 넣기'))));
  draw();
  const save = async () => {
    if (!order.length) { toast('메뉴를 하나 이상 골라 주세요.', 'err'); return false; }
    await savePrefs({ phoneTabs: order }); toast('폰 메뉴를 저장했습니다'); onSaved && onSaved(); return true;
  };
  return { el: box, save };
}
