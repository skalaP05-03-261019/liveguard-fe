import type { CaseDetail, CaseSummary, KickReview, Me, Message, PolicySnapshot, UUID } from './contracts';

export const CHANNEL_ID = '11111111-1111-4111-8111-111111111111';
export const DEMO_USERS = [
  { id: '22222222-2222-4222-8222-222222222221', alias: '별빛시청자' },
  { id: '22222222-2222-4222-8222-222222222222', alias: '어둠의유저' },
  { id: '22222222-2222-4222-8222-222222222223', alias: '정보왕' }
];
export const MODERATOR_ID = '33333333-3333-4333-8333-333333333333';
export const demoMe: Me = { userId: MODERATOR_ID, nickname: '운영자', role: 'MODERATOR', channelIds: [CHANNEL_ID] };
export const mockPolicy: Record<string, PolicySnapshot> = {
  PROFANITY: { policyId: 'CP-1.1', version: '0.5', title: '인신공격 및 욕설', text: '타인에게 직접적인 욕설 및 모욕을 하지 않습니다. 게임에 대한 일반적 불만은 허용합니다.', resourceUri: 'policy://0.5/community_policy/CP-1.1' },
  HARASSMENT: { policyId: 'CP-1.2', version: '0.5', title: '표적 괴롭힘', text: '다른 이용자를 반복적으로 괴롭히거나 위협하는 행위를 금지합니다.', resourceUri: 'policy://0.5/community_policy/CP-1.2' },
  FLOOD: { policyId: 'CP-2.1', version: '0.5', title: '채팅 도배', text: '동일하거나 유사한 채팅을 반복해서 정상적인 대화를 방해하지 않습니다.', resourceUri: 'policy://0.5/community_policy/CP-2.1' },
  PHISHING: { policyId: 'CP-3.1', version: '0.5', title: '피싱·운영진 사칭', text: '공식 운영자를 사칭해 외부 사이트로 유도하거나 계정 정보를 요구하지 않습니다.', resourceUri: 'policy://0.5/community_policy/CP-3.1' },
  PII_EXPOSURE: { policyId: 'CP-4.1', version: '0.5', title: '개인정보 노출', text: '본인 또는 타인의 연락처·계좌·주소 같은 개인정보를 채팅에 올리지 않습니다.', resourceUri: 'policy://0.5/community_policy/CP-4.1' }
};
const stamp = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
function msg(id: UUID, authorAlias: string, text: string, minutes: number, visibility: Message['visibility']): Message {
  return { messageId: id, channelId: CHANNEL_ID, authorAlias, text, visibility, version: visibility === 'PUBLIC' ? 1 : 2, sentAt: stamp(minutes), isMine: false };
}
const ids = ['44444444-4444-4444-8444-444444444441', '44444444-4444-4444-8444-444444444442', '44444444-4444-4444-8444-444444444443', '44444444-4444-4444-8444-444444444444', '44444444-4444-4444-8444-444444444445', '44444444-4444-4444-8444-444444444446'];
export const fixtureMessages = [
  msg(ids[0], '김하늘', '오늘도 화이팅하세요! 💜', 6, 'PUBLIC'),
  msg(ids[1], '별빛시청자', '오늘 무슨 게임 하시나요?', 5, 'PUBLIC'),
  msg(ids[2], '어둠의유저', '너 진짜 못하네', 4, 'HIDDEN'),
  msg(ids[3], '게임소녀', '우와 보스 클리어!!', 3, 'PUBLIC'),
  msg(ids[4], '어둠의유저', '공식 운영자입니다. 여기서 로그인하세요', 2, 'HIDDEN'),
  msg(ids[5], '어둠의유저', '계속 말 걸어줄게 짜증나게', 1, 'HIDDEN')
];
// 초기 화면을 채우는 정상 채팅과, 다른 사용자들의 첫 위반(자동 조치 대상).
const extraUsers: Record<string, string> = { 김하늘: '22222222-2222-4222-8222-222222222224', 게임소녀: '22222222-2222-4222-8222-222222222225', 치킨러버: '22222222-2222-4222-8222-222222222226', 고인물: '22222222-2222-4222-8222-222222222227', 뉴비123: '22222222-2222-4222-8222-222222222228', 새벽감성: '22222222-2222-4222-8222-222222222229', 도배러: '22222222-2222-4222-8222-222222222230', 이벤트봇: '22222222-2222-4222-8222-222222222231', 버럭이: '22222222-2222-4222-8222-222222222232' };
const xid = (n: number) => `44444444-4444-4444-8444-4444444445${String(n).padStart(2, '0')}`;
const extraLines: [string, string, number, Message['visibility']][] = [
  ['치킨러버', '방송 켜자마자 들어왔어요 ㅎㅎ', 24, 'PUBLIC'], ['고인물', '오늘 패치 내용 보셨어요?', 23, 'PUBLIC'], ['뉴비123', '처음 왔는데 분위기 좋네요', 22, 'PUBLIC'],
  ['새벽감성', 'BGM 뭐예요? 너무 좋아요', 21, 'PUBLIC'], ['김하늘', '오늘 몇 시까지 하세요?', 20, 'PUBLIC'], ['게임소녀', '저번 판 진짜 레전드였음', 19, 'PUBLIC'],
  ['도배러', 'ㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋ', 18, 'HIDDEN'], ['치킨러버', '저 지금 치킨 시켰어요 🍗', 17, 'PUBLIC'], ['고인물', '그 무기 말고 활 쓰세요', 16, 'PUBLIC'],
  ['이벤트봇', '구독자 이벤트! 아래 링크에서 아이템 받아가세요', 15, 'HIDDEN'], ['뉴비123', '저도 해보고 싶어지네요', 14, 'PUBLIC'], ['새벽감성', '와 방금 컨트롤 미쳤다', 13, 'PUBLIC'],
  ['버럭이', '아 진짜 노잼이네 꺼져라', 12, 'HIDDEN'], ['게임소녀', '보스 패턴 바뀐 것 같아요', 11, 'PUBLIC'], ['김하늘', '오늘 텐션 최고네요 👍', 9, 'PUBLIC'],
  ['고인물', '다음 맵은 왼쪽 길이 빨라요', 8, 'PUBLIC'], ['치킨러버', '치킨 왔다! 같이 먹어요 ㅋㅋ', 7, 'PUBLIC']
];
const extraMessages = extraLines.map(([who, text, min, vis], n) => msg(xid(n), who, text, min, vis));
export const fixtureOwners: Record<string,string> = {
  ...Object.fromEntries(extraMessages.map(m => [m.messageId, extraUsers[m.authorAlias]])),
  [ids[0]]: '22222222-2222-4222-8222-222222222224',
  [ids[1]]: DEMO_USERS[0].id,
  [ids[2]]: DEMO_USERS[1].id,
  [ids[3]]: '22222222-2222-4222-8222-222222222225',
  [ids[4]]: DEMO_USERS[1].id,
  [ids[5]]: DEMO_USERS[1].id
};
const caseIds = ['55555555-5555-4555-8555-555555555551', '55555555-5555-4555-8555-555555555552', '55555555-5555-4555-8555-555555555553'];
const pendingReviewId = '66666666-6666-4666-8666-666666666661';
const fixtureReview: KickReview = { reviewId: pendingReviewId, channelId: CHANNEL_ID, userAlias: '어둠의유저', status: 'PENDING', summary: '최근 24시간 동안 욕설, 운영진 사칭, 괴롭힘을 이어서 했습니다. 운영진 사칭으로 10분 채팅 제한을 받은 뒤에도 같은 사용자를 겨냥한 괴롭힘이 계속되었습니다.', caseIds, version: 1, createdAt: stamp(1), decisionReason: null, kickExpiresAt: null };
export const fixtureCases: CaseDetail[] = caseIds.map((id, index) => {
  const cat = (['PROFANITY', 'PHISHING', 'HARASSMENT'] as const)[index];
  return { caseId: id, channelId: CHANNEL_ID, userAlias: '어둠의유저', filterResult: 'HOLD', status: index === 2 ? 'KICK_REVIEW_PENDING' : 'HIDDEN', verdict: 'VIOLATION', category: cat, version: 2, createdAt: stamp(4 - index), messages: [fixtureMessages[index === 0 ? 2 : index === 1 ? 4 : 5]], reason: ['방송인을 향한 직접적인 모욕 표현입니다.', '운영자 사칭 및 외부 로그인 유도 의심. 역할 정보와 정책을 확인했습니다.', '같은 사용자를 반복해서 겨냥한 표적 언행이 확인되었습니다.'][index], evidenceMessageIds: [ids[index === 0 ? 2 : index === 1 ? 4 : 5]], policySnapshots: [mockPolicy[cat]], violationCount: index + 1, kickReview: index === 2 ? structuredClone(fixtureReview) : null, traceUrl: null };
});
// 두 번째 위반(피싱, 이전 확정 1건)으로 적용된 TIMEOUT 600초.
const fixtureTimeouts = () => ({ [DEMO_USERS[1].id]: new Date(Date.now() - 2 * 60_000 + 600_000).toISOString() });
function firstViolation(id: string, n: number, category: 'FLOOD' | 'PHISHING' | 'PROFANITY', filterResult: 'FLOOD' | 'HOLD', reason: string): CaseDetail {
  const m = extraMessages[n];
  return { caseId: id, channelId: CHANNEL_ID, userAlias: m.authorAlias, filterResult, status: 'HIDDEN', verdict: 'VIOLATION', category, version: 2, createdAt: m.sentAt, messages: [m], reason, evidenceMessageIds: [m.messageId], policySnapshots: [mockPolicy[category]], violationCount: 1, kickReview: null, traceUrl: null };
}
const extraCases: CaseDetail[] = [
  firstViolation('55555555-5555-4555-8555-555555555561', 6, 'FLOOD', 'FLOOD', '같은 글자를 짧은 시간에 반복해 대화를 방해했습니다.'),
  firstViolation('55555555-5555-4555-8555-555555555562', 9, 'PHISHING', 'HOLD', '이벤트를 사칭해 외부 링크로 유도했습니다. 공식 이벤트 목록에 없는 주소입니다.'),
  firstViolation('55555555-5555-4555-8555-555555555563', 12, 'PROFANITY', 'HOLD', '방송인을 향한 직접적인 모욕 표현입니다.')
];
const byTime = (a: Message, b: Message) => a.sentAt.localeCompare(b.sentAt);
export function cloneFixtures() { return { messages: structuredClone([...extraMessages, ...fixtureMessages].sort(byTime)), cases: structuredClone([...extraCases, ...fixtureCases]), owners: { ...fixtureOwners }, timeouts: fixtureTimeouts() }; }
export const demoScenarios = [
  { key: 'normal', label: '정상', user: 0, text: '오늘 방송 정말 재밌네요!', category: null, filterResult: 'PASS' as const },
  { key: 'profanity', label: '욕설', user: 1, text: '너 정말 못해. 바보 같아.', category: 'PROFANITY' as const, filterResult: 'HOLD' as const },
  { key: 'flood', label: '도배', user: 1, text: '가자가자가자가자', category: 'FLOOD' as const, filterResult: 'FLOOD' as const },
  { key: 'phishing', label: '피싱', user: 2, text: '공식 운영팀입니다. 외부 사이트에서 로그인하세요.', category: 'PHISHING' as const, filterResult: 'HOLD' as const },
  { key: 'pii', label: '개인정보', user: 2, text: '제 번호 010-1234-5678로 연락 주세요', category: 'PII_EXPOSURE' as const, filterResult: 'HOLD' as const },
  { key: 'review', label: '판단 보류', user: 0, text: '그런 말은 하지 마세요.', category: 'HARASSMENT' as const, filterResult: 'REVIEW' as const }
];
export function caseSummary(c: CaseDetail): CaseSummary {
  const { caseId, channelId, userAlias, filterResult, status, verdict, category, version, createdAt } = c;
  return { caseId, channelId, userAlias, filterResult, status, verdict, category, version, createdAt };
}

