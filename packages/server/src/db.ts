/**
 * SQLite 열기 + 버전드 스키마 마이그레이션. data/space.db.
 *
 * 설계(저장 vs 계산):
 *  - 임베딩 = SSOT → image_embeddings 에 BLOB(float32) + source/dim 추적.
 *  - scores/labels = JSON 컬럼(택소노미 차원이 유연하게 늘어남).
 *  - 좌표(PCA/축)는 저장하지 않고 /space 시점 계산.
 *  - UMAP/군집 등 비싸고 확률적인 전역 레이아웃만 projection_cache 에 캐시
 *    (datasetSig 로 무효화 — "저장"이 아니라 캐시).
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { config } from './config.js';

export function openDb(): Database.Database {
  mkdirSync(config.dataDir, { recursive: true });
  const db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function userVersion(db: Database.Database): number {
  return db.pragma('user_version', { simple: true }) as number;
}

function migrate(db: Database.Database): void {
  // ── v1: 초기 단일 테이블(Initial commit 스키마). 신규 DB도 여기서 베이스 생성. ──
  if (userVersion(db) < 1) {
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
    db.pragma('user_version = 1');
  }

  // ── v2: 컬렉션/임베딩 분리/투영 캐시 + 메타 컬럼. ──
  if (userVersion(db) < 2) {
    const tx = db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS collections (
          id              TEXT PRIMARY KEY,
          name            TEXT NOT NULL,
          taxonomyVersion INTEGER NOT NULL DEFAULT 1,
          createdAt       INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS image_embeddings (
          imageId TEXT NOT NULL REFERENCES images(id) ON DELETE CASCADE,
          source  TEXT NOT NULL,          -- 'clip' | 'taxonomy'
          model   TEXT NOT NULL,          -- 'Xenova/clip-vit-base-patch32' 등
          dim     INTEGER NOT NULL,       -- 512 / 47 …
          vector  BLOB NOT NULL,          -- Float32Array raw bytes
          PRIMARY KEY (imageId, source)
        );

        CREATE TABLE IF NOT EXISTS projection_cache (
          collectionId TEXT NOT NULL,
          method       TEXT NOT NULL,     -- 'umap' | 'tsne'
          paramsHash   TEXT NOT NULL,     -- nNeighbors/minDist 등 파라미터 해시
          datasetSig   TEXT NOT NULL,     -- count:maxUpdatedAt → 데이터 바뀌면 무효
          payload      TEXT NOT NULL,     -- JSON: [{id,x,y,clusterId}]
          createdAt    INTEGER NOT NULL,
          PRIMARY KEY (collectionId, method, paramsHash)
        );
      `);

      // 메타 컬럼 추가(존재하면 무시).
      addColumn(db, 'images', 'contentHash', `TEXT NOT NULL DEFAULT ''`);
      addColumn(db, 'images', 'taxonomyVersion', `INTEGER NOT NULL DEFAULT 1`);

      // 기존 데이터 → 컬렉션 백필.
      const now = Date.now();
      const colls = db
        .prepare(`SELECT DISTINCT collectionId FROM images`)
        .all() as { collectionId: string }[];
      const insColl = db.prepare(
        `INSERT OR IGNORE INTO collections (id, name, taxonomyVersion, createdAt) VALUES (?, ?, 1, ?)`,
      );
      insColl.run('default', '기본 컬렉션', now);
      for (const c of colls) insColl.run(c.collectionId, c.collectionId, now);

      // 기존 inline 임베딩 → image_embeddings 백필.
      migrateEmbeddings(db);

      // 레거시 컬럼 제거(백필 완료 후). SQLite 3.35+ 지원, 실패 시 무시.
      dropColumn(db, 'images', 'embedding');
      dropColumn(db, 'images', 'embedSource');

      db.pragma('user_version = 2');
    });
    tx();
  }
}

/** 임베딩 JSON 컬럼이 남아 있으면 image_embeddings 로 옮긴다. */
function migrateEmbeddings(db: Database.Database): void {
  if (!hasColumn(db, 'images', 'embedding')) return;
  const rows = db
    .prepare(`SELECT id, embedding, embedSource FROM images WHERE embedding != '[]'`)
    .all() as { id: string; embedding: string; embedSource: string }[];
  const ins = db.prepare(
    `INSERT OR REPLACE INTO image_embeddings (imageId, source, model, dim, vector) VALUES (?, ?, ?, ?, ?)`,
  );
  for (const r of rows) {
    let vec: number[];
    try {
      vec = JSON.parse(r.embedding);
    } catch {
      continue;
    }
    if (!Array.isArray(vec) || vec.length === 0) continue;
    const source = r.embedSource || 'taxonomy';
    const f = new Float32Array(vec);
    ins.run(r.id, source, modelForSource(source), vec.length, Buffer.from(f.buffer));
  }
}

export function modelForSource(source: string): string {
  return source === 'clip' ? 'Xenova/clip-vit-base-patch32' : 'taxonomy-v1';
}

// ── 스키마 인트로스펙션 헬퍼 ──
function hasColumn(db: Database.Database, table: string, col: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.some((c) => c.name === col);
}
function addColumn(db: Database.Database, table: string, col: string, def: string): void {
  if (!hasColumn(db, table, col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
function dropColumn(db: Database.Database, table: string, col: string): void {
  if (!hasColumn(db, table, col)) return;
  try {
    db.exec(`ALTER TABLE ${table} DROP COLUMN ${col}`);
  } catch {
    /* 구버전 SQLite: 컬럼 잔존 무해(읽지 않음) */
  }
}
