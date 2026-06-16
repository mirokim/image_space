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
  /** 분석 모델 — Claude CLI 에 넘길 모델. 기본 claude-opus-4-8('opus' 별칭도 가능). */
  visionModel: process.env.VISION_MODEL ?? 'claude-opus-4-8',
  /**
   * 분석은 Anthropic API 가 아니라 로컬 Claude CLI(`claude -p --json-schema`)로 한다 — 키 불필요.
   * MOCK_ANALYSIS=1 이면(또는 CLI 호출 실패 시) 이미지 해시 기반 결정론적 목업으로 폴백.
   */
  mockAnalysis: process.env.MOCK_ANALYSIS === '1',
  /** Claude CLI 한 장 분석 타임아웃(ms). 에이전트형이라 이미지당 60~120s 걸릴 수 있다. */
  cliTimeoutMs: Number(process.env.CLI_TIMEOUT_MS ?? 240_000),
  /** 'clip' | 'taxonomy'. clip 미설치 시 taxonomy 로 자동 폴백. */
  embedProvider: (process.env.EMBED_PROVIDER ?? 'clip') as 'clip' | 'taxonomy',
  dataDir: path.join(REPO_ROOT, 'data'),
  blobsDir: path.join(REPO_ROOT, 'blobs'),
  dbPath: path.join(REPO_ROOT, 'data', 'space.db'),
} as const;
