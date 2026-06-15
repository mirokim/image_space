/** REST 라우트. web 의 api.ts 와 shared/constants 의 API 경로를 공유. */
import type { FastifyInstance } from 'fastify';
import sizeOf from 'image-size';
import { randomUUID } from 'node:crypto';
import {
  API,
  TAXONOMY,
  SCALAR_DIMENSIONS,
  CATEGORICAL_DIMENSIONS,
  SCALAR_KEYS,
  IngestRequestSchema,
  ImageItemSchema,
  pca3d,
  normalize3d,
  type ImageItem,
  type SpacePoint,
  type SpaceResponse,
} from '@imgspace/shared';
import { LocalBlobStore, extFromMime, mimeFromExt } from '@imgspace/shared/blobstore';
import type { ImageStore } from './store.js';
import type { Bus } from './bus.js';
import type { AnalysisQueue } from './analyze/pipeline.js';

export interface Deps {
  store: ImageStore;
  blobs: LocalBlobStore;
  bus: Bus;
  queue: AnalysisQueue;
}

export function registerRoutes(app: FastifyInstance, deps: Deps): void {
  const { store, blobs, bus, queue } = deps;

  app.get(API.health, async () => ({ ok: true }));

  app.get(API.taxonomy, async () => ({
    dimensions: TAXONOMY,
    scalar: SCALAR_DIMENSIONS,
    categorical: CATEGORICAL_DIMENSIONS,
  }));

  // 이미지 수집 → 분석 큐 투입.
  app.post(API.images, async (req, reply) => {
    const parsed = IngestRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const { filename, dataBase64, mime } = parsed.data;

    const raw = dataBase64.includes(',') ? dataBase64.split(',', 2)[1]! : dataBase64;
    const buf = Buffer.from(raw, 'base64');
    if (buf.byteLength === 0) return reply.code(400).send({ error: '빈 이미지' });

    const ext = extFromMime(mime);
    const { blobId } = blobs.put(buf, { ext, name: filename });

    let width = 0;
    let height = 0;
    try {
      const dim = sizeOf(buf);
      width = dim.width ?? 0;
      height = dim.height ?? 0;
    } catch {
      /* 크기 측정 실패 무시 */
    }

    const now = Date.now();
    const item: ImageItem = ImageItemSchema.parse({
      id: randomUUID(),
      blobId,
      filename,
      width,
      height,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    });
    store.insert(item);
    bus.broadcast({ type: 'ui.itemUpdate', item });
    queue.enqueue(item.id);
    return item;
  });

  app.get(API.images, async () => store.list());

  app.get<{ Params: { id: string } }>('/images/:id', async (req, reply) => {
    const item = store.get(req.params.id);
    if (!item) return reply.code(404).send({ error: 'not found' });
    return item;
  });

  app.delete<{ Params: { id: string } }>('/images/:id', async (req, reply) => {
    const item = store.get(req.params.id);
    if (!item) return reply.code(404).send({ error: 'not found' });
    store.remove(item.id);
    bus.broadcast({ type: 'ui.itemRemoved', id: item.id });
    return { ok: true };
  });

  // 원본 이미지 바이트 서빙.
  app.get<{ Params: { blobId: string } }>('/blobs/:blobId', async (req, reply) => {
    const { blobId } = req.params;
    if (!blobs.exists(blobId)) return reply.code(404).send({ error: 'not found' });
    reply.header('content-type', mimeFromExt(blobId));
    reply.header('cache-control', 'public, max-age=31536000, immutable');
    return reply.send(blobs.read(blobId));
  });

  // 공간 투영(3D). mode=axes(스칼라 축들) 또는 pca(임베딩 상위 3성분 축소).
  app.get<{ Querystring: { x?: string; y?: string; z?: string } }>(API.space, async (req) => {
    const xAxis = req.query.x ?? 'pca';
    const yAxis = req.query.y ?? 'pca';
    const zAxis = req.query.z ?? 'pca';
    const ready = store.list().filter((i) => i.status === 'ready');

    const isScalar = (k: string) => SCALAR_KEYS.includes(k);
    // x·y 가 스칼라면 축 모드(z 는 선택 — 미지정/비스칼라면 0.5 평면).
    const axesMode = isScalar(xAxis) && isScalar(yAxis);

    let points: SpacePoint[];
    if (axesMode) {
      points = ready.map((i) =>
        toPoint(
          i,
          i.scores[xAxis] ?? 0.5,
          i.scores[yAxis] ?? 0.5,
          isScalar(zAxis) ? i.scores[zAxis] ?? 0.5 : 0.5,
        ),
      );
    } else {
      const withEmb = ready.filter((i) => i.embedding.length > 0);
      const coords = normalize3d(pca3d(withEmb.map((i) => i.embedding)));
      points = withEmb.map((i, idx) =>
        toPoint(i, coords[idx]?.x ?? 0.5, coords[idx]?.y ?? 0.5, coords[idx]?.z ?? 0.5),
      );
    }

    const resp: SpaceResponse = {
      xAxis,
      yAxis,
      zAxis,
      mode: axesMode ? 'axes' : 'pca',
      points,
    };
    return resp;
  });
}

function toPoint(i: ImageItem, x: number, y: number, z: number): SpacePoint {
  return {
    id: i.id,
    x,
    y,
    z,
    blobId: i.blobId,
    filename: i.filename,
    status: i.status,
    caption: i.caption,
    scores: i.scores,
    labels: i.labels,
  };
}
