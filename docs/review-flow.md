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
| 문맥 검토 카드 | 결정 대기에서 한 줄로 보이고, 누르면 펼쳐짐. 메시지, AI 제안(한국어 라벨 + 원래 코드)·판단 이유·정책 ID, 결정 고르기(위반을 고를 때만 유형 선택)·이유·제출. 확인 필요 사실·같은 문장 이력·마스킹된 주변 문맥·"처리 흐름 보기"는 "자세히" 안 |
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
| [03](evidence/ai-evidence-15/03-real-flow-decided-new-session.png) | 정상 확정 뒤, 새로 연 화면의 처리 흐름. 판정·결정·조치는 보이고 AI 조사 시각은 "화면을 연 뒤의 기록만" 안내 |

**Backend 요청 (이 화면을 더 낫게 하려면)**
- 명세의 `policyEvidence`(`policyId`·`title`·`resourceUri`) 구현: 지금은 정책 ID만 보여 준다.
- 강퇴 검토 `summary`를 명세대로 Agent가 쓸지, 고정 문구로 둘지 결정.
- 사건 응답에 작성자 식별 정보(`authorUserId` 또는 닉네임)를 명세에 추가: 지금은 채팅을 최대 500건까지 거꾸로 읽어 이름을 찾는다.
- 처리 흐름을 새로고침 뒤에도 보이게 하려면 사건별 이벤트 기록(감사 로그) 조회 API가 필요하다.
