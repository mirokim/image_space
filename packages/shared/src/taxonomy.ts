/**
 * 택소노미 — "다차원 공간"의 축 정의 (SSOT).
 *
 * 두 종류의 차원:
 *  - scalar      : 0~1 연속값. 공간의 좌표축으로 직접 쓸 수 있다(예: 사실성 vs 복잡도 평면).
 *  - categorical : 택1 라벨. 점의 색/그룹(패싯)으로 쓰고, 임베딩 좌표에도 기여한다.
 *
 * 이 파일이 단일 소스다:
 *  - server/analyze/vision.ts 가 이 정의로 Claude Vision 채점 스키마/프롬프트를 만든다.
 *  - server/analyze/embed.ts 의 taxonomy 폴백 임베딩이 이 차원으로 특징 벡터를 만든다.
 *  - web 의 축 선택 UI 가 이 목록을 그대로 렌더한다.
 */
import { z } from 'zod';

export interface ScalarDimension {
  key: string;
  kind: 'scalar';
  /** 한글 표시명. */
  label: string;
  /** 0 끝의 의미. */
  low: string;
  /** 1 끝의 의미. */
  high: string;
  /** Vision 채점 기준(프롬프트에 그대로 들어간다). */
  description: string;
}

export interface CategoricalDimension {
  key: string;
  kind: 'categorical';
  label: string;
  options: { value: string; label: string }[];
  description: string;
}

export type Dimension = ScalarDimension | CategoricalDimension;

/** 스칼라 축 8종 — 0(low)~1(high). 공간 좌표축 후보. */
export const SCALAR_DIMENSIONS: ScalarDimension[] = [
  {
    key: 'realism',
    kind: 'scalar',
    label: '사실성',
    low: '양식화/추상',
    high: '사진같은 실사',
    description: '0=완전히 양식화/추상/만화적, 1=실사 사진처럼 사실적.',
  },
  {
    key: 'complexity',
    kind: 'scalar',
    label: '복잡도',
    low: '단순/여백',
    high: '복잡/빽빽',
    description: '0=요소가 적고 여백이 많음, 1=요소가 많고 화면이 빽빽함.',
  },
  {
    key: 'colorfulness',
    kind: 'scalar',
    label: '색채도',
    low: '무채색/단색',
    high: '고채도/다채',
    description: '0=흑백·세피아·단색 위주, 1=채도 높고 색이 다양함.',
  },
  {
    key: 'brightness',
    kind: 'scalar',
    label: '명도',
    low: '어두움',
    high: '밝음',
    description: '전체 밝기. 0=어두운 톤, 1=밝은 톤.',
  },
  {
    key: 'warmth',
    kind: 'scalar',
    label: '색온도',
    low: '차가움(청록)',
    high: '따뜻함(적황)',
    description: '0=차가운 청록 계열 지배, 1=따뜻한 적황 계열 지배.',
  },
  {
    key: 'energy',
    kind: 'scalar',
    label: '역동성',
    low: '정적/차분',
    high: '동적/격렬',
    description: '구도·움직임의 에너지. 0=정적이고 차분, 1=동적이고 격렬.',
  },
  {
    key: 'detail',
    kind: 'scalar',
    label: '디테일',
    low: '거침/미니멀',
    high: '정밀/세밀',
    description: '0=거칠고 단순한 묘사, 1=정밀하고 세밀한 묘사.',
  },
  {
    key: 'mood',
    kind: 'scalar',
    label: '정서',
    low: '무겁고 침울',
    high: '밝고 경쾌',
    description: '감정 톤. 0=무겁고 침울/긴장, 1=밝고 경쾌/희망.',
  },
];

