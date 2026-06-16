/**
 * SSOT — 포트·WS 경로·HTTP 엔드포인트. web 클라이언트와 server 라우트가 공유한다.
 */

export const DEFAULTS = {
  serverPort: 8790,
  serverHost: '127.0.0.1',
  webPort: 5174,
} as const;

/** WebSocket 경로(서버→GUI 단방향 푸시). */
export const WS_PATH = {
  ui: '/ui',
} as const;

/** HTTP 엔드포인트 빌더. web 의 api.ts 와 server 의 routes.ts 가 동일 경로를 공유. */
export const API = {
  health: '/health',
  taxonomy: '/taxonomy',
  images: '/images',
  image: (id: string) => `/images/${id}`,
  similar: (id: string) => `/images/${id}/similar`,
  space: '/space',
  blob: (blobId: string) => `/blobs/${encodeURIComponent(blobId)}`,
} as const;
