import { useStore, type SpaceMode } from '../store.js';
import { api } from '../lib/api.js';
import { labelColor } from '../lib/color.js';
import { UploadZone } from './UploadZone.js';

const MODES: { key: SpaceMode; label: string; info: string }[] = [
  { key: 'pca', label: 'PCA', info: '512D → 3 주성분' },
  { key: 'axes', label: '축 평면', info: '고른 3개 차원 축' },
  { key: 'sim', label: '유사도', info: '512D → 이웃 (UMAP 3D)' },
  { key: 'pcoord', label: '평행좌표', info: '8개 스칼라 축을 한 화면에' },
  { key: 'radar', label: '레이더', info: '점별 8축 프로필 글리프' },
];

export function Sidebar() {
  const {
    taxonomy, mode, xAxis, yAxis, zAxis, colorBy,
    setMode, setAxes, setColorBy, items, selectedId, neighbors, select, remove, connected,
  } = useStore();

  const scalarOpts = taxonomy?.scalar ?? [];
  const catOpts = taxonomy?.categorical ?? [];
  const colorDim = catOpts.find((d) => d.key === colorBy);
  const selected = selectedId ? items[selectedId] : null;
  const modeInfo = MODES.find((m) => m.key === mode)?.info ?? '';
  // 좌표축은 pca/axes 에서만 의미가 있다(sim·평행좌표·레이더는 좌표를 안 씀).
  const axesDisabled = mode !== 'pca' && mode !== 'axes';
  const isChart = mode === 'pcoord' || mode === 'radar';

  const list = Object.values(items);
  const ready = list.filter((i) => i.status === 'ready').length;
  const working = list.filter((i) => i.status === 'analyzing' || i.status === 'pending').length;
  const errored = list.filter((i) => i.status === 'error').length;

  return (
    <aside className="sidebar">
      <h1>
        <span className={`dot${connected ? ' on' : ''}`} /> Image Space
      </h1>
      <div className="status-line">
        준비 {ready} · 분석중 {working} · 오류 {errored}
      </div>

      <UploadZone />

      {/* 보기 모드 */}
      <div>
        <div className="section-title">보기 모드</div>
        <div className="seg">
          {MODES.map((m) => (
            <button
              key={m.key}
              className={`seg-i${mode === m.key ? ' on' : ''}`}
              onClick={() => setMode(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>{modeInfo}</div>
      </div>

      {/* 축 선택 (3D) — sim 모드에선 좌표가 없어 비활성 */}
      <div style={axesDisabled ? { opacity: 0.4, pointerEvents: 'none' } : undefined}>
        <div className="section-title">공간 축 (3D)</div>
        {(['x', 'y', 'z'] as const).map((axis) => {
          const cur = axis === 'x' ? xAxis : axis === 'y' ? yAxis : zAxis;
          const onChange = (v: string) =>
            setAxes(
              axis === 'x' ? v : xAxis,
              axis === 'y' ? v : yAxis,
              axis === 'z' ? v : zAxis,
            );
          return (
            <div className="field" key={axis}>
              <label>{axis === 'x' ? 'X · 가로' : axis === 'y' ? 'Y · 세로' : 'Z · 깊이'}</label>
              <select value={cur} onChange={(e) => onChange(e.target.value)} disabled={axesDisabled}>
                <option value="pca">자동(임베딩 PCA)</option>
                {scalarOpts.map((d) => (
                  <option key={d.key} value={d.key}>{d.label}</option>
                ))}
              </select>
            </div>
          );
        })}
        <div className="muted" style={{ fontSize: 11 }}>
          {mode === 'sim'
            ? '유사도 모드는 좌표축이 없습니다 — 거리가 곧 닮음입니다.'
            : isChart
              ? '평행좌표·레이더는 좌표축 대신 8개 스칼라 차원을 직접 그립니다.'
              : 'X·Y에 차원을 고르면 그 축으로 배치(Z는 선택), 둘 중 하나라도 "자동"이면 임베딩 PCA를 3D로 축소합니다.'}
        </div>
      </div>

      {/* 색상 */}
      <div>
        <div className="section-title">색상 기준</div>
        <div className="field">
          <select value={colorBy} onChange={(e) => setColorBy(e.target.value)}>
            {catOpts.map((d) => (
              <option key={d.key} value={d.key}>{d.label}</option>
            ))}
          </select>
        </div>
        {colorDim && (
          <div className="legend">
            {colorDim.options.map((o) => (
              <span className="chip" key={o.value}>
                <span className="swatch" style={{ background: labelColor(o.value) }} />
                {o.label}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 인코딩 채널 안내 */}
      <div>
        <div className="section-title">인코딩 채널</div>
        <div className="muted" style={{ fontSize: 11, lineHeight: 1.6 }}>
          {isChart
            ? '평행좌표/레이더는 8개 스칼라 차원을 한 번에 그립니다 · 색 = ' + (colorDim?.label ?? '형식') + '.'
            : '위치 = ' + (mode === 'sim' ? '유사도' : '좌표') + ' · 색 = ' + (colorDim?.label ?? '형식') +
              ' · 크기 = 디테일 · 투명도 = 명도 · 안쪽 링 = 장르. 한 화면이 7차원을 동시에 나릅니다.'}
        </div>
      </div>

      {/* 선택 상세 */}
      {selected && (
        <div className="detail">
          <img src={api.blobUrl(selected.blobId)} alt={selected.filename} />
          <div className="caption">{selected.caption || selected.filename}</div>
          {selected.status === 'ready' ? (
            <>
              {scalarOpts.map((d) => (
                <div className="bar" key={d.key}>
                  <span className="name">{d.label}</span>
                  <span className="track">
                    <span className="fill" style={{ width: `${(selected.scores[d.key] ?? 0) * 100}%` }} />
                  </span>
                </div>
              ))}
              <div className="tags">
                {catOpts.map((d) => {
                  const val = selected.labels[d.key];
                  const opt = d.options.find((o) => o.value === val);
                  return (
                    <span className="tag" key={d.key} style={{ borderColor: val ? labelColor(val) : undefined }}>
                      {d.label}: {opt?.label ?? '—'}
                    </span>
                  );
                })}
              </div>
              {neighbors.length > 0 && (
                <div className="similar">
                  <div className="section-title" style={{ marginTop: 12 }}>가까운 작품</div>
                  <div className="sim-grid">
                    {neighbors.map((nb) => (
                      <button key={nb.id} className="sim-cell" onClick={() => select(nb.id)} title={nb.caption}>
                        <img src={api.blobUrl(nb.blobId)} alt={nb.filename} />
                        <span className="sim-score">{nb.score.toFixed(2)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="muted">상태: {statusLabel(selected.status)}{selected.error ? ` — ${selected.error}` : ''}</div>
          )}
          <div style={{ marginTop: 10 }}>
            <button className="btn" onClick={() => void remove(selected.id)}>삭제</button>
          </div>
        </div>
      )}
    </aside>
  );
}

function statusLabel(s: string): string {
  return { pending: '대기', analyzing: '분석 중', ready: '준비', error: '오류' }[s] ?? s;
}
