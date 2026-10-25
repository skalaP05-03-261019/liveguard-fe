// 요청 ID(clientMessageId·clientRequestId)용 UUID v4.
// crypto.randomUUID()는 보안 컨텍스트(localhost·HTTPS)에서만 있다. 시연 때 청중 기기는 발표 PC의
// LAN 주소(http://192.168.x.x)로 접속하므로, 그때는 어디서나 되는 crypto.getRandomValues로 만든다(#16).
export function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
