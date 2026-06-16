/** 서버 진입점 — Fastify(:PORT) + ws(/ui). */
import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { WS_PATH } from '@imgspace/shared';
import { LocalBlobStore } from '@imgspace/shared/blobstore';
import { config } from './config.js';
import { openDb } from './db.js';
import { ImageStore, ProjectionCache } from './store.js';
import { Bus } from './bus.js';
import { AnalysisQueue } from './analyze/pipeline.js';
import { registerRoutes } from './routes.js';

async function main() {
  if (config.mockAnalysis) {
    console.warn(
      '[server] 목업 분석 모드 — API 키 없이 결정론적 점수/라벨로 공간을 채운다. ' +
        '실제 Vision 분석은 .env 에 ANTHROPIC_API_KEY 설정.',
    );
  }

  const db = openDb();
  const store = new ImageStore(db);
  const projections = new ProjectionCache(db);
  const blobs = new LocalBlobStore(config.blobsDir);
  const bus = new Bus();
  const queue = new AnalysisQueue(store, blobs, bus);

  const app = Fastify({ logger: false, bodyLimit: 64 * 1024 * 1024 });
  await app.register(cors, { origin: true });
  await app.register(websocket);

  // GUI 실시간 채널: 접속 시 전체 스냅샷 → 이후 itemUpdate/itemRemoved 푸시.
  app.get(WS_PATH.ui, { websocket: true }, (socket) => {
    const off = bus.add((json) => socket.send(json));
    socket.send(
      JSON.stringify({ type: 'ui.snapshot', v: 1, ts: Date.now(), items: store.list() }),
    );
    socket.on('close', off);
  });

  registerRoutes(app, { store, projections, blobs, bus, queue });

  await app.listen({ port: config.port, host: config.host });
  console.log(`[server] http://${config.host}:${config.port}  (embed=${config.embedProvider}, model=${config.visionModel})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
