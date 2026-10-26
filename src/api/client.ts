import type { ApiErrorBody, ChannelWithLive, Decision, Envelope, Live, LiveCase, LiveReview, Me, Message, MessagePage, UUID } from '../contracts';
import { ApiError } from '../contracts';

const base = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
function csrfToken(): string | undefined {
  const value = document.cookie.split('; ').find(c => c.startsWith('XSRF-TOKEN='))?.split('=').slice(1).join('=');
  return value ? decodeURIComponent(value) : undefined;
}
async function request<T>(path: string, method: 'GET' | 'POST' = 'GET', body?: object): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken()) headers['X-XSRF-TOKEN'] = csrfToken()!;
  let res: Response;
  try { res = await fetch(`${base}${path}`, { method, credentials: 'include', headers, body: body ? JSON.stringify(body) : undefined }); }
  catch { throw new ApiError('TEMPORARY_UNAVAILABLE', '서버와 연결할 수 없습니다.', true); }
  if (res.status === 204) return undefined as T;
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const obj = json as ApiErrorBody | null;
    throw new ApiError(obj?.error?.code ?? 'TEMPORARY_UNAVAILABLE', obj?.error?.message ?? `HTTP ${res.status}`, obj?.error?.retryable ?? false, obj?.error?.until, obj?.error?.currentVersion);
  }
  return (json as Envelope<T>).data;
}
// 로그인 POST도 CSRF 대상이다. 로그아웃하면 XSRF-TOKEN 쿠키도 지워지므로, 토큰이 없으면 GET 한 번으로 새로 받는다(401이어도 쿠키는 내려온다).
async function ensureCsrfToken(): Promise<void> {
  if (csrfToken()) return;
  await fetch(`${base}/api/auth/me`, { credentials: 'include', headers: { Accept: 'application/json' } }).catch(() => undefined);
}
// API v1.0(liveId) 경로만 쓴다. 기준: Backend contracts/openapi.yaml
export const api = {
  login: async (username: string, password: string) => { await ensureCsrfToken(); return request<Me>('/api/auth/login', 'POST', { username, password }); },
  me: () => request<Me>('/api/auth/me'),
  channels: () => request<ChannelWithLive[]>('/api/channels'),
  logout: () => request<void>('/api/auth/logout', 'POST'),
  currentLive: (channelId: UUID) => request<Live>(`/api/channels/${channelId}/lives/current`),
  startLive: (channelId: UUID) => request<Live>(`/api/channels/${channelId}/lives`, 'POST'),
  endLive: (liveId: UUID) => request<Live>(`/api/lives/${liveId}/end`, 'POST'),
  liveMessages: (liveId: UUID) => request<MessagePage>(`/api/lives/${liveId}/messages`),
  // 시청자 관리: 사건 대상 메시지의 작성자(닉네임)를 찾을 때 이전 페이지까지 읽는다.
  liveMessagesPage: (liveId: UUID, cursor?: string) => request<MessagePage>(`/api/lives/${liveId}/messages?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),
  sendLive: (liveId: UUID, text: string, clientMessageId: UUID) => request<Message>(`/api/lives/${liveId}/messages`, 'POST', { text, clientMessageId }),
  liveReviews: async (liveId: UUID) => (await Promise.all(['CONTEXT', 'KICK'].map(kind => request<LiveReview[]>(`/api/reviews?liveId=${encodeURIComponent(liveId)}&kind=${kind}`)))).flat(),
  liveCases: (liveId: UUID) => request<LiveCase[]>(`/api/cases?liveId=${encodeURIComponent(liveId)}`),
  revokeFinding: (findingId: UUID, body: object) => request<object>(`/api/findings/${findingId}/revoke`, 'POST', body),
  decideLive: (review: LiveReview, body: object) => request<Decision>(`/api/${review.kind === 'CONTEXT' ? 'context' : 'kick'}-reviews/${review.reviewId}/decision`, 'POST', body),
  liveEvents: (liveId: UUID, guard = false) => new EventSource(`${base}${guard ? `/api/guard/events?liveId=${encodeURIComponent(liveId)}` : `/api/lives/${liveId}/events`}`, { withCredentials: true })
};
