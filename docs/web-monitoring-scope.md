# 웹 관제 기본안: 알림·단축키와 외부 플랫폼 경계 (#53–#55)

## 이번 범위 결정

사용자 선택에 따라 **기존 웹 관제 안 알림·탐색 단축키·브라우저 로컬 설정**을 구현한다. PC 전역 제어, 다른 앱 위 상시 오버레이, 네이티브 앱, 시스템 푸시 서버, 자체 영상 송출은 이번 구현 범위가 아니다. 외부 플랫폼 OAuth/제재 어댑터는 아래 계약 검토 후 별도 진행한다.

## #53: 원문 없는 웹 알림

| 상황 | 표시와 이동 |
| --- | --- |
| 새 문맥 검토 | '새 문맥 검토 요청' → 현재 PENDING인지 확인 후 해당 검토 열기 |
| 새 강퇴 승인 요청 | '새 강퇴 승인 요청' → 해당 강퇴 검토 열기 |
| 설정 기준 이상 대기 | 종류별 '오래 기다린 … 요청' → 현재 대기열로 이동 |
| 확인된 강퇴 실행 실패 | '강퇴 실행 실패 확인' → 해당 사건 처리 흐름 열기 |

`OperatorTools.vue`는 Studio가 이미 허용받은 reviews·kickProgress만 받는다. 원문·닉네임·AI 사유·개인정보는 알림 데이터에 복사하지 않는다. 클릭 시 liveId·최신 검토 상태를 다시 확인한다. 알림 자체가 승인/위반/강퇴/공개 해제 명령을 보내지는 않는다.

실행 결과 미확인은 실패 알림으로 만들지 않는다. 이미 결정·무효가 된 대기 알림은 제거한다. 계정/방송 전환·방송 종료에서는 알림을 초기화한다. 같은 검토의 업데이트나 재접속으로 같은 새 요청·장기 대기·실패 알림을 반복하지 않는다. 알림은 최근 20개이며 전체 요청은 기존 대기열에서 확인한다. 웹 알림을 끈 동안 새 요청 알림을 쌓아 재생하지 않는다. 소리는 재생하지 않는다.

## #54: 탐색 단축키

| 기본 키 | 동작 |
| --- | --- |
| J | 다음 요청으로 이동, 목록 밖에서는 첫 요청 열기 |
| K | 이전 요청으로 이동 |
| O | 선택한 요청의 상세 펼침/접기 |
| / | 채팅 기록 화면으로 이동하고 검색창에 초점 |

입력/textarea/select/contenteditable·한글 IME 조합·수정 키(Ctrl/Alt/Meta/Shift)·키 반복·다른 핸들러가 처리한 이벤트에서는 가로채지 않는다. 설정 패널에서도 전역 탐색을 정지한다. 승인·제재 단축키는 제공하지 않아 기존 제출·권한·버전·멱등성 경로를 우회하지 않는다.

기본 키는 영문 소문자·숫자·/·[·] 한 글자로 재지정할 수 있다. 중복 키와 장기 대기 기준(1~60분)을 검증하고 기본값 복원과 저장을 제공한다.

설정 저장 키는 `liveguard.operator-tools.v1.<userId>`이며 알림 on/off, 단축키 on/off, 장기 대기 기준, 탐색 키만 저장한다. 세션·토큰·채팅·알림 이력은 저장하지 않는다. 계정별·브라우저별 설정이며 다른 PC와 동기화하지 않는다. 저장소가 막히거나 가득 차면 오류로 앱을 중단하지 않고 현재 화면에서만 적용한다. 현 서비스의 채널 선택은 #36 선행 사항이므로 이번 기본안은 계정별 설정이고, 알림 내용은 현재 liveId에만 한정한다.

## #55: 기존 방송 기능과 신규 외부 연동 구분

현재 `POST /api/channels/{channelId}/lives`는 서비스 내부 liveId를 만들고, `POST /api/lives/{liveId}/end`는 종료한다. STREAMER/MODERATOR 권한, 채널당 진행 중 방송 1개, 이전 제재의 새 liveId 비승계가 기준이다. 외부 플랫폼의 실제 송출 제어와 같은 기능으로 설명하지 않는다. 로컬 평가에서는 중복 시작·종료 후 전송 거부·새 방송의 TIMEOUT/유형 이력 분리를 검증했다.

동일 플랫폼의 다중 채널 선택/역할 분리는 #36, 목업 생명주기는 #30, 관리자 실제 데이터는 #33 및 BE #88/#89를 선행으로 둔다. 정책 집계 단위인 liveId를 채널 전체나 외부 플랫폼 전체로 넓히지 않는다.

### YouTube 연동 검토표 — 2026-10-25 공식 문서 확인

아래는 향후 연동을 위한 검토이며 실제 외부 계정에 연결하거나 API/ERD를 개정한 결과가 아니다.

