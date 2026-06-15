/**
 * 좌표용 임베딩 벡터 생성.
 *  - clip     : @huggingface/transformers(Xenova/clip-vit-base-patch32) 이미지 임베딩(512D).
 *               패키지 미설치/로드 실패 시 taxonomy 로 1회 경고 후 폴백.
 *  - taxonomy : Vision 분석 결과(scores 8 + 카테고리 one-hot)로 결정론적 특징 벡터.
 */
import {
  SCALAR_KEYS,
  CATEGORICAL_DIMENSIONS,
  type AnalysisResult,
} from '@imgspace/shared';
import { config } from '../config.js';

export interface EmbedResult {
  vector: number[];
  source: 'clip' | 'taxonomy';
}

/** Vision 점수에서 결정론적 특징 벡터. 차원 = 8(스칼라) + Σ(카테고리 옵션수). */
export function taxonomyVector(analysis: AnalysisResult): number[] {
  const v: number[] = [];
  for (const key of SCALAR_KEYS) v.push(analysis.scores[key] ?? 0.5);
  for (const dim of CATEGORICAL_DIMENSIONS) {
    const chosen = analysis.labels[dim.key];
    for (const opt of dim.options) v.push(opt.value === chosen ? 1 : 0);
  }
  return v;
}

// CLIP 익스트랙터 지연 로드(최초 1회). 변수 specifier 로 tsc 의 모듈 해석을 회피.
let clipExtractor: Promise<((img: unknown, opts: unknown) => Promise<{ data: ArrayLike<number> }>) | null> | null = null;
let clipWarned = false;

function loadClip() {
  if (!clipExtractor) {
    clipExtractor = (async () => {
      const specifier = '@huggingface/transformers';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod: any = await import(specifier).catch(() => null);
      if (!mod) return null;
      return mod.pipeline('image-feature-extraction', 'Xenova/clip-vit-base-patch32');
    })();
  }
  return clipExtractor;
}

async function clipVector(buf: Buffer): Promise<number[] | null> {
  try {
    const extractor = await loadClip();
    if (!extractor) return null;
    const specifier = '@huggingface/transformers';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import(specifier);
    const image = await mod.RawImage.fromBlob(new Blob([buf as unknown as BlobPart]));
    const out = await extractor(image, { pooling: 'mean', normalize: true });
    return Array.from(out.data as ArrayLike<number>);
  } catch {
    return null;
  }
}

export async function embedImage(buf: Buffer, analysis: AnalysisResult): Promise<EmbedResult> {
  if (config.embedProvider === 'clip') {
    const v = await clipVector(buf);
    if (v && v.length > 0) return { vector: v, source: 'clip' };
    if (!clipWarned) {
      clipWarned = true;
      console.warn(
        '[embed] CLIP 사용 불가 → taxonomy 폴백. CLIP 활성화: `pnpm --filter @imgspace/server add @huggingface/transformers`',
      );
    }
  }
  return { vector: taxonomyVector(analysis), source: 'taxonomy' };
}
