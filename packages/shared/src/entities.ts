import { z } from 'zod';

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
});
export type SpacePoint = z.infer<typeof SpacePointSchema>;

/**
 * 공간 투영. 3축(x·y·z). 각 축은 스칼라 차원 키 또는 'pca'.
 * mode=axes: 지정한 스칼라 점수를 그대로 좌표로(미지정 축은 'pca' 표기, 값 0.5).
 * mode=pca : 임베딩을 상위 3개 주성분으로 축소.
 */
export const SpaceResponseSchema = z.object({
  xAxis: z.string(),
  yAxis: z.string(),
  zAxis: z.string().default('pca'),
  /** 'pca' | 'axes' */
  mode: z.enum(['pca', 'axes']),
  points: z.array(SpacePointSchema),
});
export type SpaceResponse = z.infer<typeof SpaceResponseSchema>;
