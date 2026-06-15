/**
 * BlobStore — 원본 이미지 바이트 저장 추상화(로컬 디스크).
 * 브라우저 번들에 node:fs 가 새지 않도록 "." 진입점이 아닌
 * "@imgspace/shared/blobstore" 서브패스로 분리 export 한다.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export interface BlobMeta {
  ext?: string;
  /** 사람이 읽는 파일명 접두. slug 후 -<uuid8> 부착. */
  name?: string;
}

export interface PutResult {
  blobId: string;
  size: number;
}

/** 파일명 안전 slug(영숫자/한글 유지). */
function slug(s: string): string {
  return (
    s
      .normalize('NFC')
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'image'
  );
}

export class LocalBlobStore {
  root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
    mkdirSync(this.root, { recursive: true });
  }

  private resolve(blobId: string): string {
    const p = path.resolve(this.root, blobId);
    if (p !== this.root && !p.startsWith(this.root + path.sep)) {
      throw new Error(`blob path escape: ${blobId}`);
    }
    return p;
  }

  put(data: Uint8Array, meta: BlobMeta = {}): PutResult {
    const ext = (meta.ext ?? 'bin').replace(/^\./, '');
    const u8 = randomUUID().slice(0, 8);
    const base = meta.name ? `${slug(meta.name)}-${u8}` : randomUUID();
    const blobId = `${base}.${ext}`;
    const dest = this.resolve(blobId);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, data);
    return { blobId, size: data.byteLength };
  }

  read(blobId: string): Buffer {
    return readFileSync(this.resolve(blobId));
  }

  path(blobId: string): string {
    return this.resolve(blobId);
  }

  exists(blobId: string): boolean {
    return existsSync(this.resolve(blobId));
  }

  size(blobId: string): number {
    return statSync(this.resolve(blobId)).size;
  }
}

/** 확장자/파일명 → MIME. */
export function mimeFromExt(nameOrExt: string): string {
  const ext = nameOrExt.toLowerCase().split('.').pop() ?? '';
  return (
    (
      {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        webp: 'image/webp',
        gif: 'image/gif',
      } as Record<string, string>
    )[ext] ?? 'application/octet-stream'
  );
}

/** MIME → 확장자. */
export function extFromMime(mime: string): string {
  return (
    (
      {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/webp': 'webp',
        'image/gif': 'gif',
      } as Record<string, string>
    )[mime] ?? 'png'
  );
}
