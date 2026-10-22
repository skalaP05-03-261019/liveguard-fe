# 실제 liveId 채팅·검토 콘솔 (FE #2)

2026-10-22 채팅 상태 UI 보완과 현재 검증 범위는 [P0 채팅 상태 처리](chat-state-ui.md)를 참고한다. 아래는 기존 통합 시험 기록이다.

`VITE_USE_API=true`이면 `LiveConsole.vue`의 liveId API/SSE 연결을 쓴다(#12 이후 `VITE_USE_LIVE_V1`은 쓰지 않는다). 시청자는 `ViewerScreen.vue`, 운영자는 `StudioScreen.vue`를 목업과 함께 쓴다. 아래 localhost:3002 기록은 이전 통합 시험 서버 기준이다.

운영자: moderator, 시청자: viewer 또는 demo-viewer-10..19, 관리자: admin. 시드 비밀번호는 로컬 시험용 `liveguard-local`이다. 추가 시청자는 Infra SQL로 별도 시드하며 운영 계정에 적용하지 않는다.

운영자는 방송 시작/종료와 AI 근거가 포함된 CONTEXT 정상/위반/보류를 결정한다. KICK은 별도 승인 카드다. 202 결정 접수와 실제 조치 적용을 구분하며 실제 BE/SSE 결과로 화면을 갱신한다. 작성자 외에는 HELD/HIDDEN 원문을 받지 않는다. SSE 이벤트 ID를 중복 제거하고 로그아웃/종료/강퇴 시 연결을 닫는다.

시청자 영상은 기존 데모 영상이며 실제 시청자 수로 보일 수 있는 Mock 집계를 숨긴다. 시스템 운영자는 담당 방송이 없는 경우 이를 알리고 가상 모니터링 수치를 만들지 않는다.

검증: vue-tsc와 vite build 통과. 실제 Chromium의 독립 역할 세션에서 일반 채팅 전파, HELD 격리, 실제 모델/Agent 조사 카드, DEFER, 사람 정상 결정 뒤 PUBLIC 복구 및 사람 위반 결정 뒤 HIDDEN/TIMED_OUT 403을 확인했다. Infra `evidence/v1-browser/report.json`에 기록했다.

이 콘솔은 통합 시험 화면이다. BE 내부 확장 계약, 전체 API 페이지네이션, PII 서버 사실·FLOOD 최초 확정·finding 취소/복구 및 운영 정책 미정 항목은 BE 통합 PR의 잔여 사항이다. 전체 서비스 구현 완료나 모델 품질 점수로 해석하지 않는다.
