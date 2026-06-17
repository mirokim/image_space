/**
 * 공간 투영 + 유사도 — routes(HTTP)와 mcp(MCP 서버)가 공유하는 순수 로직.
 *  - buildSpace : pca(임베딩 3성분) · axes(스칼라 평면) · sim(유사도 UMAP류 2D + 군집).
 *  - findSimilar: 임베딩 코사인 이웃.
 * 좌표는 저장하지 않고 호출 시점에 계산. sim 의 비싼 전역 레이아웃만 ProjectionCache 에 캐시.
 */
import {
  SCALAR_KEYS,
  CATEGORICAL_DIMENSIONS,
  pca1d,
  pca3d,
  normalize1d,
  normalize3d,
  similarityLayout3d,
  kmeans,
  type ImageItem,
  type SpacePoint,
  type SpaceResponse,
  type SimilarNeighbor,
  type Cluster,
} from '@imgspace/shared';
import type { ImageStore, ProjectionCache } from './store.js';

export type SpaceMode = 'pca' | 'axes' | 'sim' | 'pcoord' | 'radar';

export interface SpaceQuery {
  x?: string;
  y?: string;
  z?: string;
  mode?: string;
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

function toPoint(i: ImageItem, x: number, y: number, z: number, clusterId = -1): SpacePoint {
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
    clusterId,
  };
}

/** 군집별 (format 최빈값→한글 라벨, 총 개수) 메타. sim·pca·axes 공용. */
function buildClusterMeta(counts: Map<number, Map<string, number>>): Cluster[] {
  const formatDim = CATEGORICAL_DIMENSIONS.find((d) => d.key === 'format');
  const fmtLabel = (v: string) => formatDim?.options.find((o) => o.value === v)?.label ?? v;
  return [...counts.entries()]
    .map(([id, m]) => {
      let top = '';
      let best = 0;
      let total = 0;
      for (const [v, c] of m) {
        total += c;
        if (c > best) {
          best = c;
          top = v;
        }
      }
      return { id, label: fmtLabel(top), count: total };
    })
    .sort((a, b) => a.id - b.id);
}

/**
 * 임베딩 k-means 군집 — id→clusterId 맵 + 군집 메타. pca/axes 모드에 군집 색영역을 입히기 위함.
 * 차원 혼합 방지로 최빈 (source,dim) 그룹만 군집화(나머지는 clusterId 미할당=-1).
 */