| 영역 | 공식 API에서 확인한 사실 | LIVE:GUARD에 필요한 합의 |
| --- | --- | --- |
| 채팅 수집 | streamList는 서버 스트리밍, 초기 최근 이력과 nextPageToken 기반 재연결을 설명한다. [공식 문서](https://developers.google.com/youtube/data/live/reference/rest/v3/liveChatMessages/streamList) | 외부 liveChatId·messageId와 내부 liveId·clientMessageId의 대응 및 초기 이력 중복 처리. 내부 SSE의 이력 보장과 동일하게 가정하지 않음 |
| 폴링 대체 | list는 pollingIntervalMillis를 제공한다. [공식 문서](https://developers.google.com/youtube/data/live/reference/rest/v3/liveChatMessages/list) | 플랫폼이 지시한 간격·프로젝트 할당량·오류/재접속 정책을 따름. 내부 80ms UI 묶음 간격을 외부 수집 간격으로 쓰지 않음 |
| 메시지 삭제 | 채널 소유자 또는 해당 채팅 운영자의 인가가 필요하다. [공식 문서](https://developers.google.com/youtube/data/live/reference/rest/v3/liveChatMessages) | 내부 MODERATOR와 외부 OAuth 권한을 별도로 검증하고 실제 삭제 결과를 관측 |
| 사용자 제재 | liveChatBan은 채팅 참여 제한을 설명하며 temporary/permanent와 기간 필드가 있다. [공식 문서](https://developers.google.com/youtube/data/live/reference/rest/v3/liveChatBans) | 채팅 참여 제한이 서비스의 시청·재입장 차단까지 보장한다고 가정하지 않음. 일정 초 제한/영구 제한을 '현재 방송 종료까지'와 임의로 동일시하지 않음 |
| 실제 송출 상태 | liveBroadcasts.transition은 방송 상태를 바꾸고, live/testing 전환에는 연결된 스트림 active 상태와 OAuth 범위가 필요하다. [공식 문서](https://developers.google.com/youtube/data/live/reference/rest/v3/liveBroadcasts/transition) | 내부 시작 버튼을 외부 송출 시작으로 연결하려면 매핑·권한·오류·종료 동기화 계약이 선행 |

확정해야 할 저장/계약 항목: 외부 플랫폼·방송/채팅/메시지 ID 매핑, 계정 인가와 자격 증명 보관/갱신/폐기, 수집 커서와 중복 방지, 실제 조치 영수증/관측 결과. 현재 ERD에 이 구조가 모두 있다고 가정하지 않는다. 신규 스키마·API·정책 변경은 별도 합의 후 추가한다. Twitch 등 추가 플랫폼은 선정 후 같은 표를 공식 문서로 채운다.

## 검증

- 순수 모델 테스트: 손상된 설정·중복 키·IME/수정 키·이벤트 반복·원문 비복사·중복 알림·계정/방송 초기화·UNKNOWN 구분.
- 브라우저: 탐색/검색 초점·입력 보호·키 충돌·계정별 설정·저장 실패 대체·새 요청의 안전한 이동·실패 사건 흐름·무효 후 제거·390px 가로 넘침.
- 캡처는 예시 목업이며 실제 운영 데이터가 아니다.

## 최종 검증과 화면

누적 브랜치에서 브라우저 회귀 63개, 정책/집계 모델 4개, 관제 도구 모델 3개가 통과했다. Mock/API 빌드도 모두 통과했다. 앞선 전체 실행에서는 세션·스크롤·가상시계 구간의 타임아웃과 리사이즈 직후 검사가 실패했다. 실패 경로 6개를 분리 실행해 통과했고, 리사이즈 검사는 레이아웃 반영 뒤 확인하도록 보완한 다음 전체를 재실행해 63개 통과를 확인했다. 실패 기록을 운영 장애나 보안 취약점 재현으로 해석하지 않는다.

| 예시 화면 | 캡처 |
| --- | --- |
| 웹 알림 | [데스크톱](evidence/followups/operator-tools-alerts-desktop.png) |
| 설정과 키 안내 | [데스크톱](evidence/followups/operator-tools-settings-desktop.png), [390px·저장 실패 대체](evidence/followups/operator-tools-settings-390.png) |
| 확인된 강퇴 실행 실패 | [알림](evidence/followups/operator-tools-failure.png), [해당 사건 흐름 이동](evidence/followups/operator-tools-case-flow.png) |
| 정합성: 사건 3건·여러 유형 | [데스크톱](evidence/followups/contract-basis-desktop.png), [390px](evidence/followups/contract-basis-390.png) |
| 정합성: 무효·결정 누락 | [무효](evidence/followups/contract-invalidated-390.png), [정보 미확인](evidence/followups/contract-unavailable-390.png) |
| 기간 집계 초안 정렬 | [7일](evidence/followups/contract-period-7days.png), [30일](evidence/followups/contract-period-30days.png) |

캡처 재현:

```bash
CHAT_EVIDENCE_DIR=docs/evidence/followups node --test --test-name-pattern='admin period stats default|distinct basis|operator navigation|web operator alerts|web failure alerts' tests/live-chat.test.cjs
```

실제 로컬 100세션·100채팅/초 결과와 검증 범위는 [정합성·평가 보고서](contract-alignment.md)를 참고한다. 이는 웹 도구의 새로운 인증/외부 플랫폼 계약이 있다는 뜻이 아니다.
