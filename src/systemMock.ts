import type { Category, Verdict } from './contracts';

// 시스템 운영자 화면용 Mock. 행복한게임방(현재 Mock 채널)은 스토어의 실제 상태를 쓰고, 나머지 방송은 아래 고정 예시를 쓴다.
import type { ReportStatus } from './reportSummary';
export type { ReportStatus } from './reportSummary';
export type Execution = 'EXECUTED' | 'FAILED' | null;
// scanned = 검사한 채팅, hidden = 위반 확정으로 숨김(HIDDEN), held = 판정 대기(HELD: AI 조사 중 또는 운영자 문맥 검토 대기). 나머지는 정상(PUBLIC)
export interface SysChannel { id: string; name: string; streamer: string; live: boolean; viewers: number; scanned: number; hidden: number; held: number }
export interface SysReport { id: string; channelId: string; userAlias: string; summary: string; categories: Category[]; basisCaseIds: string[]; reportedAt: string; status: ReportStatus; decidedAt: string | null; decisionReason: string | null; execution: Execution }
export interface SysLog { id: string; channelId: string; at: string; userAlias: string; text: string; category: Category | null; verdict: Verdict; action: string }

export const LIVE_CHANNEL_ID = 'live-mock';
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

export const sysChannels: SysChannel[] = [
  { id: 'ch-lol', name: '롤 랭크 올리기', streamer: '랭커민수', live: true, viewers: 8120, scanned: 4210, hidden: 96, held: 7 },
  { id: 'ch-food', name: '먹방하는 곰', streamer: '곰먹방', live: true, viewers: 3540, scanned: 1875, hidden: 41, held: 3 },
  { id: 'ch-song', name: '새벽 노래방', streamer: '새벽소리', live: true, viewers: 960, scanned: 702, hidden: 12, held: 2 },
  { id: 'ch-code', name: '코딩 라이브', streamer: '개발자J', live: false, viewers: 0, scanned: 1330, hidden: 18, held: 0 }
];

const r = (id: string, channelId: string, userAlias: string, summary: string, categories: Category[], reportedMin: number, status: ReportStatus, decidedMin: number | null, decisionReason: string | null, execution: Execution): SysReport =>
  // These fixed examples each represent three distinct basis cases, regardless of category count.
  ({ id, channelId, userAlias, summary, categories, basisCaseIds: [1,2,3].map(n => `${id}-case-${n}`), reportedAt: ago(reportedMin), status, decidedAt: decidedMin === null ? null : ago(decidedMin), decisionReason, execution });

export const sysReports: SysReport[] = [
  r('rp-01', 'ch-lol', '트롤장인', '같은 팀원을 반복해서 조롱하고 욕설을 이어 갔습니다. 10분 채팅 제한 뒤에도 괴롭힘이 계속되었습니다.', ['PROFANITY', 'HARASSMENT', 'HARASSMENT'], 95, 'APPROVED', 88, '같은 시청자를 반복 공격한 것이 확인되어 추방합니다.', 'EXECUTED'),
  r('rp-02', 'ch-lol', '분탕러', '짧은 시간에 같은 문장을 반복해 채팅을 가렸습니다.', ['FLOOD', 'FLOOD', 'FLOOD'], 61, 'REJECTED', 55, '방송 밈을 따라 한 것으로 보여 악의가 없다고 판단했습니다. 숨김만 유지합니다.', null),
  r('rp-03', 'ch-lol', '정치토론러', '다른 시청자를 겨냥한 비난이 세 번 이어졌습니다.', ['HARASSMENT', 'PROFANITY', 'HARASSMENT'], 14, 'PENDING', null, null, null),
  r('rp-04', 'ch-food', '광고왕', '이벤트를 사칭해 외부 링크로 유도하는 메시지를 반복했습니다.', ['PHISHING', 'PHISHING', 'PHISHING'], 140, 'APPROVED', 131, '운영진 사칭 피싱이 확실합니다.', 'EXECUTED'),
  r('rp-05', 'ch-food', '익명123', '본인과 타인의 연락처를 반복해서 올렸습니다.', ['PII_EXPOSURE', 'PII_EXPOSURE', 'PROFANITY'], 47, 'APPROVED', 40, '개인정보 노출이 반복되어 추방합니다.', 'FAILED'),
  r('rp-06', 'ch-song', '악플러', '노래에 대한 비하 표현을 세 번 남겼습니다.', ['PROFANITY', 'PROFANITY', 'HARASSMENT'], 33, 'REJECTED', 21, '노래 평가 수준의 표현이라 직접 모욕으로 보기 어렵습니다.', null),
  r('rp-07', 'ch-code', '스팸봇77', '무료 강의를 사칭해 계정 정보를 요구했습니다.', ['PHISHING', 'PHISHING', 'PHISHING'], 260, 'APPROVED', 252, '피싱 봇으로 확인되어 추방합니다.', 'EXECUTED')
];