// Mock 실시간 흐름용 채팅. 위반 문장은 아직 위반 기록이 없는 사용자만 보낸다(자동 조치만 쌓이게).
export const feedUsers = Object.entries(extraUsers).filter(([alias]) => !['도배러', '이벤트봇', '버럭이'].includes(alias)).map(([alias, id]) => ({ alias, id }));
export const feedChats = ['ㅋㅋㅋ 이건 못 참지', '오 방금 그거 뭐예요?', '화이팅!!', '오늘 방송 길게 해주세요', '와 대박', '이 게임 재밌어 보이네요', '방금 들어왔어요 안녕하세요', '목소리 너무 좋으세요', '이번 판은 이길 듯', 'GG', '아깝다 ㅠㅠ', '다음 판 가보자고', '채팅 분위기 좋네요', '오늘 처음 봤는데 구독했어요', '배고파지는 방송이네 ㅋㅋ',
  '방금 그 점프 어떻게 한 거예요?', '저 이 구간에서 맨날 죽어요 ㅠ', '오늘 의상 예쁘네요', '다들 저녁 드셨어요?', '이거 신규 업데이트 맵이죠?', '침착하게! 할 수 있어요', '역시 고수는 다르네', '퇴근하고 바로 왔어요 🙌', '응원합니다 끝까지 가요', '내일도 방송하시나요?',
  '이 장면 클립 따야 함', '오늘 운 좋은데요?', '하트 누르고 갑니다 ❤️', '채팅창 깨끗해서 좋네요', '보스 체력 얼마 안 남았어요!', '방금 소리 뭐예요 ㅋㅋㅋ', '설명 너무 친절하세요', '오늘 몇 판 하실 거예요?', '다음엔 같이 해요', '첫 방송부터 보고 있어요']; 
export const feedViolations = [
  { alias: '스팸장인', id: '22222222-2222-4222-8222-222222222240', text: '무료 아이템 지급! 여기서 로그인만 하세요', category: 'PHISHING' as const, filterResult: 'HOLD' as const },
  { alias: '연타왕', id: '22222222-2222-4222-8222-222222222241', text: '가즈아가즈아가즈아가즈아가즈아가즈아', category: 'FLOOD' as const, filterResult: 'FLOOD' as const },
  { alias: '화난곰', id: '22222222-2222-4222-8222-222222222242', text: '진짜 실력 쓰레기네', category: 'PROFANITY' as const, filterResult: 'HOLD' as const },
  { alias: '오픈톡', id: '22222222-2222-4222-8222-222222222243', text: '제 카톡 아이디 game1234 친추 주세요', category: 'PII_EXPOSURE' as const, filterResult: 'HOLD' as const }
];
