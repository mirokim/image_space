/**
 * 리포지토리(SQLite).
 *  - ImageStore        : images + image_embeddings 를 합쳐 ImageItem 으로 다룬다.
 *                        임베딩은 BLOB(float32)로 분리 저장(차원/출처 추적).
 *  - ProjectionCache   : UMAP/군집 등 비싼 전역 레이아웃 캐시(datasetSig 로 무효화).
 */
import type Database from 'better-sqlite3';
import { type ImageItem, ImageItemSchema, TAXONOMY_VERSION } from '@imgspace/shared';
import { modelForSource } from './db.js';

interface Row {
  id: string;
  collectionId: string;
  blobId: string;
  contentHash: string;
  filename: string;
  width: number;
  height: number;
  status: string;
  scores: string;
  labels: string;
  caption: string;
  taxonomyVersion: number;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  // image_embeddings LEFT JOIN
  e_vector: Buffer | null;
  e_source: string | null;
}

const IMG_COLS =
  'id, collectionId, blobId, contentHash, filename, width, height, status, scores, labels, caption, taxonomyVersion, error, createdAt, updatedAt';

const SELECT_JOINED = `
  SELECT i.id, i.collectionId, i.blobId, i.contentHash, i.filename, i.width, i.height,
         i.status, i.scores, i.labels, i.caption, i.taxonomyVersion, i.error, i.createdAt, i.updatedAt,
         e.vector AS e_vector, e.source AS e_source
  FROM images i
  LEFT JOIN image_embeddings e ON e.imageId = i.id`;

/** BLOB ↔ number[] (정렬 안전하게 복사). */
function decodeVec(buf: Buffer): number[] {
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return Array.from(new Float32Array(ab));
}
function encodeVec(v: number[]): Buffer {
  const f = new Float32Array(v);
  return Buffer.from(f.buffer);
}

function rowToItem(r: Row): ImageItem {
  return ImageItemSchema.parse({
    id: r.id,
    collectionId: r.collectionId,
    blobId: r.blobId,
    contentHash: r.contentHash,
    filename: r.filename,
    width: r.width,
    height: r.height,
    status: r.status,
    embedding: r.e_vector ? decodeVec(r.e_vector) : [],
    embedSource: r.e_source ?? '',
    scores: JSON.parse(r.scores),
    labels: JSON.parse(r.labels),
    caption: r.caption,
    taxonomyVersion: r.taxonomyVersion,
    error: r.error,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  });
}

export class ImageStore {
  constructor(private readonly db: Database.Database) {
    // 기본 컬렉션 보장.
    this.db
      .prepare(
        `INSERT OR IGNORE INTO collections (id, name, taxonomyVersion, createdAt) VALUES (?, ?, ?, ?)`,
      )
      .run('default', '기본 컬렉션', TAXONOMY_VERSION, Date.now());
  }

  insert(item: ImageItem): void {
    this.db
      .prepare(
        `INSERT INTO images (${IMG_COLS})
         VALUES (@id, @collectionId, @blobId, @contentHash, @filename, @width, @height,
                 @status, @scores, @labels, @caption, @taxonomyVersion, @error, @createdAt, @updatedAt)`,
      )
      .run(this.serialize(item));
    this.writeEmbedding(item.id, item.embedding, item.embedSource);
  }

  update(item: ImageItem): void {
    this.db
      .prepare(
        `UPDATE images SET
           status=@status, scores=@scores, labels=@labels, caption=@caption,
           contentHash=@contentHash, taxonomyVersion=@taxonomyVersion,
           width=@width, height=@height, error=@error, updatedAt=@updatedAt
         WHERE id=@id`,
      )
      .run(this.serialize(item));
    this.writeEmbedding(item.id, item.embedding, item.embedSource);
  }

  /** 임베딩 1건만 유지(이미지당 하나). 빈 벡터면 제거만. */
  private writeEmbedding(imageId: string, vector: number[], source: string): void {
    this.db.prepare(`DELETE FROM image_embeddings WHERE imageId=?`).run(imageId);
    if (vector.length === 0) return;
    this.db
      .prepare(
        `INSERT INTO image_embeddings (imageId, source, model, dim, vector) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(imageId, source || 'taxonomy', modelForSource(source), vector.length, encodeVec(vector));
  }

  get(id: string): ImageItem | null {
    const row = this.db.prepare(`${SELECT_JOINED} WHERE i.id=?`).get(id) as Row | undefined;
    return row ? rowToItem(row) : null;
  }

  /** 동일 컬렉션 내 같은 바이트(contentHash) 이미지 — 중복 업로드 감지. */
  findByContentHash(collectionId: string, contentHash: string): ImageItem | null {
    if (!contentHash) return null;
    const row = this.db
      .prepare(`${SELECT_JOINED} WHERE i.collectionId=? AND i.contentHash=? LIMIT 1`)
      .get(collectionId, contentHash) as Row | undefined;
    return row ? rowToItem(row) : null;
  }

  list(collectionId = 'default'): ImageItem[] {
    const rows = this.db
      .prepare(`${SELECT_JOINED} WHERE i.collectionId=? ORDER BY i.createdAt ASC`)
      .all(collectionId) as Row[];
    return rows.map(rowToItem);
  }

  remove(id: string): void {
    // image_embeddings 는 ON DELETE CASCADE.
    this.db.prepare(`DELETE FROM images WHERE id=?`).run(id);
  }

  /** 데이터셋 시그니처 — ready 개수 + 최신 updatedAt. 투영 캐시 무효화 키. */
  datasetSig(collectionId = 'default'): string {
    const r = this.db
      .prepare(
        `SELECT COUNT(*) AS c, COALESCE(MAX(updatedAt), 0) AS m
         FROM images WHERE collectionId=? AND status='ready'`,
      )
      .get(collectionId) as { c: number; m: number };
    return `${r.c}:${r.m}`;
  }

  private serialize(item: ImageItem) {
    return {
      id: item.id,
      collectionId: item.collectionId,
      blobId: item.blobId,
      contentHash: item.contentHash,
      filename: item.filename,
      width: item.width,
      height: item.height,
      status: item.status,
      scores: JSON.stringify(item.scores),
      labels: JSON.stringify(item.labels),
      caption: item.caption,
      taxonomyVersion: item.taxonomyVersion,
      error: item.error,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }
}

export interface CachedProjection {
  payload: string;
  datasetSig: string;
}

/** UMAP/t-SNE 등 전역 레이아웃 캐시. datasetSig 불일치 시 stale → null. */
export class ProjectionCache {
  constructor(private readonly db: Database.Database) {}

  get(collectionId: string, method: string, paramsHash: string, datasetSig: string): unknown | null {
    const row = this.db
      .prepare(
        `SELECT payload, datasetSig FROM projection_cache
         WHERE collectionId=? AND method=? AND paramsHash=?`,
      )
      .get(collectionId, method, paramsHash) as CachedProjection | undefined;
    if (!row || row.datasetSig !== datasetSig) return null;
    return JSON.parse(row.payload);
  }

  put(
    collectionId: string,
    method: string,
    paramsHash: string,
    datasetSig: string,
    payload: unknown,
  ): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO projection_cache
           (collectionId, method, paramsHash, datasetSig, payload, createdAt)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(collectionId, method, paramsHash, datasetSig, JSON.stringify(payload), Date.now());
  }
}
