import { h, copyText } from '../util.js';
import { native } from '../native.js';

// Remote support goes through TeamViewer: MY AIDE helps send the download/join link; it does not build its own remote engine.
const QS = 'https://www.teamviewer.com/ko/download/quicksupport/';
const JOIN = 'https://start.teamviewer.com/';

export async function mount(root) {
  const msg = `원격지원을 위해 아래 링크에서 TeamViewer QuickSupport를 내려받아 실행한 뒤, 화면에 나오는 ID와 비밀번호를 알려 주세요.\n${QS}`;
  root.append(h('div', { class: 'view-head' }, h('h1', null, '원격지원')),
    h('div', { class: 'pad', style: { maxWidth: '760px' } },
      h('p', { class: 'muted' }, 'TeamViewer로 원격지원을 합니다. 상대에게 초대 메시지를 보내고, 상대가 알려 준 ID로 접속하세요.'),
      h('section', { class: 'block' }, h('h2', null, '상대방에게 보낼 초대 메시지'),
        h('textarea', { rows: 4, readOnly: true }, msg),
        h('div', { class: 'row', style: { marginTop: '8px' } }, h('button', { class: 'btn primary', onclick: () => copyText(msg, '초대 메시지를 복사했습니다') }, '초대 메시지 복사'),
          h('button', { class: 'btn', onclick: () => copyText(QS, '링크를 복사했습니다') }, '링크만 복사'))),
      h('section', { class: 'block' }, h('h2', null, '내가 접속하기'),
        h('div', { class: 'row' },
          native.available ? h('button', { class: 'btn', onclick: () => native.call('shell.open', { path: 'teamviewer8://' }).catch(() => window.open(JOIN, '_blank')) }, 'TeamViewer 열기') : null,
          h('button', { class: 'btn', onclick: () => window.open(JOIN, '_blank', 'noopener') }, '웹에서 세션 참여')),
        h('p', { class: 'hint' }, 'iPhone·iPad를 지원받을 때는 상대도 TeamViewer QuickSupport 앱을 설치해야 합니다. Apple 기기끼리는 FaceTime 화면 공유도 쓸 수 있습니다.'))));
}
