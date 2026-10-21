import type { ApiErrorBody, CaseDetail, CaseSummary, Envelope, KickReview, Me, Message, MessagePage, UUID } from '../contracts';
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
export const api = {
  login: async (username: string, password: string) => { await ensureCsrfToken(); return request<Me>('/api/auth/login', 'POST', { username, password }); },
  me: () => request<Me>('/api/auth/me'),
  logout: () => request<void>('/api/auth/logout', 'POST'),
  messages: (channelId: UUID, cursor?: string) => request<MessagePage>(`/api/channels/${channelId}/messages?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),
  send: (channelId: UUID, text: string, clientMessageId: UUID) => request<Message>(`/api/channels/${channelId}/messages`, 'POST', { clientMessageId, text }),
  cases: (channelId: UUID) => request<CaseSummary[]>(`/api/cases?channelId=${encodeURIComponent(channelId)}`),
  case: (caseId: UUID) => request<CaseDetail>(`/api/cases/${caseId}`),
  release: (caseId: UUID, expectedVersion: number, reason: string) => request<CaseSummary>(`/api/cases/${caseId}/release`, 'POST', { expectedVersion, reason }),
  decideKick: (reviewId: UUID, decision: 'APPROVE' | 'REJECT', reason: string, expectedVersion: number, clientRequestId: UUID) => request<KickReview>(`/api/kick-reviews/${reviewId}/decision`, 'POST', { decision, reason, expectedVersion, clientRequestId }),
  channelEvents: (channelId: UUID) => new EventSource(`${base}/api/channels/${channelId}/events`, { withCredentials: true }),
  guardEvents: (channelId: UUID) => new EventSource(`${base}/api/guard/events?channelId=${encodeURIComponent(channelId)}`, { withCredentials: true })
};
