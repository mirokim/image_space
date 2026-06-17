# Image Space → Slash Image v2 통합 계획

> 상태: 제안(Draft) · 작성 2026-06-17 · 대상 레포 `C:\Dev\Slash_image_v2`
> Image Space는 처음부터 v2와 동일한 pnpm 모노레포 형식(`@imgspace/*`)으로 만들어
> v2의 `packages/`로 흡수하는 것을 전제로 한다. 이 문서는 그 흡수 경로를 정의한다.

## 1. 배경 / 목표

- **Image Space**가 제공하는 것: 이미지 → Claude Vision 택소노미 채점(8 스칼라 + 4 카테고리)
  + 임베딩 → 다차원 공간 배치(PCA·축평면·유사도 UMAP 3D·평행좌표·레이더) + k-means 군집.
- **v2의 빈틈**: v2는 ComfyUI 생성 → `conceptBoard`(생성 결과 자동 적재) → `refBoard`(PureRef식
  수동 x/y 그리드)로 이미지를 *쌓고 수동 배치*만 한다. **태그·임베딩·유사도·스타일축·군집이 전무**하다.
  (`embedding`/`similar` 검색 매치는 전부 크로마키·클립보드였음 — 의미 검색은 없음.)
- **목표**: Image Space를 v2의 "의미 레이어(semantic layer)"로 흡수한다. 생성·수집되는 모든
  자산에 스타일 메타데이터를 붙이고, 그 위에 탐색·유사도·자동정렬·일관성 검사를 얹는다.

## 2. v2 아키텍처 매핑(현황 근거)

| v2 구성 | 역할 | Image Space 접점 |
|--------|------|------------------|
| `packages/shared` (`@slash/shared`) | zod 엔티티·blobstore·protocol | projection·taxonomy 이식 대상 |
| `packages/job-server` | 백엔드: `db`(jsonStore)·`bus`/`uiChannel`(ws)·`conceptBoard`·`refBoard`·`orchestrator`·`mcp`·`claudeAuth` | 분석 큐·공간 계산 흡수 대상 |
| `packages/worker-agent` + `comfyui-wrapper` | ComfyUI 생성 워커 | **실제 CLIP 임베딩** 추출 경로(업그레이드) |
| `packages/web` | React UI(ActivityBar·RefBoard·`Space3D`(splat)·store) | SpaceMap/평행좌표/레이더 뷰 이식 |
| `packages/desktop` | Electron 셸 | 변화 없음 |

핵심 엔티티(이미 존재):
- `Artifact { kind: image|video, blobId, projectId, panelId, meta: Record }` — **`meta`가 자유 레코드라
  스키마 마이그레이션 없이 분석 결과를 실을 수 있다.**
- `RefBoard / RefBoardItem { x,y,w,h,rotation,z,... }` — 수동 보드(자동정렬 대상).
- `Plan.styleLock`, `Take.refBlobIds` — 스타일 일관성·레퍼런스 워크플로 접점.
- `conceptBoard`: `artifactNew(kind=image)` 훅으로 "생성 컨셉" RefBoard에 자동 적재 — **분석 훅의 자연스러운 자리.**

## 3. 활용 방향 (가치·적합도 순)

1. **모든 Artifact 자동 태깅(기반).** `conceptBoard`의 `artifactNew` 훅에 분석을 붙여
   스타일 메타(8축 점수·형식/장르/매체/사조·임베딩)를 `Artifact.meta.analysis`에 적재.
2. **Space 뷰.** ActivityBar 새 탭에서 프로젝트 자산을 군집·유사도로 탐색(그리드 스크롤 대체).
3. **레퍼런스 워크플로.** `findSimilar`/택소노미로 "비슷한 레퍼런스", "스타일 공간 다양화 샘플링",
   "프로젝트 스타일 drift 감지"(기존 Critique와 결합).
4. **RefBoard 자동 정렬.** `similarityLayout`/`kmeans`로 보드를 닮음 기준 자동 배치(수동 그리드 보완).
5. **스타일 일관성 가드레일.** `Plan.styleLock` 앵커 대비 신규 프레임 채점 → 스토리보드 이탈 샷 플래그.

## 4. 흡수 경로 (기술)

### 4.1 패키지 이동 맵
- `@imgspace/shared`의 **`projection.ts`(PCA/UMAP/kmeans/normalize — 순수·무의존)** → `@slash/shared`로 드롭인.
- `@imgspace/shared`의 **`taxonomy.ts`** → `@slash/shared`로 이동. v2 전역 태깅 스키마(SSOT)로 승격.
  - 주의: v2의 `entities.ts`와 이름 충돌 없도록 `taxonomy.ts`로 분리 유지. `buildAnalysisSchema()` 그대로.
- **분석 로직**(`vision.ts`·`embed.ts`)·**공간 계산**(`space.ts`) → `job-server`의 새 모듈
  (`analysis.ts`·`space.ts`)로. **독립 서버/sqlite는 가져오지 않는다** — v2의 `db`(jsonStore)·`bus`·`uiChannel` 사용.
- **web 컴포넌트**(`SpaceMap`·`ParallelCoords`·`RadarGlyphs`) → v2 `packages/web`의 새 뷰로.
  토큰은 이미 v2에서 가져와 공유 중 → 스타일 드롭인.

