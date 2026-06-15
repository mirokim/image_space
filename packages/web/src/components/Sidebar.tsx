import { useStore } from '../store.js';
import { api } from '../lib/api.js';
import { labelColor } from '../lib/color.js';
import { UploadZone } from './UploadZone.js';

export function Sidebar() {
  const { taxonomy, xAxis, yAxis, zAxis, colorBy, setAxes, setColorBy, items, selectedId, remove, connected } =
    useStore();

  const scalarOpts = taxonomy?.scalar ?? [];
  const catOpts = taxonomy?.categorical ?? [];
  const colorDim = catOpts.find((d) => d.key === colorBy);
  const selected = selectedId ? items[selectedId] : null;

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

      {/* 업로드 */}
      <UploadZone />

      {/* 축 선택 (3D) */}
      <div>
        <div className="section-title">공간 축 (3D)</div>
        <div className="field">
          <label>X · 가로</label>
          <select value={xAxis} onChange={(e) => setAxes(e.target.value, yAxis, zAxis)}>
            <option value="pca">자동(임베딩 PCA)</option>
            {scalarOpts.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Y · 세로</label>
          <select value={yAxis} onChange={(e) => setAxes(xAxis, e.target.value, zAxis)}>
            <option value="pca">자동(임베딩 PCA)</option>
            {scalarOpts.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Z · 깊이</label>
          <select value={zAxis} onChange={(e) => setAxes(xAxis, yAxis, e.target.value)}>
            <option value="pca">자동(임베딩 PCA)</option>
            {scalarOpts.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
        <div className="muted" style={{ fontSize: 11 }}>
          X·Y에 차원을 고르면 그 축으로 배치(Z는 선택), 둘 중 하나라도 "자동"이면 임베딩 PCA를 3D로 축소합니다.
        </div>
      </div>

      {/* 색상 */}
      <div>
        <div className="section-title">색상 기준</div>
        <div className="field">
          <select value={colorBy} onChange={(e) => setColorBy(e.target.value)}>
            {catOpts.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
              </option>
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
            </>
          ) : (
            <div className="muted">상태: {statusLabel(selected.status)}{selected.error ? ` — ${selected.error}` : ''}</div>
          )}
          <div style={{ marginTop: 10 }}>
            <button className="btn" onClick={() => void remove(selected.id)}>
              삭제
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}

function statusLabel(s: string): string {
  return { pending: '대기', analyzing: '분석 중', ready: '준비', error: '오류' }[s] ?? s;
}
