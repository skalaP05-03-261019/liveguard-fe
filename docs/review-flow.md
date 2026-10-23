# 운영자 검토·제재 승인 흐름 검증 (#13)

2026-10-22 기준. 실제 API 화면(`VITE_USE_API=true`)을 infra Compose의 실제 Backend·AI Agent에 연결해 확인했다. Backend는 `LIVEGUARD_POLICY_VERSION=v3.1`, `LIVEGUARD_TBD_FIXTURE_ENABLED=true`, `AGENT_DELIVERY_ENABLED=true`로 실행했다. 운영자 화면 두 개와 시청자 화면을 서로 다른 브라우저 세션으로 열었다. 계정은 `moderator`, `viewer`다.

## 실제 환경 결과

| 시나리오 | 결과 | 캡처 |
| --- | --- | --- |
| 공격 표현 → 문맥 검토 카드 | Agent 제안(`NO_VIOLATION`, CP-2.2)과 판단 이유가 카드에 표시됨. 시청자 본인에게는 "검토 중"과 안내 문구 | [01](evidence/review-flow/01-context-card.png) |
| 보류(DEFER) | 같은 검토가 v1 → v2로 남고, 시청자 메시지는 계속 임시 비노출·"검토 중" | [02](evidence/review-flow/02-viewer-after-defer.png) |
| 동시 결정 충돌 | 오래된 화면(v1)의 정상 확정을 Backend가 `409 STALE_VERSION`으로 거부. 결정은 기록되지 않고 메시지도 계속 비노출. 안내가 5초 주기 재확인 뒤에도 남고, 새로고침하면 v2로 갱신 | [09](evidence/review-flow/09-stale-notice.png) |
| 정상 확정 | 카드가 사라지고 시청자·운영자 화면 모두 공개로 복구 | [04](evidence/review-flow/04-viewer-after-normal.png) |
| 확정 3건 → 강퇴 승인 요청 | 강퇴 카드에 기준 사건 3건(욕설 2건, 링크 1건)의 시각·유형·마스킹된 원문·상태 | [05](evidence/review-flow/05-kick-card.png) |
| 강퇴 기각 | "강퇴 기각 · 기존 제재 유지". 시청자는 입장 제한 없이 영상 시청 가능, 기존 숨김과 10분 채팅 제한 유지 | [06](evidence/review-flow/06-kick-rejected.png), [07](evidence/review-flow/07-viewer-after-reject.png) |
| 검토 기록 | 문맥 검토 "결정됨", 오판 취소로 무효가 된 강퇴 "무효", 기각한 강퇴 "결정됨 · 강퇴 기각" | [08](evidence/review-flow/08-review-records.png) |

강퇴 승인 → 입장 제한 → 기준 사건 오판 취소 → 강퇴 해제는 같은 날 #12 검증에서 확인했다(PR #17).

## 테스트 서버로만 확인한 것

`npm run test:chat`은 격리된 HTTP/SSE 테스트 서버를 쓴다.

- 강퇴 실패(`ACTION_FAILED`, `observation=CONFIRMED`)와 결과 미확인(`observation=UNKNOWN`) 안내. Backend가 아직 이 이벤트를 발행하지 않는다.
- 강퇴 기각 요청 본문과 시청자 화면.
- 오래된 검토 결정의 `STALE_VERSION` 안내가 5초 뒤에도 남는지.

## 이번에 고친 것

- 버전 충돌 안내가 오류(`role=alert`)로 표시되어 5초 주기 재확인이 성공하면 지워졌다. 이제 안내(`role=status`)로 남는다. 오판 취소의 버전 충돌도 같다.
- 목업의 강퇴 심사가 Backend와 달랐다. 결정된 강퇴 검토가 나중에 무효가 되면 그 기준 사건을 다시 셌다. Backend(`guard.live_reservations`)는 결정 시점에 기준 사건을 소진(CONSUMED)하고, 무효가 돼도 소진을 유지한다. 목업도 같게 맞췄다(정책 v3.1 MP-4.2).

## 관찰한 Backend·Agent 동작

- `REVIEW_DECIDED` payload의 검토 종류 필드가 명세의 `reviewKind`가 아니라 `kind`다. 화면은 둘 다 읽는다.
- `ACTION_FAILED`를 발행하지 않는다. `ACTION_APPLIED`는 강퇴 성공 때만 온다.
- 검토 상태에 명세에 없는 `INVALIDATED`가 온다.
- 결정된 강퇴 검토의 기준 사건은 나중에 검토가 무효가 돼도 소진 상태로 남아 다음 강퇴 심사에서 세지 않는다.
- Agent가 실행 한도에 걸리면 `NEEDS_REVIEW`, 정책 ID 없음, 확인 필요 사실 `EXECUTION_LIMIT`로 넘어온다. 화면은 정책을 `-`로 표시한다.
- 숨김 안내 문구가 욕설·링크 공통("금지된 욕설 또는 링크가 포함되어…")이다. 정책의 링크 문구와 다르다.
- `Message.timeoutUntil`이 요청자의 현재 제한이라 예전 숨김 메시지에도 같은 제한 종료 시각이 붙는다([07](evidence/review-flow/07-viewer-after-reject.png)).

