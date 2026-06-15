/** SQLite 열기 + 스키마. data/space.db. */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { config } from './config.js';

export function openDb(): Database.Database {
  mkdirSync(config.dataDir, { recursive: true });
  const db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS images (
      id           TEXT PRIMARY KEY,
      collectionId TEXT NOT NULL DEFAULT 'default',
      blobId       TEXT NOT NULL,
      filename     TEXT NOT NULL DEFAULT '',
      width        INTEGER NOT NULL DEFAULT 0,
      height       INTEGER NOT NULL DEFAULT 0,
      status       TEXT NOT NULL DEFAULT 'pending',
      embedding    TEXT NOT NULL DEFAULT '[]',
      embedSource  TEXT NOT NULL DEFAULT '',
      scores       TEXT NOT NULL DEFAULT '{}',
      labels       TEXT NOT NULL DEFAULT '{}',
      caption      TEXT NOT NULL DEFAULT '',
      error        TEXT,
      createdAt    INTEGER NOT NULL,
      updatedAt    INTEGER NOT NULL
    );
  `);
  return db;
}