function clusterItems(ready: ImageItem[]): { byId: Map<string, number>; clusters: Cluster[] } {
  const withEmb = ready.filter((i) => i.embedding.length > 0);
  const groups = new Map<string, ImageItem[]>();
  for (const i of withEmb) {
    const key = `${i.embedSource}:${i.embedding.length}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(i);
  }
  let grp: ImageItem[] = [];
  for (const g of groups.values()) if (g.length > grp.length) grp = g;

  const byId = new Map<string, number>();
  if (grp.length === 0) return { byId, clusters: [] };

  const ck = Math.max(1, Math.min(6, Math.round(Math.sqrt(grp.length / 2))));
  const labels = kmeans(
    grp.map((i) => i.embedding),
    ck,
  );
  const counts = new Map<number, Map<string, number>>();
  grp.forEach((it, idx) => {
    const cid = labels[idx] ?? -1;
    byId.set(it.id, cid);
    const fmt = it.labels['format'] ?? 'unknown';
    const m = counts.get(cid) ?? counts.set(cid, new Map()).get(cid)!;
    m.set(fmt, (m.get(fmt) ?? 0) + 1);
  });
  return { byId, clusters: buildClusterMeta(counts) };
}

export function buildSpace(
  store: ImageStore,
  projections: ProjectionCache,
  q: SpaceQuery,
): SpaceResponse {
  const xAxis = q.x ?? 'pca';
  const yAxis = q.y ?? 'pca';
  const zAxis = q.z ?? 'pca';
  const isScalar = (k: string) => SCALAR_KEYS.includes(k);

  const known: SpaceMode[] = ['sim', 'pca', 'axes', 'pcoord', 'radar'];
  const mode: SpaceMode = known.includes(q.mode as SpaceMode)
    ? (q.mode as SpaceMode)
    : isScalar(xAxis) && isScalar(yAxis)
      ? 'axes'
      : 'pca';

  if (mode === 'sim') return buildSimSpace(store, projections, xAxis, yAxis, zAxis);

  const ready = store.list().filter((i) => i.status === 'ready');
  // 군집은 전 모드 공통 — 색영역/라벨로 무리를 한눈에 보이게 한다.
  const { byId: clusterById, clusters } = clusterItems(ready);
  const cid = (id: string) => clusterById.get(id) ?? -1;

  // pcoord/radar 는 좌표 없는 2D 차트 — 점의 scores/labels 만 쓰므로 좌표는 0.5로 둔다.
  if (mode === 'pcoord' || mode === 'radar') {
    const points = ready.map((i) => toPoint(i, 0.5, 0.5, 0.5, cid(i.id)));
    return { xAxis, yAxis, zAxis, mode, points, clusters, edges: [] };
  }

  let points: SpacePoint[];
  if (mode === 'axes') {
    // Z 가 스칼라면 그 점수, '자동(pca)'이면 임베딩 1주성분으로 채운다(평면 깔림 방지).
    let zById: Map<string, number> | null = null;
    if (!isScalar(zAxis)) {
      const withEmb = ready.filter((i) => i.embedding.length > 0);
      const zc = normalize1d(pca1d(withEmb.map((i) => i.embedding)));
      zById = new Map(withEmb.map((i, idx) => [i.id, zc[idx] ?? 0.5]));
    }
    points = ready.map((i) =>
      toPoint(
        i,
        i.scores[xAxis] ?? 0.5,
        i.scores[yAxis] ?? 0.5,
        isScalar(zAxis) ? i.scores[zAxis] ?? 0.5 : zById?.get(i.id) ?? 0.5,
        cid(i.id),
      ),
    );
  } else {
    const withEmb = ready.filter((i) => i.embedding.length > 0);
    const coords = normalize3d(pca3d(withEmb.map((i) => i.embedding)));
    points = withEmb.map((i, idx) =>
      toPoint(i, coords[idx]?.x ?? 0.5, coords[idx]?.y ?? 0.5, coords[idx]?.z ?? 0.5, cid(i.id)),
    );
  }
  return { xAxis, yAxis, zAxis, mode, points, clusters, edges: [] };
}

/** 유사도(UMAP류) 2D + k-means 군집. ProjectionCache 에 datasetSig 로 캐시. */
function buildSimSpace(
  store: ImageStore,
  projections: ProjectionCache,
  xAxis: string,
  yAxis: string,
  zAxis: string,
): SpaceResponse {
  const ready = store.list().filter((i) => i.status === 'ready' && i.embedding.length > 0);

  // 차원 혼합 방지 — 최빈 (source,dim) 그룹만.
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
  const paramsHash = `umap3d_k${k}_i300_c${ck}`;
  const sig = store.datasetSig();

  interface Layout {
    ids: string[];
    coords: { x: number; y: number; z: number }[];
    edges: [number, number][];
    labels: number[];
  }
  let layout = projections.get('default', 'umap', paramsHash, sig) as Layout | null;
  if (!layout) {
    const vectors = items.map((i) => i.embedding);
    const sl = similarityLayout3d(vectors, { k, iters: 300 });
    layout = {
      ids: items.map((i) => i.id),
      coords: normalize3d(sl.points),
      edges: sl.edges,
      labels: kmeans(vectors, ck),
    };
    projections.put('default', 'umap', paramsHash, sig, layout);
  }

  const byId = new Map(items.map((i) => [i.id, i]));
  const points: SpacePoint[] = [];
  const counts = new Map<number, Map<string, number>>();
  layout.ids.forEach((id, idx) => {
    const it = byId.get(id);
    if (!it) return;
    const cid = layout!.labels[idx] ?? -1;
    const c = layout!.coords[idx] ?? { x: 0.5, y: 0.5, z: 0.5 };
    points.push(toPoint(it, c.x, c.y, c.z, cid));
    const fmt = it.labels['format'] ?? 'unknown';
    const m = counts.get(cid) ?? counts.set(cid, new Map()).get(cid)!;
    m.set(fmt, (m.get(fmt) ?? 0) + 1);
  });

  const clusters = buildClusterMeta(counts);

  return { xAxis, yAxis, zAxis, mode: 'sim', points, clusters, edges: layout.edges };
}

/** 임베딩 코사인 유사도 이웃 — 같은 source/dim 끼리만. 소규모 풀스캔. */
export function findSimilar(store: ImageStore, id: string, k = 8): SimilarNeighbor[] | null {
  const target = store.get(id);
  if (!target) return null;
  if (target.embedding.length === 0) return [];

  const tv = target.embedding;
  const tNorm = Math.sqrt(dot(tv, tv)) || 1;
  const kk = Math.max(1, Math.min(50, k));

  return store
    .list()
    .filter(
      (i) =>
        i.id !== target.id &&
        i.status === 'ready' &&
        i.embedSource === target.embedSource &&
        i.embedding.length === tv.length,
    )
    .map((i) => {
      const nn = Math.sqrt(dot(i.embedding, i.embedding)) || 1;
      return { item: i, score: dot(tv, i.embedding) / (tNorm * nn) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, kk)
    .map(
      ({ item, score }): SimilarNeighbor => ({
        id: item.id,
        blobId: item.blobId,
        filename: item.filename,
        caption: item.caption,
        score,
      }),
    );
}