## 검증 데이터

로컬 infra DB의 채널 A 진행 중 방송에 `[검증]`으로 시작하는 채팅과 그 사건·결정이 남아 있다. 검증 중 `viewer`에게 걸린 10분 채팅 제한은 22:16:41에 끝났다. 대기 중인 검토는 남기지 않았다.

## AI 근거와 사건 처리 흐름 (#15, 2026-10-23)

운영자가 AI 판정을 그대로 따르지 않고 근거를 보고 결정할 수 있도록 화면을 보강했다.

| 화면 | 보이는 것 |
| --- | --- |
| 실시간 관제 · 채팅 상세 | 채팅을 누르면 오른쪽에 처리 경로(필터 통과·규칙 확정·AI 검토), AI Agent 판단(AI 검토 대상일 때만), 처리 흐름. 이벤트가 오면 "조사 중" → AI 제안으로 바로 바뀜. 결정 대기 중이면 "결정하러 가기". AI가 보지 않은 채팅에 AI 판단을 만들어 보여 주지 않음 |
| 실시간 관제 배치 | 영상 정보와 실시간 채팅만(채팅 칸 전체 폭). 실시간 채팅 시각은 `14:27`(마우스를 올리면 날짜까지). 채팅별 판정 흐름은 시스템 운영자 화면의 '채팅관제 Tracking'으로 옮김 ([03](evidence/admin-tracking/03-studio-monitor.png)) |
| 채팅관제 Tracking (시스템 운영자) | 왼쪽 메뉴 '시스템 현황 / 채팅관제 Tracking'. 실시간 채팅 : 채팅 상세 = 1 : 2, 조회 전용(결정 버튼 없음). 백엔드에 관리자용 방송 채팅·사건 조회 API가 없어 목업 데이터로만 동작 ([01](evidence/admin-tracking/01-admin-chat-tracking.png), [02](evidence/admin-tracking/02-admin-overview.png)) |
| 채팅 상세 · 판정 흐름 | 채팅관제 Tracking 안에서 2열. 왼쪽은 채팅 한 줄, 결과 배너(누가 판단·결정·실행했는지, 처리 경로, AI 제안, 현재 상태), 단계별 판단 근거(판단 내용 · 확인한 근거 · 상태와 실행 주체), 상태 변경 기록. 오른쪽은 판정 흐름도(백엔드 파랑 · Agent 보라 · 운영자 주황, 경로 재생). 상세가 640px보다 좁으면 한 열로 쌓고 흐름도는 거친 단계만 세로로 ([09](evidence/ai-evidence-15/09-mock-chat-detail-flow.png), [11](evidence/ai-evidence-15/11-mock-chat-detail-mobile.png)) |
| 판정 흐름의 기준 | 정책 v3.1 §3·§5·§6·§8과 Backend `LiveModerationService.judgment`. 채팅 접수 → 백엔드 1차 분류 → 통과 / 규칙 확정 / 조사 후보. 조사 후보는 Agent 조사 → 정책 대조·AI 판정 → **백엔드 근거·정책 검증** → 문맥 검토·판단 보류는 운영자 결정, 개인정보 정상은 가림 해제, 개인정보 위반은 검증된 근거가 있을 때만 확정. 확정 위반 → 숨김·제재(§6) → 확정 통합 3건이면 강퇴 승인 요청(§8). 강조는 서버 기록(목업은 목업 처리 기록)으로만 하고, 기록이 없는 단계는 점선으로 둠 |
| AI가 스스로 처리한 예시 (목업) | 고객센터 공개 메일 → 개인정보 조사 → AI 위반 아님 → 백엔드 검증 뒤 운영자 검토 없이 공개. v3.1과 현재 Backend에서 AI 판정만으로 끝나는 유일한 경로. 처음 화면과 빠른 시연 "개인정보 정상 (AI 판단)" ([10](evidence/ai-evidence-15/10-mock-ai-self-decided.png)) |
| 처리 기록 · AI 판단 과정 (목업만) | 목업 Backend가 채팅마다 처리 단계(정규화 → 사전 검사 → 처리 경로 → …)를 기록하고, 목업 Agent의 도구 호출(실제와 같은 이름)·판단 과정·최종 답변(JSON)을 근거 칸에 "목업" 표시와 함께 보여 줌. 실제 Backend에는 채팅별 처리 기록 API가 없고 실제 Agent는 판단 과정을 내보내지 않아(`agent/app/check_investigation.py`) 실제 API 화면에는 나오지 않음 |
| 결정 사유 (A-26) | 문맥 검토·강퇴 결정과 시청자 관리에서 사유 입력란을 없앰. 실제 API에도 `reason`을 보내지 않음(계약상 선택). 오판 취소 사유는 그대로 필수 ([04](evidence/admin-tracking/04-context-card-no-reason.png)) |
| 왼쪽 메뉴 | 스트리머·시스템 운영자 화면 모두 연회색 바탕에 아이콘과 이름, 고른 메뉴는 둥근 회색 배경 |
| 결정 대기 · AI 판단 근거 | 검토 카드와 강퇴 기준 사건에 AI 판단 근거 상자(`AiEvidence.vue`): 판정, 이유, 위반 유형, 근거 정책, 추가 확인 필요. 검토 응답에 근거가 없으면 같은 사건에 저장된 판정을 씀 |
| 임시 비노출 · 숨김 표시 | 운영자 화면에서 둘 다 같은 회색(줄 배경·취소선·라벨). 노란색은 쓰지 않음 |
| 결정 대기 (별도 페이지) | 강퇴 승인 / 문맥 검토 탭으로 나눔. 탭에 건수, 가려진 탭에 대기 건이 있으면 빨간 점. 처음에는 강퇴 요청이 있으면 강퇴 탭 |
| 문맥 검토 카드 | 탭 안에서 한 줄로 보이고, 누르면 펼쳐짐. 메시지, AI 제안(한국어 라벨 + 원래 코드)·판단 이유·정책 ID, 결정 고르기(위반을 고를 때만 유형 선택)·이유·제출. 확인 필요 사실·같은 문장 이력·마스킹된 주변 문맥·"처리 흐름 보기"는 "자세히" 안 |
| 강퇴 카드 | 기준 사건마다 AI 판단 이유. 규칙으로 확정된 사건은 "규칙 자동 확정 · AI 조사 없음". 고정 요약 문구는 AI 요약처럼 꾸미지 않음 |
| 사건 이력 | 사건 / 검토 기록 탭, 상태별 거르기. 행을 펼치면 채팅 → 사건 생성 → AI 조사 → AI 판정 → 운영자 결정 → 조치 (→ 강퇴 심사) |
| 채팅 기록 | 이번 방송의 모든 채팅을 검색·거르기. 연결된 사건 상태와 처리 흐름 링크. 실제 API는 100건씩 이전 채팅을 더 불러옴 ("진행 기록" 페이지를 대신함) |
| 시청자 관리 | 위쪽에 "사람 결정 필요 N명" |

