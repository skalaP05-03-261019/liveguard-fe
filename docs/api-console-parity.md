# localhost:3000 API 콘솔 반영 점검

2026-10-25 현재 작업 브랜치의 공통 UI를 로컬 Docker API 콘솔에 빌드하고, 실제 로컬 시드 스트리머 계정으로 로그인해 확인했습니다. 브라우저의 API 응답을 목업으로 바꾸지 않은 실제 화면입니다. 검토 요청·방송 시작/종료·제재 데이터를 생성하거나 변경하지 않았습니다.

## 원인과 반영

5173번 Vite 개발 서버는 소스 변경을 바로 반영하지만, 3000번은 Docker 안의 정적 빌드를 제공합니다. 이전 3000번 자산에는 종·통합 화면·OFF AIR 코드가 없었습니다. 프론트엔드만 `docker compose build frontend`와 `docker compose up -d --no-deps frontend`로 갱신했습니다. 빌드 소스는 `liveguard-fe`, `VITE_USE_API=true`입니다. BE·Agent·DB는 재시작하지 않았습니다.

현재 3000번 자산은 `/assets/index-Dh3PYTJD.js`이며 종·통합 화면·OFF AIR 코드가 포함돼 있습니다. 향후 프론트 소스를 수정해도 Docker는 자동 갱신되지 않으므로 3000번 반영을 다시 확인해야 합니다.

## 실제 API 화면 체크

| 오늘 변경한 항목 | 확인 결과 |
| --- | --- |
| 메뉴 통합 | 실시간 모니터링 한 개, 별도 결정 대기 메뉴 없음 |
| 3열 | 방송 정보·채팅 / 문맥 검토 대기 / 강퇴 승인 대기 동시 표시 |
| 종 알림 | 대기 0건에서도 종 표시, 클릭 시 빈 상세 목록 표시 |
| 알림 설정 | 톱니바퀴로 기존 알림·단축키 설정 열림 |
| 정책 문구 | ‘채팅 관제 운영 정책’, v3.2 SP-3.1·A-28 및 CP-3.3 안내 표시 |
| OFF AIR | 현재 실시간 연결 시 ON AIR. 검사 브라우저만 SSE를 차단해 컬러바 OFF AIR 표시 확인 |
| 휴대폰 | 390·360px 문서 가로 넘침 없음 |
| 런타임 오류 | 검사 브라우저 pageerror 0건 |

새 요청 효과 코드는 API 콘솔과 목업이 함께 사용하는 StudioScreen에 있습니다. 초기 목록/중복 제외, API/SSE로 새 요청 수신 후 강조, 종료 시 제거는 기존 API 모드 회귀 테스트에서 확인했습니다. **현재 실제 방송의 검토 요청은 0건이므로 실제 업무 데이터를 만들어 효과를 발생시키지는 않았습니다.** 효과 캡처는 [통합 화면 보고서](unified-live-monitoring.md)의 명시된 테스트 픽스처를 참고합니다.

실제 API의 판정·집계는 서버 응답을 사용합니다. FE 정책 안내가 표시된다는 사실이 BE·Agent/RAG의 정책 전환이나 미구현 기간 집계 API까지 검증됐다는 의미는 아닙니다. Backend 기간 통계 API는 기존 미연동 상태를 유지하며 임의 수치를 표시하지 않습니다.

## 실제 API 콘솔 캡처

![실시간 모니터링](evidence/api-console-parity/01-live-monitoring.png)

![종 상세](evidence/api-console-parity/02-bell-details.png)

<details><summary>정책 페이지</summary>

![정책](evidence/api-console-parity/03-policy.png)

</details>

<details><summary>390·360px</summary>

![390px](evidence/api-console-parity/04-mobile-390.png)

![360px](evidence/api-console-parity/05-mobile-360.png)

</details>

SSE 차단은 검사 브라우저에만 적용했습니다. 실행 중인 방송·서버 연결을 중단하지 않았습니다.

![OFF AIR](evidence/api-console-parity/06-off-air.png)
