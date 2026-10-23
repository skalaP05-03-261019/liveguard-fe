import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api } from '../api/client';
import { ApiError, authorNotice, type Category, type ContextDecision, type KickDecision, type Me, type Message } from '../contracts';
import { CHANNEL_ID, DEMO_USERS, demoMe, demoScenarios, feedChats, feedUsers, feedViolations, fixtureLines, mockUsers, userByAlias, type MockUser } from '../mock';
import { createMockLive, type KickOutcome, type SendResult } from '../mockLive';
import { timeoutText } from '../sanction';

const demo = import.meta.env.VITE_USE_API !== 'true';
// 시청자 채팅 최대 글자 수. 서버 계약(SendMessageRequest.text maxLength)과 같게 둔다
export const MAX_CHAT_LENGTH = 500;

// 로그인·세션과 목업 방송 상태. 실제 API의 방송·채팅·검토 연결은 LiveConsole.vue가 맡는다.
export const useLiveGuard = defineStore('liveGuard', () => {
  const mode = ref<'mock' | 'api'>(demo ? 'mock' : 'api');
  const me = ref<Me | null>(null);
  const channelId = ref(CHANNEL_ID);
  const viewerId = ref(DEMO_USERS[0].id);
  const busy = ref(false);
  const error = ref('');
  const notice = ref('');
  const loginRequired = ref(true);
  const clock = ref(Date.now());
  let clockTimer: ReturnType<typeof setInterval> | undefined;
  let notificationTimeout: ReturnType<typeof setTimeout> | undefined;

  // 목업 방송: 정책 v3.1 판정과 API v1.0 모양의 사건·검토(mockLive.ts)
  const mock = createMockLive(mockUsers);
  const viewer = computed(() => DEMO_USERS.find(u => u.id === viewerId.value) ?? DEMO_USERS[0]);
  const viewerAlias = computed(() => demo ? viewer.value.alias : me.value?.nickname ?? '시청자');
  // 작성자 본인 메시지만 비공개 상태로 보인다. 본인 응답에만 작성자 안내 필드가 채워진다.
  const viewerMessages = computed<Message[]>(() => mock.state.messages
    .filter(m => m.visibility === 'PUBLIC' || m.ownerId === viewerId.value)
    .map(({ ownerId, ...m }) => ownerId === viewerId.value ? { ...m, isMine: true } : { ...m, isMine: false, moderationNotice: null, moderationReasonCode: null, reviewStatus: null, timeoutUntil: null }));
  const kicked = computed(() => !!mock.state.kicks[viewerId.value]);
  const viewerTimeoutUntil = computed(() => mock.state.timeouts[viewerId.value] ?? null);
  const timedOut = computed(() => !kicked.value && !!viewerTimeoutUntil.value && Date.parse(viewerTimeoutUntil.value) > clock.value);
  // 제한 안내에 함께 보일 사유: 지금 제한을 일으킨 본인 메시지, 없으면 가장 최근 가려진 본인 메시지
  const viewerLastReason = computed(() => {
    const own = [...viewerMessages.value].reverse().filter(m => m.visibility !== 'PUBLIC' && (m.moderationNotice || m.moderationReasonCode));
    const last = own.find(m => m.timeoutUntil && m.timeoutUntil === viewerTimeoutUntil.value) ?? own[0];
    return last ? authorNotice(last) : null;
  });

  function toast(text: string) { notice.value = text; if (notificationTimeout) clearTimeout(notificationTimeout); notificationTimeout = setTimeout(() => notice.value = '', 3500); }
  function report(e: unknown): void {
    const err = e instanceof ApiError ? e : new ApiError('TEMPORARY_UNAVAILABLE', e instanceof Error ? e.message : '알 수 없는 오류');
    error.value = `${err.code}: ${err.message}`;
    if (err.code === 'UNAUTHENTICATED') loginRequired.value = true;
    toast(error.value);
  }
  function resetMock() { mock.reset(fixtureLines); error.value = ''; notice.value = ''; }
  async function init() {
    if (!clockTimer) clockTimer = setInterval(() => { clock.value = Date.now(); }, 1000);
    if (demo) { resetMock(); loginRequired.value = true; me.value = null; return; }
    try { enter(await api.me()); }
    catch (e) {
      if (e instanceof ApiError && e.code === 'UNAUTHENTICATED') { loginRequired.value = true; error.value = ''; }
      else report(e);
    }
  }
  async function login(username: string, password: string) {
    busy.value = true; error.value = '';
    try {
      if (demo) {
        const account = username.trim().toLowerCase();
        if (password !== 'liveguard-local' || !['moderator', 'viewer', 'admin'].includes(account)) throw new ApiError('UNAUTHENTICATED', '데모 계정 또는 비밀번호가 올바르지 않습니다.');
        const role = account === 'viewer' ? 'VIEWER' : account === 'admin' ? 'PLATFORM_ADMIN' : 'MODERATOR';
        me.value = role === 'VIEWER' ? { userId: DEMO_USERS[0].id, nickname: DEMO_USERS[0].alias, role, channelIds: [CHANNEL_ID] }
          : { ...structuredClone(demoMe), role, nickname: role === 'PLATFORM_ADMIN' ? '시스템 운영자' : '운영자' };
        viewerId.value = role === 'VIEWER' ? me.value.userId : viewerId.value;
        loginRequired.value = false;
        startFeed();
        toast(`${me.value.nickname} 로그인 완료 (MOCK)`);
      } else {
        let user: Me;
        try { user = await api.login(username, password); }
        catch (e) {
          // 서버는 계정 유무를 구분하지 않고 401을 준다. 사용자에게는 한국어 안내로 바꿔 보여준다
          report(e instanceof ApiError && e.code === 'UNAUTHENTICATED' ? new ApiError(e.code, '아이디 또는 비밀번호가 올바르지 않습니다.') : e);
          me.value = null; loginRequired.value = true;
          return;
        }
        enter(user); notifyAuthChange();
      }
    } catch (e) { report(e); me.value = null; loginRequired.value = true; }
    finally { busy.value = false; }
  }
  function enter(user: Me) { me.value = user; loginRequired.value = false; error.value = ''; channelId.value = user.channelIds[0] ?? ''; }
  // 다른 창에서 계정이 바뀌었을 때 LiveConsole이 부른다.
  async function syncIdentity(user: Me) { enter(user); }
  function notifyAuthChange() {
    if (typeof BroadcastChannel !== 'undefined') { const channel = new BroadcastChannel('liveguard-auth'); channel.postMessage('changed'); channel.close(); }
  }
  function clearIdentity() { stopFeed(); me.value = null; loginRequired.value = true; channelId.value = ''; }
  async function logout() {
    stopFeed();
    if (!demo) { try { await api.logout(); } catch (e) { report(e); } }
    me.value = null; loginRequired.value = true; notifyAuthChange();
  }

  function announce(r: SendResult, alias: string) {
    if (!r.ok) return toast(r.code === 'KICKED' ? '현재 방송 입장이 제한되었습니다.' : '채팅이 일시 제한되어 메시지를 보낼 수 없습니다.');
    const m = r.message, c = r.caseItem;
    if (m.visibility === 'PUBLIC') return;
    if (m.visibility === 'HELD') return toast(`${alias} · AI 검토 후 운영자 결정 대기 (MOCK)`);
    const limit = c?.timeoutUntil ? ` · 채팅 ${timeoutText(Math.round((Date.parse(c.timeoutUntil) - Date.parse(m.sentAt)) / 1000))} 제한` : '';
    toast(`${alias} · 메시지 숨김${limit} (MOCK)`);
  }
  // 목업 시청자 채팅. 판정은 mockLive가 Backend와 같은 처리 경로로 한다.
  async function sendMessage(text: string) {
    const trimmed = text.trim(); if (!trimmed) return false;
    if (trimmed.length > MAX_CHAT_LENGTH) { toast(`메시지는 최대 ${MAX_CHAT_LENGTH}자입니다.`); return false; }
    clock.value = Date.now();
    const r = mock.send(viewer.value, trimmed);
    if (!r.ok) { announce(r, viewer.value.alias); return false; }
    if (r.message.visibility !== 'PUBLIC') announce(r, viewer.value.alias);
    return true;
  }
  // 목업 시청자 화면 시연용: 제한 효과만 보여 준다. 사건은 만들지 않는다.
  function setMockTimeout(userId: string, until: string | null) {
    clock.value = Date.now();
    if (until) mock.state.timeouts[userId] = until; else delete mock.state.timeouts[userId];
  }
  // 빠른 시연: 처리 경로별 시연 계정이 한 줄씩 보낸다. 도배는 같은 문장을 연달아 보낸다.
  function mockScenario(key: string) {
    const sc = demoScenarios.find(x => x.key === key); if (!sc) return;
    const user = userByAlias(sc.alias), at = Date.now();
    let last: SendResult | null = null;
    for (let n = 0; n < (sc.repeat ?? 1); n++) last = mock.send(user, sc.text, at + n);
    if (last) { if (last.ok && last.message.visibility === 'PUBLIC') toast(`${sc.alias} · 공개 (MOCK)`); else announce(last, sc.alias); }
  }
  function decide(reviewId: string, value: ContextDecision | KickDecision, reason: string, categories: Category[] = []) {
    if (!reason.trim()) { error.value = '결정 이유를 입력해 주세요.'; return false; }
    const r = mock.decide(reviewId, value, reason.trim(), categories);
    if (r.ok) error.value = ''; else error.value = r.message;
    toast(r.message);
    return r.ok;
  }
  function revoke(caseId: string, findingId: string, reason: string) {
    if (!mock.revoke(caseId, findingId, reason)) return false;
    toast('오판 취소를 반영했습니다. 남은 근거가 없으면 메시지가 다시 공개됩니다. (MOCK)');
    return true;
  }
  function finishKick(reviewId: string, outcome: KickOutcome) { const text = mock.finishKick(reviewId, outcome); if (text) toast(text); return !!text; }

  // Mock 실시간 흐름: 4.5초마다 채팅 한 줄. 가끔 아직 사건이 없는 사용자의 위반이 섞인다.
  const feedOn = ref(false);
  let feedTimer: ReturnType<typeof setInterval> | undefined;
  const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];
  const hasCase = (u: MockUser) => mock.state.cases.some(c => c.userId === u.id);
  function feedTick() {
    if (Math.random() < 0.15) {
      const v = feedViolations.filter(x => !hasCase(x));
      if (v.length) { const x = pick(v), at = Date.now(); for (let n = 0; n < (x.repeat ?? 1); n++) mock.send(x, x.text, at + n); return; }
    }
    mock.send(pick(feedUsers), pick(feedChats));
  }
  function startFeed() { if (!demo || feedTimer) return; feedTimer = setInterval(feedTick, 4500); feedOn.value = true; }
  function stopFeed() { if (feedTimer) clearInterval(feedTimer); feedTimer = undefined; feedOn.value = false; }
  function toggleFeed() { if (feedOn.value) stopFeed(); else startFeed(); }
  function dispose() { stopFeed(); if (clockTimer) clearInterval(clockTimer); if (notificationTimeout) clearTimeout(notificationTimeout); }
  return { mode, me, channelId, viewerId, busy, error, notice, loginRequired, clock, mock,
    viewerAlias, viewerMessages, kicked, viewerTimeoutUntil, timedOut, viewerLastReason,
    init, login, logout, syncIdentity, clearIdentity, toast, report, resetMock, sendMessage, setMockTimeout, mockScenario, decide, revoke, finishKick, feedOn, toggleFeed, dispose };
});
