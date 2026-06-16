/**
 * 분석 큐 — 이미지 1건당 Vision 채점 + 임베딩을 실행하고 store/bus 를 갱신.
 * 동시성 2로 제한해 API 과부하를 막는다. 진행 상태는 ws 로 실시간 푸시.
 */
import { LocalBlobStore } from '@imgspace/shared/blobstore';
import type { ImageStore } from '../store.js';
import type { Bus } from '../bus.js';
import { analyzeImage } from './vision.js';
import { embedImage } from './embed.js';

const CONCURRENCY = 2;

export class AnalysisQueue {
  private pending: string[] = [];
  private active = 0;

  constructor(
    private readonly store: ImageStore,
    private readonly blobs: LocalBlobStore,
    private readonly bus: Bus,
  ) {}

  enqueue(id: string): void {
    this.pending.push(id);
    this.pump();
  }

  private pump(): void {
    while (this.active < CONCURRENCY && this.pending.length > 0) {
      const id = this.pending.shift()!;
      this.active++;
      void this.run(id).finally(() => {
        this.active--;
        this.pump();
      });
    }
  }

  private async run(id: string): Promise<void> {
    const item = this.store.get(id);
    if (!item) return;

    item.status = 'analyzing';
    item.updatedAt = Date.now();
    this.store.update(item);
    this.bus.broadcast({ type: 'ui.itemUpdate', item });

    try {
      const buf = this.blobs.read(item.blobId);
      // 분석은 Claude CLI 가 파일을 직접 Read 하므로 경로를 넘긴다.
      const analysis = await analyzeImage(this.blobs.path(item.blobId), this.blobs.root);
      const embed = await embedImage(buf, analysis);

      item.caption = analysis.caption;
      item.scores = analysis.scores;
      item.labels = analysis.labels;
      item.embedding = embed.vector;
      item.embedSource = embed.source;
      item.status = 'ready';
      item.error = null;
    } catch (err) {
      item.status = 'error';
      item.error = err instanceof Error ? err.message : String(err);
      console.error(`[analyze] ${id} 실패:`, item.error);
    }

    item.updatedAt = Date.now();
    this.store.update(item);
    this.bus.broadcast({ type: 'ui.itemUpdate', item });
  }
}
