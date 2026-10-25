# 열린 이슈 종료 조건 자체 점검 — 2026-10-25

## 판단 기준

이슈 본문의 완료 조건, 실제 구현, 저장된 검증 근거, PR 머지 여부를 함께 비교했다. 코드가 작업 브랜치에 있는 것과 main에 반영된 것을 구분한다. 초안 계약·미검증 항목을 완료로 표시하지 않고, 중복 종료는 기능 완료와 구분한다.

점검 시 main에는 PR #47까지 머지돼 있고, PR #56과 #57은 열려 있다. BE #88(관리자 권한/API), #89(기간 집계 API)도 열려 있다. 이 문서는 저장 시점의 판단이며 이후 상태 변경은 각 링크에서 확인한다.

## 이슈별 판단

| 이슈 | 판단 | 근거와 남은 조건 |
| --- | --- | --- |
| [#35](https://github.com/skalaP05-03-261019/liveguard-fe/issues/35) | 중복 종료 | #36과 제목·본문이 동일하다. 기능 완료로 처리하지 않고 #36에 통합한다. |
| [#36](https://github.com/skalaP05-03-261019/liveguard-fe/issues/36) | 유지 | 정식 다중 채널 선택 UI·채널 역할 계약·역할 분리 결정이 남았다. |
| [#49](https://github.com/skalaP05-03-261019/liveguard-fe/issues/49) | PR #56 머지 시 종료 | 엔티티별 과거 버전 무시, REST 메시지 버전, 중복·역순/개인정보 회귀 근거가 있다. main 반영 전 수동 완료 종료하지 않는다. |
| [#54](https://github.com/skalaP05-03-261019/liveguard-fe/issues/54) | PR #57 머지 시 종료 | 웹 탐색만 구현, 입력/IME·수정 키 보호, 충돌/복원·계정별 로컬 설정을 확인했다. 자체 점검에서 방송 전환·종료/결정 완료·편집기 보호의 명시적 테스트를 보강했다. |
| [#48](https://github.com/skalaP05-03-261019/liveguard-fe/issues/48) | 유지, 자동 종료 제거 | 사건 수·중립 역할·미확인 분리는 구현됐지만 이슈에 적힌 INVALIDATED의 BE/OpenAPI 합의 조건은 아직 충족되지 않았다. 표시용 호환 처리로 계약 합의를 대체하지 않는다. |
| [#50](https://github.com/skalaP05-03-261019/liveguard-fe/issues/50) | 유지 | 기간 경계·자정·daily 합계 목업은 보완했다. BE #89의 최종 모집단/스냅샷 합의와 실제 계약 연동은 남았다. |
| [#51](https://github.com/skalaP05-03-261019/liveguard-fe/issues/51) | 유지 | 100개 세션·100채팅/초의 짧은 PUBLIC 기준 측정은 있다. 장기·다중 방송·LLM 혼합 부하, 대기열·자원·비용, 팀 합의 SLO 및 반복 측정은 미완료다. |
| [#52](https://github.com/skalaP05-03-261019/liveguard-fe/issues/52) | 유지 | 로컬 권한/세션/CSRF/가시성 경계는 검사했다. 운영 HTTPS 쿠키·키 관리, 실제 결정·오판 취소 쓰기 권한의 전체 경계와 실제 강퇴 재검증은 미검증이다. |
| [#53](https://github.com/skalaP05-03-261019/liveguard-fe/issues/53) | 유지, 자동 종료 제거 | 사용자 승인 웹 기본안은 구현했다. 원 이슈의 채널별 설정 등 확대 범위는 아직 충족되지 않았다. 시스템 알림은 기본안 범위 밖이며 향후 지원/권한/대체 흐름 결정이 필요하다. |
| [#55](https://github.com/skalaP05-03-261019/liveguard-fe/issues/55) | 유지 | 웹 관제 범위와 YouTube 공식 API 검토표는 기록했다. 추가 플랫폼별 조건·외부 ID/인가·제재 효력·송출 동기화의 최종 계약은 남았다. |
| [#30](https://github.com/skalaP05-03-261019/liveguard-fe/issues/30) | 유지 | 기존 실제 API 시작/종료나 목업 알림만으로 목업 생명주기·AI 조사 지연·A-28 시연 요구가 충족되지는 않는다. |
| [#33](https://github.com/skalaP05-03-261019/liveguard-fe/issues/33) | 유지 | BE #88 이후 실제 관리자 조회/권한 연동이 필요하다. 현재 빈 상태나 목업을 실데이터 연결로 계산하지 않는다. |
| [#16](https://github.com/skalaP05-03-261019/liveguard-fe/issues/16) | 유지 | 스크립트의 독립 세션 100개는 실제 기기 3대·현장 네트워크·계정 배포·시연 문장/실패 대체 리허설을 대체하지 않는다. |

## 점검 중 보완한 코드

기존 단축키는 현재 liveId를 기준으로 알림을 걸렀지만, Studio의 pending 계산은 PENDING 상태만 봤다. 방송 전환 중 이전 데이터가 남는 순간을 방어하도록 pending에 현재 liveId 조건을 추가했다. 제출 가능 여부와 submit 진입에서도 현재 방송·PENDING 여부를 재확인한다. 실제 서버의 권한·expectedReviewVersion·clientRequestId 처리는 그대로 사용한다.

추가 브라우저 시나리오:

- textarea/select/contenteditable에 입력할 때 J가 탐색을 실행하지 않음.
- 모든 요청이 DECIDED이면 단축키로 결정 카드를 열 수 없음.
- liveId가 바뀌고 이전 방송의 PENDING 데이터가 남아도 탐색/제출 대상으로 표시하지 않음.
- 서버 LIVE_ENDED 수신 후 검색 단축키가 동작하지 않음.
- 기존 키 재지정·IME·저장 실패·알림 원문 비복사·결정 충돌/문맥 검토 회귀를 함께 확인.

## PR 정리

- [PR #56](https://github.com/skalaP05-03-261019/liveguard-fe/pull/56): `Closes #49` 유지, `Closes #48`은 `Refs #48`로 변경한다.
- [PR #57](https://github.com/skalaP05-03-261019/liveguard-fe/pull/57): `Closes #54` 유지, `Closes #53`은 `Refs #53`으로 변경한다. 이 자체 점검 문서와 추가 보호/회귀 테스트를 같은 PR에 반영한다.
- 새 PR을 중복 생성하지 않고 이미 열려 있는 두 PR의 종료 조건과 검토 근거를 갱신한다. #56 → #57 순서로 검토한다.

참고: [정합성·실제 평가 보고서](contract-alignment.md), [웹 도구 범위·검증·캡처](web-monitoring-scope.md).

## 이번 자체 점검의 검증 결과

- 전체 브라우저 회귀: **65개 통과, 실패 0개** (약 139초).
- 정책/집계 모델 4개와 관제 도구 모델 3개: **7개 통과**.
- Mock/API 각각 타입 검사·프로덕션 빌드 통과.
- 종료 조건 관련 집중 브라우저 실행 7개 통과 후 전체 65개를 재확인했다. 집중 실행은 전체 합계에 중복 가산하지 않는다.
- `git diff --check` 통과.
- GitHub에서 #35가 `CLOSED / DUPLICATE`이고 #36은 열려 있음을 확인했다. #49·#54는 main 반영 전이라 열어 둔다.
