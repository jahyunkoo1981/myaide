// 개발도구: what MY AIDE is built from — outside services (API), bundled open-source programs and their
// licenses, Windows/browser features, and which screen uses what. Plus this device's environment.
import { h, toast } from '../util.js';
import { native } from '../native.js';
import * as db from '../db.js';
import { prefs } from '../prefs.js';

export const APP_VERSION = '2.5.0';

const API = [
  { name: 'Google Drive API v3', who: 'Google', use: '모든 기록 동기화(내 드라이브 › MY AIDE 폴더), 백업, 사진·동영상 원본·미리보기 저장', screens: '전체 · 백업 · 사진·동영상 · VisualCode(내 드라이브)', cost: '무료 (구글 계정 저장공간 사용)', scope: 'drive.file — MY AIDE가 만든 파일만 접근', link: 'https://developers.google.com/drive/api' },
  { name: 'Google OAuth 2.0', who: 'Google', use: '구글 계정으로 로그인, 접근 토큰 발급·갱신', screens: '처음 연결 · 설정', cost: '무료', scope: 'Windows 앱은 데스크톱 클라이언트, 웹은 웹 클라이언트 ID', link: 'https://developers.google.com/identity/protocols/oauth2' },
  { name: 'OpenAI Chat Completions', who: 'OpenAI', use: '질문 답변, 생각 정리, 회의 요약, 코드 설명·수정', screens: 'AIDE · AI 마인드맵 · 회의록(요약) · VisualCode(AI 도우미)', cost: '사용량만큼 유료 (내 API 키)', scope: () => `모델: ${prefs().aiModel || 'gpt-4o-mini'} (설정에서 변경)`, link: 'https://platform.openai.com/docs/api-reference/chat' },
  { name: 'OpenAI Audio Transcriptions', who: 'OpenAI', use: '녹음 → 글자 받아쓰기 (한국어)', screens: '회의록', cost: '사용량만큼 유료', scope: () => `모델: ${prefs().transcribeModel || 'gpt-4o-mini-transcribe'} · 한 번에 25MB까지`, link: 'https://platform.openai.com/docs/api-reference/audio' },
  { name: 'OpenAI Vision (이미지 이해)', who: 'OpenAI', use: '사진 내용 설명·태그 만들기', screens: '사진·동영상 (AI 태그)', cost: '사용량만큼 유료', scope: '작은 미리보기(저해상도)만 전송', link: 'https://platform.openai.com/docs/guides/vision' },
  { name: 'OpenAI Embeddings', who: 'OpenAI', use: '뜻으로 찾기(“바다에서 찍은 사진”)', screens: '사진·동영상 (AI 검색)', cost: '사용량만큼 유료 (매우 저렴)', scope: 'text-embedding-3-small · 256차원', link: 'https://platform.openai.com/docs/guides/embeddings' },
  { name: 'PeerJS 중계 서버 + WebRTC', who: 'PeerJS (공개 서버)', use: '원격지원 연결 주선 — 화면·마우스 신호는 두 기기가 직접 주고받음', screens: '원격지원', cost: '무료 공개 서버', scope: '0.peerjs.com', link: 'https://peerjs.com' },
  { name: 'GitHub Pages', who: 'GitHub', use: '웹앱(폰·태블릿·브라우저용) 호스팅', screens: '웹·폰 전체', cost: '무료', scope: 'jahyunkoo1981.github.io/myaide', link: 'https://pages.github.com' },
  { name: 'ChatGPT · Claude 웹사이트', who: 'OpenAI · Anthropic', use: '질문을 그 사이트에서 이어 묻기 (링크만 열고 데이터는 보내지 않음)', screens: 'AIDE', cost: '각 서비스 요금', scope: '새 창으로 열기', link: 'https://chatgpt.com' }
];

