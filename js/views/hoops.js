// 농구: 아이 농구 일정·경기 결과·대회·대진표·기록지·사진·영상·기사, 카톡 대화방에서 일정 가져오기
import { h, uid, today, parseYmd, ymd, WEEK, pad2, dialog, confirmBox, toast, shrinkImage } from '../util.js';
import * as db from '../db.js';

const COL = 'hoops';
const KINDS = ['경기', '대회', '연습', '기타'];
const STATS = [['pts', '득점'], ['reb', '리바운드'], ['ast', '어시스트'], ['stl', '스틸'], ['blk', '블록'], ['three', '3점슛']];
const TABS = [['home', '요약'], ['games', '일정·경기'], ['tours', '대회'], ['stats', '기록'], ['docs', '대진표·기록지'], ['media', '사진·영상'], ['news', '기사'], ['kakao', '카톡 가져오기']];
const THEME = '농구';
const dayDiff = s => Math.round((parseYmd(s) - parseYmd(today())) / 864e5);
const dday = s => { const n = dayDiff(s); return n === 0 ? '오늘' : n > 0 ? `D-${n}` : `${-n}일 전`; };
const fmtDate = s => { const d = parseYmd(s); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]})`; };
const mapUrl = q => 'https://map.naver.com/p/search/' + encodeURIComponent(q);
const resultOf = g => g.us != null && g.them != null && g.us !== '' && g.them !== '' ? (+g.us > +g.them ? '승' : +g.us < +g.them ? '패' : '무') : '';

export async function mount(root, ctx) {
  let tab = (ctx.param && TABS.some(t => t[0] === ctx.param)) ? ctx.param : 'home';
  let all = [], cfg = {};
  const load = async () => {
    all = await db.all(COL);
    cfg = (await db.get('settings', 'hoops')) || {};
  };
  const games = () => all.filter(r => r.kind === 'game').sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
  const tours = () => all.filter(r => r.kind === 'tour').sort((a, b) => (b.start || '').localeCompare(a.start || ''));
  const docs = () => all.filter(r => r.kind === 'doc').sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const news = () => all.filter(r => r.kind === 'article').sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const notes = () => all.filter(r => r.kind === 'note').sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const tourName = id => (all.find(r => r.id === id) || {}).name || '';
  const saveCfg = async patch => { cfg = { ...cfg, ...patch }; const { id, updatedAt, ...c } = cfg; await db.put('settings', 'hoops', c); };

  const head = h('div', { class: 'hp-head' });
  const tabsBar = h('div', { class: 'hp-tabs', role: 'tablist' });
  const body = h('div', { class: 'hp-body' });
  const fab = h('button', { class: 'hp-fab', 'aria-label': '추가', onclick: () => addForTab() }, '+');
  root.append(h('div', { class: 'hp' }, head, tabsBar, body, fab));

  // ---------- 머리: 팀 카드 ----------
  const drawHead = () => {
    const who = [cfg.child, cfg.number ? `#${cfg.number}` : '', cfg.position].filter(Boolean).join(' ');
    head.replaceChildren(
      h('div', { class: 'hp-ball', 'aria-hidden': 'true' }),
      h('div', { class: 'hp-team' },
        h('div', { class: 'hp-team-name' }, cfg.team || '우리 팀'),
        h('div', { class: 'hp-team-sub' }, [who, cfg.division, cfg.region].filter(Boolean).join(' · ') || '팀·아이 정보를 넣어 주세요')),
      h('button', { class: 'btn small ghost hp-edit', onclick: editTeam }, '팀 정보'));
  };
  async function editTeam() {
    const f = {};
    const fld = (k, label, ph) => (f[k] = h('input', { type: 'text', value: cfg[k] || '', placeholder: ph || '' }), h('label', { class: 'field' }, label, f[k]));
    const ok = await dialog({ title: '팀·아이 정보', body: [
      fld('child', '아이 이름', '예: 구OO'), fld('team', '팀 이름', '예: 아산우리은행 U10'),
      h('div', { class: 'hp-row2' }, fld('number', '등번호', '예: 7'), fld('position', '포지션', '예: 가드')),
      h('div', { class: 'hp-row2' }, fld('division', '부/연령', '예: U10'), fld('region', '지역', '예: 아산')),
      fld('season', '시즌(연도)', String(new Date().getFullYear()))],
      actions: [{ label: '취소', value: false }, { label: '저장', kind: 'primary', value: true }] });
    if (!ok) return;
    await saveCfg(Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value.trim()])));
    drawHead(); draw();
  }

  const drawTabs = () => tabsBar.replaceChildren(...TABS.map(([k, label]) => h('button', { role: 'tab', class: 'hp-tab', 'aria-selected': String(tab === k), onclick: () => { tab = k; drawTabs(); draw(); tabsBar.querySelector('[aria-selected=true]')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); } }, label)));

  // ---------- 공통 카드 ----------
  const gameCard = g => {
    const r = resultOf(g), d = parseYmd(g.date);
    const st = g.stats && g.stats.pts !== undefined && g.stats.pts !== '' ? `${g.stats.pts}점` : '';
    return h('button', { class: 'hp-card hp-game k-' + (g.type || '경기') + (dayDiff(g.date) < 0 ? ' past' : ''), onclick: () => editGame(g) },
      h('span', { class: 'hp-date' }, h('small', null, `${d.getMonth() + 1}월`), h('b', null, d.getDate()), h('small', null, WEEK[d.getDay()])),
      h('span', { class: 'hp-main' },
        h('span', { class: 'hp-title' }, g.title || (g.opponent ? `vs ${g.opponent}` : g.type || '경기')),
        h('span', { class: 'hp-meta' }, [g.time, g.place, g.region, g.tourId ? tourName(g.tourId) : g.tourName, g.round].filter(Boolean).join(' · ') || ' '),
        h('span', { class: 'hp-tags' }, h('i', { class: 'hp-kind' }, g.type || '경기'), st ? h('i', { class: 'hp-stat' }, st) : null, g.src === 'kakao' ? h('i', { class: 'hp-src' }, '카톡') : null)),
      r ? h('span', { class: 'hp-score r-' + r }, h('b', null, `${g.us}:${g.them}`), h('small', null, r)) : dayDiff(g.date) >= 0 ? h('span', { class: 'hp-dday' }, dday(g.date)) : null);
  };
  const tourCard = t => {
    const gs = games().filter(g => g.tourId === t.id);
    const w = gs.filter(g => resultOf(g) === '승').length, l = gs.filter(g => resultOf(g) === '패').length;
    return h('button', { class: 'hp-card hp-tour', onclick: () => openTour(t) },
      h('span', { class: 'hp-trophy' }, t.result && /우승/.test(t.result) && !/준/.test(t.result) ? '🏆' : t.result ? '🏅' : '🏀'),
      h('span', { class: 'hp-main' },
        h('span', { class: 'hp-title' }, t.name),
        h('span', { class: 'hp-meta' }, [t.start ? (t.end && t.end !== t.start ? `${t.start.slice(5).replace('-', '/')}~${t.end.slice(5).replace('-', '/')}` : t.start.slice(5).replace('-', '/')) : '', t.region, t.venue, t.division].filter(Boolean).join(' · ')),
        h('span', { class: 'hp-tags' }, gs.length ? h('i', null, `${gs.length}경기 ${w}승 ${l}패`) : null, t.result ? h('i', { class: 'hp-res' }, t.result) : null)),
      t.start && dayDiff(t.start) >= 0 ? h('span', { class: 'hp-dday' }, dday(t.start)) : null);
  };
  const empty = (text, btnLabel, fn) => h('div', { class: 'hp-empty' }, h('p', null, text), btnLabel ? h('button', { class: 'btn primary', onclick: fn }, btnLabel) : null);

  // ---------- 탭별 화면 ----------
  const draw = async () => {
    const T = {
      home: drawHome, games: drawGames, tours: drawTours, stats: drawStats, docs: drawDocs, media: drawMedia, news: drawNews, kakao: drawKakao
    };
    body.replaceChildren(...[].concat(await T[tab]()).flat(4).filter(Boolean));
    fab.hidden = !['home', 'games', 'tours', 'docs', 'news'].includes(tab);
  };

  function drawHome() {
    const gs = games(), up = gs.filter(g => dayDiff(g.date) >= 0), done = gs.filter(g => resultOf(g)).reverse();
    const next = up[0];
    const season = cfg.season || String(new Date().getFullYear());
    const sg = gs.filter(g => g.date.startsWith(season) && resultOf(g));
    const w = sg.filter(g => resultOf(g) === '승').length, l = sg.filter(g => resultOf(g) === '패').length;
    const pts = sg.map(g => (g.stats || {}).pts).filter(v => v !== '' && v != null && !isNaN(+v)).map(Number);
    const avg = pts.length ? (pts.reduce((a, b) => a + b, 0) / pts.length).toFixed(1) : '-';
    const upTours = tours().filter(t => (t.end || t.start) && dayDiff(t.end || t.start) >= 0).reverse();
    return [
      next ? h('section', { class: 'hp-next', onclick: () => editGame(next) },
        h('div', { class: 'hp-next-top' }, h('span', { class: 'hp-next-label' }, '다음 ' + (next.type || '경기')), h('span', { class: 'hp-next-dday' }, dday(next.date))),
        h('div', { class: 'hp-next-title' }, next.title || (next.opponent ? `vs ${next.opponent}` : '경기')),
        h('div', { class: 'hp-next-when' }, fmtDate(next.date), next.time ? ' ' + next.time : ''),
        next.place ? h('a', { class: 'hp-next-place', href: mapUrl(next.place), target: '_blank', rel: 'noopener', onclick: e => e.stopPropagation() }, '📍 ' + next.place + (next.region ? ` (${next.region})` : '')) : null)
        : empty('다가오는 일정이 없습니다. 카톡 대화방에서 가져오거나 직접 넣어 보세요.', '+ 일정 넣기', () => editGame(null)),
      h('section', { class: 'hp-kpis' },
        h('div', null, h('b', null, sg.length), h('small', null, `${season} 경기`)),
        h('div', null, h('b', null, `${w}-${l}`), h('small', null, '승-패')),
        h('div', null, h('b', null, avg), h('small', null, (cfg.child || '아이') + ' 평균 득점'))),
      up.length > 1 ? h('section', { class: 'hp-sec' }, h('h3', null, '다가오는 일정'), h('div', { class: 'hp-list' }, up.slice(1, 4).map(gameCard))) : null,
      done.length ? h('section', { class: 'hp-sec' }, h('h3', null, '최근 결과'), h('div', { class: 'hp-list' }, done.slice(0, 3).map(gameCard))) : null,
      upTours.length ? h('section', { class: 'hp-sec' }, h('h3', null, '다가오는 대회'), h('div', { class: 'hp-list' }, upTours.slice(0, 3).map(tourCard))) : null,
      news().length ? h('section', { class: 'hp-sec' }, h('h3', null, '최근 기사·영상'), h('div', { class: 'hp-list' }, news().slice(0, 2).map(newsCard))) : null,
      h('button', { class: 'hp-kakao-cta', onclick: () => { tab = 'kakao'; drawTabs(); draw(); } }, h('b', null, '카톡 대화방에서 일정 가져오기'), h('small', null, cfg.rooms && cfg.rooms.length ? `지정한 방: ${cfg.rooms.join(', ')}` : '농구 공지가 올라오는 방을 지정해 두면 새 글만 골라 정리합니다'))
    ];
  }

  let gFilter = 'up', gRegion = '';
  function drawGames() {
    const gs = games();
    const regions = [...new Set(gs.map(g => g.region).filter(Boolean))];
    let list = gs.filter(g => gFilter === 'all' || (gFilter === 'up' ? dayDiff(g.date) >= 0 : dayDiff(g.date) < 0)).filter(g => !gRegion || g.region === gRegion);
    if (gFilter === 'past') list = list.reverse();
    const byMonth = new Map(); list.forEach(g => { const k = g.date.slice(0, 7); if (!byMonth.has(k)) byMonth.set(k, []); byMonth.get(k).push(g); });
    return [
      h('div', { class: 'hp-filters' },
        ...[['up', '다가오는'], ['past', '지난'], ['all', '전체']].map(([k, l]) => h('button', { class: 'chip', 'aria-pressed': String(gFilter === k), onclick: () => { gFilter = k; draw(); } }, l)),
        regions.length ? h('select', { class: 'hp-sel', onchange: e => { gRegion = e.target.value; draw(); } }, h('option', { value: '' }, '모든 지역'), ...regions.map(r => h('option', { value: r, selected: r === gRegion }, r))) : null),
      list.length ? [...byMonth].map(([k, gl]) => h('section', { class: 'hp-sec' }, h('h3', null, `${+k.slice(0, 4)}년 ${+k.slice(5)}월`), h('div', { class: 'hp-list' }, gl.map(gameCard))))
        : empty(gFilter === 'up' ? '다가오는 일정이 없습니다.' : '경기 기록이 없습니다.', '+ 일정·경기 넣기', () => editGame(null))
    ];
  }

  function drawTours() {
    const ts = tours();
    return ts.length ? h('div', { class: 'hp-list' }, ts.map(tourCard)) : empty('대회를 넣으면 대진표·기록지·경기 결과를 대회별로 모아 볼 수 있어요.', '+ 대회 넣기', () => editTour(null));
  }

  function drawStats() {
    const season = cfg.season || String(new Date().getFullYear());
    const years = [...new Set(games().map(g => g.date.slice(0, 4)))].sort().reverse();
    const sel = statYear || years[0] || season;
    const gs = games().filter(g => g.date.startsWith(sel) && (resultOf(g) || (g.stats && Object.values(g.stats).some(v => v !== '' && v != null))));
    const sum = k => gs.reduce((a, g) => a + (+((g.stats || {})[k]) || 0), 0);
    const cnt = k => gs.filter(g => (g.stats || {})[k] !== '' && (g.stats || {})[k] != null).length || 1;
    const maxPts = Math.max(1, ...gs.map(g => +((g.stats || {}).pts) || 0));
    return [
      h('div', { class: 'hp-filters' }, years.length > 1 ? h('select', { class: 'hp-sel', onchange: e => { statYear = e.target.value; draw(); } }, years.map(y => h('option', { value: y, selected: y === sel }, y + '년'))) : h('span', { class: 'muted' }, sel + '년'),
        h('span', { class: 'muted' }, `${gs.length}경기 · 경기 화면에서 아이 기록을 넣으면 여기에 모입니다`)),
      gs.length ? h('section', { class: 'hp-kpis hp-kpis6' }, STATS.map(([k, l]) => h('div', null, h('b', null, (sum(k) / cnt(k)).toFixed(1)), h('small', null, '평균 ' + l)))) : null,
      gs.length ? h('section', { class: 'hp-sec' }, h('h3', null, '경기별 득점'), h('div', { class: 'hp-bars' }, gs.map(g => h('button', { class: 'hp-bar', onclick: () => editGame(g), title: `${g.date} ${g.opponent || ''}` },
        h('i', { style: { height: Math.round(((+((g.stats || {}).pts) || 0) / maxPts) * 100) + '%' } }), h('b', null, (g.stats || {}).pts || 0), h('small', null, g.date.slice(5).replace('-', '/')))))) : null,
      gs.length ? h('div', { class: 'hp-table-wrap' }, h('table', { class: 'data hp-table' },
        h('thead', null, h('tr', null, h('th', null, '날짜'), h('th', null, '상대'), h('th', null, '결과'), ...STATS.map(([, l]) => h('th', { class: 'num' }, l.replace('리바운드', '리바').replace('어시스트', '어시').replace('3점슛', '3점'))))),
        h('tbody', null, gs.map(g => h('tr', { class: 'clickable', onclick: () => editGame(g) }, h('td', null, g.date.slice(5)), h('td', null, g.opponent || g.title || ''), h('td', null, resultOf(g) ? `${resultOf(g)} ${g.us}:${g.them}` : ''),
          ...STATS.map(([k]) => h('td', { class: 'num' }, (g.stats || {})[k] ?? ''))))),
        h('tfoot', null, h('tr', null, h('td', { colspan: 3 }, '합계'), ...STATS.map(([k]) => h('td', { class: 'num' }, sum(k))))))) : empty(`${sel}년에 기록한 경기가 없습니다.`, null)
    ];
  }
  let statYear = null;

  // 대진표·기록지 (사진·PDF를 이 기록에 저장해 Drive로 동기화)
  const blobUrls = new Map();
  async function thumb(doc, img) {
    try {
      let u = blobUrls.get(doc.blobId);
      if (!u) { const { getBlob } = await import('../sync.js'); const b = await getBlob(doc.blobId); u = URL.createObjectURL(b); blobUrls.set(doc.blobId, u); }
      if (img) img.src = u; return u;
    } catch { if (img) img.closest('.hp-doc')?.classList.add('nothumb'); return null; }
  }
  function docTile(d) {
    const img = h('img', { alt: d.title || d.docType, loading: 'lazy' });
    if (!/pdf/.test(d.mime || '')) thumb(d, img);
    return h('button', { class: 'hp-doc', onclick: () => openDoc(d) },
      /pdf/.test(d.mime || '') ? h('span', { class: 'hp-pdf' }, 'PDF') : img,
      h('span', { class: 'hp-doc-cap' }, h('b', null, d.docType || '자료'), h('small', null, [d.title, d.tourId ? tourName(d.tourId) : ''].filter(Boolean).join(' · ') || d.date || '')));
  }
  function drawDocs() {
    const ds = docs();
    const groups = new Map(); ds.forEach(d => { const k = d.tourId ? tourName(d.tourId) || '대회' : '대회 없음'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(d); });
    return ds.length ? [...groups].map(([k, l]) => h('section', { class: 'hp-sec' }, h('h3', null, k), h('div', { class: 'hp-docs' }, l.map(docTile))))
      : empty('대진표나 기록지를 찍어 두면 대회별로 모아 볼 수 있어요. (사진·PDF)', '+ 대진표·기록지 올리기', () => addDoc({}));
  }
  async function addDoc(pre) {
    const type = h('select', null, ['대진표', '기록지', '경기 일정표', '상장', '기타'].map(t => h('option', { selected: t === (pre.docType || '대진표') }, t)));
    const tourSel = tourSelect(pre.tourId);
    const title = h('input', { type: 'text', placeholder: '예: 예선 A조, 결승 기록지' });
    const file = h('input', { type: 'file', accept: 'image/*,application/pdf', multiple: true });
    const ok = await dialog({ title: '대진표·기록지 올리기', body: [h('label', { class: 'field' }, '종류', type), h('label', { class: 'field' }, '대회', tourSel), h('label', { class: 'field' }, '설명 (선택)', title), h('label', { class: 'field' }, '사진·PDF', file),
      h('p', { class: 'hint' }, '사진은 보기 좋은 크기로 줄여 Google Drive에 저장합니다.')],
      actions: [{ label: '취소', value: false }, { label: '올리기', kind: 'primary', run: () => { if (!file.files.length) { toast('파일을 골라 주세요', 'err'); return false; } }, value: true }] });
    if (!ok) return;
    for (const f of file.files) {
      let blob = f, mime = f.type;
      if (/^image\//.test(f.type)) { const du = await shrinkImage(f, 2200, 0.85); blob = await (await fetch(du)).blob(); mime = blob.type; }
      else if (f.size > 15 * 1024 * 1024) { toast(`${f.name}: 15MB보다 큰 파일은 올릴 수 없습니다`, 'err'); continue; }
      const blobId = 'hoops-' + uid();
      await db.putBlob(blobId, blob, { name: f.name });
      await db.put(COL, uid(), { kind: 'doc', docType: type.value, tourId: tourSel.value || '', title: title.value.trim(), blobId, mime, name: f.name, date: today() });
    }
    toast('올렸습니다');
  }
  async function openDoc(d) {
    const u = await thumb(d);
    if (!u) { toast('파일을 불러오지 못했습니다', 'err'); return; }
    if (/pdf/.test(d.mime || '')) { window.open(u, '_blank'); return; }
    const r = await dialog({ title: `${d.docType}${d.title ? ' · ' + d.title : ''}`, wide: true, body: [h('div', { class: 'hp-docview' }, h('img', { src: u, alt: d.docType }))],
      actions: [{ label: '삭제', kind: 'danger ghost', value: 'del' }, { label: '새 창에서 크게', run: () => { window.open(u, '_blank'); return false; } }, { label: '닫기', kind: 'primary' }] });
    if (r === 'del' && await confirmBox('이 자료를 삭제할까요?', '삭제', true)) { await db.remove(COL, d.id); toast('삭제했습니다'); }
  }

  // 사진·영상: 사진보관함에서 #농구 테마로 묶인 것
  async function drawMedia() {
    const items = (await db.all('media').catch(() => [])).filter(i => (i.themes || []).includes(THEME)).sort((a, b) => (b.taken || '').localeCompare(a.taken || ''));
    const grid = h('div', { class: 'hp-media' });
    const ms = await import('../mediastore.js').catch(() => null);
    items.slice(0, 120).forEach(it => {
      const img = h('img', { alt: it.name || '', loading: 'lazy' });
      if (ms && it.thumbId) ms.cachedImage(it.thumbId, 'mt:' + it.id).then(b => { if (b) img.src = URL.createObjectURL(b); }).catch(() => {});
      grid.append(h('button', { class: 'hp-ph' + (/^video/.test(it.type || '') || it.duration ? ' vid' : ''), onclick: () => ctx.go('media', 'theme:' + THEME) }, img));
    });
    return [
      h('div', { class: 'hp-media-bar' },
        h('button', { class: 'btn primary', onclick: () => ctx.go('media', 'theme:' + THEME) }, '사진보관함에서 올리기·보기'),
        h('span', { class: 'muted' }, `#${THEME} ${items.length}개`)),
      items.length ? grid : empty(`사진보관함에서 #${THEME} 테마로 올리면 여기에 모입니다. 이미 올린 사진은 사진보관함에서 골라 ‘#${THEME}’ 테마를 붙여 주세요.`, null),
      newsLinks('영상')
    ];
  }

  const newsCard = a => h('div', { class: 'hp-card hp-news' },
    h('span', { class: 'hp-news-ico' }, a.type === '영상' ? '▶' : '📰'),
    h('span', { class: 'hp-main' },
      h('a', { class: 'hp-title', href: a.url || '#', target: '_blank', rel: 'noopener' }, a.title || a.url || '제목 없음'),
      h('span', { class: 'hp-meta' }, [a.outlet, a.date, a.tourId ? tourName(a.tourId) : ''].filter(Boolean).join(' · ')),
      a.summary ? h('span', { class: 'hp-sum' }, a.summary) : null),
    h('button', { class: 'btn small ghost', onclick: () => editArticle(a) }, '편집'));
  const newsLinks = type => { const l = news().filter(a => a.type === type); return l.length ? h('section', { class: 'hp-sec' }, h('h3', null, type === '영상' ? '영상 링크' : '기사'), h('div', { class: 'hp-list' }, l.map(newsCard))) : null; };
  function drawNews() {
    const l = news();
    return l.length ? h('div', { class: 'hp-list' }, l.map(newsCard)) : empty('신문 기사·인터뷰·경기 영상 링크를 모아 두세요. 카톡에 올라온 링크도 가져올 수 있어요.', '+ 기사·영상 넣기', () => editArticle(null));
  }

  // ---------- 편집 창 ----------
  function tourSelect(cur) {
    return h('select', null, h('option', { value: '' }, '(대회 없음)'), ...tours().map(t => h('option', { value: t.id, selected: t.id === cur }, t.name)));
  }
  async function editGame(g, pre = {}) {
    const d = g ? { ...g } : { kind: 'game', type: '경기', date: today(), time: '', ...pre };
    const inp = (v, ph, type = 'text', extra = {}) => h('input', { type, value: v ?? '', placeholder: ph || '', ...extra });
    const typeSeg = h('div', { class: 'seg hp-seg' }, KINDS.map(k => h('button', { type: 'button', 'aria-pressed': String((d.type || '경기') === k), onclick: e => { d.type = k; typeSeg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === e.currentTarget))); } }, k)));
    const f = {
      date: inp(d.date, '', 'date'), time: inp(d.time, '', 'time'), title: inp(d.title, '비우면 “vs 상대팀”'), opponent: inp(d.opponent, '예: 청주스타즈'),
      round: inp(d.round, '예: 예선 1경기, 4강'), place: inp(d.place, '예: 청주 국민체육센터'), region: inp(d.region, '예: 청주'),
      us: inp(d.us, '우리', 'number', { inputmode: 'numeric' }), them: inp(d.them, '상대', 'number', { inputmode: 'numeric' }),
      memo: h('textarea', { rows: 3, placeholder: '집합 시간, 준비물, 경기 소감…' }, d.memo || '')
    };
    const tourSel = tourSelect(d.tourId);
    const st = Object.fromEntries(STATS.map(([k]) => [k, inp((d.stats || {})[k], '0', 'number', { inputmode: 'numeric', min: 0 })]));
    const toSched = h('input', { type: 'checkbox', checked: g ? !!g.schedId : cfg.toSchedule !== false });
    const ok = await dialog({ title: g ? '일정·경기 수정' : '일정·경기 넣기', wide: true, body: h('div', { class: 'hp-form' },
      typeSeg,
      h('div', { class: 'hp-row2' }, h('label', { class: 'field' }, '날짜', f.date), h('label', { class: 'field' }, '시간', f.time)),
      h('label', { class: 'field' }, '대회', tourSel),
      h('div', { class: 'hp-row2' }, h('label', { class: 'field' }, '상대팀', f.opponent), h('label', { class: 'field' }, '라운드', f.round)),
      h('label', { class: 'field' }, '제목', f.title),
      h('div', { class: 'hp-row2' }, h('label', { class: 'field' }, '장소', f.place), h('label', { class: 'field' }, '지역', f.region)),
      h('fieldset', { class: 'hp-fs' }, h('legend', null, '점수'), h('div', { class: 'hp-score-in' }, f.us, h('span', null, ':'), f.them)),
      h('fieldset', { class: 'hp-fs' }, h('legend', null, `${cfg.child || '아이'} 기록`), h('div', { class: 'hp-stats-in' }, STATS.map(([k, l]) => h('label', null, h('small', null, l), st[k])))),
      h('label', { class: 'field' }, '메모', f.memo),
      h('label', { class: 'check' }, toSched, ' 일정관리 달력에도 표시'),
      d.text ? h('details', { class: 'hp-src-msg' }, h('summary', null, '카톡 원문'), h('pre', null, d.text)) : null),
      actions: [g ? { label: '삭제', kind: 'danger ghost', value: 'del' } : null, { label: '취소', value: false }, { label: '저장', kind: 'primary', value: true }].filter(Boolean) });
    if (ok === 'del') {
      if (!await confirmBox('이 일정·경기를 삭제할까요?', '삭제', true)) return;
      if (g.schedId) await db.remove('schedule', g.schedId).catch(() => {});
      await db.remove(COL, g.id); toast('삭제했습니다'); return;
    }
    if (ok !== true) return;
    const { id: _i, updatedAt: _u, ...keep } = d;
    const rec = { ...keep, kind: 'game', date: f.date.value || today(), time: f.time.value, title: f.title.value.trim(), opponent: f.opponent.value.trim(), round: f.round.value.trim(),
      place: f.place.value.trim(), region: f.region.value.trim(), us: f.us.value === '' ? '' : +f.us.value, them: f.them.value === '' ? '' : +f.them.value, memo: f.memo.value.trim(), tourId: tourSel.value,
      stats: Object.fromEntries(STATS.map(([k]) => [k, st[k].value === '' ? '' : +st[k].value])) };
    const id = g ? g.id : uid();
    rec.schedId = await syncSchedule(id, rec, toSched.checked, g && g.schedId);
    await db.put(COL, id, rec);
    await saveCfg({ toSchedule: toSched.checked });
    toast('저장했습니다');
  }
  // 일정관리 달력에 같이 표시 (농구 일정은 '기타' 종류로)
  async function syncSchedule(id, rec, on, oldId) {
    const sid = oldId || 'hoops-' + id;
    if (!on) { if (oldId) await db.remove('schedule', oldId).catch(() => {}); return ''; }
    const title = '🏀 ' + (rec.title || (rec.opponent ? `vs ${rec.opponent}` : rec.type || '농구'));
    await db.put('schedule', sid, { title, type: 'other', calendar: 'solar', date: rec.date, time: rec.time || '', yearly: false, remind: '1', leap: false,
      memo: [rec.place, rec.region, rec.memo].filter(Boolean).join(' · '), hoops: id });
    return sid;
  }
  async function editTour(t) {
    const d = t ? { ...t } : { kind: 'tour' };
    const inp = (v, ph, type = 'text') => h('input', { type, value: v ?? '', placeholder: ph || '' });
    const f = { name: inp(d.name, '예: 원주 치악배'), start: inp(d.start, '', 'date'), end: inp(d.end, '', 'date'), region: inp(d.region, '예: 원주'), venue: inp(d.venue, '예: 원주종합체육관'),
      division: inp(d.division, '예: U10'), organizer: inp(d.organizer, '예: 강원농구협회'), result: inp(d.result, '예: 우승, 4강, 예선 탈락'), link: inp(d.link, 'https://…', 'url'),
      memo: h('textarea', { rows: 3 }, d.memo || '') };
    const ok = await dialog({ title: t ? '대회 수정' : '대회 넣기', wide: true, body: h('div', { class: 'hp-form' },
      h('label', { class: 'field' }, '대회 이름', f.name),
      h('div', { class: 'hp-row2' }, h('label', { class: 'field' }, '시작일', f.start), h('label', { class: 'field' }, '종료일', f.end)),
      h('div', { class: 'hp-row2' }, h('label', { class: 'field' }, '지역', f.region), h('label', { class: 'field' }, '경기장', f.venue)),
      h('div', { class: 'hp-row2' }, h('label', { class: 'field' }, '부/연령', f.division), h('label', { class: 'field' }, '주최', f.organizer)),
      h('label', { class: 'field' }, '성적', f.result), h('label', { class: 'field' }, '대회 안내 링크', f.link), h('label', { class: 'field' }, '메모', f.memo)),
      actions: [t ? { label: '삭제', kind: 'danger ghost', value: 'del' } : null, { label: '취소', value: false }, { label: '저장', kind: 'primary', value: true }].filter(Boolean) });
    if (ok === 'del') { if (await confirmBox(`‘${t.name}’ 대회를 삭제할까요? (경기·자료는 남습니다)`, '삭제', true)) { await db.remove(COL, t.id); toast('삭제했습니다'); } return; }
    if (ok !== true) return;
    if (!f.name.value.trim()) { toast('대회 이름을 넣어 주세요', 'err'); return; }
    const { id: _i, updatedAt: _u, ...keep } = d;
    await db.put(COL, t ? t.id : uid(), { ...keep, kind: 'tour', ...Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value.trim()])) });
    toast('저장했습니다');
  }
  async function openTour(t) {
    const gs = games().filter(g => g.tourId === t.id), ds = docs().filter(d => d.tourId === t.id), ns = news().filter(a => a.tourId === t.id);
    const r = await dialog({ title: t.name, wide: true, body: h('div', { class: 'hp-tourview' },
      h('p', { class: 'hp-meta' }, [t.start && t.end && t.end !== t.start ? `${t.start} ~ ${t.end}` : t.start, t.region, t.venue, t.division, t.organizer].filter(Boolean).join(' · ')),
      t.result ? h('p', { class: 'hp-tour-res' }, '성적: ' + t.result) : null,
      t.venue ? h('a', { href: mapUrl(t.venue), target: '_blank', rel: 'noopener' }, '📍 경기장 지도 보기') : null,
      t.link ? h('a', { href: t.link, target: '_blank', rel: 'noopener', style: { marginLeft: '12px' } }, '🔗 대회 안내') : null,
      h('h3', null, `경기 ${gs.length}`), gs.length ? h('div', { class: 'hp-list' }, gs.map(gameCard)) : h('p', { class: 'muted' }, '아직 넣은 경기가 없습니다.'),
      h('h3', null, `대진표·기록지 ${ds.length}`), ds.length ? h('div', { class: 'hp-docs' }, ds.map(docTile)) : h('p', { class: 'muted' }, '대진표·기록지 사진을 올려 보세요.'),
      ns.length ? [h('h3', null, '기사·영상'), h('div', { class: 'hp-list' }, ns.map(newsCard))] : null,
      t.memo ? h('p', { class: 'hp-memo' }, t.memo) : null),
      actions: [{ label: '수정', value: 'edit' }, { label: '+ 경기', value: 'game' }, { label: '+ 대진표·기록지', value: 'doc' }, { label: '닫기', kind: 'primary' }] });
    if (r === 'edit') editTour(t);
    if (r === 'game') editGame(null, { tourId: t.id, type: '대회', region: t.region, place: t.venue, date: t.start && dayDiff(t.start) >= 0 ? t.start : today() });
    if (r === 'doc') addDoc({ tourId: t.id });
  }
  async function editArticle(a, pre = {}) {
    const d = a ? { ...a } : { kind: 'article', type: '기사', date: today(), ...pre };
    const inp = (v, ph, type = 'text') => h('input', { type, value: v ?? '', placeholder: ph || '' });
    const f = { url: inp(d.url, 'https://…', 'url'), title: inp(d.title, '기사·영상 제목'), outlet: inp(d.outlet, '예: 점프볼, 유튜브'), date: inp(d.date, '', 'date'),
      summary: h('textarea', { rows: 4, placeholder: '인터뷰 내용이나 중요한 부분을 붙여 넣어 두면 나중에 찾기 쉬워요' }, d.summary || '') };
    const type = h('select', null, ['기사', '인터뷰', '영상'].map(t => h('option', { selected: t === d.type }, t)));
    const tourSel = tourSelect(d.tourId);
    const ok = await dialog({ title: a ? '기사·영상 수정' : '기사·영상 넣기', wide: true, body: h('div', { class: 'hp-form' },
      h('label', { class: 'field' }, '링크', f.url), h('label', { class: 'field' }, '제목', f.title),
      h('div', { class: 'hp-row2' }, h('label', { class: 'field' }, '종류', type), h('label', { class: 'field' }, '날짜', f.date)),
      h('div', { class: 'hp-row2' }, h('label', { class: 'field' }, '언론사·채널', f.outlet), h('label', { class: 'field' }, '대회', tourSel)),
      h('label', { class: 'field' }, '내용·인터뷰 요약', f.summary)),
      actions: [a ? { label: '삭제', kind: 'danger ghost', value: 'del' } : null, { label: '취소', value: false }, { label: '저장', kind: 'primary', value: true }].filter(Boolean) });
    if (ok === 'del') { if (await confirmBox('삭제할까요?', '삭제', true)) { await db.remove(COL, a.id); toast('삭제했습니다'); } return; }
    if (ok !== true) return;
    if (!f.url.value.trim() && !f.title.value.trim()) { toast('링크나 제목을 넣어 주세요', 'err'); return; }
    const { id: _i, updatedAt: _u, ...keep } = d;
    const host = (f.url.value.match(/^https?:\/\/(?:www\.|m\.)?([^/]+)/) || [])[1] || '';
    await db.put(COL, a ? a.id : uid(), { ...keep, kind: 'article', type: type.value, url: f.url.value.trim(), title: f.title.value.trim() || host, outlet: f.outlet.value.trim() || (/youtu/.test(host) ? '유튜브' : host), date: f.date.value, summary: f.summary.value.trim(), tourId: tourSel.value });
    toast('저장했습니다');
  }
  function addForTab() {
    if (tab === 'tours') return editTour(null);
    if (tab === 'docs') return addDoc({});
    if (tab === 'news') return editArticle(null);
    return editGame(null);
  }

  // ---------- 카톡 가져오기 ----------
  async function drawKakao() {
    const rooms = cfg.rooms || [];
    const fileIn = h('input', { type: 'file', accept: '.txt,.zip,.csv,text/plain', hidden: true, onchange: () => { const f = fileIn.files[0]; fileIn.value = ''; if (f) importKakao(f); } });
    const q = h('input', { type: 'search', placeholder: '카톡 기록 검색 (예: 유니폼, 집합, 치악배)' });
    const listBox = h('div', { class: 'hp-notes' });
    const drawNotes = () => {
      const s = q.value.trim();
      const l = notes().filter(n => !s || n.text.includes(s) || (n.who || '').includes(s)).slice(0, 80);
      listBox.replaceChildren(...(l.length ? l.map(n => h('div', { class: 'hp-note' },
        h('div', { class: 'hp-note-head' }, h('b', null, n.who || ''), h('small', null, [n.room, new Date(n.ts).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })].filter(Boolean).join(' · ')),
          h('button', { class: 'btn small ghost', onclick: () => editGame(null, { text: n.text, memo: n.text.slice(0, 300), src: 'kakao' }) }, '일정으로')),
        h('div', { class: 'hp-note-text' }, n.text))) : [h('p', { class: 'muted' }, s ? '찾는 내용이 없습니다.' : '아직 가져온 카톡 기록이 없습니다.')]));
    };
    q.addEventListener('input', drawNotes); drawNotes();
    return [
      h('section', { class: 'hp-kk' },
        h('h3', null, '지정한 농구 대화방'),
        rooms.length ? h('div', { class: 'hp-rooms' }, rooms.map(r => h('span', { class: 'chip' }, r, h('button', { class: 'x', 'aria-label': r + ' 지정 해제', onclick: async () => { await saveCfg({ rooms: rooms.filter(x => x !== r) }); draw(); } }, '×'))))
          : h('p', { class: 'muted' }, '아직 없습니다. 아래에서 대화 파일을 처음 넣으면 그 방을 지정할지 물어봅니다.'),
        h('button', { class: 'btn primary hp-kk-btn', onclick: () => fileIn.click() }, '카톡 대화 파일 넣기'), fileIn,
        h('details', { class: 'hp-howto' }, h('summary', null, '카톡 대화 파일 만드는 방법'),
          h('ol', null,
            h('li', null, h('b', null, '아이폰: '), '농구 대화방 › 오른쪽 위 ≡ › 오른쪽 아래 ⚙ › ‘대화 내용 내보내기’ › ‘텍스트만 보내기’ › ‘파일에 저장’ → 여기서 ‘카톡 대화 파일 넣기’로 고릅니다.'),
            h('li', null, h('b', null, '안드로이드: '), '대화방 › ≡ › ⚙ › ‘대화 내용 내보내기’ › ‘텍스트만 보내기’ → 저장된 .txt를 고릅니다.'),
            h('li', null, h('b', null, 'PC 카톡: '), '대화방 › ≡ › ‘대화 내용’ › ‘대화 내보내기’ → 저장한 .txt를 고릅니다.')),
          h('p', { class: 'hint' }, '카카오톡은 다른 앱이 대화를 직접 읽을 수 없게 막아 두었기 때문에, 이렇게 내보낸 파일로 가져옵니다. 같은 파일을 다시 넣어도 지난번 이후 새 글만 정리합니다. 대화 내용은 이 기록에만 저장되고 밖으로 보내지 않습니다.'))),
      h('section', { class: 'hp-sec' }, h('h3', null, `카톡에서 모은 농구 글 ${notes().length}`), q, listBox)
    ];
  }

  async function readFileText(f) {
    if (/\.zip$/i.test(f.name) || f.type === 'application/zip') {
      const JSZip = window.JSZip || await new Promise((res, rej) => { const saved = window.define; window.define = undefined; const sc = document.createElement('script'); sc.src = new URL('../../vendor/jszip/jszip.min.js', import.meta.url).href; sc.onload = () => { window.define = saved; res(window.JSZip); }; sc.onerror = () => { window.define = saved; rej(new Error('압축 파일을 풀 수 없습니다.')); }; document.head.append(sc); });
      if (!JSZip) throw new Error('압축 파일을 풀 수 없습니다. .txt 파일로 내보내 주세요.');
      const z = await JSZip.loadAsync(f);
      const txt = Object.values(z.files).filter(x => !x.dir && /\.txt$/i.test(x.name)).sort((a, b) => b._data.uncompressedSize - a._data.uncompressedSize)[0];
      if (!txt) throw new Error('압축 파일 안에 대화 내용(.txt)이 없습니다.');
      return await txt.async('string');
    }
    const buf = await f.arrayBuffer();
    let t = new TextDecoder('utf-8').decode(buf);
    if (/�/.test(t.slice(0, 2000))) { try { t = new TextDecoder('euc-kr').decode(buf); } catch { } }   // 오래된 PC 카톡
    return t;
  }

  async function importKakao(file) {
    const K = await import('../kakao.js');
    let parsed;
    try { parsed = K.parseChat(await readFileText(file)); } catch (e) { toast(e.message, 'err'); return; }
    if (!parsed.msgs.length) { toast('카톡 대화 형식을 알아보지 못했습니다. ‘텍스트만 보내기’로 내보낸 파일인지 확인해 주세요.', 'err'); return; }
    let room = parsed.room || file.name.replace(/\.(txt|zip|csv)$/i, '');
    const rooms = cfg.rooms || [];
    if (!rooms.includes(room)) {
      const nameIn = h('input', { type: 'text', value: room });
      const r = await dialog({ title: '이 대화방을 농구 대화방으로 지정할까요?', body: [h('p', null, `대화 ${parsed.msgs.length.toLocaleString()}개를 찾았습니다.`), h('label', { class: 'field' }, '대화방 이름', nameIn),
        h('p', { class: 'hint' }, '지정해 두면 다음부터 이 방 파일을 넣을 때 새 글만 골라 정리합니다.')],
        actions: [{ label: '취소', value: false }, { label: '지정하고 정리', kind: 'primary', value: true }] });
      if (!r) return;
      room = nameIn.value.trim() || room;
      await saveCfg({ rooms: [...rooms, room] });
    }
    const seen = (cfg.kakaoSeen || {})[room] || 0;
    const x = K.extract(parsed.msgs, { since: seen });
    const newest = Math.max(seen, ...parsed.msgs.map(m => m.ts));
    await reviewKakao(room, x, newest, seen);
  }

  async function reviewKakao(room, x, newest, seen) {
    const gs = games();
    const exists = e => gs.some(g => g.date === e.date && (g.time || '') === (e.time || '') && (g.type === e.kind || !e.kind));
    const evRows = x.events.map(e => ({ e, on: h('input', { type: 'checkbox', checked: !exists(e) && e.sure }), dup: exists(e) }));
    const rsRows = x.results.map(r => {
      const g = gs.find(g => g.date === r.date && !resultOf(g)) || null;
      return { r, g, on: h('input', { type: 'checkbox', checked: !!g || true }) };
    });
    const lnRows = x.links.filter(l => !news().some(a => a.url === l.url)).map(l => ({ l, on: h('input', { type: 'checkbox', checked: true }) }));
    const keepNotes = h('input', { type: 'checkbox', checked: true });
    const toSched = h('input', { type: 'checkbox', checked: cfg.toSchedule !== false });
    const total = evRows.length + rsRows.length + lnRows.length;
    const body = h('div', { class: 'hp-review' },
      h('p', { class: 'muted' }, seen ? `${room} · 지난번(${new Date(seen).toLocaleDateString('ko-KR')}) 이후 새 글에서 찾았습니다.` : `${room} · 전체 대화에서 찾았습니다.`),
      evRows.length ? [h('h3', null, `일정 ${evRows.length}`), ...evRows.map(({ e, on, dup }) => h('label', { class: 'hp-rv' }, on,
        h('span', null, h('b', null, `${fmtDate(e.date)}${e.time ? ' ' + e.time : ''} · ${e.kind}`), dup ? h('i', { class: 'hp-dup' }, '이미 있음') : null, h('br'),
          h('span', null, [e.title, e.place, e.region].filter(Boolean).join(' · ')), h('small', null, (e.text || '').split('\n').slice(0, 3).join(' / ').slice(0, 140)))))] : null,
      rsRows.length ? [h('h3', null, `경기 결과 ${rsRows.length}`), ...rsRows.map(({ r, g, on }) => h('label', { class: 'hp-rv' }, on,
        h('span', null, h('b', null, `${fmtDate(r.date)} · ${r.us}:${r.them} ${r.us > r.them ? '승' : r.us < r.them ? '패' : '무'}`), h('br'),
          h('span', null, g ? `‘${g.title || g.opponent || '경기'}’에 점수를 넣습니다` : '새 경기 기록으로 넣습니다'), h('small', null, r.text.slice(0, 120)))))] : null,
      lnRows.length ? [h('h3', null, `기사·영상 링크 ${lnRows.length}`), ...lnRows.map(({ l, on }) => h('label', { class: 'hp-rv' }, on,
        h('span', null, h('b', null, l.kind), ' ', h('span', { class: 'hp-url' }, l.url), h('small', null, l.note))))] : null,
      total ? null : h('p', null, '새로 정리할 일정·결과·링크가 없습니다.'),
      h('label', { class: 'check' }, keepNotes, ` 농구 관련 글 ${x.notes.length}개를 ‘카톡에서 모은 글’에 보관 (검색용)`),
      evRows.length ? h('label', { class: 'check' }, toSched, ' 일정관리 달력에도 표시') : null);
    const ok = await dialog({ title: '카톡에서 찾은 농구 소식', wide: true, body, actions: [{ label: '취소', value: false }, { label: '선택한 것 넣기', kind: 'primary', value: true }] });
    if (!ok) return;
    let n = 0;
    for (const { e, on } of evRows) {
      if (!on.checked) continue;
      const id = uid();
      const rec = { kind: 'game', type: e.kind === '기타' ? '경기' : e.kind, date: e.date, time: e.time, title: e.title, opponent: e.opponent, place: e.place, region: e.region,
        tourName: e.tour, tourId: (tours().find(t => e.tour && (t.name.includes(e.tour) || e.tour.includes(t.name))) || {}).id || '', memo: e.text.slice(0, 500), text: e.text, src: 'kakao', room, us: '', them: '', stats: {} };
      rec.schedId = await syncSchedule(id, rec, toSched.checked);
      await db.put(COL, id, rec); n++;
    }
    for (const { r, g, on } of rsRows) {
      if (!on.checked) continue;
      if (g) { const { id, updatedAt, ...k } = g; await db.put(COL, g.id, { ...k, us: r.us, them: r.them, opponent: k.opponent || r.opponent }); }
      else await db.put(COL, uid(), { kind: 'game', type: '경기', date: r.date, us: r.us, them: r.them, opponent: r.opponent, title: r.opponent ? `vs ${r.opponent}` : '경기', memo: r.text.slice(0, 300), src: 'kakao', room, stats: {} });
      n++;
    }
    for (const { l, on } of lnRows) {
      if (!on.checked) continue;
      const host = (l.url.match(/^https?:\/\/(?:www\.|m\.|n\.)?([^/]+)/) || [])[1] || '';
      await db.put(COL, uid(), { kind: 'article', type: l.kind, url: l.url, title: l.note || host, outlet: /youtu/.test(host) ? '유튜브' : host, date: ymd(new Date(l.ts)), summary: l.note, src: 'kakao' });
      n++;
    }
    if (keepNotes.checked) {
      const have = new Set(notes().map(z => z.ts + '|' + z.who));
      for (const z of x.notes) { if (have.has(z.ts + '|' + z.who)) continue; await db.put(COL, uid(), { kind: 'note', ts: z.ts, who: z.who, text: z.text.slice(0, 2000), room }); }
    }
    await saveCfg({ kakaoSeen: { ...(cfg.kakaoSeen || {}), [room]: newest }, toSchedule: toSched.checked });
    toast(n ? `${n}개를 넣었습니다` : '정리했습니다');
    tab = n ? 'home' : 'kakao'; drawTabs(); draw();
  }

  // ---------- 시작 ----------
  const onChange = async ev => { if (ev.detail.col !== COL && !(ev.detail.col === 'settings' && ev.detail.id === 'hoops') && ev.detail.col !== 'media') return; await load(); drawHead(); draw(); };
  db.events.addEventListener('change', onChange);
  await load(); drawHead(); drawTabs(); await draw();
  return {
    open: p => { if (p && TABS.some(t => t[0] === p)) { tab = p; drawTabs(); draw(); } },
    cleanup: () => { db.events.removeEventListener('change', onChange); blobUrls.forEach(u => URL.revokeObjectURL(u)); }
  };
}