/** 카테고리 축 4종 — 택1. 색/패싯 + 임베딩 기여. */
export const CATEGORICAL_DIMENSIONS: CategoricalDimension[] = [
  {
    key: 'format',
    kind: 'categorical',
    label: '형식',
    description: '이미지가 만들어진 형식.',
    options: [
      { value: 'photo', label: '사진' },
      { value: 'illustration', label: '일러스트' },
      { value: 'anime', label: '애니/만화체' },
      { value: 'painting', label: '회화' },
      { value: '3d_render', label: '3D 렌더' },
      { value: 'pixel_art', label: '픽셀아트' },
      { value: 'vector', label: '벡터/플랫' },
      { value: 'sketch', label: '스케치/선화' },
      { value: 'photo_manipulation', label: '합성/포토매니퓰레이션' },
      { value: 'mixed_media', label: '혼합매체' },
    ],
  },
  {
    key: 'genre',
    kind: 'categorical',
    label: '장르',
    description: '소재/주제 장르.',
    options: [
      { value: 'portrait', label: '인물' },
      { value: 'character', label: '캐릭터' },
      { value: 'landscape', label: '풍경' },
      { value: 'architecture', label: '건축/공간' },
      { value: 'concept_art', label: '컨셉아트' },
      { value: 'product', label: '제품' },
      { value: 'still_life', label: '정물' },
      { value: 'abstract', label: '추상' },
      { value: 'scene', label: '장면/내러티브' },
      { value: 'ui_graphic', label: 'UI/그래픽' },
    ],
  },
  {
    key: 'medium',
    kind: 'categorical',
    label: '매체',
    description: '표현 매체/기법.',
    options: [
      { value: 'photography', label: '사진' },
      { value: 'digital_painting', label: '디지털 페인팅' },
      { value: 'watercolor', label: '수채' },
      { value: 'oil', label: '유화' },
      { value: 'ink', label: '잉크/펜' },
      { value: 'pencil', label: '연필/목탄' },
      { value: 'cgi', label: 'CGI/3D' },
      { value: 'vector_art', label: '벡터' },
      { value: 'collage', label: '콜라주' },
    ],
  },
  {
    key: 'era_style',
    kind: 'categorical',
    label: '사조',
    description: '시각적 사조/무드.',
    options: [
      { value: 'modern', label: '모던' },
      { value: 'minimalist', label: '미니멀' },
      { value: 'retro', label: '레트로' },
      { value: 'cyberpunk', label: '사이버펑크' },
      { value: 'fantasy', label: '판타지' },
      { value: 'surreal', label: '초현실' },
      { value: 'vaporwave', label: '베이퍼웨이브' },
      { value: 'pop_art', label: '팝아트' },
      { value: 'realism', label: '사실주의' },
      { value: 'ukiyo_e', label: '우키요에/동양화' },
    ],
  },
];

export const TAXONOMY: Dimension[] = [...SCALAR_DIMENSIONS, ...CATEGORICAL_DIMENSIONS];

export const SCALAR_KEYS = SCALAR_DIMENSIONS.map((d) => d.key);
export const CATEGORICAL_KEYS = CATEGORICAL_DIMENSIONS.map((d) => d.key);

export function getDimension(key: string): Dimension | undefined {
  return TAXONOMY.find((d) => d.key === key);
}

/**
 * Vision 분석 결과를 검증하는 zod 스키마를 택소노미에서 동적으로 생성한다.
 * scores=스칼라 키→0~1, labels=카테고리 키→옵션 enum, caption=한 줄 설명.
 * (단일 소스: 차원을 추가하면 스키마·프롬프트·임베딩이 자동으로 따라온다.)
 */
export function buildAnalysisSchema() {
  const scoresShape: Record<string, z.ZodNumber> = {};
  for (const d of SCALAR_DIMENSIONS) {
    scoresShape[d.key] = z.number().min(0).max(1);
  }
  const labelsShape: Record<string, z.ZodEnum<[string, ...string[]]>> = {};
  for (const d of CATEGORICAL_DIMENSIONS) {
    const values = d.options.map((o) => o.value) as [string, ...string[]];
    labelsShape[d.key] = z.enum(values);
  }
  return z.object({
    caption: z.string(),
    scores: z.object(scoresShape),
    labels: z.object(labelsShape),
  });
}

export type AnalysisResult = z.infer<ReturnType<typeof buildAnalysisSchema>>;
