/**
 * 평행좌표(Parallel Coordinates) 뷰 — 8개 스칼라 축을 세로선으로 늘어놓고
 * 이미지마다 꺾은선 1개. 다차원을 손실 없이 한 화면에 본다.
 * 색 = colorBy 카테고리 · 선택 강조 · 선 클릭으로 선택.
 */
import { useStore } from '../store.js';
import { labelColor } from '../lib/color.js';

const VB_W = 960;
const VB_H = 540;
const M = { top: 28, right: 48, bottom: 56, left: 48 };

export function ParallelCoords() {
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

  const innerW = VB_W - M.left - M.right;
  const innerH = VB_H - M.top - M.bottom;
  const axisX = (i: number) => M.left + (dims.length === 1 ? innerW / 2 : (innerW * i) / (dims.length - 1));
  const yOf = (v: number) => M.top + innerH * (1 - Math.max(0, Math.min(1, v)));

  const line = (p: (typeof points)[number]) =>
    dims.map((d, i) => `${axisX(i).toFixed(1)},${yOf(p.scores[d.key] ?? 0.5).toFixed(1)}`).join(' ');

  // 선택된 선을 맨 위에 그리도록 정렬.
  const ordered = [...points].sort((a, b) => Number(a.id === selectedId) - Number(b.id === selectedId));

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="xMidYMid meet" className="pcoord-svg">
        {/* 축 */}
        {dims.map((d, i) => {
          const x = axisX(i);
          return (
            <g key={d.key}>
              <line x1={x} y1={M.top} x2={x} y2={M.top + innerH} className="pc-axis" />
              <text x={x} y={M.top - 10} className="pc-hi" textAnchor="middle">{d.high}</text>
              <text x={x} y={M.top + innerH + 16} className="pc-lo" textAnchor="middle">{d.low}</text>
              <text x={x} y={M.top + innerH + 36} className="pc-name" textAnchor="middle">{d.label}</text>
            </g>
          );
        })}
        {/* 데이터 폴리라인 */}
        {ordered.map((p) => {
          const sel = p.id === selectedId;
          const stroke = p.labels[colorBy] ? labelColor(p.labels[colorBy]!) : '#5a6675';
          return (
            <polyline
              key={p.id}
              points={line(p)}
              fill="none"
              stroke={sel ? 'var(--accent)' : stroke}
              strokeWidth={sel ? 3 : 1.4}
              strokeOpacity={sel ? 1 : selectedId ? 0.25 : 0.7}
              className="pc-line"
              onClick={() => select(p.id)}
            >
              <title>{p.caption || p.filename}</title>
            </polyline>
          );
        })}
      </svg>
      <div className="gl-hint">선 클릭 = 선택 · 세로축 = 각 차원(위=높음) · 색 = 카테고리</div>
    </div>
  );
}