const OSS = [
  { name: 'Monaco Editor', ver: '0.52.2', lic: 'MIT', by: 'Microsoft', use: 'VS Code와 같은 코드 편집기 (색 구분, 찾기, 비교 화면)', screens: 'VisualCode', file: 'vendor/monaco/LICENSE', extra: 'vendor/monaco/ThirdPartyNotices.txt', link: 'https://github.com/microsoft/monaco-editor' },
  { name: 'PeerJS', ver: '1.5.4', lic: 'MIT', by: 'Michelle Bu, Eric Zhang', use: 'WebRTC 연결을 쉽게 만드는 라이브러리', screens: '원격지원 (상대방 페이지 포함)', file: 'vendor/peerjs.LICENSE', link: 'https://github.com/peers/peerjs' },
  { name: 'ffmpeg.wasm (@ffmpeg/ffmpeg)', ver: '0.12.15', lic: 'MIT', by: 'ffmpegwasm', use: '브라우저 안에서 FFmpeg 실행', screens: '사진·동영상 › 동영상 편집', link: 'https://github.com/ffmpegwasm/ffmpeg.wasm' },
  { name: 'FFmpeg core (@ffmpeg/core)', ver: '0.12.10', lic: 'GPL-2.0-or-later', by: 'FFmpeg 개발자들', use: '자르기·나누기·합치기·자막·소리 끄기 (원본 화질 그대로 복사)', screens: '사진·동영상 › 동영상 편집', file: 'vendor/ffmpeg/ffmpeg-core-LICENSE.txt', link: 'https://ffmpeg.org/legal.html', note: '개인 사용은 제한 없음. 이 프로그램을 남에게 배포할 때는 FFmpeg 소스 위치를 함께 알려야 합니다.' },
  { name: 'exifr', ver: '7.x', lic: 'MIT', by: 'Mike Kovařík', use: '사진 촬영일·카메라·위치·HEIC 정보 읽기', screens: '사진·동영상 (일자별 정리, 중복 찾기)', file: 'vendor/exifr.LICENSE', link: 'https://github.com/MikeKovarik/exifr' },
  { name: 'korean-lunar-calendar', ver: '—', lic: 'MIT', by: 'Jinil Lee', use: '음력 ↔ 양력 변환', screens: '일정관리 (음력 기념일)', file: 'vendor/korean-lunar-calendar.LICENSE', link: 'https://github.com/usingsky/korean_lunar_calendar_js' },
  { name: 'Pretendard Variable', ver: '1.3.x', lic: 'SIL OFL 1.1', by: '길형진', use: '화면 전체 한글·영문 글꼴', screens: '전체', file: 'vendor/fonts/Pretendard-LICENSE.txt', link: 'https://github.com/orioncactus/pretendard' },
  { name: 'Microsoft Edge WebView2 SDK', ver: '1.0.2903.40', lic: 'Microsoft (BSD 형식)', by: 'Microsoft', use: 'Windows 앱 안에 웹 화면 띄우기', screens: 'Windows 앱 전체 · 위젯', link: 'https://www.nuget.org/packages/Microsoft.Web.WebView2' },
  { name: '.NET 8 (Windows Desktop)', ver: '8.0', lic: 'MIT', by: 'Microsoft · .NET Foundation', use: 'Windows 앱 본체 (WinForms)', screens: 'Windows 앱', link: 'https://github.com/dotnet/runtime' },
  { name: 'System.Data.OleDb', ver: '8.0.1', lic: 'MIT', by: 'Microsoft', use: 'Windows 검색 색인 조회', screens: 'MyPC Search (빠른 검색)', link: 'https://www.nuget.org/packages/System.Data.OleDb' },
  { name: 'System.Security.Cryptography.ProtectedData', ver: '8.0.0', lic: 'MIT', by: 'Microsoft', use: '구글 로그인 토큰을 Windows 계정 키로 암호화', screens: 'Windows 앱 로그인', link: 'https://www.nuget.org/packages/System.Security.Cryptography.ProtectedData' },
  { name: '.NET Framework 4', ver: '4.x', lic: 'Windows 구성요소', by: 'Microsoft', use: '원격지원 도우미(MyAideSupport.exe, 16KB) 실행 — Windows에 기본 포함', screens: '원격지원 (상대방 PC)', link: 'https://dotnet.microsoft.com/download/dotnet-framework' }
];

const PLATFORM = [
  ['Windows', 'Windows Hello (얼굴·지문·PIN)', '계정정보 열람 확인'],
  ['Windows', 'DPAPI (데이터 보호)', '구글 로그인 토큰 보관'],
  ['Windows', 'Windows Search 색인', 'MyPC Search 빠른 검색'],
  ['Windows', '전역 단축키 (RegisterHotKey)', '화면 캡처 Ctrl+Shift+F10/F11 · 계정 자동 입력'],
  ['Windows', '화면 복사 (GDI)', '화면 캡처'],
  ['Windows', 'DWM 창 색', '바탕화면 위젯 제목줄 색'],
  ['Windows', 'SendInput (마우스·키보드 입력)', '원격지원 도우미'],
  ['Windows', '휴지통 (Microsoft.VisualBasic.FileIO)', 'VisualCode에서 PC 파일 삭제'],
  ['Windows', 'cmd · PowerShell · git · python 등', 'VisualCode 터미널·실행·Git (PC에 설치된 것 사용)'],
  ['브라우저', 'IndexedDB', '모든 기록을 기기에 먼저 저장 (오프라인 사용)'],
  ['브라우저', 'Service Worker', '오프라인 실행, 폰 홈 화면 앱(PWA)'],
  ['브라우저', 'Web Crypto (AES-GCM · PBKDF2)', '계정정보·API 키 암호화 — 비밀번호 없이는 아무도 못 읽음'],
  ['브라우저', 'MediaRecorder · 마이크', '회의록 녹음 · 원격지원 음성'],
  ['브라우저', '화면 공유 (getDisplayMedia)', '원격지원 · 브라우저 화면 캡처'],
  ['브라우저', 'WebRTC', '원격지원 화면·입력 전송'],
  ['브라우저', 'File System Access', 'Chrome·Edge에서 PC 폴더 열기 (MyPC Search, VisualCode)'],
  ['브라우저', 'BroadcastChannel', '여러 창(위젯 포함) 사이 즉시 반영'],
  ['브라우저', 'Web Worker · WebAssembly', '동영상 편집(FFmpeg), 코드 편집기']
];

