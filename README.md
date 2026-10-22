> 2026-10-21 통합 시험: `VITE_USE_API=true`와 `VITE_USE_LIVE_V1=true`를 빌드 시 함께 설정하면 기존 화면 대신 실제 liveId 채팅·검토 콘솔을 사용합니다. 기본값은 false입니다. BE #29 통합 브랜치와 Agent #48 Gateway가 필요합니다. 상세·제한은 [통합 시험](docs/live-v1-integration.md)을 참조하세요.

2026-10-22 P0 채팅 상태 처리: 실제 API 콘솔에 작성자 숨김 사유·검토 중 표시, TIMEOUT 안내·입력 차단, 강퇴·방송 종료 화면을 반영했습니다. [변경 내용과 검증 기록](docs/chat-state-ui.md)을 참고하세요.

목업과 API 시청자 화면은 `ViewerScreen.vue`를 공통으로 사용합니다. 넓은 화면에서는 왼쪽 영상·오른쪽 채팅, 모바일에서는 위쪽 영상·아래쪽 채팅으로 배치합니다. TIMEOUT 중에는 입력부만 제한 안내창으로 바꿉니다. 다른 사람의 채팅은 계속 실시간으로 보이며 검색·스크롤과 영상 시청도 유지합니다. 제한 해제 후에는 입력창을 복원합니다. 날짜와 남은 시간·시작 및 해제 효과·사유와 종료 안내의 줄바꿈도 공통입니다. API는 기존 liveId REST/SSE와 서버 제재 상태를 유지하며, 목업 계정·시연 버튼·가상 구독자 수와 반응 수는 목업에서만 표시합니다.

# LIVE:GUARD — Frontend

**LIVE:GUARD**는 AI Agent가 라이브 방송 채팅을 관제하고, 운영자가 주요 제재를 최종 승인하는 서비스입니다. 이 저장소는 시청자·스트리머·시스템 운영자용 웹 프론트엔드를 제공합니다.

* **시청자:** 방송 시청, 실시간 채팅, 채팅 제한·입장 제한 상태 확인

* **스트리머:** 실시간 채팅 관제, AI 판정·자동 조치 확인, 강퇴 승인·기각

* **시스템 운영자:** 방송별 관제 현황과 Agent 조치 결과 모니터링

**기술 스택:** Vue 3 · TypeScript · Pinia · Vite · REST API · SSE

## 1. 주요 화면

로그인한 계정의 역할(`VIEWER`, `MODERATOR`, `PLATFORM_ADMIN`)에 따라 화면이 전환됩니다. YouTube Live·YouTube Studio의 UI 구성을 참고했습니다.

| 화면         | 핵심 기능                                   | 미리보기                                 |
| ---------- | --------------------------------------- | ------------------------------------ |
| 로그인        | 계정 인증 및 역할별 화면 진입                       | [이미지](docs/screenshots/login.png)    |
| 시청자        | 방송 플레이어, 실시간 채팅, 본인 메시지·제재 상태 확인        | [이미지](docs/screenshots/viewer.png)   |
| 스트리머 운영 콘솔 | 실시간 AI 관제, 숨김 내역, 강퇴 승인·기각, 사건·정책·실행 기록 | [이미지](docs/screenshots/operator.png) |
| 시스템 운영자    | 방송별 지표, 강퇴 검토·실행 결과, Agent 활동 모니터링      | [이미지](docs/screenshots/system.png)   |

<br />

### AI 관제 흐름

```text
시청자 채팅 → AI Agent 판정 ─┬→ 메시지 숨김 / 10분 채팅 제한 (자동)
                            └→ 24시간 제한 권고 → 운영자 승인·기각 → Agent 재개
```

24시간 제한은 Agent의 `interrupt()` 이후 운영자 승인을 받아 실행합니다. 승인 요청이 접수된 것과 실제 강퇴 실행 완료는 구분합니다.

## 2. 실행 방법

**요구 환경:** Node.js 20 이상 (`.nvmrc`: 20.20.2)

```bash
npm install
npm run dev
```

접속: **<http://localhost:5173>**

기본값은 **Mock 모드**이며, 백엔드 없이 화면과 제재 시나리오를 시연할 수 있습니다.

<br />

###### 로그인 ID / Password

* Mock 모드와 백엔드 연결(API 모드) 모두 같은 계정을 씁니다. API 모드에서는 Backend를 `local` 프로파일로 실행했을 때 들어가는 시드 계정입니다.

