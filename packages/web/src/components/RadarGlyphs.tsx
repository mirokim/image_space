/**
 * 레이더 글리프 뷰 — 이미지 1개를 8축 미니 레이더 차트로 그린다.
 * 개별 작품의 다차원 프로필을 직관적으로 비교. 색 = colorBy · 클릭으로 선택.
 */
import { useStore } from '../store.js';
import { api } from '../lib/api.js';
import { labelColor } from '../lib/color.js';

const SZ = 132; // 글리프 한 변
const C = SZ / 2;
const R = SZ / 2 - 22; // 레이더 반경

export function RadarGlyphs() {
  const space = useStore((s) => s.space);
  const taxonomy = useStore((s) => s.taxonomy);
  const colorBy = useStore((s) => s.colorBy);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);

  const dims = taxonomy?.scalar ?? [];
  const points = space?.points ?? [];

  if (dims.length === 0 || points.length === 0) {
    return (
      <div className="chart-wrap">
        <div className="map-hint">아직 분석된 이미지가 없습니다. 왼쪽에서 이미지를 추가하세요.</div>
      </div>
    );
  }

  const n = dims.length;
  const angle = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2; // 12시 방향 시작
  const pt = (i: number, r: number) => `${(C + r * Math.cos(angle(i))).toFixed(1)},${(C + r * Math.sin(angle(i))).toFixed(1)}`;

  return (
    <div className="chart-wrap radar-scroll">
      <div className="radar-grid">
        {points.map((p) => {
          const sel = p.id === selectedId;
          const color = p.labels[colorBy] ? labelColor(p.labels[colorBy]!) : '#5a6675';
          const poly = dims.map((d, i) => pt(i, R * Math.max(0, Math.min(1, p.scores[d.key] ?? 0.5)))).join(' ');
          const ring = dims.map((_, i) => pt(i, R)).join(' ');
          return (
            <button
              key={p.id}
              className={`radar-cell${sel ? ' selected' : ''}`}
              onClick={() => select(p.id)}
              title={p.caption || p.filename}
            >
              <svg viewBox={`0 0 ${SZ} ${SZ}`} className="radar-svg">
                <polygon points={ring} className="radar-ring" />
                {dims.map((_, i) => (
                  <line key={i} x1={C} y1={C} x2={pt(i, R).split(',')[0]} y2={pt(i, R).split(',')[1]} className="radar-spoke" />
                ))}
                <polygon points={poly} fill={color} fillOpacity={0.35} stroke={color} strokeWidth={1.6} />
              </svg>
              <img src={api.blobUrl(p.blobId)} alt={p.filename} className="radar-thumb" style={{ borderColor: color }} />
              <span className="radar-cap">{p.caption || p.filename}</span>
            </button>
          );
        })}
      </div>
      <div className="gl-hint">글리프 = 8축 프로필 · 칸 클릭 = 선택 · 테두리색 = 카테고리</div>
    </div>
  );
}
