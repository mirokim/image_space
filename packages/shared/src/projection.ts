/**
 * 다차원 → 2D 투영. 의존성 없는 순수 TS.
 *  - pca2d   : 임베딩 벡터 집합을 상위 2개 주성분(거듭제곱 반복법)으로 축소.
 *  - normalize2d : 좌표를 [0,1] 평면으로 정규화(레이아웃용).
 * server(/space)와 web 양쪽에서 쓸 수 있도록 shared 에 둔다.
 */

/** 평균 중심화. */
function center(vectors: number[][]): { centered: number[][]; mean: number[] } {
  const n = vectors.length;
  const d = vectors[0]?.length ?? 0;
  const mean = new Array(d).fill(0);
  for (const v of vectors) for (let i = 0; i < d; i++) mean[i] += v[i]! / n;
  const centered = vectors.map((v) => v.map((x, i) => x - mean[i]!));
  return { centered, mean };
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

function norm(a: number[]): number {
  return Math.sqrt(dot(a, a)) || 1;
}

/**
 * 공분산 행렬에 대한 거듭제곱 반복으로 주성분 1개를 구한다.
 * Cov·v 를 X^T(X·v) 로 계산해 d×d 행렬을 직접 만들지 않는다(고차원 안전).
 */
function topComponent(centered: number[][], iterations = 50): number[] {
  const d = centered[0]?.length ?? 0;
  // 결정론적 초기 벡터(난수 미사용 — 워크플로/재현성 안전).
  let v = new Array(d).fill(0).map((_, i) => Math.sin(i + 1));
  let len = norm(v);
  v = v.map((x) => x / len);
  for (let it = 0; it < iterations; it++) {
    // proj[k] = X·v
    const proj = centered.map((row) => dot(row, v));
    // next = X^T·proj
    const next = new Array(d).fill(0);
    for (let r = 0; r < centered.length; r++) {
      const row = centered[r]!;
      const p = proj[r]!;
      for (let i = 0; i < d; i++) next[i] += row[i]! * p;
    }
    len = norm(next);
    if (len < 1e-12) break;
    v = next.map((x) => x / len);
  }
  return v;
}

/** centered 데이터에서 v 성분을 제거(deflation). */
function deflate(centered: number[][], v: number[]): number[][] {
  return centered.map((row) => {
    const c = dot(row, v);
    return row.map((x, i) => x - c * v[i]!);
  });
}

/**
 * 임베딩 벡터 집합 → 상위 2개 주성분 좌표.
 * 입력이 비거나 1개면 0좌표를 반환(호출측에서 격자 배치 등으로 처리).
 */
export function pca2d(vectors: number[][]): { x: number; y: number }[] {
  if (vectors.length === 0) return [];
  if (vectors.length === 1) return [{ x: 0, y: 0 }];
  const { centered } = center(vectors);
  const pc1 = topComponent(centered);
  const deflated = deflate(centered, pc1);
  const pc2 = topComponent(deflated);
  return centered.map((row) => ({ x: dot(row, pc1), y: dot(row, pc2) }));
}

/**
 * 임베딩 벡터 집합 → 상위 3개 주성분 좌표(3D 공간).
 * 입력이 비거나 1개면 원점 반환.
 */
export function pca3d(vectors: number[][]): { x: number; y: number; z: number }[] {
  if (vectors.length === 0) return [];
  if (vectors.length === 1) return [{ x: 0, y: 0, z: 0 }];
  const { centered } = center(vectors);
  const pc1 = topComponent(centered);
  const d1 = deflate(centered, pc1);
  const pc2 = topComponent(d1);
  const d2 = deflate(d1, pc2);
  const pc3 = topComponent(d2);
  return centered.map((row) => ({ x: dot(row, pc1), y: dot(row, pc2), z: dot(row, pc3) }));
}

/** 좌표를 [0,1]×[0,1] 로 정규화. 분산이 0인 축은 0.5 로 둔다. */
export function normalize2d(pts: { x: number; y: number }[]): { x: number; y: number }[] {
  if (pts.length === 0) return [];
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  return pts.map((p) => ({
    x: maxX === minX ? 0.5 : (p.x - minX) / spanX,
    y: maxY === minY ? 0.5 : (p.y - minY) / spanY,
  }));
}

/** 3D 좌표를 [0,1]^3 으로 정규화. 분산이 0인 축은 0.5. */
export function normalize3d(
  pts: { x: number; y: number; z: number }[],
): { x: number; y: number; z: number }[] {
  if (pts.length === 0) return [];
  const lo = { x: Infinity, y: Infinity, z: Infinity };
  const hi = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const p of pts) {
    lo.x = Math.min(lo.x, p.x); hi.x = Math.max(hi.x, p.x);
    lo.y = Math.min(lo.y, p.y); hi.y = Math.max(hi.y, p.y);
    lo.z = Math.min(lo.z, p.z); hi.z = Math.max(hi.z, p.z);
  }
  const norm = (v: number, a: number, b: number) => (a === b ? 0.5 : (v - a) / (b - a));
  return pts.map((p) => ({
    x: norm(p.x, lo.x, hi.x),
    y: norm(p.y, lo.y, hi.y),
    z: norm(p.z, lo.z, hi.z),
  }));
}