| 역할      | 아이디         | 비밀번호              | 들어가는 화면       |
| :------ | :---------- | :---------------- | :------------ |
| 시청자     | `viewer`    | `liveguard-local` | 시청자 채팅 화면     |
| 스트리머    | `moderator` | `liveguard-local` | 운영 콘솔         |
| 시스템 운영자 | `admin`     | `liveguard-local` | AI Agent 모니터링 |

**시연 예시:** `moderator` 로그인 → **빠른 시연**에서 `개인정보` 3회 선택 → 강퇴 승인·기각 → **실행 기록** 확인. Mock 상태는 같은 탭에서 계정을 전환해도 유지되며, 새로고침하면 초기화됩니다.

**채팅 제한 UI 시연:** `viewer` 로그인 → 영상 아래 **목업 시연**에서 **제한·해제 효과 보기**를 누릅니다. 주황색 제한 안내와 입력 차단을 확인하고, 10초 후 초록색 해제 안내·입력창 강조·채팅 복구를 확인할 수 있습니다. **24시간 표시 보기**로 다음 날 종료 날짜를 확인하고 **제한 해제 시연**으로 바로 해제할 수도 있습니다. 이 버튼은 목업 화면 상태만 바꾸며, 시연용 10초는 실제 정책 시간이 아닙니다.

**목업 직접 입력:** 시청자 채팅에 `시발`이 포함되면 욕설 규칙을 적용합니다. 한 메시지는 위반 1건이며, 같은 시청자의 욕설 사건 기준으로 1회 숨김 → 2회 숨김＋10분 채팅 제한 → 3회 이상 숨김＋24시간 채팅 제한입니다. `시발점`·`시발역`은 예외이며, 다른 욕설·띄어쓴 우회 표현은 검사하지 않습니다. 두 번째 제한이 끝난 뒤 세 번째를 입력하거나, **제한 해제 시연**으로 입력을 복구해 다음 단계를 확인할 수 있습니다. 이 시연 해제는 욕설 누적 이력을 지우지 않으며, 새로고침하면 목업 초기 상태로 돌아갑니다. API 모드의 판정은 Backend가 수행합니다.

**기타 명령어:** `npm run build`(타입 검사·프로덕션 빌드), `npm run preview`(빌드 미리보기)

## 3. 백엔드 연동

