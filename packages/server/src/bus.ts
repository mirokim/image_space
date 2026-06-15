/** GUI 푸시 버스 — ws 클라이언트 집합에 ServerToUi 메시지를 브로드캐스트. */
import { type ServerToUiBody, envelope } from '@imgspace/shared';

type Sink = (json: string) => void;

export class Bus {
  private sinks = new Set<Sink>();

  add(sink: Sink): () => void {
    this.sinks.add(sink);
    return () => this.sinks.delete(sink);
  }

  broadcast(body: ServerToUiBody): void {
    const json = JSON.stringify(envelope(body as Record<string, unknown>, Date.now()));
    for (const sink of this.sinks) {
      try {
        sink(json);
      } catch {
        /* 끊긴 소켓 무시 */
      }
    }
  }
}
