/** 레포 루트 .env 로드 + 설정값. */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { existsSync } from 'node:fs';
import dotenv from 'dotenv';

const srcDir = path.dirname(fileURLToPath(import.meta.url));
// packages/server/src → 레포 루트는 세 단계 위.
export const REPO_ROOT = path.resolve(srcDir, '../../..');

const envPath = path.join(REPO_ROOT, '.env');
if (existsSync(envPath)) dotenv.config({ path: envPath });

export const config = {
  port: Number(process.env.PORT ?? 8790),
  host: '127.0.0.1',
  /** Vision 분석 모델. 기본 claude-opus-4-8. */
  visionModel: process.env.VISION_MODEL ?? 'claude-opus-4-8',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  /** 'clip' | 'taxonomy'. clip 미설치 시 taxonomy 로 자동 폴백. */
  embedProvider: (process.env.EMBED_PROVIDER ?? 'clip') as 'clip' | 'taxonomy',
  dataDir: path.join(REPO_ROOT, 'data'),
  blobsDir: path.join(REPO_ROOT, 'blobs'),
  dbPath: path.join(REPO_ROOT, 'data', 'space.db'),
} as const;