const SCREENS = [
  ['업무일지', '서식 편집기(목록·제목·접기·목차), 프로세스 그림', 'Drive 동기화'],
  ['업무메모', '서식 편집기 + 프로세스(흐름도) 편집기', 'Drive 동기화'],
  ['AI 마인드맵', '직접 만든 마인드맵 화면', 'OpenAI Chat · Drive'],
  ['지식노트', 'Markdown 렌더러, [[문서 연결]]', 'Drive'],
  ['회의록', '녹음(MediaRecorder), 달력', 'OpenAI 받아쓰기·요약 · Drive'],
  ['MyPC Search', 'Windows 검색 색인, 전체 드라이브 목록(직접 구현)', 'System.Data.OleDb'],
  ['원격지원', 'PeerJS, WebRTC, 원격지원 도우미(.NET Framework 4)', 'PeerJS 중계 서버'],
  ['일정관리', 'korean-lunar-calendar (음력)', 'Drive'],
  ['사진·동영상', 'exifr, ffmpeg.wasm, 나눠 올리기(재개 가능)', 'Drive · OpenAI Vision·Embeddings'],
  ['가계부', '직접 구현 (분류·합계)', 'Drive'],
  ['AIDE', '내 기록을 근거로 질문 답변', 'OpenAI Chat'],
  ['VisualCode', 'Monaco Editor, 터미널·Git(Windows 앱)', 'Drive · OpenAI Chat'],
  ['계정정보', 'Web Crypto 암호화, Windows Hello', 'Drive (암호문만)'],
  ['백업', '전체 기록 묶음 저장·복원', 'Drive'],
  ['바탕화면 위젯', 'WebView2 작은 창, DWM 색', '—'],
  ['화면 캡처', 'GDI 화면 복사, 직접 만든 이미지 편집기', '—']
];