[Backend 저장소](https://github.com/skalaP05-03-261019/liveguard-be)의 안내에 따라 PostgreSQL과 Spring Boot 서버를 먼저 실행합니다. 로컬 백엔드 기본 주소는 `http://localhost:8080`입니다.

```bash
VITE_USE_API=true npm run dev
```

지속적으로 API 모드를 사용하려면 `.env.example`을 `.env.local`로 복사하고 `VITE_USE_API=true`로 설정합니다.

| 환경 변수                 | 기본값                     | 설명                             |
| --------------------- | ----------------------- | ------------------------------ |
| `VITE_USE_API`        | `false`                 | `true`: 실제 API / `false`: Mock |
| `VITE_BACKEND_TARGET` | `http://localhost:8080` | 개발 서버의 `/api` 프록시 대상           |
| `VITE_API_BASE_URL`   | 빈 값                     | 별도 API 기본 주소가 필요한 경우 설정        |
| `VITE_STREAM_SRC`     | 기본 데모 영상                | 방송 영상 URL                      |
| `VITE_STREAM_POSTER`  | 기본 포스터                  | 영상 썸네일 URL                     |

* **API 모드 계정:** `viewer`, `moderator`, `admin` / 공통 비밀번호 `liveguard-local` (`local` 프로파일 시드 계정)

* **인증:** Spring Session 쿠키(`JSESSIONID`) 및 CSRF 토큰(`XSRF-TOKEN`) 사용

* **통신:** REST API로 인증·채팅·사건 조회·강퇴 결정을 처리하고, SSE로 채팅·관제 이벤트를 수신

* **주의:** `VITE_` 환경 변수는 브라우저에 노출되므로 비밀번호·API 비밀키를 넣지 않습니다.

### 연동 현황

| 기능                | 상태                     |
| ----------------- | ---------------------- |
| 로그인·세션 인증         | API 연동                 |
| 채팅 조회·전송 및 SSE 수신 | API 연동                 |
| 사건 조회·강퇴 승인 API   | 프론트 구현 완료, 백엔드 구현 진행 중 |
| 시스템 운영자 통합 지표     | Mock 데이터               |

사건 API가 아직 없는 환경에서는 운영 콘솔에 조회 오류가 표시될 수 있으나, 로그인과 채팅 기능은 별도로 동작합니다. 인증·제재의 최종 권한은 백엔드에 있습니다.

### Docker로 실행

빌드한 화면 파일을 nginx가 제공하고, `/api` 요청은 nginx가 백엔드로 전달합니다. 화면과 API가 같은 주소에서 나오므로 세션·CSRF 쿠키와 SSE가 개발 서버와 똑같이 동작합니다. 백엔드(`http://localhost:8080`)를 먼저 실행해 둡니다.

```bash
# 이미지 만들기 (기본: API 모드)
docker build -t liveguard-fe:local .

# 실행: 내 컴퓨터 3000 → 컨테이너 8080 (백엔드가 8080을 쓰므로 3000으로 연다)
docker run --rm --name liveguard-fe -p 3000:8080 liveguard-fe:local
```

접속: **<http://localhost:3000>**

<br />

환경변수

| 설정                  | 넣는 시점                | 기본값                                | 설명                                        |
| ------------------- | -------------------- | ---------------------------------- | ----------------------------------------- |
| `VITE_USE_API`      | 빌드 (`--build-arg`)   | `true`                             | `false`면 Mock 모드 이미지. 바꾸면 **다시 빌드**해야 합니다 |
| `VITE_API_BASE_URL` | 빌드 (`--build-arg`)   | 빈 값                                | 비워 두면 같은 주소의 `/api`로 요청                   |
| `BACKEND_URL`       | 실행 (`docker run -e`) | `http://host.docker.internal:8080` | nginx가 `/api`를 넘길 백엔드 주소                  |

* **확인:** `curl -i http://localhost:3000/api/auth/me`가 `401`과 `Set-Cookie: XSRF-TOKEN=...`을 돌려주면 nginx를 거쳐 백엔드까지 연결된 것입니다.

* 컨테이너 안의 `localhost`는 컨테이너 자신이므로, 내 컴퓨터의 백엔드는 `host.docker.internal`로 가리킵니다. 다른 백엔드에 붙일 때는 `-e BACKEND_URL=http://주소:포트`를 추가합니다.

* 빌드 중에 타입 검사(`vue-tsc`)를 하므로 타입 오류가 있으면 이미지 빌드가 실패합니다.

| 증상                              | 원인·해결                                           |
| ------------------------------- | ----------------------------------------------- |
| 로그인 창에 "데모 계정을 선택해 체험해 보세요"가 보임 | Mock 모드로 빌드됨. `VITE_USE_API=true`(기본값)로 다시 빌드   |
| `/api` 요청이 502                  | 백엔드가 꺼져 있거나 `BACKEND_URL`이 잘못됨                  |
| 채팅이 실시간으로 안 올라옴                 | `nginx.conf.template`의 `proxy_buffering off` 확인 |

## 4. 프로젝트 구조

```text
src/
├── App.vue                 # 역할 분기·스트리머 운영 콘솔
├── LoginPage.vue           # 로그인
├── ViewerScreen.vue        # Mock/API 공통 시청자 UI
├── ViewerPage.vue          # Mock·기존 채널 경로의 시청자 데이터 연결
├── LiveConsole.vue         # liveId API/SSE 연결·운영 콘솔
├── SystemPage.vue          # 시스템 운영자 모니터링
├── YtPlayer.vue            # 방송 플레이어
├── stores/liveGuard.ts     # Pinia 상태·Mock/API 모드
├── api/client.ts           # REST API 클라이언트
├── contracts.ts            # API 타입·라벨
├── sanction.ts             # 채팅 제재 기준
├── mock.ts / systemMock.ts # 시연 데이터
└── style.css               # 공통 스타일
docs/
├── screenshots/            # 화면 캡처
├── openapi-v0.5-lite.yaml  # 브라우저 API 명세 발췌본
└── erd.mmd                 # ERD 관계도
public/media/               # 데모 영상·포스터
Dockerfile                  # 빌드(Node 20) → 실행(nginx) 2단계 이미지
nginx.conf.template         # 화면 제공·/api 프록시·SSE 설정 (BACKEND_URL 치환)
.dockerignore               # 이미지에서 제외할 파일 (.env, node_modules 등)
```

## 5. 명세 및 참고 자료

* **API 기준:** [Backend `contracts/openapi.yaml`](https://github.com/skalaP05-03-261019/liveguard-be/blob/main/contracts/openapi.yaml) (v0.5). 프론트의 `docs/openapi-v0.5-lite.yaml`은 브라우저 호출 API 발췌본입니다.

* **데이터 모델:** [Backend `docs/erd.md`](https://github.com/skalaP05-03-261019/liveguard-be/blob/main/docs/erd.md)

* **운영 정책:** [공통 기획서·정책 v0.3](https://github.com/skalaP05-03-261019/liveguard-be/tree/main/docs/live-guard/v0.3) / 프론트 제재 표시 로직 `src/sanction.ts`

* **Agent 저장소:** [liveguard-agent](https://github.com/skalaP05-03-261019/liveguard-agent)

**연동 시 유의사항:** `PII_EXPOSURE`, 10분 채팅 제한 이벤트 등 일부 제재 항목은 프론트에 선반영되어 있습니다. 백엔드 API·정책 명세와 최종 일치 여부를 확인해야 합니다.

**데모 영상:** `public/media/live-stream.mp4`는 [Mnet M2의 A2O LITE - NEON 영상](https://www.youtube.com/watch?v=93j1fDGi_-8) 일부를 시연용으로 사용합니다. (외부 공개·배포 시 영상 사용 권한을 확인하거나 사용 허가된 영상으로 교체해야 합니다.)

## 6. 화면별 API 연결

API 모드에서 각 화면이 호출하는 API입니다. 담당은 [`contracts/openapi.yaml`](https://github.com/skalaP05-03-261019/liveguard-be/blob/main/contracts/openapi.yaml)의 `x-owner`, 백엔드 상태는 2026-10-21 기준 `liveguard-be` 코드입니다. 호출 코드는 `src/api/client.ts`에 모여 있습니다.

| 화면      | 호출 시점                        | API                                               | 담당 | 백엔드                                       |
| ------- | ---------------------------- | ------------------------------------------------- | -- | ----------------------------------------- |
| 로그인     | 앱 시작(세션 복원, `XSRF-TOKEN` 발급) | `GET /api/auth/me`                                | B1 | 구현                                        |
| 로그인     | 로그인 버튼 (세 역할 공통)             | `POST /api/auth/login`                            | B1 | 구현                                        |
| 공통      | 로그아웃 버튼                      | `POST /api/auth/logout`                           | B1 | 구현                                        |
| 시청자     | 입장, `CHAT` 이벤트 수신 시          | `GET /api/channels/{channelId}/messages?limit=50` | B1 | 구현                                        |
| 시청자     | 채팅 전송                        | `POST /api/channels/{channelId}/messages`         | B1 | 구현                                        |
| 시청자     | 실시간 채팅 (SSE)                 | `GET /api/channels/{channelId}/events`            | B1 | `CHAT`만 발송                                |
| 운영 콘솔   | 입장, 새로고침, `CHAT` 이벤트 수신 시    | `GET /api/channels/{channelId}/messages?limit=50` | B1 | 구현                                        |
| 운영 콘솔   | 실시간 채팅 (SSE)                 | `GET /api/channels/{channelId}/events`            | B1 | `CHAT`만 발송                                |
| 운영 콘솔   | 관제 이벤트 (SSE)                 | `GET /api/guard/events?channelId=`                | B1 | `TOOL_START`·`TOOL_END`·`TASK_FAILED`만 발송 |
| 운영 콘솔   | 입장, 새로고침, 사건 이벤트 수신 시        | `GET /api/cases?channelId=`                       | B2 | 미구현 (404)                                 |
| 운영 콘솔   | 사건 선택, 목록 조회 후               | `GET /api/cases/{caseId}`                         | B2 | 미구현                                       |
| 운영 콘솔   | 강퇴 승인·기각 버튼                  | `POST /api/kick-reviews/{reviewId}/decision`      | B2 | 미구현                                       |
| 운영 콘솔   | 오탐 해제 (현재 화면에 버튼 없음)         | `POST /api/cases/{caseId}/release`                | B2 | 미구현                                       |
| 시스템 운영자 | 없음 (로그인·로그아웃만)               | —                                                 | —  | 여러 채널 통합 조회 API는 계약에 없음                   |

* 시청자 화면은 사건 API와 관제 SSE를 호출하지 않습니다(`MODERATOR`·`PLATFORM_ADMIN`만 호출).

* 채팅 SSE의 `MESSAGE_VISIBILITY_CHANGED`(메시지 숨김·복원)와 `USER_KICKED`(강퇴), 관제 SSE의 `CASE_CREATED`·`CASE_UPDATED`·`KICK_REVIEW_REQUIRED`·`KICK_APPLIED`는 계약에 있고 프론트도 받도록 되어 있지만, 발생시키는 B2 기능이 아직 없어 오지 않습니다.

* `USER_TIMED_OUT`(10분 채팅 제한)은 프론트가 미리 받도록 해 둔 제안 이벤트로, 계약에는 아직 없습니다.