**처리 흐름의 데이터 출처**
- 항상 보이는 것 (서버 응답): 보낸 시각, 사건 생성 시각, 처리 경로, AI 판정, 확정 상태, 확정·취소 시각, 강퇴 심사 상태
- 이 화면을 연 뒤에만 보이는 것 (실시간 이벤트): AI 조사 시작·완료 시각(`TOOL_START`·`TOOL_END`), 운영자 결정 시각(`REVIEW_DECIDED`), 공개 복원 시각. 감사 로그 API가 없어 새로고침하면 사라진다.

**실제 환경 확인** (infra Compose, 실제 Agent)

| 캡처 | 내용 |
| --- | --- |
| [01](evidence/ai-evidence-15/01-real-context-card.png) | 실제 Agent 판정이 들어간 문맥 검토 카드 (위반 아님, CP-2.2) |
| [02](evidence/ai-evidence-15/02-real-flow-pending.png) | 결정 전 처리 흐름. AI 조사 시작·완료 시각이 실시간 이벤트로 찍힘 |
| [08](evidence/ai-evidence-15/08-real-chat-detail.png) | 실시간 관제의 채팅 상세. 실제 Agent 판정(위반 아님, CP-2.2)과 운영자 정상 확정 |
| [03](evidence/ai-evidence-15/03-real-flow-decided-new-session.png) | 정상 확정 뒤, 새로 연 화면의 처리 흐름. 판정·결정·조치는 보이고 AI 조사 시각은 "화면을 연 뒤의 기록만" 안내 |

**Backend 요청 (이 화면을 더 낫게 하려면)**
- 명세의 `policyEvidence`(`policyId`·`title`·`resourceUri`) 구현: 지금은 정책 ID만 보여 준다.
- 강퇴 검토 `summary`를 명세대로 Agent가 쓸지, 고정 문구로 둘지 결정.
- 사건 응답에 작성자 식별 정보(`authorUserId` 또는 닉네임)를 명세에 추가: 지금은 채팅을 최대 500건까지 거꾸로 읽어 이름을 찾는다.
- 처리 흐름을 새로고침 뒤에도 보이게 하려면 사건별 이벤트 기록(감사 로그) 조회 API가 필요하다.
