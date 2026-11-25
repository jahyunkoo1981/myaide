# MY AIDE 설치 매뉴얼

처음 한 번만 하면 되는 설정입니다. Google Drive(데이터 저장), Google Cloud(로그인 허가), GitHub(휴대폰용 화면), Git(올리기 자동화), .NET(Windows 실행 파일) 순서입니다. 결제 정보는 어디에도 필요 없습니다.

| 단계 | 무엇 | 필수 |
| --- | --- | --- |
| 1 | Google Drive for desktop | 선택 (PC 탐색기에서 파일을 보고 싶을 때) |
| 2 | Google Cloud 설정 | 필수 (한 번) |
| 3 | GitHub 저장소와 Pages | 필수 (휴대폰·태블릿·Mac용) |
| 4 | Git for Windows | 권장 (수정사항 올리기를 더블클릭으로) |
| 5 | .NET 8 SDK와 빌드 | Windows 실행 파일을 만들 PC에만 |
| 6 | 기기별 첫 연결 | 기기마다 한 번 |

웹 앱 주소: https://jahyunkoo1981.github.io/myaide/
PC 폴더: 바탕화면\MyAide

## 1. Google Drive for desktop (선택)

MY AIDE는 인터넷으로 Drive에 직접 저장하므로 없어도 됩니다. PC 탐색기에서 MY AIDE 폴더와 백업 파일을 보고 싶을 때만 설치합니다.

1. https://www.google.com/drive/download/ 에서 **데스크톱용 Drive 다운로드**를 누릅니다.
2. 받은 `GoogleDriveSetup.exe`를 실행해 설치합니다.
3. MY AIDE에 쓰는 것과 **같은 Google 계정**으로 로그인합니다.
4. 탐색기에 **Google Drive (G:)**가 생기면 완료입니다. `G:\내 드라이브\MY AIDE` 안에 `records`(기록), `files`(녹음), `backups`(백업)가 있습니다.

이 폴더의 파일을 직접 고치거나 지우지 마세요. 수정은 MY AIDE 화면에서 해야 동기화가 꼬이지 않습니다.

## 2. Google Cloud 설정

MY AIDE가 내 Drive에 저장하려면 Google에 프로그램을 한 번 등록해야 합니다. 데이터는 Google Cloud가 아니라 Drive에 저장됩니다. ‘무료 체험판 $300’ 배너는 누르지 마세요.

주소: https://console.cloud.google.com (MY AIDE에 쓸 Google 계정으로 로그인)

| 단계 | 메뉴 | 할 일 |
| --- | --- | --- |
| 2-1 | 프로젝트 선택 › 새 프로젝트 | 이름 `MY AIDE` → 만들기 |
| 2-2 | 검색창 `Google Drive API` | **사용** |
| 2-3 | Google 인증 플랫폼 › 시작하기 | 앱 이름 `MY AIDE`, 대상 **외부**, 연락처 이메일 |
| 2-4 | 데이터 액세스 › 범위 추가 | `.../auth/drive.file` 하나만 체크 → 업데이트 → 저장 |
| 2-5 | 클라이언트 › 만들기 | **데스크톱 앱** `MY AIDE Windows` → JSON 다운로드 (바탕화면에 두기) |
| 2-6 | 클라이언트 › 만들기 | **웹 애플리케이션** `MY AIDE Web` (아래 값) |
| 2-7 | 브랜딩 | 홈페이지·개인정보처리방침·승인된 도메인 (아래 값) → 저장 |
| 2-8 | 대상 | **앱 게시** → 확인 (테스트 중 → 프로덕션) |

2-6 웹 클라이언트 값

- 승인된 자바스크립트 원본: `https://jahyunkoo1981.github.io` (끝에 `/` 없음)
- 승인된 리디렉션 URI: `https://jahyunkoo1981.github.io/myaide/` (끝의 `/` 포함)

2-7 브랜딩 값

- 애플리케이션 홈페이지: `https://jahyunkoo1981.github.io/myaide/`
- 개인정보처리방침 링크: `https://jahyunkoo1981.github.io/myaide/privacy.html`
- 승인된 도메인: `jahyunkoo1981.github.io`

2-8을 하지 않으면 7일마다 Google에 다시 로그인해야 합니다. 로그인 중 ‘Google에서 확인하지 않은 앱’ 경고가 뜨면 **고급 › MY AIDE(으)로 이동**을 누릅니다(본인이 만든 앱입니다). 데스크톱 클라이언트의 보안 비밀번호는 다른 사람에게 보내지 마세요.

## 3. GitHub 가입과 웹 앱 올리기

GitHub Pages는 휴대폰·태블릿·Mac에서 열 MY AIDE 화면을 무료로 올려 두는 곳입니다. 화면만 올라가고 기록은 각자의 Google Drive에만 있습니다.

