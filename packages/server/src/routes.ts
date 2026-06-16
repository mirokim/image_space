/** REST 라우트. web 의 api.ts 와 shared/constants 의 API 경로를 공유. */
import type { FastifyInstance } from 'fastify';
import sizeOf from 'image-size';
import { randomUUID, createHash } from 'node:crypto';
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
  normalize2d,
  similarityLayout,
  kmeans,
  type ImageItem,
  type SpacePoint,
  type SpaceResponse,
  type SimilarNeighbor,
  type Cluster,
} from '@imgspace/shared';
import { LocalBlobStore, extFromMime, mimeFromExt } from '@imgspace/shared/blobstore';
import type { ImageStore, ProjectionCache } from './store.js';
import type { Bus } from './bus.js';
import type { AnalysisQueue } from './analyze/pipeline.js';

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

  // 임베딩 코사인 유사도 이웃 — 같은 source/dim 끼리만 비교. 소규모는 풀스캔.
  app.get<{ Params: { id: string }; Querystring: { k?: string } }>(
    '/images/:id/similar',
    async (req, reply) => {
      const target = store.get(req.params.id);
      if (!target) return reply.code(404).send({ error: 'not found' });
      if (target.embedding.length === 0) return [] as SimilarNeighbor[];

      const k = Math.max(1, Math.min(50, Number(req.query.k ?? 8)));
      const tv = target.embedding;
      const tNorm = Math.sqrt(dot(tv, tv)) || 1;

      const neighbors = store
        .list()
        .filter(
          (i) =>
            i.id !== target.id &&
            i.status === 'ready' &&
            i.embedSource === target.embedSource &&
            i.embedding.length === tv.length,
        )
        .map((i) => {
          const n = Math.sqrt(dot(i.embedding, i.embedding)) || 1;
          const score = dot(tv, i.embedding) / (tNorm * n);
          return { item: i, score };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, k);

      return neighbors.map(
        ({ item, score }): SimilarNeighbor => ({
          id: item.id,
          blobId: item.blobId,
          filename: item.filename,
          caption: item.caption,
          score,
        }),
      );
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
    async (req) => {
      const xAxis = req.query.x ?? 'pca';
      const yAxis = req.query.y ?? 'pca';
      const zAxis = req.query.z ?? 'pca';
      const ready = store.list().filter((i) => i.status === 'ready');
      const isScalar = (k: string) => SCALAR_KEYS.includes(k);

      // 모드 결정: 명시 mode 우선, 없으면 축 선택으로 추론.
      const reqMode = req.query.mode;
      const mode: 'pca' | 'axes' | 'sim' =
        reqMode === 'sim' || reqMode === 'pca' || reqMode === 'axes'
          ? reqMode
          : isScalar(xAxis) && isScalar(yAxis)
            ? 'axes'
            : 'pca';

      if (mode === 'sim') {
        return buildSimSpace(store, projections, xAxis, yAxis, zAxis);
      }

      let points: SpacePoint[];
      if (mode === 'axes') {
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

      const resp: SpaceResponse = { xAxis, yAxis, zAxis, mode, points, clusters: [], edges: [] };
      return resp;
    },
  );
}

/**
 * 유사도(sim) 공간 — 동일 source/dim 임베딩에 UMAP류 2D 배치 + k-means 군집.
 * 결과는 ProjectionCache 에 datasetSig 로 캐시(비싸고 결정론적).
 */
function buildSimSpace(
  store: ImageStore,
  projections: ProjectionCache,
  xAxis: string,
  yAxis: string,
  zAxis: string,
): SpaceResponse {
  const ready = store.list().filter((i) => i.status === 'ready' && i.embedding.length > 0);

  // 임베딩 차원 혼합 방지 — 최빈 (source,dim) 만 사용.
  const groups = new Map<string, ImageItem[]>();
  for (const i of ready) {
    const key = `${i.embedSource}:${i.embedding.length}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(i);
  }
  let items: ImageItem[] = [];
  for (const g of groups.values()) if (g.length > items.length) items = g;

  const empty: SpaceResponse = { xAxis, yAxis, zAxis, mode: 'sim', points: [], clusters: [], edges: [] };
  if (items.length === 0) return empty;

  const n = items.length;
  const k = Math.max(2, Math.min(15, Math.round(Math.sqrt(n))));
  const ck = Math.max(1, Math.min(6, Math.round(Math.sqrt(n / 2))));
  const paramsHash = `umap_k${k}_i300_c${ck}`;
  const sig = store.datasetSig();

  interface Layout {
    ids: string[];
    coords: { x: number; y: number }[];
    edges: [number, number][];
    labels: number[];
  }
  let layout = projections.get('default', 'umap', paramsHash, sig) as Layout | null;
  if (!layout) {
    const vectors = items.map((i) => i.embedding);
    const sl = similarityLayout(vectors, { k, iters: 300 });
    layout = {
      ids: items.map((i) => i.id),
      coords: normalize2d(sl.points),
      edges: sl.edges,
      labels: kmeans(vectors, ck),
    };
    projections.put('default', 'umap', paramsHash, sig, layout);
  }

  // 캐시는 id 순서로 저장 → 현재 items 와 id 매핑(동일 sig면 동일 집합).
  const byId = new Map(items.map((i) => [i.id, i]));
  const points: SpacePoint[] = [];
  const counts = new Map<number, Map<string, number>>();
  layout.ids.forEach((id, idx) => {
    const it = byId.get(id);
    if (!it) return;
    const cid = layout!.labels[idx] ?? -1;
    const c = layout!.coords[idx] ?? { x: 0.5, y: 0.5 };
    points.push({ ...toPoint(it, c.x, c.y, 0.5), clusterId: cid });
    // 군집별 형식 최빈값 집계.
    const fmt = it.labels['format'] ?? 'unknown';
    const m = counts.get(cid) ?? counts.set(cid, new Map()).get(cid)!;
    m.set(fmt, (m.get(fmt) ?? 0) + 1);
  });

  const formatDim = CATEGORICAL_DIMENSIONS.find((d) => d.key === 'format');
  const fmtLabel = (v: string) => formatDim?.options.find((o) => o.value === v)?.label ?? v;
  const clusters: Cluster[] = [...counts.entries()]
    .map(([id, m]) => {
      let top = '';
      let n2 = 0;
      let total = 0;
      for (const [v, c] of m) {
        total += c;
        if (c > n2) {
          n2 = c;
          top = v;
        }
      }
      return { id, label: fmtLabel(top), count: total };
    })
    .sort((a, b) => a.id - b.id);

  return { xAxis, yAxis, zAxis, mode: 'sim', points, clusters, edges: layout.edges };
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
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
    clusterId: -1,
  };
}
