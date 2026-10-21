// 시연 방송 영상 경로. .env의 VITE_STREAM_SRC·VITE_STREAM_POSTER로 바꿀 수 있다.
export const streamSrc = import.meta.env.VITE_STREAM_SRC || '/media/live-stream.mp4';
export const streamPoster = import.meta.env.VITE_STREAM_POSTER || '/media/live-stream-poster.jpg';
