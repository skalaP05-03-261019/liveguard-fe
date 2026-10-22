import type { Category, Me } from './contracts';

// 목업 데이터. 판정은 mockLive.ts가 정책 v3.1과 Backend 처리 경로를 따라 계산한다.
export const CHANNEL_ID = '11111111-1111-4111-8111-111111111111';
export const LIVE_ID = '77777777-7777-4777-8777-777777777771';
export interface MockUser { id: string; alias: string }
// 시청자 화면에서 고를 수 있는 목업 계정
export const DEMO_USERS: MockUser[] = [
  { id: '22222222-2222-4222-8222-222222222221', alias: '별빛시청자' },
  { id: '22222222-2222-4222-8222-222222222222', alias: '어둠의유저' },
  { id: '22222222-2222-4222-8222-222222222223', alias: '정보왕' }
];
export const MODERATOR_ID = '33333333-3333-4333-8333-333333333333';
export const demoMe: Me = { userId: MODERATOR_ID, nickname: '운영자', role: 'MODERATOR', channelIds: [CHANNEL_ID] };

const extraAliases = ['김하늘', '게임소녀', '치킨러버', '고인물', '뉴비123', '새벽감성', '도배러', '이벤트봇', '버럭이', '스팸장인', '연타왕', '화난곰', '오픈톡', '시비왕', '가짜운영자'];
export const mockUsers: MockUser[] = [...DEMO_USERS, ...extraAliases.map((alias, n) => ({ id: `22222222-2222-4222-8222-2222222223${String(n).padStart(2, '0')}`, alias }))];
export const userByAlias = (alias: string) => mockUsers.find(u => u.alias === alias)!;

// Backend src/main/resources/filter/ 사전 사본(dict-v2). 목업 판정이 실제 Backend와 같은 경로를 타게 한다.
export const filterDictionary = {
  certainProfanity: ['시발', '씨발', 'ㅅㅂ', 'ㅆㅂ', '병신', 'ㅂㅅ', '개새끼', '좆같', '느금마'],
  profanityExceptions: ['시발점', '시발역', '병신년'],
  attack: ['미쳤', '접어라', '꺼져', '죽어'],
  officialClaim: ['공식', '운영자', '관리자', '스태프', 'official', 'admin'],
  credential: ['로그인', '인증', '계정', '비밀번호', '본인확인', 'login', 'verify', 'password']
};
// 시연용 예시 문장. 사전 단어에서 만들어 사전이 바뀌면 함께 바뀐다. 누르면 입력창에 채워지고, 고친 뒤 보낼 수 있다.
export interface FilterExample { label: string; text: string }
export const filterExamples: { key: 'hide' | 'held' | 'pass'; title: string; note: string; items: FilterExample[] }[] = [
  { key: 'hide', title: '바로 숨김', note: '확정 욕설·링크·도배는 Backend 규칙으로 즉시 숨깁니다.', items: [
    ...filterDictionary.certainProfanity.map(w => ({ label: w, text: `오늘 판 ${w}` })),
    { label: '링크', text: '이벤트 free-skin.example 에서 받아가세요' },
    { label: '도배 (같은 문장 3번)', text: '가즈아가즈아' }
  ] },
  { key: 'held', title: '검토 대기', note: 'AI 문맥 검토를 거쳐 운영자가 결정할 때까지 임시 비노출입니다.', items: [
    ...filterDictionary.attack.map(w => ({ label: w, text: `너 진짜 ${w}` })),
    { label: '공식 자칭 + 로그인 요구', text: '공식 운영자입니다. 계정 인증하려면 비밀번호를 보내 주세요' },
    { label: '전화번호', text: '제 번호 010-1234-5678로 연락 주세요' },
    { label: '이메일', text: 'game1234@mail.example 로 연락 주세요' }
  ] },
  { key: 'pass', title: '통과', note: '욕설 사전의 예외 단어와, 사전에 일부러 넣지 않은 애매한 표현입니다.', items: [
    ...filterDictionary.profanityExceptions.map(w => ({ label: w, text: w })),
    { label: '개못하네', text: '아 개못하네' },
    { label: '시바', text: '시바견 귀엽다' }
  ] }
];