1. https://github.com 에서 **Sign up**으로 가입하고 이메일 인증을 합니다.
2. **+ › New repository** → 이름 `myaide`(이름만) → **Public** → **Create repository**
3. **uploading an existing file** → `MyAide\v2\web` 폴더 **안의 내용 전부**를 끌어다 놓기 → **Commit changes**
4. **Settings › Pages** → Source `Deploy from a branch`, Branch `main` / `(root)` → **Save**
5. 1~2분 뒤 ‘Your site is live’가 뜨면 완료입니다.

이후에는 수동 업로드 대신 4단계의 `웹앱 올리기.bat`을 씁니다.

## 4. Git for Windows와 ‘웹앱 올리기.bat’

1. https://git-scm.com/download/win 에서 64-bit 설치 파일을 받습니다.
2. 설치 화면은 모두 **기본값 그대로 Next** → **Install**.
3. `바탕화면\MyAide\웹앱 올리기.bat`을 더블클릭합니다.
4. **처음 한 번만** GitHub 로그인 창이 뜹니다. **Sign in with your browser** → **Authorize**.
5. `[UPLOAD OK]`가 보이면 1~2분 뒤 휴대폰·태블릿에 새 화면이 반영됩니다. `[UPLOAD FAILED]`면 그 창을 캡처해 Claude에게 보내 주세요.

## 5. .NET 8 SDK와 MY AIDE.exe 만들기

1. https://dotnet.microsoft.com/download/dotnet/8.0 → **SDK 8.0.x › Windows x64** 설치 프로그램을 받아 설치합니다.
2. `바탕화면\MyAide\빌드 및 실행.bat`을 더블클릭합니다. 처음에는 1~3분 걸립니다.
3. `[BUILD OK]`가 보이면 `MyAide\MY AIDE.exe`가 새로 만들어지고 바로 실행됩니다. 실패하면 `build.log`를 Claude에게 보내 주세요.
4. 원격지원 도우미(`v2\web\support\MyAideSupport.exe`)는 이미 만들어져 들어 있습니다. `웹앱 올리기.bat`으로 올려 두어야 상대방이 원격지원 페이지에서 내려받을 수 있습니다.

업무망 PC에는 빌드하지 않고, 만든 `MY AIDE.exe` 파일 하나만 복사해 실행합니다. .NET 설치는 필요 없습니다.

## 6. 기기별 첫 연결과 비밀번호

각 기기에서 **처음 한 번만** Google에 연결하고, 그 뒤에는 MY AIDE 비밀번호만 입력합니다.

| 기기 | 여는 방법 | 처음 한 번 |
| --- | --- | --- |
| Windows | `MyAide\MY AIDE.exe` | **Google Drive에 저장** → 바탕화면의 `client_secret_…json`을 자동으로 읽음 → 브라우저에서 Google 로그인·허용 |
| iPhone·iPad | Safari로 웹 앱 주소 | **Google Drive에 저장** → Google 로그인 → 공유 버튼 › **홈 화면에 추가** |
| Android | Chrome으로 웹 앱 주소 | **Google Drive에 저장** → Google 로그인 → 메뉴 › **앱 설치** |
| Mac | Safari 또는 Chrome | **Google Drive에 저장** → Google 로그인 → 파일 › **Dock에 추가** |
| 업무망 PC | 복사한 `MY AIDE.exe` | **이 PC에만 저장 (업무망)** → 비밀번호 만들기 |

- 비밀번호는 처음 연결한 기기에서 만들고, 모든 기기에서 같은 비밀번호를 씁니다.
- 계정정보와 OpenAI API 키는 이 비밀번호로 암호화되어 저장됩니다.
- 잊었을 때는 로그인 화면의 **비밀번호를 잊었어요**. 기록은 그대로 남고 계정정보와 API 키만 지워집니다.

## 7. 수정사항 반영과 문제 해결

프로그램을 고친 뒤에는 `웹앱 올리기.bat`(휴대폰·태블릿용) → `빌드 및 실행.bat`(Windows용) 순서로 실행합니다.

| 증상 | 해결 |
| --- | --- |
| `redirect_uri_mismatch` | 2-6 리디렉션 URI가 주소와 글자 하나까지 같은지(끝의 `/` 포함) 확인 |
| ‘확인하지 않은 앱’ 경고 | **고급 › MY AIDE(으)로 이동** |
| 7일마다 다시 로그인 | 2-7, 2-8을 마쳐 ‘프로덕션’으로 전환 |
| 휴대폰에서 PC 기록이 안 보임 | 같은 Google 계정인지, 두 클라이언트가 같은 프로젝트인지 확인 |
| iPhone에서 ‘Google 다시 연결’ | 웹 방식은 약 1시간마다 누르면 됩니다. 그동안 쓴 내용은 기기에 남아 있음 |
| 웹 화면이 예전 그대로 | 2~3분 기다렸다가 새로고침(PC는 `Ctrl + F5`) |
| `MY AIDE.exe`가 안 열림 | `%LOCALAPPDATA%\MY AIDE\error.log`를 Claude에게 보내기 |
| 업무망 PC에서 WebView2 안내 | Microsoft Edge WebView2 런타임 설치를 IT 담당자에게 요청 |