### 4.2 데이터 모델
- `Artifact.meta.analysis = { scores, labels, caption, embedding, embedSource, taxonomyVersion }`
  로 적재(스키마 무변경). 검색·필터가 잦아지면 1급 옵셔널 필드로 승격 검토.
- 좌표는 **저장하지 않는다**(Image Space 원칙 유지) — `/space` 요청 시점에 프로젝트 자산 전체로 투영.
- 임베딩 캐시는 v2 `db`에, 투영 캐시는 메모리/`ProjectionCache` 패턴 그대로.

### 4.3 분석 트리거
- 1차: `conceptBoard`의 `artifactNew(image)` 후처리 훅에서 enqueue(동시성 제한 유지).
- 분석은 로컬 Claude CLI 기반 → v2 `claudeAuth`/mainbot 인프라와 호환. 새 job 타입으로 둘지,
  렌더 파이프라인 후처리로 둘지는 §6 결정.

### 4.4 임베딩 소스
- 시작: **taxonomy 폴백**(인프라 0, 지금 동작). 
- 업그레이드: v2 `worker-agent`/`comfyui-wrapper`에 CLIP 추출 노드를 두고 실제 CLIP 벡터 적재 →
  유사도/군집 품질 향상. `embedSource`로 구분, 차원 혼합 방지 로직(이미 있음) 그대로.

## 5. 단계별 로드맵 (수직 슬라이스)

- **P0 — 공유 이식**: `projection.ts`·`taxonomy.ts`를 `@slash/shared`로. 타입체크 통과. (반나절)
- **P1 — 자동 태깅**: job-server `analysis` 모듈 + `conceptBoard` 훅 → `Artifact.meta.analysis` 적재,
  `uiChannel`로 진행 푸시. (1~2일)
- **P2 — Space 뷰**: web ActivityBar 탭 + `/space` 엔드포인트(프로젝트 스코프) + SpaceMap/평행좌표/레이더. (2~3일)
- **P3 — 유사도/자동정렬**: `findSimilar` API + RefBoard "닮음 자동 배치" 액션. (1~2일)
- **P4 — 일관성 가드레일**: styleLock 앵커 대비 drift 점수 → 스토리보드/Critique 노출. (2일)

각 단계가 독립 출시 가능. P0→P1→P2가 핵심 슬라이스, P3·P4는 같은 데이터 위 증분.

## 6. 결정 필요 사항 (권고 포함)

| 결정 | 옵션 | 권고 |
|------|------|------|
| 임베딩 소스 | taxonomy 폴백 / 실제 CLIP(worker) | 폴백으로 시작, P3 이후 CLIP 업그레이드 |
| 분석 범위 | 전 Artifact 자동 / 온디맨드·배치 | 자동(동시성 제한) + 수동 재분석 버튼 |
| Space 뷰 범위 | 프로젝트별 / 전역 라이브러리 | 프로젝트별 우선(데이터·권한 단순) |
| 패키징 | `@imgspace` 별도 유지 / `@slash/shared` 병합 | shared는 병합, 분석·뷰는 v2 모듈로 |
| 태깅 저장 | `Artifact.meta` / 1급 필드 | meta로 시작, 검색 빈번해지면 승격 |

## 7. 리스크 / 주의

- **비용**: 자산마다 Claude CLI 분석 → 대량 생성 프로젝트에서 호출량↑. 동시성 제한·중복 해시 스킵·
  재분석 수동화로 완화.
- **임베딩 차원 혼합**: taxonomy(47D) ↔ CLIP(512D) 혼재 시 투영 깨짐 → 이미 `embedSource:dim` 최빈 그룹만
  쓰는 로직 존재. 이식 시 유지.
- **택소노미 버전**: 차원 정의 변경 시 `taxonomyVersion`으로 추적(옛 자산 0.5 폴백). v2 자산에도 동일 적용.
- **scope 충돌**: `@imgspace/*` → `@slash/*` 이동 시 import 경로 일괄 변경. shared만 병합하면 표면 최소.

## 8. 진행 상태 (v2 브랜치 `feat/imgspace-integration`)

- [x] **P0 공유 이식** (`d045414`) — `taxonomy.ts`·`projection.ts` → `@slash/shared`. 타입체크 통과.
- [x] **P1 자동 태깅** (`50e6c50`) — `analysis.ts`(artifactNew→Claude CLI 채점+임베딩→`meta.analysis`),
  `db.setArtifactAnalysis`, index 등록. 동시성 1·중복 스킵·킬스위치(`IMGSPACE_ANALYZE=0`)·목업 폴백.
- [x] **P2 Space 뷰** (`d44b758`) — shared Space 타입 + `buildProjectSpace`/`findSimilarInProject` +
  `/imgspace/*` 라우트 + web ActivityBar 탭/뷰(SpaceMap·평행좌표·레이더). 3패키지 타입체크 + vite build 통과.
- [ ] **P3 유사도/자동정렬 UI** — `/imgspace/.../similar` 엔드포인트는 완료. RefBoard "닮음 자동 배치"·
  선택 패널 "비슷한 자산" UI 연결 남음.
- [ ] **P4 일관성 가드레일** — `Plan.styleLock` 앵커 대비 drift 점수 → 스토리보드/Critique 노출.

**남은 결정**: 임베딩 CLIP 업그레이드(worker), 분석 자동 범위(현재 기본 ON·킬스위치), 패키징 최종.