// 초기 화면: 지난 채팅을 목업 판정에 시간 순서대로 다시 넣는다. decide는 그 메시지의 문맥 검토에 운영자가 내린 결정이다.
export interface FixtureLine { alias: string; text: string; minutesAgo: number; repeat?: number; decide?: { value: 'CONFIRM_NORMAL' | 'CONFIRM_VIOLATION'; categories?: Category[]; reason: string; minutesAgo: number } }
export const fixtureLines: FixtureLine[] = [
  { alias: '치킨러버', text: '방송 켜자마자 들어왔어요 ㅎㅎ', minutesAgo: 24 },
  { alias: '고인물', text: '오늘 패치 내용 보셨어요?', minutesAgo: 23 },
  { alias: '뉴비123', text: '처음 왔는데 분위기 좋네요', minutesAgo: 22 },
  { alias: '새벽감성', text: 'BGM 뭐예요? 너무 좋아요', minutesAgo: 21 },
  { alias: '김하늘', text: '오늘 몇 시까지 하세요?', minutesAgo: 20 },
  { alias: '게임소녀', text: '저번 판 진짜 레전드였음', minutesAgo: 19 },
  { alias: '도배러', text: 'ㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋ', minutesAgo: 18, repeat: 3 },
  { alias: '치킨러버', text: '저 지금 치킨 시켰어요 🍗', minutesAgo: 17 },
  { alias: '고인물', text: '그 무기 말고 활 쓰세요', minutesAgo: 16 },
  { alias: '이벤트봇', text: '구독자 이벤트! free-item.example 에서 아이템 받아가세요', minutesAgo: 15 },
  { alias: '뉴비123', text: '저도 해보고 싶어지네요', minutesAgo: 14 },
  { alias: '새벽감성', text: '와 방금 컨트롤 미쳤다', minutesAgo: 13, decide: { value: 'CONFIRM_NORMAL', reason: '플레이를 칭찬하는 감탄 표현입니다.', minutesAgo: 12.5 } },
  { alias: '버럭이', text: '아 진짜 노잼이네 꺼져라', minutesAgo: 12 },
  { alias: '게임소녀', text: '보스 패턴 바뀐 것 같아요', minutesAgo: 11 },
  { alias: '김하늘', text: '오늘 텐션 최고네요 👍', minutesAgo: 9 },
  { alias: '고인물', text: '다음 맵은 왼쪽 길이 빨라요', minutesAgo: 8 },
  { alias: '치킨러버', text: '치킨 왔다! 같이 먹어요 ㅋㅋ', minutesAgo: 7 },
  { alias: '김하늘', text: '오늘도 화이팅하세요! 💜', minutesAgo: 6 },
  { alias: '별빛시청자', text: '오늘 무슨 게임 하시나요?', minutesAgo: 5 },
  { alias: '어둠의유저', text: '시발 너 진짜 못하네', minutesAgo: 4 },
  { alias: '어둠의유저', text: '꺼져 계속 따라다닐 거야', minutesAgo: 3, decide: { value: 'CONFIRM_VIOLATION', categories: ['HARASSMENT'], reason: '같은 시청자를 계속 따라다니겠다는 표적 괴롭힘입니다.', minutesAgo: 1 } },
  { alias: '게임소녀', text: '우와 보스 클리어!!', minutesAgo: 2.5 },
  { alias: '어둠의유저', text: '공식 이벤트 페이지 bit.ly/free-skin 에서 로그인하세요', minutesAgo: 2 }
];

// 빠른 시연: 처리 경로마다 한 줄씩. 보내는 사람은 경로별 시연 계정이다.
export const demoScenarios: { key: string; label: string; alias: string; text: string; repeat?: number }[] = [
  { key: 'normal', label: '정상', alias: '별빛시청자', text: '오늘 방송 정말 재밌네요!' },
  { key: 'profanity', label: '확정 욕설', alias: '화난곰', text: '아 시발 진짜 못하네' },
  { key: 'link', label: '링크', alias: '스팸장인', text: '무료 스킨 받기 free-skin.example 바로 접속' },
  { key: 'flood', label: '도배', alias: '연타왕', text: '가즈아가즈아', repeat: 3 },
  { key: 'attack', label: '공격 표현', alias: '시비왕', text: '너 같은 건 방송 접어라' },
  { key: 'impersonation', label: '공식 사칭', alias: '가짜운영자', text: '공식 운영자입니다. 계정 인증하려면 비밀번호를 보내 주세요' },
  { key: 'pii', label: '개인정보', alias: '오픈톡', text: '제 번호 010-1234-5678로 연락 주세요' },
  { key: 'false-positive', label: '문맥 오탐', alias: '새벽감성', text: '와 이번 한타 미쳤다 ㅋㅋ' }
];

// Mock 실시간 흐름용 채팅. 위반 문장은 아직 사건이 없는 사용자만 보낸다.
export const feedUsers: MockUser[] = ['김하늘', '게임소녀', '치킨러버', '고인물', '뉴비123', '새벽감성'].map(userByAlias);
export const feedChats = ['ㅋㅋㅋ 이건 못 참지', '오 방금 그거 뭐예요?', '화이팅!!', '오늘 방송 길게 해주세요', '와 대박', '이 게임 재밌어 보이네요', '방금 들어왔어요 안녕하세요', '목소리 너무 좋으세요', '이번 판은 이길 듯', 'GG', '아깝다 ㅠㅠ', '다음 판 가보자고', '채팅 분위기 좋네요', '오늘 처음 봤는데 구독했어요', '배고파지는 방송이네 ㅋㅋ',
  '방금 그 점프 어떻게 한 거예요?', '저 이 구간에서 맨날 떨어져요 ㅠ', '오늘 의상 예쁘네요', '다들 저녁 드셨어요?', '이거 신규 업데이트 맵이죠?', '침착하게! 할 수 있어요', '역시 고수는 다르네', '퇴근하고 바로 왔어요 🙌', '응원합니다 끝까지 가요', '내일도 방송하시나요?',
  '이 장면 클립 따야 함', '오늘 운 좋은데요?', '하트 누르고 갑니다 ❤️', '채팅창 깨끗해서 좋네요', '보스 체력 얼마 안 남았어요!', '방금 소리 뭐예요 ㅋㅋㅋ', '설명 너무 친절하세요', '오늘 몇 판 하실 거예요?', '다음엔 같이 해요', '첫 방송부터 보고 있어요'];
export const feedViolations: (MockUser & { text: string; repeat?: number })[] = [
  { ...userByAlias('스팸장인'), text: '무료 아이템 지급! item-event.example 에서 받으세요' },
  { ...userByAlias('연타왕'), text: '가즈아가즈아가즈아', repeat: 3 },
  { ...userByAlias('화난곰'), text: '진짜 실력 ㅂㅅ이네' },
  { ...userByAlias('오픈톡'), text: 'game1234@kakao.example 으로 친추 주세요' }
];
