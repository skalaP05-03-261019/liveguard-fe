// 유튜브 채팅처럼 닉네임마다 고정된 아바타 배경색을 준다.
const palette = ['#e53935', '#8e24aa', '#3949ab', '#039be5', '#00897b', '#7cb342', '#f4511e', '#6d4c41', '#546e7a', '#d81b60'];
export function avatarColor(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}