export async function mount(root) {
  const t = (heads, rows) => h('div', { class: 'dt-scroll' }, h('table', { class: 'data dt-table' },
    h('thead', null, h('tr', null, ...heads.map(x => h('th', null, x)))),
    h('tbody', null, ...rows.map(r => h('tr', null, ...r.map(c => h('td', null, c)))))));
  const ext = (href, text) => h('a', { href, target: '_blank', rel: 'noopener' }, text);   // Windows 앱은 새 창 링크를 기본 브라우저로 엽니다
  const licBtn = (file, label) => h('button', { class: 'btn small ghost', onclick: () => showLicense(file, label) }, '원문');

  async function showLicense(file, label) {
    try {
      const text = await (await fetch(file)).text();
      const bg = h('div', { class: 'ol-help-bg', onclick: e => { if (e.target === bg) bg.remove(); } },
        h('div', { class: 'ol-help', role: 'dialog', 'aria-label': label + ' 라이선스' },
          h('div', { class: 'ol-help-head' }, h('b', null, label + ' — 라이선스 원문'), h('button', { class: 'btn small ghost', onclick: () => bg.remove() }, '닫기')),
          h('pre', { class: 'dt-lic' }, text)));
      document.body.append(bg);
    } catch { toast('라이선스 파일을 열지 못했습니다.', 'err'); }
  }

  // this device
  const env = h('div', { class: 'dt-env' });
  const envRow = (k, v) => h('div', null, h('span', null, k), h('b', null, v));
  (async () => {
    let usage = '—';
    try { const e = await navigator.storage.estimate(); usage = `${(e.usage / 1048576).toFixed(1)}MB 사용 / ${(e.quota / 1073741824).toFixed(1)}GB 가능`; } catch { }
    const mode = await db.kvGet('mode');
    const recs = (await db.rawAll()).filter(r => !r.deleted).length;
    env.replaceChildren(
      envRow('MY AIDE 버전', APP_VERSION),
      envRow('실행 환경', native.available ? 'Windows 앱 (WebView2)' : /iPhone|iPad|Android/i.test(navigator.userAgent) ? '휴대폰·태블릿 웹앱' : '브라우저 웹앱'),
      envRow('저장 방식', mode === 'local' ? '이 기기에만 저장 (테스트)' : 'Google Drive 동기화'),
      envRow('이 기기의 기록 수', recs.toLocaleString() + '건'),
      envRow('기기 저장공간', usage),
      envRow('브라우저 엔진', (navigator.userAgent.match(/(Edg|Chrome|Version)\/[\d.]+/) || ['—'])[0].replace('Edg/', 'Edge ').replace('Version/', 'Safari ').replace('Chrome/', 'Chrome ')));
  })();

  const sec = (title, desc, ...body) => h('section', { class: 'dt-sec' }, h('h2', null, title), desc ? h('p', { class: 'hint' }, desc) : null, ...body);
  root.append(
    h('div', { class: 'view-head' }, h('h1', null, '개발도구'), h('span', { class: 'muted' }, 'MY AIDE를 이루는 API · 프로그램 · 라이선스')),
    h('div', { class: 'pad dt' },
      sec('이 기기', null, env),
      sec('구성', null, h('div', { class: 'dt-arch' },
        h('div', null, h('b', null, '웹앱 (PWA)'), h('span', null, 'HTML·CSS·JavaScript(ES 모듈), 빌드 도구 없이 동작. 폰·태블릿·브라우저에서 사용, GitHub Pages에 올림.')),
        h('div', null, h('b', null, 'Windows 앱'), h('span', null, '.NET 8 WinForms + WebView2. 같은 웹앱을 EXE 안에 넣어 인터넷 없이도 열림. 캡처·파일 검색·위젯·터미널 등 PC 기능 담당.')),
        h('div', null, h('b', null, '데이터'), h('span', null, '기기에 먼저 저장(IndexedDB) → 내 Google Drive의 MY AIDE 폴더로 동기화. 서버를 따로 두지 않음.')),
        h('div', null, h('b', null, '보안'), h('span', null, '계정정보·API 키는 MY AIDE 비밀번호로 암호화(AES-GCM) 후 저장. 구글 권한은 MY AIDE가 만든 파일만(drive.file).')))),
      sec('외부 서비스 (API)', '인터넷으로 연결하는 서비스입니다. OpenAI는 설정에 넣은 내 API 키로, 쓴 만큼만 요금이 나옵니다.',
        t(['API', '하는 일', '쓰는 화면', '범위·모델', '요금'], API.map(a => [h('div', null, ext(a.link, a.name), h('div', { class: 'dt-sub' }, a.who)), a.use, a.screens, typeof a.scope === 'function' ? a.scope() : a.scope, a.cost]))),
      sec('포함된 오픈소스·프로그램', '앱 안에 함께 들어 있는 프로그램입니다. 원문을 누르면 라이선스 전문을 볼 수 있습니다.',
        t(['이름', '버전', '라이선스', '하는 일', '쓰는 화면', ''], OSS.map(o => [h('div', null, ext(o.link, o.name), h('div', { class: 'dt-sub' }, o.by), o.note ? h('div', { class: 'dt-note' }, o.note) : null), o.ver, h('span', { class: 'dt-lic-tag' + (/GPL/.test(o.lic) ? ' gpl' : '') }, o.lic), o.use, o.screens,
          h('div', { class: 'row', style: { gap: '4px', flexWrap: 'nowrap' } }, o.file ? licBtn(o.file, o.name) : null, o.extra ? h('button', { class: 'btn small ghost', onclick: () => showLicense(o.extra, o.name + ' 포함 구성요소') }, '구성요소') : null)]))),
      sec('Windows · 브라우저 기능', '운영체제와 브라우저에 원래 들어 있는 기능을 씁니다 (따로 설치하지 않음).',
        t(['구분', '기능', '쓰는 곳'], PLATFORM)),
      sec('화면별 적용 내용', null,
        t(['화면', '적용된 기술', '연결 서비스'], SCREENS.map(r => [h('b', null, r[0]), r[1], r[2]]))),
      sec('직접 만든 부분', null, h('p', { class: 'dt-p' }, '동기화 엔진(충돌 합치기 포함), 서식 편집기(목록·제목·접기·목차), 프로세스 그림 편집기(다리 표시·선 자동 경로), 마인드맵, 이미지·손글씨 편집기, 위젯·캡처·파일 목록, 원격지원 화면은 외부 라이브러리 없이 MY AIDE 코드로 만들었습니다. MY AIDE 자체 코드는 개인용으로 작성되었습니다.'))));
}
