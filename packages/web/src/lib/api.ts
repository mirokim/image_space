/** 서버 API 클라이언트. shared 의 API 경로 + DEFAULTS 포트를 공유. */
import {
  API,
  DEFAULTS,
  WS_PATH,
  type ImageItem,
  type SpaceResponse,
  type ScalarDimension,
  type CategoricalDimension,
} from '@imgspace/shared';

const HOST = `${DEFAULTS.serverHost}:${DEFAULTS.serverPort}`;
export const HTTP_BASE = `http://${HOST}`;
export const WS_URL = `ws://${HOST}${WS_PATH.ui}`;

export interface TaxonomyResponse {
  dimensions: (ScalarDimension | CategoricalDimension)[];
  scalar: ScalarDimension[];
  categorical: CategoricalDimension[];
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${HTTP_BASE}${path}`);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  taxonomy: () => getJson<TaxonomyResponse>(API.taxonomy),
  images: () => getJson<ImageItem[]>(API.images),
  space: (x: string, y: string, z: string) =>
    getJson<SpaceResponse>(
      `${API.space}?x=${encodeURIComponent(x)}&y=${encodeURIComponent(y)}&z=${encodeURIComponent(z)}`,
    ),
  async ingest(filename: string, dataBase64: string, mime: string): Promise<ImageItem> {
    const res = await fetch(`${HTTP_BASE}${API.images}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filename, dataBase64, mime }),
    });
    if (!res.ok) throw new Error(`ingest → ${res.status}`);
    return res.json() as Promise<ImageItem>;
  },
  async remove(id: string): Promise<void> {
    await fetch(`${HTTP_BASE}${API.image(id)}`, { method: 'DELETE' });
  },
  blobUrl: (blobId: string) => `${HTTP_BASE}${API.blob(blobId)}`,
};
