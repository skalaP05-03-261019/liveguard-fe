import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api } from '../api/client';
import { ApiError, categoryLabels, statusLabels, type AuditEntry, type CaseDetail, type Category, type CaseEvent, type CaseSummary, type ChatEvent, type KickReview, type KickReviewEvent, type Me, type Message, type TaskFailedEvent, type ToolEvent, type UserKickedEvent, type VisibilityChangedEvent } from '../contracts';
import { caseSummary, CHANNEL_ID, cloneFixtures, DEMO_USERS, demoMe, demoScenarios, feedChats, feedUsers, feedViolations, mockPolicy } from '../mock';
import { needsApproval, sanctionFor, sanctionLabel, SHORT_TIMEOUT_MS, timeoutText } from '../sanction';

const demo = import.meta.env.VITE_USE_API !== 'true';
// 시청자 채팅 최대 글자 수. 서버 계약(SendMessageRequest.text maxLength)과 같게 둔다
export const MAX_CHAT_LENGTH = 500;
const now = () => new Date().toISOString();
const newId = () => crypto.randomUUID();
// sentAt은 소수 자릿수가 메시지마다 달라("…50.2Z", "…50.205958Z") 문자열 비교로는 순서가 틀릴 수 있어 시각으로 비교한다
const bySentAt = (a: Message, b: Message) => Date.parse(a.sentAt) - Date.parse(b.sentAt) || a.sentAt.localeCompare(b.sentAt);
const time = (stamp?: string) => new Date(stamp || Date.now()).toLocaleTimeString('ko-KR', { hour12: false });

