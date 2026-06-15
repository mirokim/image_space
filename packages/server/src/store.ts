/** ImageItem 리포지토리(SQLite). JSON 컬럼은 (de)serialize 처리. */
import type Database from 'better-sqlite3';
import { type ImageItem, ImageItemSchema } from '@imgspace/shared';

interface Row {
  id: string;
  collectionId: string;
  blobId: string;
  filename: string;
  width: number;
  height: number;
  status: string;
  embedding: string;
  embedSource: string;
  scores: string;
  labels: string;
  caption: string;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

function rowToItem(r: Row): ImageItem {
  return ImageItemSchema.parse({
    id: r.id,
    collectionId: r.collectionId,
    blobId: r.blobId,
    filename: r.filename,
    width: r.width,
    height: r.height,
    status: r.status,
    embedding: JSON.parse(r.embedding),
    embedSource: r.embedSource,
    scores: JSON.parse(r.scores),
    labels: JSON.parse(r.labels),
    caption: r.caption,
    error: r.error,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  });
}

export class ImageStore {
  constructor(private readonly db: Database.Database) {}

  insert(item: ImageItem): void {
    this.db
      .prepare(
        `INSERT INTO images
         (id, collectionId, blobId, filename, width, height, status, embedding, embedSource, scores, labels, caption, error, createdAt, updatedAt)
         VALUES (@id, @collectionId, @blobId, @filename, @width, @height, @status, @embedding, @embedSource, @scores, @labels, @caption, @error, @createdAt, @updatedAt)`,
      )
      .run(this.serialize(item));
  }

  update(item: ImageItem): void {
    this.db
      .prepare(
        `UPDATE images SET
           status=@status, embedding=@embedding, embedSource=@embedSource,
           scores=@scores, labels=@labels, caption=@caption,
           width=@width, height=@height, error=@error, updatedAt=@updatedAt
         WHERE id=@id`,
      )
      .run(this.serialize(item));
  }

  get(id: string): ImageItem | null {
    const row = this.db.prepare(`SELECT * FROM images WHERE id=?`).get(id) as Row | undefined;
    return row ? rowToItem(row) : null;
  }

  list(collectionId = 'default'): ImageItem[] {
    const rows = this.db
      .prepare(`SELECT * FROM images WHERE collectionId=? ORDER BY createdAt ASC`)
      .all(collectionId) as Row[];
    return rows.map(rowToItem);
  }

  remove(id: string): void {
    this.db.prepare(`DELETE FROM images WHERE id=?`).run(id);
  }

  private serialize(item: ImageItem) {
    return {
      ...item,
      embedding: JSON.stringify(item.embedding),
      scores: JSON.stringify(item.scores),
      labels: JSON.stringify(item.labels),
    };
  }
}
