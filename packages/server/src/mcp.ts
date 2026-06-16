/**
 * Image Space — MCP 서버(stdio). Image Space 를 Claude Code/Desktop 등에 도구로 노출.
 *
 * 분류는 내부에서 로컬 Claude CLI(`claude -p --json-schema`)로 수행 — Anthropic API 키 불필요.
 * HTTP 서버와 동일한 DB/blobs 를 공유(better-sqlite3 WAL). 단독으로도 동작한다.
 *
 * 도구:
 *  - classify_image : 파일 경로 → 택소노미 점수/라벨/캡션(저장 없음, CLI 분석).
 *  - ingest_image   : 파일을 수집(blob 저장 + 분석 큐 투입) → 아이템.
 *  - list_images    : 컬렉션 이미지 목록(요약).
 *  - get_space      : 공간 투영(pca/axes/sim) — 좌표·군집·간선.
 *  - search_similar : 임베딩 코사인 유사 이웃.
 *
 * ⚠ stdout 은 JSON-RPC 채널 — 로그는 반드시 stderr(console.error)로만.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { ImageItemSchema, type ImageItem } from '@imgspace/shared';
import { LocalBlobStore, extFromMime, mimeFromExt } from '@imgspace/shared/blobstore';
import { config } from './config.js';
import { openDb } from './db.js';
import { ImageStore, ProjectionCache } from './store.js';
import { Bus } from './bus.js';
import { AnalysisQueue } from './analyze/pipeline.js';
import { analyzeImage } from './analyze/vision.js';
import { buildSpace, findSimilar } from './space.js';

const db = openDb();
const store = new ImageStore(db);
const projections = new ProjectionCache(db);
const blobs = new LocalBlobStore(config.blobsDir);
const bus = new Bus(); // ws sink 없음 — MCP 단독 동작
const queue = new AnalysisQueue(store, blobs, bus);

const json = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });
const err = (msg: string) => ({ content: [{ type: 'text' as const, text: `error: ${msg}` }], isError: true });

const server = new McpServer({ name: 'image-space', version: '0.1.0' });

server.registerTool(
  'classify_image',
  {
    title: '이미지 분류',
    description:
      '이미지 파일을 택소노미(스칼라 8축 + 카테고리 4축)로 분류한다. 로컬 Claude CLI 로 분석하며 저장하지 않는다.',
    inputSchema: { path: z.string().describe('분석할 이미지의 절대 경로') },
  },
  async ({ path: imgPath }) => {
    try {
      const analysis = await analyzeImage(imgPath, path.dirname(path.resolve(imgPath)));
      return json(analysis);
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e));
    }
  },
);

server.registerTool(
  'ingest_image',
  {
    title: '이미지 수집',
    description: '이미지 파일을 컬렉션에 수집한다(blob 저장 + 분석 큐 투입). 분석은 비동기로 진행된다.',
    inputSchema: {
      path: z.string().describe('수집할 이미지의 절대 경로'),
      filename: z.string().optional().describe('표시 파일명(미지정 시 경로의 파일명)'),
    },
  },
  async ({ path: imgPath, filename }) => {
    try {
      const buf = readFileSync(imgPath);
      const name = filename ?? path.basename(imgPath);
      const contentHash = createHash('sha256').update(buf).digest('hex');
      const dup = store.findByContentHash('default', contentHash);
      if (dup) return json({ deduped: true, item: summarize(dup) });

      const mime = mimeFromExt(imgPath);
      const { blobId } = blobs.put(buf, { ext: extFromMime(mime), name });
      const now = Date.now();
      const item: ImageItem = ImageItemSchema.parse({
        id: randomUUID(), blobId, contentHash, filename: name,
        status: 'pending', createdAt: now, updatedAt: now,
      });
      store.insert(item);
      bus.broadcast({ type: 'ui.itemUpdate', item });
      queue.enqueue(item.id);
      return json({ deduped: false, item: summarize(item) });
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e));
    }
  },
);

server.registerTool(
  'list_images',
  {
    title: '이미지 목록',
    description: '컬렉션의 이미지 목록(요약: id·상태·캡션·라벨).',
    inputSchema: {},
  },
  async () => json(store.list().map(summarize)),
);

server.registerTool(
  'get_space',
  {
    title: '공간 투영',
    description:
      "공간 좌표를 계산한다. mode=pca(임베딩 3성분)·axes(스칼라 축 평면)·sim(유사도 UMAP 2D + 군집·간선).",
    inputSchema: {
      mode: z.enum(['pca', 'axes', 'sim']).optional(),
      x: z.string().optional().describe('axes 모드 X 스칼라 차원 키'),
      y: z.string().optional().describe('axes 모드 Y 스칼라 차원 키'),
      z: z.string().optional().describe('axes 모드 Z 스칼라 차원 키'),
    },
  },
  async ({ mode, x, y, z }) => json(buildSpace(store, projections, { mode, x, y, z })),
);

server.registerTool(
  'search_similar',
  {
    title: '유사 이미지 검색',
    description: '임베딩 코사인 유사도로 가장 가까운 이미지들을 찾는다.',
    inputSchema: {
      id: z.string().describe('기준 이미지 id'),
      k: z.number().optional().describe('이웃 개수(기본 8)'),
    },
  },
  async ({ id, k }) => {
    const neighbors = findSimilar(store, id, k ?? 8);
    if (neighbors === null) return err(`이미지 없음: ${id}`);
    return json(neighbors);
  },
);

function summarize(i: ImageItem) {
  return {
    id: i.id,
    status: i.status,
    filename: i.filename,
    caption: i.caption,
    labels: i.labels,
    embedSource: i.embedSource,
    error: i.error,
  };
}

async function main() {
  await server.connect(new StdioServerTransport());
  console.error(
    `[mcp] image-space MCP 서버 시작 (db=${config.dbPath}, 분석=${config.mockAnalysis ? '목업' : 'Claude CLI'})`,
  );
}

main().catch((e) => {
  console.error('[mcp] 시작 실패:', e);
  process.exit(1);
});