export const useLiveGuard = defineStore('liveGuard', () => {
  const mode = ref<'mock' | 'api'>(demo ? 'mock' : 'api');
  const me = ref<Me | null>(null);
  const channelId = ref(CHANNEL_ID);
  const viewerId = ref(DEMO_USERS[0].id);
  const messages = ref<Message[]>([]);
  const cases = ref<CaseSummary[]>([]);
  const details = ref<Record<string, CaseDetail>>({});
  const selectedCaseId = ref<string | null>(null);
  const selectedMessageId = ref<string | null>(null);
  const kicks = ref<Record<string, string>>({});
  const timeouts = ref<Record<string, string>>({});
  // 시스템 운영자 화면용: 강퇴 검토가 결정된 시각(명세 KickReview에는 결정 시각 필드가 없다).
  const decidedAt = ref<Record<string, string>>({});
  // 시청자 관리 탭(#5) Mock 상태: 오판 취소된 사건(사유)과 문맥 결정이 끝난 사건(결정값).
  const revokedCases = ref<Record<string, string>>({});
  const contextDecided = ref<Record<string, string>>({});
  const clock = ref(Date.now());
  let clockTimer: ReturnType<typeof setInterval> | undefined;
  const owners = ref<Record<string, string>>({});
  const audit = ref<AuditEntry[]>([]);
  const online = ref(false);
  const busy = ref(false);
  const error = ref('');
  const notice = ref('');
  const lastTraceId = ref('');
  const loginRequired = ref(true);
  let chatSource: EventSource | null = null;
  let guardSource: EventSource | null = null;
  let notificationTimeout: ReturnType<typeof setTimeout> | undefined;

  const selectedCase = computed(() => selectedCaseId.value ? details.value[selectedCaseId.value] : undefined);
  const allCases = computed(() => [...cases.value].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  const selectedMessage = computed(() => messages.value.find(m => m.messageId === selectedMessageId.value));
  const kickReviews = computed(() => {
    const dict: Record<string, KickReview> = {};
    Object.values(details.value).forEach(c => { if (c.kickReview) dict[c.kickReview.reviewId] = c.kickReview; });
    return Object.values(dict).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });
  const pendingReviews = computed(() => kickReviews.value.filter(r => r.status === 'PENDING'));
  const viewerAlias = computed(() => demo ? DEMO_USERS.find(u => u.id === viewerId.value)?.alias ?? '시청자' : me.value?.nickname ?? '시청자');
  const viewerMessages = computed(() => messages.value.filter(m => m.visibility === 'PUBLIC' || (demo ? owners.value[m.messageId] === viewerId.value : m.isMine)));
  const viewerCases = computed(() => demo ? allCases.value.filter(c => c.userAlias === viewerAlias.value) : []);
  const viewerKickUntil = computed(() => demo ? kicks.value[viewerId.value] ?? null : kicks.value['session'] ?? null);
  const kicked = computed(() => !!viewerKickUntil.value && new Date(viewerKickUntil.value).getTime() > clock.value);
  const viewerTimeoutUntil = computed(() => demo ? timeouts.value[viewerId.value] ?? null : timeouts.value['session'] ?? null);
  const timedOut = computed(() => !kicked.value && !!viewerTimeoutUntil.value && new Date(viewerTimeoutUntil.value).getTime() > clock.value);
  // 운영자 채팅에 제한 중인 사용자를 표시한다. 사용자 ID가 공개되지 않는 API 모드에서는 Mock만 지원한다.
  const restrictedAliases = computed(() => {
    const out: Record<string, 'TIMEOUT' | 'KICK'> = {};
    for (const u of DEMO_USERS) {
      if (timeouts.value[u.id] && new Date(timeouts.value[u.id]).getTime() > clock.value) out[u.alias] = 'TIMEOUT';
      if (kicks.value[u.id] && new Date(kicks.value[u.id]).getTime() > clock.value) out[u.alias] = 'KICK';
    }
    return demo ? out : {};
  });
  const isOperator = computed(() => me.value?.role === 'MODERATOR' || me.value?.role === 'PLATFORM_ADMIN');

  function restrict(until: string) {
    // KICKED 응답과 USER_KICKED에는 until만 있으므로 남은 시간이 짧으면 TIMEOUT 600초로 구분한다.
    if (new Date(until).getTime() - Date.now() <= SHORT_TIMEOUT_MS) timeouts.value['session'] = until; else kicks.value['session'] = until;
  }
  // 최근 24시간 이전 확정 위반 수. 오탐 해제된 사건과 결정이 끝난 강퇴 검토에 쓰인 사건은 제외한다(ERD 4절).
  function priorViolations(alias: string) {
    const consumed = new Set(Object.values(details.value).flatMap(c => c.kickReview && c.kickReview.status !== 'PENDING' ? c.kickReview.caseIds : []));
    return Object.values(details.value).filter(c => c.userAlias === alias && c.verdict === 'VIOLATION' && !revokedCases.value[c.caseId] && !consumed.has(c.caseId) && Date.now() - new Date(c.createdAt).getTime() <= 86400000);
  }
  function toast(text: string) { notice.value = text; if (notificationTimeout) clearTimeout(notificationTimeout); notificationTimeout = setTimeout(() => notice.value = '', 3500); }
  function log(type: string, content: string, state = '완료') { audit.value.unshift({ id: newId(), time: time(), type, content, state }); audit.value = audit.value.slice(0, 80); }
  function report(e: unknown): void {
    const err = e instanceof ApiError ? e : new ApiError('TEMPORARY_UNAVAILABLE', e instanceof Error ? e.message : '알 수 없는 오류');
    error.value = `${err.code}: ${err.message}`;
    if (err.code === 'KICKED' && err.until) restrict(err.until);
    if (err.code === 'UNAUTHENTICATED') loginRequired.value = true;
    toast(error.value);
    log('API ERROR', error.value, '실패');
  }
  function resetMock() {
    const fixture = cloneFixtures();
    messages.value = fixture.messages;
    owners.value = fixture.owners;
    details.value = Object.fromEntries(fixture.cases.map(c => [c.caseId, c]));
    cases.value = fixture.cases.map(caseSummary);
    const start = fixture.cases.find(c => c.kickReview?.status === 'PENDING') ?? fixture.cases[0];
    selectedCaseId.value = start.caseId;
    selectedMessageId.value = start.messages[0].messageId;
    kicks.value = {}; decidedAt.value = {}; revokedCases.value = {}; contextDecided.value = {}; timeouts.value = fixture.timeouts; audit.value = []; online.value = true; error.value = ''; notice.value = '';
    log('MOCK', 'OpenAPI v0.5-lite 형식의 테스트 데이터 로드');
  }
  async function refreshMessages() {
    if (demo) return;
    const page = await api.messages(channelId.value);
    // 서버는 최신 메시지부터 준다. 화면은 아래쪽이 최신이므로 오래된 순으로 뒤집는다
    messages.value = [...page.items].sort(bySentAt);
  }
  async function refreshCases() {
    if (demo || !isOperator.value) return;
    const items = await api.cases(channelId.value);
    cases.value = items;
    await Promise.allSettled(items.map(i => loadCase(i.caseId)));
    if (!selectedCaseId.value && items[0]) selectedCaseId.value = items[0].caseId;
  }
  async function loadCase(id: string) {
    if (demo) return details.value[id];
    const item = await api.case(id);
    if (!details.value[id] || item.version >= details.value[id].version) details.value[id] = item;
    upsertCase(caseSummary(item));
    return item;
  }
  function upsertCase(c: CaseSummary) {
    const idx = cases.value.findIndex(x => x.caseId === c.caseId);
    if (idx >= 0) { if (c.version >= cases.value[idx].version) cases.value[idx] = c; }
    else cases.value.unshift(c);
  }
  function addOrUpdateMessage(m: Message) {
    const index = messages.value.findIndex(x => x.messageId === m.messageId);
    if (index === -1) messages.value.push(m);
    else if (m.version >= messages.value[index].version) messages.value[index] = m;
    messages.value.sort(bySentAt);
    if (messages.value.length > 150) messages.value.splice(0, messages.value.length - 150);
  }
  async function init() {
    if (!clockTimer) clockTimer = setInterval(() => { clock.value = Date.now(); }, 1000);
    if (demo) { resetMock(); loginRequired.value = true; me.value = null; return; }
    try {
      await enter(await api.me());
    } catch (e) {
      if (e instanceof ApiError && e.code === 'UNAUTHENTICATED') { loginRequired.value = true; error.value = ''; }
      else report(e);
    }
  }
  async function login(username: string, password: string) {
    busy.value = true; error.value = '';
    try {
      if (demo) {
        const account = username.trim().toLowerCase();
        if (password !== 'demo1234' || !['moderator', 'viewer', 'admin'].includes(account)) throw new ApiError('UNAUTHENTICATED', '데모 계정 또는 비밀번호가 올바르지 않습니다.');
        const role = account === 'viewer' ? 'VIEWER' : account === 'admin' ? 'PLATFORM_ADMIN' : 'MODERATOR';
        me.value = role === 'VIEWER' ? { userId: DEMO_USERS[0].id, nickname: DEMO_USERS[0].alias, role, channelIds: [CHANNEL_ID] }
          : { ...structuredClone(demoMe), role, nickname: role === 'PLATFORM_ADMIN' ? '시스템 운영자' : '운영자' };
        viewerId.value = me.value.userId;
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
        await enter(user);notifyAuthChange();
      }
    } catch (e) { report(e); me.value = null; loginRequired.value = true; }
    finally { busy.value = false; }
  }
  // 세션 복원(init)과 로그인 성공 후 공통 처리. 시스템 운영자는 소속 채널이 없어도 들어갈 수 있다.
  // 로그인이 끝난 뒤의 데이터 로딩 실패는 화면 안 오류로만 보여준다. 로그인 화면으로 보내는 건 401(report)뿐이다.
  async function syncIdentity(user: Me) {
    disconnectSse();messages.value=[];cases.value=[];details.value={};selectedCaseId.value=null;
    me.value=user;channelId.value=user.channelIds[0]??'';loginRequired.value=false;error.value='';
  }
  function notifyAuthChange(){
    if(typeof BroadcastChannel!=='undefined'){const channel=new BroadcastChannel('liveguard-auth');channel.postMessage('changed');channel.close();}
  }
  async function enter(user: Me) {
    me.value = user; loginRequired.value = false; error.value = ''; channelId.value = user.channelIds[0] ?? '';
    if(import.meta.env.VITE_USE_LIVE_V1 === 'true') return;
    if (!channelId.value) {
      if (user.role !== 'PLATFORM_ADMIN') report(new ApiError('FORBIDDEN', '접근 가능한 채널이 없습니다.'));
      return;
    }
    const results = await Promise.allSettled([refreshMessages(), refreshCases()]);
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed) report(failed.reason);
    if (!loginRequired.value) connectSse();
  }
  function clearIdentity() {
    stopFeed();disconnectSse();me.value=null;loginRequired.value=true;messages.value=[];cases.value=[];details.value={};channelId.value='';
  }
  async function logout() {
    stopFeed(); disconnectSse();
    if (!demo) { try { await api.logout(); } catch (e) { report(e); } }
    me.value = null; loginRequired.value = true;notifyAuthChange();
    if (!demo) { messages.value = []; cases.value = []; details.value = {}; }
  }
  function selectMessage(id: string) {
    selectedMessageId.value = id;
    const item = Object.values(details.value).find(c => c.messages.some(m => m.messageId === id));
    if (item) { selectedCaseId.value = item.caseId; return; }
    selectedCaseId.value = null;
    if (!demo && isOperator.value) refreshCases().catch(report);
  }
  async function selectCase(id: string) {
    selectedCaseId.value = id;
    if (!demo) { try { await loadCase(id); } catch (e) { report(e); } }
    selectedMessageId.value = details.value[id]?.messages?.[0]?.messageId ?? null;
  }
  function onChatEvent(e: Event) {
    const data = JSON.parse((e as MessageEvent).data) as ChatEvent;
    // SSE에는 channelId/isMine가 없다. 권한별 채팅 조회 응답으로 동기화한다.
    log('CHAT', `${data.authorAlias} · ${data.visibility}`);
    refreshMessages().catch(report);
  }
  function onVisibilityEvent(e: Event) {
    const data = JSON.parse((e as MessageEvent).data) as VisibilityChangedEvent;
    const local = messages.value.find(x => x.messageId === data.messageId);
    if (local && data.version > local.version) {
      local.version = data.version; local.visibility = data.visibility;
      if (data.text !== undefined) local.text = data.text;
    }
    log('VISIBILITY', `${data.messageId.slice(0, 8)} · ${data.visibility}`);
    refreshMessages().catch(report);
  }
  function onCaseEvent(e: Event) {
    const item = JSON.parse((e as MessageEvent).data) as CaseEvent;
    log('CASE', `${item.caseId.slice(0, 8)} · ${statusLabels[item.status]}`);
    loadCase(item.caseId).catch(report);
  }
  function onKickEvent(e: Event) {
    const item = JSON.parse((e as MessageEvent).data) as KickReviewEvent;
    log('KICK', `${item.reviewId.slice(0, 8)} · ${item.status}`);
    loadCase(item.caseId).catch(report);
  }
  function onToolEvent(e: Event) {
    const item = JSON.parse((e as MessageEvent).data) as ToolEvent;
    log('AGENT TOOL', `${item.tool} · ${item.status ?? '시작'}${item.elapsedMs != null ? ` (${item.elapsedMs}ms)` : ''}`);
  }
  function onFailure(e: Event) {
    const item = JSON.parse((e as MessageEvent).data) as TaskFailedEvent;
    log('TASK_FAILED', `${item.stage} · ${item.errorCode}`, '실패');
    loadCase(item.caseId).catch(report);
  }
  function disconnectSse() { chatSource?.close(); guardSource?.close(); chatSource = null; guardSource = null; online.value = false; }
  function connectSse() {
    disconnectSse(); if (demo || !channelId.value) return;
    chatSource = api.channelEvents(channelId.value);
    chatSource.onopen = () => { online.value = true; };
    chatSource.onerror = () => { online.value = false; }; // EventSource는 자동 재접속한다.
    chatSource.addEventListener('CHAT', onChatEvent);
    chatSource.addEventListener('MESSAGE_VISIBILITY_CHANGED', onVisibilityEvent);
    chatSource.addEventListener('USER_KICKED', (e: Event) => { const v = JSON.parse((e as MessageEvent).data) as UserKickedEvent; kicks.value['session'] = v.until; log('USER_KICKED', `입장 제한 · ${v.until}`); disconnectSse(); });
    // 조치 기준표의 TIMEOUT 600초용 제안 이벤트. 명세에 추가되기 전까지는 수신되지 않는다.
    chatSource.addEventListener('USER_TIMED_OUT', (e: Event) => { const v = JSON.parse((e as MessageEvent).data) as UserKickedEvent; timeouts.value['session'] = v.until; log('USER_TIMED_OUT', `채팅 제한 · ${v.until}`); });
    if (!isOperator.value) return;
    guardSource = api.guardEvents(channelId.value);
    for (const event of ['CASE_CREATED', 'CASE_UPDATED']) guardSource.addEventListener(event, onCaseEvent);
    for (const event of ['TOOL_START', 'TOOL_END']) guardSource.addEventListener(event, onToolEvent);
    for (const event of ['KICK_REVIEW_REQUIRED', 'KICK_APPLIED']) guardSource.addEventListener(event, onKickEvent);
    guardSource.addEventListener('TASK_FAILED', onFailure);
    guardSource.onerror = () => log('SSE', '관제 SSE 연결 끊김 · 자동 재연결 대기', '대기');
  }
  async function sendMessage(text: string) {
    const trimmed = text.trim(); if (!trimmed) return false;
    if (trimmed.length > MAX_CHAT_LENGTH) { toast(`메시지는 최대 ${MAX_CHAT_LENGTH}자입니다.`); return false; }
    if (kicked.value) { toast('현재 방송 입장이 제한되었습니다.'); return false; }
    if (timedOut.value) { toast('채팅이 일시 제한되어 메시지를 보낼 수 없습니다.'); return false; }
    busy.value = true;
    try {
      if (demo) {
        const alias = DEMO_USERS.find(u => u.id === viewerId.value)?.alias ?? '시청자';
        const id = newId(); const data: Message = { messageId: id, channelId: channelId.value, authorAlias: alias, text: trimmed, visibility: 'PUBLIC', version: 1, sentAt: now(), isMine: true };
        owners.value[id] = viewerId.value; addOrUpdateMessage(data); log('CHAT', `${alias} 채팅 작성`);
      } else addOrUpdateMessage(await api.send(channelId.value, trimmed, newId()));
      return true;
    } catch (e) { report(e); return false; }
    finally { busy.value = false; }
  }
  function groupCategories(list: (Category | null | undefined)[]) {
    const counts = new Map<string, number>();
    for (const c of list) { const name = c ? categoryLabels[c] : '위반'; counts.set(name, (counts.get(name) ?? 0) + 1); }
    return [...counts].map(([name, n]) => n > 1 ? `${name} ${n}건` : name).join(', ');
  }
  function mockScenario(key: string) {
    if (!demo) { toast('시나리오 버튼은 MOCK 모드에서만 실행됩니다.'); return; }
    const sc = demoScenarios.find(x => x.key === key); if (!sc) return;
    incoming(DEMO_USERS[sc.user], sc.text, sc.category, sc.filterResult, false);
  }
  // Mock 채팅 한 건을 받아 1차 필터 → Agent 판정 → 기준표 조치까지 처리한다. quiet이면 화면 선택·알림을 건드리지 않는다.
  function incoming(user: { id: string; alias: string }, text: string, category: Category | null, filterResult: 'PASS' | 'REVIEW' | 'HOLD' | 'FLOOD', quiet: boolean) {
    const s = { text, category, filterResult }; const id = newId();
    // REVIEW는 공개 상태로 분석하고, HOLD·FLOOD는 즉시 HELD(명세 sendMessage).
    const m: Message = { messageId: id, channelId: CHANNEL_ID, authorAlias: user.alias, text: s.text, visibility: s.filterResult === 'PASS' || s.filterResult === 'REVIEW' ? 'PUBLIC' : 'HELD', version: 1, sentAt: now(), isMine: false };
    owners.value[id] = user.id; addOrUpdateMessage(m);
    if (!quiet) selectedMessageId.value = id;
    if (!s.category) { if (!quiet) { selectedCaseId.value = null; log('FILTER', 'PASS · 메시지 공개'); } return; }
    const cid = newId();
    const prior = priorViolations(user.alias);
    const violation = s.filterResult !== 'REVIEW';
    const count = prior.length + (violation ? 1 : 0);
    const sanction = sanctionFor(s.category, prior.length);
    const pending = Object.values(details.value).some(c => c.userAlias === user.alias && c.kickReview?.status === 'PENDING');
    const status = !violation ? 'NEEDS_REVIEW' : needsApproval(sanction) && !pending ? 'KICK_REVIEW_PENDING' : 'HIDDEN';
    if (violation) { m.visibility = 'HIDDEN'; m.version = 2; } // 판단 보류는 상태 유지(ERD 1절)
    const detail: CaseDetail = { caseId: cid, channelId: CHANNEL_ID, userAlias: user.alias, filterResult: s.filterResult, status, verdict: violation ? 'VIOLATION' : 'NEEDS_REVIEW', category: s.category, version: 2, createdAt: now(), messages: [structuredClone(m)], reason: violation ? `채팅 내용 및 전후 맥락에 ${categoryLabels[s.category]} 위반 근거가 있다고 판정했습니다. (목업)` : '맥락 부족으로 최종 판정 보류', evidenceMessageIds: [id], policySnapshots: [mockPolicy[s.category]], violationCount: count, kickReview: null, traceUrl: null };
    if (status === 'KICK_REVIEW_PENDING') {
      detail.kickReview = { reviewId: newId(), channelId: CHANNEL_ID, userAlias: user.alias, status: 'PENDING', summary: `최근 24시간 동안 ${groupCategories([...prior.map(c => c.category), s.category])} 위반이 이어졌습니다. 이전 확정 위반 ${prior.length}건이 있는 상태에서 다시 위반했습니다.`, caseIds: [...prior.map(c => c.caseId), cid], version: 1, createdAt: now(), kickExpiresAt: null, decisionReason: null };
    }
    if (violation && sanction.timeoutSec === 600) {
      timeouts.value[user.id] = new Date(Date.now() + 600_000).toISOString();
      log('TIMEOUT', `${user.alias} · 채팅 ${timeoutText(600)} 제한 (${sanctionLabel(sanction)})`, '자동 적용');
    }
    details.value[cid] = detail; cases.value.unshift(caseSummary(detail)); if (!quiet) selectedCaseId.value = cid;
    log('FILTER', `${s.filterResult} → ${m.visibility}`);
    log('AGENT', `${s.category} / ${detail.verdict} / 이전 확정 ${prior.length}건 → ${violation ? sanctionLabel(sanction) : '판단 보류'}`, detail.kickReview ? '검토 대기' : '완료');
    if (!quiet) toast(detail.kickReview ? `${sanctionLabel(sanction)} 대상 · 운영자 승인 대기가 등록됐습니다.` : !violation ? '판단 보류 · 운영자 확인이 필요합니다. (MOCK)' : sanction.timeoutSec === 600 ? `숨김 + 채팅 ${timeoutText(600)} 제한 적용 (MOCK)` : pending && needsApproval(sanction) ? '이미 승인 대기 중인 검토가 있어 숨김만 적용했습니다. (MOCK)' : `${sanctionLabel(sanction)} 적용 (MOCK)`);
  }
  async function release(id: string, reason: string) {
    const c = details.value[id]; if (!c || !reason.trim()) return false;
    busy.value = true;
    try {
      if (demo) {
        c.status = 'CLOSED'; c.verdict = 'NO_VIOLATION'; c.violationCount = Math.max(0, c.violationCount - 1); c.version++;
        for (const msg of c.messages) {
          const target = messages.value.find(x => x.messageId === msg.messageId);
          if (target) { target.visibility = 'PUBLIC'; target.version++; }
          msg.visibility = 'PUBLIC'; msg.version++;
        }
        upsertCase(caseSummary(c));
      } else {
        upsertCase(await api.release(id, c.version, reason)); await Promise.all([loadCase(id), refreshMessages()]);
      }
      log('RELEASE', `${id.slice(0, 8)} · 오탐 해제: ${reason}`); toast('메시지가 복원됐습니다.'); return true;
    } catch (e) { report(e); if (e instanceof ApiError && e.code === 'STALE_VERSION') await loadCase(id).catch(report); return false; }
    finally { busy.value = false; }
  }
  // Mock 오판 취소: 위반 근거를 무효로 하고 메시지를 공개로 되돌린다. 기록은 남긴다(ERD findings.revoked_at).
  // 실제 API의 오판 취소는 라이브 콘솔(VITE_USE_LIVE_V1)이 POST /api/findings/{findingId}/revoke로 처리한다.
  function revokeCase(caseId: string, reason: string) {
    if (!demo) { toast('실제 API의 오판 취소는 라이브 콘솔에서 지원합니다.'); return false; }
    const c = details.value[caseId];
    if (!c || revokedCases.value[caseId] || !reason.trim()) return false;
    revokedCases.value[caseId] = reason;
    setCaseVisibility(c, 'PUBLIC');
    c.status = 'NO_ACTION'; c.version++; upsertCase(caseSummary(c));
    log('REVOKE', `${c.userAlias} · ${c.category ? categoryLabels[c.category] : '위반'} 오판 취소 · ${reason}`, '모의 적용');
    toast('오판 취소를 반영했습니다. 메시지가 다시 공개됩니다. (MOCK)');
    return true;
  }
  // Mock 문맥 결정: 정상 확정은 공개, 위반 확정은 숨김, 보류는 검토 대기를 유지한다(openapi ContextDecision).
  function decideContext(caseId: string, value: 'CONFIRM_NORMAL' | 'CONFIRM_VIOLATION' | 'DEFER', reason: string) {
    if (!demo) { toast('실제 API의 문맥 결정은 라이브 콘솔에서 지원합니다.'); return false; }
    const c = details.value[caseId];
    if (!c || contextDecided.value[caseId] || !reason.trim()) return false;
    if (value === 'DEFER') { log('CONTEXT_REVIEW', `${c.userAlias} · 보류 · ${reason}`, '대기 유지'); toast('보류했습니다. 검토 대기에 남습니다. (MOCK)'); return true; }
    contextDecided.value[caseId] = value;
    const violation = value === 'CONFIRM_VIOLATION';
    c.verdict = violation ? 'VIOLATION' : 'NO_VIOLATION'; c.status = violation ? 'HIDDEN' : 'NO_ACTION'; c.version++;
    setCaseVisibility(c, violation ? 'HIDDEN' : 'PUBLIC');
    upsertCase(caseSummary(c));
    log('CONTEXT_REVIEW', `${c.userAlias} · ${violation ? '위반 확정' : '정상 확정'} · ${reason}`, '모의 적용');
    toast(violation ? '위반으로 확정해 메시지를 숨겼습니다. (MOCK)' : '정상으로 확정했습니다. (MOCK)');
    return true;
  }
  function setCaseVisibility(c: CaseDetail, visibility: Message['visibility']) {
    for (const m of [...c.messages, ...messages.value.filter(x => c.messages.some(y => y.messageId === x.messageId))]) {
      if (m.visibility !== visibility) { m.visibility = visibility; m.version++; }
    }
  }
  async function decide(reviewId: string, decision: 'APPROVE' | 'REJECT', reason: string) {
    const detail = Object.values(details.value).find(c => c.kickReview?.reviewId === reviewId);
    const review = detail?.kickReview;
    if (!review || review.status !== 'PENDING' || !reason.trim()) return false;
    busy.value = true;
    try {
      if (demo) {
        review.status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED'; review.version++; review.decisionReason = reason;
        log('INTERRUPT', `${review.reviewId.slice(0, 8)} · ${decision} 응답 저장`, '결정 접수');
        if (decision === 'APPROVE') {
          review.kickExpiresAt = new Date(Date.now() + 86400000).toISOString();
          const user = DEMO_USERS.find(u => u.alias === review.userAlias);
          if (user) { kicks.value[user.id] = review.kickExpiresAt; delete timeouts.value[user.id]; }
          review.status = 'EXECUTED'; // 모의 Agent resume → kick_user 성공 후 상태 전환
          detail.status = 'CLOSED'; detail.version++;
        } else { detail.status = 'HIDDEN'; detail.version++; }
        upsertCase(caseSummary(detail));
      } else {
        const result = await api.decideKick(reviewId, decision, reason, review.version, newId());
        // 202 접수는 실행 완료가 아님. KICK_APPLIED SSE를 기다린다.
        review.status = result.status; review.version = result.version;
        await loadCase(detail.caseId);
      }
      decidedAt.value[review.reviewId] = now();
      log('KICK_REVIEW', `${decision} · ${review.userAlias} · ${reason}`, demo && decision === 'APPROVE' ? '강퇴 모의 실행' : '결정 접수');
      toast(decision === 'APPROVE' ? (demo ? '강퇴가 모의 적용됐습니다.' : '승인 접수. 강퇴 실행 이벤트를 기다립니다.') : '강퇴 요청이 기각됐습니다. 메시지 가림은 유지됩니다.');
      return true;
    } catch (e) { report(e); if (e instanceof ApiError && e.code === 'STALE_VERSION' && detail) await loadCase(detail.caseId).catch(report); return false; }
    finally { busy.value = false; }
  }
  // Mock 실시간 흐름: 4.5초마다 채팅 한 줄. 가끔 아직 위반 기록이 없는 사용자의 위반이 섞여 자동 조치만 쌓인다.
  const feedOn = ref(false);
  let feedTimer: ReturnType<typeof setInterval> | undefined;
  const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];
  function feedTick() {
    if (Math.random() < 0.15) {
      const v = feedViolations.filter(x => !priorViolations(x.alias).length);
      if (v.length) { const x = pick(v); incoming(x, x.text, x.category, x.filterResult, true); return; }
    }
    incoming(pick(feedUsers), pick(feedChats), null, 'PASS', true);
  }
  function startFeed() { if (!demo || feedTimer) return; feedTimer = setInterval(feedTick, 4500); feedOn.value = true; }
  function stopFeed() { if (feedTimer) clearInterval(feedTimer); feedTimer = undefined; feedOn.value = false; }
  function toggleFeed() { if (feedOn.value) stopFeed(); else startFeed(); }
  function dispose() { stopFeed(); disconnectSse(); if (clockTimer) clearInterval(clockTimer); if (notificationTimeout) clearTimeout(notificationTimeout); }
  return { mode, me, channelId, viewerId, messages, cases, details, selectedCaseId, selectedMessageId, kicks, owners, audit, online, busy, error, notice, lastTraceId, loginRequired,
    selectedCase, allCases, selectedMessage, kickReviews, pendingReviews, viewerAlias, viewerMessages, viewerCases, viewerKickUntil, kicked, decidedAt, viewerTimeoutUntil, timedOut, restrictedAliases, timeouts, clock, priorViolations, isOperator, revokedCases, contextDecided,
    init, login, logout, syncIdentity, clearIdentity, feedOn, toggleFeed, refreshMessages, refreshCases, loadCase, selectCase, selectMessage, resetMock, sendMessage, mockScenario, release, decide, revokeCase, decideContext, dispose, toast, log };
});