const l = (id: string, channelId: string, min: number, userAlias: string, text: string, category: Category | null, verdict: Verdict, action: string): SysLog =>
  ({ id, channelId, at: ago(min), userAlias, text, category, verdict, action });

export const sysLogs: SysLog[] = [
  l('lg-01', 'ch-lol', 97, '트롤장인', '너 같은 애는 게임 접어라', 'PROFANITY', 'VIOLATION', '숨김'),
  l('lg-02', 'ch-lol', 96, '트롤장인', '서폿 또 너냐 진짜 답 없다', 'HARASSMENT', 'VIOLATION', '숨김 + 10분 제한'),
  l('lg-03', 'ch-lol', 95, '트롤장인', '끝까지 따라가서 괴롭혀 줄게', 'HARASSMENT', 'VIOLATION', '강퇴 승인 요청'),
  l('lg-04', 'ch-lol', 70, '롤린이', '아 이번 한타 미쳤다 ㅋㅋ', null, 'NO_VIOLATION', '공개 유지'),
  l('lg-05', 'ch-lol', 62, '분탕러', '가즈아가즈아가즈아가즈아', 'FLOOD', 'VIOLATION', '강퇴 승인 요청'),
  l('lg-06', 'ch-lol', 15, '정치토론러', '저 사람 말하는 거 다 무시하세요', 'HARASSMENT', 'VIOLATION', '강퇴 승인 요청'),
  l('lg-07', 'ch-lol', 9, '골드탈출', '이건 좀 선 넘은 듯?', 'HARASSMENT', 'NEEDS_REVIEW', '판단 보류'),
  l('lg-08', 'ch-food', 142, '광고왕', '구독자 전원 쿠폰 지급! 링크 클릭', 'PHISHING', 'VIOLATION', '숨김 + 10분 제한'),
  l('lg-09', 'ch-food', 140, '광고왕', '공식 이벤트 페이지에서 로그인하세요', 'PHISHING', 'VIOLATION', '강퇴 승인 요청'),
  l('lg-10', 'ch-food', 50, '익명123', '제 번호 010-0000-0000 연락 주세요', 'PII_EXPOSURE', 'VIOLATION', '숨김'),
  l('lg-11', 'ch-food', 47, '익명123', '친구 카톡 아이디 알려 드림 abc12', 'PII_EXPOSURE', 'VIOLATION', '강퇴 승인 요청'),
  l('lg-12', 'ch-food', 25, '먹짱', '그거 매운 거 아니에요? ㅋㅋ', null, 'NO_VIOLATION', '공개 유지'),
  l('lg-13', 'ch-song', 35, '악플러', '음정 다 나갔네 듣기 싫다', 'PROFANITY', 'VIOLATION', '숨김'),
  l('lg-14', 'ch-song', 33, '악플러', '노래 그만해 귀 아프다', 'PROFANITY', 'VIOLATION', '강퇴 승인 요청'),
  l('lg-15', 'ch-song', 12, '새벽감성러', '이 노래 진짜 미쳤다', null, 'NO_VIOLATION', '공개 유지'),
  l('lg-16', 'ch-code', 262, '스팸봇77', '무료 강의 받으려면 아이디 비번 입력', 'PHISHING', 'VIOLATION', '강퇴 승인 요청'),
  l('lg-17', 'ch-code', 200, '주니어', '이 에러 저도 났어요', null, 'NO_VIOLATION', '공개 유지'),
  l('lg-18', 'ch-code', 180, '시니어킬러', '이걸 왜 이렇게 짜요 바보도 아니고', 'PROFANITY', 'VIOLATION', '숨김')
];
