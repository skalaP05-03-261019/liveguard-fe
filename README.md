> 2026-10-22 운영자 콘솔 통일(#12): 목업과 실제 API가 같은 Studio 화면(`StudioScreen.vue`)을 씁니다. 목업 판정은 운영정책 v3.1과 Backend 처리 경로를 따릅니다. `VITE_USE_LIVE_V1`은 더 이상 쓰지 않으며, `VITE_USE_API=true`이면 항상 실제 liveId API 화면입니다.

2026-10-22 운영자 검토·제재 승인 흐름(#13): 실제 Backend·Agent에서 보류·정상 확정·동시 결정 충돌·강퇴 기각을 확인했습니다. [검증 기록](docs/review-flow.md)을 참고하세요.

2026-10-22 P0 채팅 상태 처리: 작성자 숨김 사유·검토 중 표시, TIMEOUT 안내·입력 차단, 강퇴·방송 종료 화면을 반영했습니다. [변경 내용과 검증 기록](docs/chat-state-ui.md)을 참고하세요.

목업과 API는 화면 컴포넌트를 함께 쓰고 데이터 연결만 다릅니다. 시청자는 `ViewerScreen.vue`, 운영자는 `StudioScreen.vue`입니다. 목업 계정·시연 버튼·가상 구독자 수와 반응 수는 목업에서만 표시합니다.

# LIVE:GUARD — Frontend

**LIVE:GUARD**는 AI Agent가 라이브 방송 채팅을 관제하고, 운영자가 주요 제재를 최종 승인하는 서비스입니다. 이 저장소는 시청자·스트리머·시스템 운영자용 웹 프론트엔드를 제공합니다.

* **시청자:** 방송 시청, 실시간 채팅, 채팅 제한·입장 제한 상태 확인

* **스트리머:** 실시간 채팅 관제, AI 제안 확인 후 문맥 검토 결정, 강퇴 승인·기각, 오판 취소

* **시스템 운영자:** 방송별 관제 현황 모니터링 (목업 전용. 여러 방송 통합 지표 API는 없음)

**기술 스택:** Vue 3 · TypeScript · Pinia · Vite · REST API · SSE

## 1. 주요 화면

로그인한 계정의 역할(`VIEWER`, `MODERATOR`, `PLATFORM_ADMIN`)에 따라 화면이 전환됩니다. YouTube Live·YouTube Studio의 UI 구성을 참고했습니다.

| 화면         | 핵심 기능                                   | 미리보기                                 |
| ---------- | --------------------------------------- | ------------------------------------ |
| 로그인        | 계정 인증 및 역할별 화면 진입                       | [이미지](docs/screenshots/login.png)    |
| 시청자        | 방송 플레이어, 실시간 채팅, 본인 메시지·제재 상태 확인        | [이미지](docs/screenshots/viewer.png)   |
| 스트리머 · 실시간 관제 | 채팅, 운영자 결정 대기(문맥 검토·강퇴 승인 카드), 규칙 자동 숨김 내역 | [이미지](docs/screenshots/operator.png) |
| 스트리머 · 시청자 관리 | 현재 방송에서 제재받은 시청자별 상태·확정 위반·유형, 오판 취소, 검토 결정 | [이미지](docs/screenshots/viewer-manage.png) |
| 스트리머 · 사건 이력 / 정책 근거 / 진행 기록 | 사건별 처리 경로·AI 제안·확정 상태, v3.1 처리 경로·제재표(읽기 전용), 현재 세션의 실시간 이벤트 | - |
| 시스템 운영자 (목업) | 방송별 지표, 강퇴 승인 요청·실행 결과 | [이미지](docs/screenshots/system.png)   |

* 캡처는 Mock 모드 화면입니다. 실제 API 모드도 같은 메뉴·카드 구성이며, MOCK 표기와 빠른 시연·모의 강퇴 결과 버튼만 없습니다.

<br />

### AI 관제 흐름

```text
시청자 채팅 → Backend 규칙 ─┬→ 확정 욕설·링크·도배: 바로 숨김 + 기준표의 채팅 제한 (자동)
                            └→ 공격 표현·사칭·개인정보: AI 제안 → 운영자 문맥 검토 (결정 전까지 임시 비노출)
확정 위반 3건 (최근 24시간, 유형 무관) → 강퇴 승인 요청 → 운영자 승인 → 재검증 → 이번 방송 종료까지 입장·채팅 제한
```

채팅 제한(10분·24시간)은 모두 자동이며 24시간 제한도 강퇴가 아닙니다. 강퇴는 승인 요청이 접수된 것과 실제 적용 완료(`ACTION_APPLIED`)를 구분합니다. 기준: 운영정책 v3.1 MP-2.1·MP-4.1~4.3.

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

**시연 예시:** `moderator` 로그인 → 채팅 아래 **빠른 시연**에서 `공격 표현`·`공식 사칭`·`개인정보`를 눌러 문맥 검토 카드 확인 → 정상·위반·보류 결정. 초기 데이터의 `어둠의유저`는 확정 위반 3건으로 강퇴 승인 요청이 올라와 있습니다. 승인하면 **모의 적용 성공·실패·결과 미확인** 버튼으로 실행 결과를 시뮬레이션합니다. 결과는 **진행 기록**에서 확인합니다. Mock 상태는 같은 탭에서 계정을 전환해도 유지되며, 새로고침하면 초기화됩니다.

**목업 판정:** Backend 필터 사전(`src/main/resources/filter/`)의 사본과 같은 처리 경로를 씁니다. AI 제안은 실제 모델 대신 고정 규칙으로 붙인 `(목업 Agent)` 결과입니다.

**채팅 제한 UI 시연:** `viewer` 로그인 → 영상 아래 **목업 시연**에서 **제한·해제 효과 보기**를 누릅니다. 주황색 제한 안내와 입력 차단을 확인하고, 10초 후 초록색 해제 안내·입력창 강조·채팅 복구를 확인할 수 있습니다. **24시간 표시 보기**로 다음 날 종료 날짜를 확인하고 **제한 해제 시연**으로 바로 해제할 수도 있습니다. 이 버튼은 목업 화면 상태만 바꾸며, 시연용 10초는 실제 정책 시간이 아닙니다.

**목업 직접 입력:** 시청자 채팅도 같은 목업 판정을 거칩니다. 확정 욕설(`시발`·`씨발`·`ㅅㅂ` 등, 예외 `시발점`·`시발역`)은 같은 시청자의 욕설 확정 수에 따라 1회 숨김 → 2회 숨김＋10분 채팅 제한 → 3회 이상 숨김＋24시간 채팅 제한입니다. 링크는 바로 숨김, 공격 표현·사칭·연락처는 운영자 검토 전까지 임시 비노출입니다. 띄어 쓴 우회 표현은 Backend와 마찬가지로 검사하지 않습니다. **제한 해제 시연**은 입력 제한만 풀고 이력은 남깁니다. API 모드의 판정은 Backend가 수행합니다.

**기타 명령어:** `npm run build`(타입 검사·프로덕션 빌드), `npm run preview`(빌드 미리보기)

## 3. 백엔드 연동

[Backend 저장소](https://github.com/skalaP05-03-261019/liveguard-be)의 안내에 따라 PostgreSQL과 Spring Boot 서버를 먼저 실행합니다. 로컬 백엔드 기본 주소는 `http://localhost:8080`입니다.

```bash
VITE_USE_API=true npm run dev
```

API 모드는 백엔드 v1.0(liveId) API를 씁니다. 백엔드·AI Agent까지 한 번에 붙이는 방법은 아래 [전체 연결](#전체-연결-backend--ai-agent-infra)을 참고합니다.

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
| 방송 시작·종료, 사건·검토 조회, 문맥 검토·강퇴 결정, 오판 취소, 시청자 관리 | API 연동 (liveId) |
| 시스템 운영자 통합 지표     | Mock 데이터. API 모드에서는 "데이터 없음" 안내만 표시 |
| 강퇴 실패·결과 미확인 표시 | 화면은 구현됨. Backend가 `ACTION_FAILED`를 아직 발행하지 않아 테스트 서버로만 확인 |

* **2026-10-22 infra 통합 실행에서 화면으로 확인:** 로그인, 채팅 전송·실시간 수신, 관제 SSE, 사건·검토 조회, 오판 취소, AI Agent 판정 후 문맥 검토 생성. 문맥 검토 결정은 [통합 시험 기록](docs/live-v1-integration.md)을 참고합니다.

* 인증·제재의 최종 권한은 백엔드에 있습니다.

### 전체 연결: Backend + AI Agent (infra)

[liveguard-infra](https://github.com/skalaP05-03-261019/liveguard-infra)의 Docker Compose로 DB·Backend·AI Agent·MCP 서버와 이 프론트를 한 번에 실행합니다. 자세한 절차는 infra README를 따르고, 여기에는 프론트에 필요한 부분만 적습니다.

1. infra 폴더에서 `.env.example`을 `.env`로 복사하고 값을 채웁니다. 실제 API 콘솔과 시청자 관리를 쓰려면 아래 값이 필요합니다.

| 값 | 이유 |
| --- | --- |
| `LIVEGUARD_POLICY_VERSION=v3.1`, `LIVEGUARD_TBD_FIXTURE_ENABLED=true` | 백엔드의 방송(liveId) 단위 관제를 켭니다. 없으면 사건에 liveId가 붙지 않아 시청자 관리가 비어 보입니다 |
| (`LIVEGUARD_V1_UI`) | 더 이상 필요 없습니다. API 모드 빌드는 항상 liveId 콘솔입니다 |
| `AGENT_DELIVERY_ENABLED=true` | 백엔드가 AI Agent에 판정을 맡깁니다 |
| `AGENT_CHECKPOINT_DB_URL`, `RAG_DB_URL` | `postgresql://liveguard:<DB 비밀번호>@db:5432/liveguard` 형식. 안내 문구를 그대로 두면 Agent가 시작하지 못합니다 |

2. 실행하고 6개 서비스(db, backend, agent, business-mcp, rag-mcp, frontend)가 `Up`인지 확인합니다.

```bash
cd ../infra
docker compose up -d
docker compose ps
```

3. 처음 한 번 운영 정책을 색인합니다. OpenAI API를 호출하므로 비용이 조금 발생합니다.

```bash
docker compose run --rm --no-deps rag-mcp python -m app.rag_mcp.index
```

**접속**

* **3000번 (infra가 빌드한 화면):** <http://localhost:3000>. 프론트 코드를 바꾼 뒤에는 `docker compose up -d --build --no-deps frontend`로 프론트만 다시 빌드합니다. `--no-deps`가 없으면 백엔드도 새로 만들어져 로그인이 풀립니다.

* **5173번 (개발 서버):** 이 저장소에서 `VITE_USE_API=true npm run dev`. infra 백엔드가 `127.0.0.1:8080`을 열어 두므로 `/api`가 그대로 연결됩니다.

**AI Agent를 거치는 채팅** (백엔드 규칙 필터 기준)

| 시청자 채팅 | 처리 |
| --- | --- |
| 확정 욕설, 링크 | 백엔드 규칙으로 바로 숨김·위반 확정 (Agent를 거치지 않음) |
| `미쳤`·`접어라`·`꺼져`·`죽어`가 들어간 말, 공식 사칭 + 로그인 요구 | AI Agent 문맥 판정 → 운영자 **문맥 검토 대기** |
| 전화번호, 이메일 | AI Agent 개인정보 조사 → 필요하면 운영자 문맥 검토 |
| 확정 위반이 누적돼 강퇴 기준(3건) 도달 | AI Agent 강퇴 검토 → 운영자 **강퇴 승인 대기** |

**문제 해결** (2026-10-22 실제 사례)

| 증상 | 원인·해결 |
| --- | --- |
| `localhost:3000` 연결 거부 (`ERR_CONNECTION_REFUSED`) | 다른 Postgres 컨테이너가 5433 포트를 쓰고 있으면 infra 컨테이너가 `Created`에서 멈춥니다. 그 컨테이너를 멈추고 `docker compose up -d` |
| agent가 계속 재시작 | `AGENT_CHECKPOINT_DB_URL`·`RAG_DB_URL`이 잘못됨 (안내 문구가 그대로 있거나 비밀번호 특수문자를 URL 인코딩하지 않음). `docker compose logs agent`로 확인 |
| 5173 화면이 Mock으로 뜸 | 다른 폴더의 개발 서버가 5173을 쓰고 있거나 환경 변수 없이 실행됨. 그 서버를 끄고 위 명령으로 다시 실행 |
| 시청자 관리가 비어 있음 | 백엔드에 `LIVEGUARD_TBD_FIXTURE_ENABLED=true`, `LIVEGUARD_POLICY_VERSION=v3.1`이 없음 |

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
| `BACKEND_URL`       | 실행 (`docker run -e`) | `http://host.docker.internal:8080` | nginx가 `/api`를 넘길 백엔드 주소 (끝에 `/` 없이)       |

* **확인:** `curl -i http://localhost:3000/api/auth/me`가 `401`과 `Set-Cookie: XSRF-TOKEN=...`을 돌려주면 nginx를 거쳐 백엔드까지 연결된 것입니다.

* nginx는 백엔드 주소를 10초마다 다시 찾습니다. 백엔드 컨테이너가 재시작돼 주소가 바뀌어도 프론트를 재시작할 필요가 없습니다.

* 컨테이너 안의 `localhost`는 컨테이너 자신이므로, 내 컴퓨터의 백엔드는 `host.docker.internal`로 가리킵니다. 다른 백엔드에 붙일 때는 `-e BACKEND_URL=http://주소:포트`를 추가합니다.

* 빌드 중에 타입 검사(`vue-tsc`)를 하므로 타입 오류가 있으면 이미지 빌드가 실패합니다.

| 증상                              | 원인·해결                                           |
| ------------------------------- | ----------------------------------------------- |
| 로그인 창에 "데모 계정을 선택해 체험해 보세요"가 보임 | Mock 모드로 빌드됨. `VITE_USE_API=true`(기본값)로 다시 빌드   |
| `/api` 요청이 502                  | 백엔드가 꺼져 있거나 `BACKEND_URL`이 잘못됨. 백엔드가 막 재시작됐다면 10초 안에 자동으로 다시 연결됩니다. Linux에서 `--add-host`로만 만든 이름은 nginx가 찾지 못하므로 IP 주소를 씁니다 |
| 채팅이 실시간으로 안 올라옴                 | `nginx.conf.template`의 `proxy_buffering off` 확인 |

## 4. 프로젝트 구조

```text
src/
├── App.vue                 # 역할별 화면 분기, 목업 운영자 데이터 연결
├── LoginPage.vue           # 로그인
├── ViewerScreen.vue        # Mock/API 공통 시청자 화면
├── ViewerPage.vue          # 목업 시청자 데이터 연결
├── StudioScreen.vue        # Mock/API 공통 운영자(Studio) 화면
├── LiveConsole.vue         # 실제 API 연결: liveId REST·SSE, 시청자·운영자 화면에 데이터 전달
├── SystemPage.vue          # 시스템 운영자 모니터링 (목업)
├── ChatTimeoutNotice.vue   # 채팅 제한 안내 (Mock·API 공용)
├── chatTime.ts             # 제한 종료 시각·남은 시간 표시 (한국 시간)
├── ViewerManage.vue        # 시청자 관리 탭
├── viewerManage.ts         # 시청자 관리 공통 모델 (사건·검토 → 시청자별 행)
├── YtPlayer.vue            # 방송 플레이어
├── stores/liveGuard.ts     # 로그인·세션, 목업 방송 상태
├── api/client.ts           # REST API 클라이언트 (v1.0 liveId)
├── contracts.ts            # API v1.0 타입·라벨
├── sanction.ts             # 정책 v3.1 제재 기준표·강퇴 기준·처리 경로
├── mockLive.ts             # 목업 판정 (Backend 처리 경로·v3.1 재현, API 모양의 사건·검토 생성)
├── mock.ts / systemMock.ts # 시연 데이터·필터 사전 사본
└── style.css               # 공통 스타일
docs/
├── screenshots/            # 화면 캡처
├── evidence/chat-ui/       # 채팅 상태 UI 검증 캡처
├── chat-state-ui.md        # 채팅 상태 처리(#7) 변경·검증 기록
├── evidence/review-flow/   # 검토·제재 승인 흐름 검증 캡처
├── review-flow.md          # 검토·제재 승인 흐름(#13) 검증 기록
└── live-v1-integration.md  # 실제 API 콘솔 통합 시험 기록
tests/live-chat.test.cjs    # 채팅 상태 브라우저 테스트 (npm run test:chat)
public/media/               # 데모 영상·포스터
Dockerfile                  # 빌드(Node 20) → 실행(nginx) 2단계 이미지
nginx.conf.template         # 화면 제공·/api 프록시·SSE 설정 (BACKEND_URL 치환)
.dockerignore               # 이미지에서 제외할 파일 (.env, node_modules 등)
```

## 5. 명세 및 참고 자료

* **API 기준:** [Backend `contracts/openapi.yaml`](https://github.com/skalaP05-03-261019/liveguard-be/blob/main/contracts/openapi.yaml) (v1.0, liveId 기준)

* **데이터 모델:** [Backend `docs/erd.md`](https://github.com/skalaP05-03-261019/liveguard-be/blob/main/docs/erd.md)

* **운영 정책:** [Backend `docs/policy/POLICY.md`](https://github.com/skalaP05-03-261019/liveguard-be/blob/main/docs/policy/POLICY.md) (v3.1, 구현 기준) / 프론트 제재 기준 `src/sanction.ts`

* **Agent 저장소:** [liveguard-agent](https://github.com/skalaP05-03-261019/liveguard-agent)

**연동 시 유의사항 (Backend 현재 동작):** `REVIEW_DECIDED`의 검토 종류를 명세의 `reviewKind` 대신 `kind`로 보내 프론트가 둘 다 읽습니다. 검토 상태에 명세에 없는 `INVALIDATED`(근거 취소·재검증 탈락)가 올 수 있습니다. 검토 카드의 `summary`는 고정 문구이고, AI 근거는 `findings[]`에만 있습니다.

**데모 영상:** `public/media/live-stream.mp4`는 [Mnet M2의 A2O LITE - NEON 영상](https://www.youtube.com/watch?v=93j1fDGi_-8) 일부를 시연용으로 사용합니다. (외부 공개·배포 시 영상 사용 권한을 확인하거나 사용 허가된 영상으로 교체해야 합니다.)

## 6. 화면별 API 연결

호출 코드는 `src/api/client.ts`에 모여 있습니다.

### API v1.0 (liveId)

| 화면 | 호출 시점 | API |
| --- | --- | --- |
| 공통 | 앱 시작(세션 복원) · 로그인 · 로그아웃 | `GET /api/auth/me`, `POST /api/auth/login`, `POST /api/auth/logout` |
| 시청자·운영자 | 입장 (현재 방송 찾기) | `GET /api/channels/{channelId}/lives/current` |
| 운영자 | 방송 시작 / 종료 버튼 | `POST /api/channels/{channelId}/lives` / `POST /api/lives/{liveId}/end` |
| 시청자·운영자 | 입장, 새로고침, SSE 이벤트 수신 시 | `GET /api/lives/{liveId}/messages` |
| 시청자·운영자 | 채팅 전송 | `POST /api/lives/{liveId}/messages` |
| 시청자·운영자 | 실시간 채팅 (SSE) | `GET /api/lives/{liveId}/events` |
| 운영자 | 관제 이벤트 (SSE) | `GET /api/guard/events?liveId=` |
| 운영자 · 실시간 관제·시청자 관리 | 입장, 새로고침, SSE 이벤트 수신 시 | `GET /api/reviews?liveId=&kind=CONTEXT`·`KICK`, `GET /api/cases?liveId=` |
| 운영자 · 실시간 관제·시청자 관리 | 문맥 검토 결정 (정상·위반·보류) | `POST /api/context-reviews/{reviewId}/decision` |
| 운영자 · 실시간 관제·시청자 관리 | 강퇴 승인·기각 | `POST /api/kick-reviews/{reviewId}/decision` |
| 운영자 · 실시간 관제·시청자 관리 | 오판 취소 | `POST /api/findings/{findingId}/revoke` |
| 운영자 | 사건·검토의 시청자 이름 표시 (사건 대상 메시지의 작성자) | `GET /api/lives/{liveId}/messages?limit=100&cursor=` (최대 5페이지) |

* 채팅 SSE에서 받는 이벤트: `CHAT`, `MESSAGE_VISIBILITY_CHANGED`, `MESSAGE_RESTORED`, `LIVE_ACCESS_BLOCKED`, `LIVE_ENDED`, `ACTION_APPLIED`, `ACTION_FAILED`

* 관제 SSE(운영자만)에서 받는 이벤트: `CASE_CREATED`, `CASE_UPDATED`, `CONTEXT_REVIEW_REQUIRED`, `KICK_REVIEW_REQUIRED`, `REVIEW_DECIDED`, `ACTION_APPLIED`, `ACTION_FAILED`, `TOOL_START`, `TOOL_END`, `TASK_FAILED`
