/** REST 라우트. web 의 api.ts 와 shared/constants 의 API 경로를 공유. */
import type { FastifyInstance } from 'fastify';
import sizeOf from 'image-size';
import { randomUUID, createHash } from 'node:crypto';
import {
  API,
  TAXONOMY,
  SCALAR_DIMENSIONS,
  CATEGORICAL_DIMENSIONS,
  IngestRequestSchema,
  ImageItemSchema,
  type ImageItem,
} from '@imgspace/shared';
import { LocalBlobStore, extFromMime, mimeFromExt } from '@imgspace/shared/blobstore';
import type { ImageStore, ProjectionCache } from './store.js';
import type { Bus } from './bus.js';
import type { AnalysisQueue } from './analyze/pipeline.js';
import { buildSpace, findSimilar } from './space.js';

export interface Deps {
  store: ImageStore;
  projections: ProjectionCache;
  blobs: LocalBlobStore;
  bus: Bus;
  queue: AnalysisQueue;
}

export function registerRoutes(app: FastifyInstance, deps: Deps): void {
  const { store, projections, blobs, bus, queue } = deps;

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

    // 중복 업로드 감지 — 같은 바이트면 기존 항목 반환(비전 호출 절약).
    const contentHash = createHash('sha256').update(buf).digest('hex');
    const dup = store.findByContentHash('default', contentHash);
    if (dup) return dup;

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
      contentHash,
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

  // 임베딩 코사인 유사도 이웃.
  app.get<{ Params: { id: string }; Querystring: { k?: string } }>(
    '/images/:id/similar',
    async (req, reply) => {
      const neighbors = findSimilar(store, req.params.id, Number(req.query.k ?? 8));
      if (neighbors === null) return reply.code(404).send({ error: 'not found' });
      return neighbors;
    },
  );

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

  // 공간 투영. mode=axes(스칼라 축) · pca(임베딩 3성분) · sim(유사도 UMAP류 2D).
  app.get<{ Querystring: { x?: string; y?: string; z?: string; mode?: string } }>(
    API.space,
    async (req) => buildSpace(store, projections, req.query),
  );
}
