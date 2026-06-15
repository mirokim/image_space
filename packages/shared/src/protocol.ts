import { z } from 'zod';
import { ImageItemSchema } from './entities.js';

/** WS 프로토콜 버전. */
export const PROTOCOL_VERSION = 1;

const metaShape = {
  v: z.number(),
  ts: z.number(),
};

function msg<T extends string, S extends z.ZodRawShape>(type: T, shape: S) {
  return z.object({ type: z.literal(type), ...metaShape, ...shape });
}

/** 서버 → GUI 단방향 푸시. GUI→서버 변경은 HTTP. */
export const ServerToUiSchema = z.discriminatedUnion('type', [
  /** 접속 직후 전체 스냅샷. */
  msg('ui.snapshot', { items: z.array(ImageItemSchema) }),
  /** 아이템 1개 생성/갱신(분석 진행에 따라 여러 번). */
  msg('ui.itemUpdate', { item: ImageItemSchema }),
  /** 아이템 삭제. */
  msg('ui.itemRemoved', { id: z.string() }),
]);
export type ServerToUi = z.infer<typeof ServerToUiSchema>;

type StripEnvelope<T> = T extends unknown ? Omit<T, 'v' | 'ts'> : never;
export type ServerToUiBody = StripEnvelope<ServerToUi>;

/** 봉투 메타(v/ts)를 채워 메시지를 만든다. ts 는 호출측에서 주입. */
export function envelope<T extends Record<string, unknown>>(
  body: T,
  ts: number,
): T & { v: number; ts: number } {
  return { v: PROTOCOL_VERSION, ts, ...body };
}
