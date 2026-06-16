import { z } from 'zod';
import { TAXONOMY_VERSION } from './taxonomy.js';

/** 이미지 분석 상태 머신. */
export const IMAGE_STATUSES = [
  'pending', // 수집됨, 분석 대기
  'analyzing', // Vision/임베딩 진행 중
  'ready', // 분석 완료
  'error', // 실패
] as const;
export type ImageStatus = (typeof IMAGE_STATUSES)[number];

/**
 * 공간에 배치되는 이미지 1개.
 *  - embedding : 좌표 계산용 고차원 특징 벡터(clip 또는 taxonomy 폴백).
 *  - scores    : 스칼라 차원 키 → 0~1 (택소노미 SCALAR_DIMENSIONS).
 *  - labels    : 카테고리 차원 키 → 선택된 옵션 value (택소노미 CATEGORICAL_DIMENSIONS).
 * 좌표(coords)는 저장하지 않는다 — 데이터셋 전체에 대해 /space 요청 시점에 투영한다.
 */
export const ImageItemSchema = z.object({
  id: z.string(),
  /** 단일 컬렉션 v1: 항상 'default'. 향후 다중 공간 분리용. */
  collectionId: z.string().default('default'),
  blobId: z.string(),
  /** 원본 바이트 sha256 — 같은 이미지 재업로드 중복 방지. */
  contentHash: z.string().default(''),
  filename: z.string().default(''),
  width: z.number().default(0),
  height: z.number().default(0),
  status: z.enum(IMAGE_STATUSES).default('pending'),
  /** 좌표 계산용 임베딩 벡터(차원은 provider 마다 다름). 미분석 시 빈 배열. */
  embedding: z.array(z.number()).default([]),
  /** 임베딩 출처: 'clip' | 'taxonomy'. */
  embedSource: z.string().default(''),
  /** 스칼라 차원 점수 0~1. */
  scores: z.record(z.string(), z.number()).default({}),
  /** 카테고리 차원 선택 라벨(키→value). */
  labels: z.record(z.string(), z.string()).default({}),
  /** Vision 한 줄 설명. */
  caption: z.string().default(''),
  /** scores/labels 가 어느 택소노미 버전 기준인지. */
  taxonomyVersion: z.number().default(TAXONOMY_VERSION),
  error: z.string().nullable().default(null),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type ImageItem = z.infer<typeof ImageItemSchema>;

/** POST /images 요청 바디(base64 인라인 업로드). */
export const IngestRequestSchema = z.object({
  filename: z.string().default('image'),
  /** data URL 또는 순수 base64. */
  dataBase64: z.string(),
  mime: z.string().default('image/png'),
});
export type IngestRequest = z.infer<typeof IngestRequestSchema>;

/** 3D 좌표가 붙은 공간 점(GET /space 응답 항목). x·y·z ∈ [0,1]. */
export const SpacePointSchema = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  z: z.number().default(0.5),
  blobId: z.string(),
  filename: z.string(),
  status: z.enum(IMAGE_STATUSES),
  caption: z.string(),
  scores: z.record(z.string(), z.number()),
  labels: z.record(z.string(), z.string()),
  /** 유사도(sim) 모드 군집 id. 그 외 모드는 -1. */
  clusterId: z.number().default(-1),
});
export type SpacePoint = z.infer<typeof SpacePointSchema>;

/** 유사도 모드 군집 메타(범례·라벨). */
export const ClusterSchema = z.object({
  id: z.number(),
  /** 대표 라벨(군집 내 최빈 형식의 한글 표시명). */
  label: z.string(),
  count: z.number(),
});
export type Cluster = z.infer<typeof ClusterSchema>;

/**
 * 공간 투영. 3축(x·y·z). 각 축은 스칼라 차원 키 또는 'pca'.
 * mode=axes: 지정한 스칼라 점수를 그대로 좌표로(미지정 축은 'pca' 표기, 값 0.5).
 * mode=pca : 임베딩을 상위 3개 주성분으로 축소.
 */
export const SpaceResponseSchema = z.object({
  xAxis: z.string(),
  yAxis: z.string(),
  zAxis: z.string().default('pca'),
  /**
   * 'pca'=임베딩 주성분 3D · 'axes'=스칼라 축 평면 · 'sim'=유사도 3D(UMAP류)
   * 'pcoord'=평행좌표(8축 동시) · 'radar'=레이더 글리프(점별 8축 프로필).
   * pcoord/radar 는 좌표를 안 쓰는 2D 차트 — 점의 scores/labels 로 웹이 직접 그린다.
   */
  mode: z.enum(['pca', 'axes', 'sim', 'pcoord', 'radar']),
  points: z.array(SpacePointSchema),
  /** sim 모드 군집 메타. 그 외 빈 배열. */
  clusters: z.array(ClusterSchema).default([]),
  /** sim 모드 k-NN 간선(points 배열 인덱스 쌍). 그 외 빈 배열. */
  edges: z.array(z.tuple([z.number(), z.number()])).default([]),
});
export type SpaceResponse = z.infer<typeof SpaceResponseSchema>;

/** GET /images/:id/similar 응답 항목 — 임베딩 코사인 유사도 이웃. */
export const SimilarNeighborSchema = z.object({
  id: z.string(),
  blobId: z.string(),
  filename: z.string(),
  caption: z.string(),
  /** 코사인 유사도 0~1(같은 임베딩 source/dim 끼리만 비교). */
  score: z.number(),
});
export type SimilarNeighbor = z.infer<typeof SimilarNeighborSchema>;
