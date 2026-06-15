# Image Space — 작업 룰

이미지를 다차원 공간에 배치하는 도구. Slash Image v2(`C:\Dev\Slash_image_v2`)와 **동일한
pnpm 모노레포 형식**으로 만들었다 — 나중에 v2 의 `packages/` 로 흡수할 수 있게.

## 시스템 한눈에

pnpm 모노레포. 이미지 입력 → Claude Vision 채점 + 임베딩 → 2D 맵 배치.

| 패키지 | 역할 |
|--------|------|
| `packages/shared` | SSOT — zod 엔티티(`entities.ts`)·**택소노미(`taxonomy.ts`)**·API 경로(`constants.ts`)·PCA(`projection.ts`)·ws(`protocol.ts`) |
| `packages/server` | :8790 — Fastify·DB(better-sqlite3, `data/space.db`)·분석 큐·ws(/ui) |
| `packages/web` | :5174 — React(Vite) 맵·`store.ts`(zustand)·`lib/api.ts` |

**기동**: `pnpm dev:server` / `pnpm dev:web`. 레포루트 `.env` 를 서버가 로드(`config.ts`):
`ANTHROPIC_API_KEY`·`VISION_MODEL`(기본 claude-opus-4-8)·`EMBED_PROVIDER`(clip|taxonomy).

## 핵심 원칙

- **택소노미가 단일 소스**: `shared/src/taxonomy.ts` 의 `SCALAR_DIMENSIONS`(8축)·
  `CATEGORICAL_DIMENSIONS`(4축)만 고치면 Vision 스키마·프롬프트(`vision.ts`)·임베딩 폴백
  (`embed.ts` taxonomyVector)·웹 축/색 UI 가 모두 따라온다. 차원 추가는 여기서 시작한다.
- **하이브리드 분석**: 좌표=임베딩(CLIP 또는 taxonomy 폴백), 라벨=Vision. 둘 다 한 이미지에 붙는다.
- **좌표는 저장하지 않는다**: `/space` 요청 시점에 전체 데이터셋으로 투영(PCA 또는 축 평면).
  데이터셋이 커져도 항상 일관된 배치.
- **Vision 은 강제 tool-use**(`record_analysis`)로 구조화 출력 — 전 모델 버전 호환. 결과는 zod 검증.
- **Anthropic 코드 규칙**: 모델 ID 는 정확한 문자열(`claude-opus-4-8` 등), 날짜 접미사 금지.
  분류는 thinking 생략(빠르고 저렴). 모델 교체는 `VISION_MODEL` env 로.

## 자주 빠지는 함정

- 이미지 base64 POST 는 크다 — 서버 `bodyLimit` 64MB(`index.ts`).
- CLIP(`@huggingface/transformers`)은 기본 미설치. `EMBED_PROVIDER=clip` 이어도 로드 실패 시
  taxonomy 폴백 + 1회 경고. 실제 CLIP 쓰려면 패키지 설치 필요(README 참고).
- `ANTHROPIC_API_KEY` 없으면 분석이 error 상태로 떨어진다(서버 기동 시 경고 출력).
- 패키지 scope 는 `@imgspace/*`(v2 의 `@slash/*` 와 충돌 안 나게) — 흡수 시 그대로 이동 가능.
