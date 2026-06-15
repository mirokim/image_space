# Image Space

이미지를 입력하면 **다차원 공간에 배치**하는 도구. 각 이미지를 Claude Vision으로
형식·장르·무드 등 명명된 차원으로 채점하고(하이브리드 분석), 임베딩 좌표로 2D 맵에
펼쳐 비슷한 이미지끼리 모이게 한다.

> Slash Image v2 와 동일한 pnpm 모노레포 형식 — 나중에 v2 의 `packages/` 로 흡수 가능.

## 구조

| 패키지 | 역할 |
|--------|------|
| `packages/shared` | SSOT — `taxonomy.ts`(차원 정의)·`entities.ts`(zod)·`projection.ts`(PCA)·`constants.ts`(API)·`protocol.ts`(ws) |
| `packages/server` | :8790 — Fastify·better-sqlite3(`data/space.db`)·분석 파이프라인(Vision+임베딩)·ws(/ui) |
| `packages/web` | :5174 — React(Vite) 인터랙티브 산점도 맵·zustand |

## 차원 택소노미

- **스칼라 8축**(0~1, 공간 좌표 후보): 사실성·복잡도·색채도·명도·색온도·역동성·디테일·정서
- **카테고리 4축**(택1, 색/패싯): 형식·장르·매체·사조

`packages/shared/src/taxonomy.ts` 가 단일 소스. 차원을 추가하면 Vision 채점 스키마·프롬프트·
임베딩 폴백·웹 축 선택 UI 가 자동으로 따라온다.

## 분석 파이프라인 (하이브리드)

1. **임베딩** → 좌표. `EMBED_PROVIDER=clip` 이면 CLIP 이미지 임베딩(512D),
   미설치 시 `taxonomy`(Vision 점수에서 만든 특징 벡터)로 자동 폴백.
2. **Vision** → 라벨/점수. Claude(`VISION_MODEL`, 기본 `claude-opus-4-8`)가 강제 tool-use로
   택소노미 차원을 채점.
3. **투영** → `/space` 요청 시 임베딩을 PCA 2D로 축소(`mode=pca`)하거나,
   스칼라 두 축을 직접 평면으로(`mode=axes`).

## 실행

```bash
pnpm install
cp .env.example .env   # ANTHROPIC_API_KEY 입력
pnpm dev:server        # :8790
pnpm dev:web           # :5174  (다른 터미널)
```

브라우저에서 http://127.0.0.1:5174 → 이미지를 끌어다 놓으면 분석 후 맵에 배치된다.

### CLIP 임베딩 활성화(선택)

```bash
pnpm --filter @imgspace/server add @huggingface/transformers
# .env: EMBED_PROVIDER=clip  (최초 1회 모델 다운로드)
```
