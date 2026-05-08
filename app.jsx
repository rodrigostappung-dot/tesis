const { useState, useEffect, useMemo, useRef, useCallback } = React;

const STORAGE_KEY = 'tesis_ensayos_v2';
const LANG_KEY = 'tesis_lang_v1';

const PRELOAD_FLAG = 'tesis_preload_v3_applied';
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.results && parsed.mixMeta) {
        // Apply preload data if it hasn't been merged before
        if (window.PRELOAD_STATE && !localStorage.getItem(PRELOAD_FLAG)) {
          for (const mix in window.PRELOAD_STATE.results) {
            // Flexion / compression: parsed file data + dimensions/weight
            for (const test of ['flexion', 'compression']) {
              const preSpecs = window.PRELOAD_STATE.results[mix][test];
              for (const ps of preSpecs) {
                const slot = parsed.results[mix][test].find(s => s.id === ps.id);
                if (!slot) continue;
                // File data: only fill if empty
                if (ps.parsed && ps.parsed.pmax > 0 && !(slot.parsed && slot.parsed.pmax > 0)) {
                  slot.file = ps.file; slot.parsed = ps.parsed; slot.testDate = ps.testDate || slot.testDate;
                }
                // Dimensions/weight: only fill if empty
                for (const k of ['length', 'height', 'width', 'weight']) {
                  if ((slot[k] == null || slot[k] === '') && ps[k] != null && ps[k] !== '') {
                    slot[k] = ps[k];
                  }
                }
              }
            }
            // Retraction: replace empty value arrays with preload values
            const preRetr = window.PRELOAD_STATE.results[mix].retraction;
            if (preRetr) {
              for (const ps of preRetr) {
                const slot = parsed.results[mix].retraction.find(s => s.id === ps.id);
                if (!slot) continue;
                for (const age of [0, 1, 7, 28]) {
                  const preVals = ps.values && ps.values[age];
                  const curVals = slot.values && slot.values[age];
                  const isEmpty = !curVals || (Array.isArray(curVals) ? curVals.every(v => v === '' || v == null) : (curVals === '' || curVals == null));
                  if (preVals && preVals.length > 0 && isEmpty) {
                    if (!slot.values) slot.values = {};
                    slot.values[age] = preVals;
                  }
                }
              }
            }
          }
          // mixMeta: castDate / castMoment if empty
          for (const mix in window.PRELOAD_STATE.mixMeta) {
            const pre = window.PRELOAD_STATE.mixMeta[mix];
            if (!parsed.mixMeta[mix]) parsed.mixMeta[mix] = {};
            for (const k of ['castDate', 'castMoment']) {
              if (pre[k] && (parsed.mixMeta[mix][k] == null || parsed.mixMeta[mix][k] === '')) {
                parsed.mixMeta[mix][k] = pre[k];
              }
            }
          }
          localStorage.setItem(PRELOAD_FLAG, '1');
        }
        return parsed;
      }
    }
  } catch (e) {}
  if (window.PRELOAD_STATE) {
    localStorage.setItem(PRELOAD_FLAG, '1');
    return window.PRELOAD_STATE;
  }
  return { results: window.makeEmptyResults(), mixMeta: window.makeEmptyMixMeta() };
}

function saveState(state) {
  try {
    const compact = JSON.parse(JSON.stringify(state));
    for (const m in compact.results) {
      for (const t of ['flexion', 'compression']) {
        for (const r of compact.results[m][t]) {
          if (r.parsed && r.parsed.points && r.parsed.points.length > 500) {
            const step = Math.ceil(r.parsed.points.length / 500);
            r.parsed.points = r.parsed.points.filter((_, i) => i % step === 0);
          }
        }
      }
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(compact));
  } catch (e) {
    console.warn('Storage error', e);
  }
}

function MiniCurve({ points, pmax, idxPmax }) {
  if (!points || points.length === 0) return null;
  const W = 200, H = 60, padL = 4, padR = 4, padT = 6, padB = 4;
  const xs = points.map(p => p.disp || p.strain || p.t);
  const ys = points.map(p => p.load);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = 0, yMax = Math.max(...ys, pmax || 0);
  const sx = (x) => padL + ((x - xMin) / (xMax - xMin || 1)) * (W - padL - padR);
  const sy = (y) => H - padB - ((y - yMin) / (yMax - yMin || 1)) * (H - padT - padB);
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(xs[i]).toFixed(1)},${sy(ys[i]).toFixed(1)}`).join(' ');
  const peakX = xs[idxPmax] != null ? sx(xs[idxPmax]) : null;
  const peakY = peakX != null ? sy(pmax) : null;
  return (
    <svg className="curve-mini" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <line className="axis" x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} />
      <line className="axis" x1={padL} y1={padT} x2={padL} y2={H - padB} />
      <path className="data" d={d} />
      {peakX != null && <circle className="peak" cx={peakX} cy={peakY} r="2" />}
    </svg>
  );
}

function FactorialPanel({ T, lang }) {
  const factors = ['BR', 'SFD', 'AFD', 'SFL', 'AFL', 'T'];
  return (
    <details className="design-panel">
      <summary>{T.factors} · {T.legend}</summary>
      <div className="design-body">
        <table className="factorial">
          <thead>
            <tr>
              <th>Run</th>
              {factors.map(f => <th key={f}>{T['factor_' + f]}</th>)}
            </tr>
          </thead>
          <tbody>
            {window.FACTORIAL_DESIGN.map(row => {
              const isCenter = row.run === 45;
              return (
                <tr key={row.run}>
                  <td className={'run' + (isCenter ? ' center' : '')}>{row.run}{isCenter ? '×3' : ''}</td>
                  {factors.map(f => {
                    const v = row[f];
                    const cls = v === '+' ? 'plus' : v === '-' ? 'minus' : v === '0' ? 'zero' : '';
                    return <td key={f} className={cls}>{v === '+' ? '+' : v === '-' ? '−' : v}</td>;
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="legend-row">
          <span><span className="swatch" style={{background:'var(--plus-bg)'}}></span>{T.high}</span>
          <span><span className="swatch" style={{background:'var(--minus-bg)'}}></span>{T.low}</span>
          <span><span className="swatch" style={{background:'var(--zero-bg)'}}></span>{T.center}</span>
        </div>
      </div>
    </details>
  );
}

// ----- RETRACCIÓN: tabla de probetas (filas) × edades (columnas), expandible -----
function ShrinkageTable({ specimens, onUpdate, T }) {
  const ages = window.SHRINKAGE_AGES;
  const [expanded, setExpanded] = useState(false);

  const colStats = ages.map(a => {
    const all = [];
    specimens.forEach(s => {
      const arr = Array.isArray(s.values[a]) ? s.values[a] : [s.values[a]];
      arr.forEach(v => { const n = parseFloat(v); if (!isNaN(n)) all.push(n); });
    });
    if (all.length === 0) return null;
    const avg = all.reduce((x, y) => x + y, 0) / all.length;
    return { avg, n: all.length };
  });

  return (
    <div className="shrink-table-wrap">
      <div className="shrink-toolbar">
        <button onClick={() => setExpanded(!expanded)} className="expand-btn">
          {expanded ? '▾ ' : '▸ '}{expanded ? T.collapse || 'Colapsar' : T.expandAll || 'Ver 12 mediciones'}
        </button>
      </div>
      <table className="shrink-table">
        <thead>
          <tr>
            <th>{T.specimen}</th>
            {ages.map(a => <th key={a}>{a} {a === 1 ? T.day : T.days}</th>)}
          </tr>
        </thead>
        <tbody>
          {specimens.map((spec, i) => {
            const stats = ages.map(a => window.shrinkAvg(spec, a));
            return (
              <React.Fragment key={spec.id}>
                <tr>
                  <td className="spec-id">{spec.id}</td>
                  {ages.map((a, j) => (
                    <td key={a} className={stats[j] ? 'has-val' : 'empty'}>
                      {stats[j] ? stats[j].avg.toFixed(0) : '—'}
                      {stats[j] && stats[j].n > 1 && <span className="n-badge">n={stats[j].n}</span>}
                    </td>
                  ))}
                </tr>
                {expanded && Array.from({length: 12}).map((_, k) => (
                  <tr key={k} className="reading-row">
                    <td className="reading-label">{spec.id}<sub>{k+1}</sub></td>
                    {ages.map(a => {
                      const arr = Array.isArray(spec.values[a]) ? spec.values[a] : [];
                      return (
                        <td key={a}>
                          <input type="number" step="any" value={arr[k] ?? ''}
                            placeholder="—"
                            onChange={(e) => {
                              const next = specimens.map(s => ({ ...s, values: { ...s.values } }));
                              const tgt = next[i];
                              if (!Array.isArray(tgt.values[a])) tgt.values[a] = [];
                              tgt.values[a] = [...tgt.values[a]];
                              tgt.values[a][k] = e.target.value;
                              onUpdate(next);
                            }} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </React.Fragment>
            );
          })}
          <tr className="avg-row">
            <td>{T.avg} (A+B)</td>
            {colStats.map((s, i) => (
              <td key={i} className={s ? 'has-val' : 'empty'}>{s ? s.avg.toFixed(0) : '—'}</td>
            ))}
          </tr>
        </tbody>
      </table>
      <div className="shrink-units">μm/m</div>
    </div>
  );
}

// ----- TARJETA DE PROBETA MECÁNICA (flexión / compresión) -----
function MechSpecimenCard({ specimen, onUpdate, T }) {
  const inputRef = useRef(null);
  const [drag, setDrag] = useState(false);
  const [parsing, setParsing] = useState(false);

  const handleFile = async (file) => {
    if (!file) return;
    setParsing(true);
    try {
      const text = await file.text();
      const parsed = window.parseTestFile(text);
      onUpdate({ ...specimen, file: { name: file.name, size: file.size }, parsed });
    } catch (e) {
      console.error(e);
      alert(T.parseError + ': ' + e.message);
    }
    setParsing(false);
  };

  const onDrop = (e) => {
    e.preventDefault(); setDrag(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  const removeFile = () => {
    if (!confirm(T.confirmDelete)) return;
    onUpdate({ ...specimen, file: null, parsed: null });
  };

  const updateField = (k, v) => onUpdate({ ...specimen, [k]: v });
  const hasData = specimen.parsed && specimen.parsed.pmax > 0;

  return (
    <div className={'replica-card' + (hasData ? ' has-data' : '')}>
      <div className="rep-header">
        <span className="rep-num">{T.specimen} {specimen.id}</span>
        <span className="age-pill">{specimen.age} {specimen.age === 1 ? T.day : T.days}</span>
      </div>

      {!specimen.file ? (
        <label
          className={'drop-zone' + (drag ? ' dragover' : '')}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
        >
          <div className="icon">⤓</div>
          <div>{parsing ? T.parsing : T.dropHere}</div>
          <input ref={inputRef} type="file" accept=".txt"
            onChange={(e) => handleFile(e.target.files[0])} />
        </label>
      ) : (
        <>
          <div className="file-info">
            <span className="fname" title={specimen.file.name}>{specimen.file.name}</span>
            <button onClick={removeFile} title={T.delete}>✕</button>
          </div>
          {specimen.parsed && (
            <>
              <MiniCurve points={specimen.parsed.points} pmax={specimen.parsed.pmax} idxPmax={specimen.parsed.idxPmax} />
              <div className="metrics-row">
                <div className="metric"><span className="k">{T.pmax}</span><span className="v big">{specimen.parsed.pmax.toFixed(2)}</span></div>
                <div className="metric"><span className="k">{T.smax}</span><span className="v big">{specimen.parsed.smax.toFixed(1)}</span></div>
                <div className="metric"><span className="k">{T.points}</span><span className="v">{specimen.parsed.nPoints}</span></div>
              </div>
            </>
          )}
        </>
      )}

      <div className="input-grid">
        <input placeholder={T.length} value={specimen.length}
          onChange={(e) => updateField('length', e.target.value)} />
        <input placeholder={T.height} value={specimen.height}
          onChange={(e) => updateField('height', e.target.value)} />
        <input placeholder={T.width} value={specimen.width}
          onChange={(e) => updateField('width', e.target.value)} />
      </div>
      <input className="text-input" placeholder={T.weight} value={specimen.weight}
        onChange={(e) => updateField('weight', e.target.value)} />
      <input className="text-input" type="date" value={specimen.testDate}
        onChange={(e) => updateField('testDate', e.target.value)} />
    </div>
  );
}

// ----- SECCIÓN POR ENSAYO -----
function MechTestSection({ testKey, specimens, onUpdate, T }) {
  const groups = window.groupByAge(specimens);
  const ages = Object.keys(groups).map(Number).sort((a, b) => a - b);
  const prog = window.testProgress(testKey, specimens);

  return (
    <div className="test-section">
      <h3>
        {T[testKey]}
        <span className="test-summary">{prog.done}/{prog.total} {T.specimens.toLowerCase()}</span>
      </h3>
      {ages.map(age => {
        const ageSpecs = groups[age];
        const stats_p = window.stats(ageSpecs.map(s => s.parsed?.pmax));
        const stats_s = window.stats(ageSpecs.map(s => s.parsed?.smax));
        return (
          <div key={age} className="age-block">
            <div className="age-block-header">
              <span className="age-label">{age} {age === 1 ? T.day : T.days}</span>
              <span className="age-count">{ageSpecs.length} {T.specimens.toLowerCase()}</span>
            </div>
            <div className="replicas-grid">
              {ageSpecs.map(spec => {
                const idx = specimens.findIndex(s => s.id === spec.id);
                return (
                  <MechSpecimenCard key={spec.id} specimen={spec} T={T}
                    onUpdate={(updated) => {
                      const next = [...specimens];
                      next[idx] = updated;
                      onUpdate(next);
                    }} />
                );
              })}
            </div>
            {stats_p && (
              <div className="summary-bar inline">
                <div className="stat"><span className="k">{T.avg} {T.pmax}</span><span className="v">{stats_p.avg.toFixed(2)}</span></div>
                <div className="stat"><span className="k">{T.avg} {T.smax}</span><span className="v">{stats_s ? stats_s.avg.toFixed(2) : '—'}</span></div>
                <div className="stat"><span className="k">{T.cv} σ</span><span className="v">{stats_s ? stats_s.cv.toFixed(1) + '%' : '—'}</span></div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ShrinkageSection({ specimens, onUpdate, T }) {
  const prog = window.testProgress('retraction', specimens);
  return (
    <div className="test-section">
      <h3>
        {T.retraction}
        <span className="test-summary">{prog.done}/{prog.total} {T.measurements}</span>
      </h3>
      <ShrinkageTable specimens={specimens} onUpdate={onUpdate} T={T} />
    </div>
  );
}

// ----- DETALLE DE MEZCLA -----
function MixDetail({ mix, design, mixData, mixMeta, onUpdate, onUpdateMeta, onClose, T }) {
  const factors = ['BR', 'SFD', 'AFD', 'SFL', 'AFL', 'T'];
  const isCenter = mix === 45;
  const isStar = mix >= 33 && mix <= 44;
  const typeLabel = isCenter ? T.centerN45 : isStar ? T.starPoint : T.factorialPoint;

  const updateTest = (testKey, specs) => {
    const next = { ...mixData, [testKey]: specs };
    onUpdate(next);
  };

  return (
    <div className="mix-detail">
      <div className="detail-header">
        <h2>N{mix}<small>{typeLabel}</small></h2>
        <button className="close-btn" onClick={onClose}>{T.backToList}</button>
      </div>

      <div className="factors-inline">
        {factors.map(f => {
          const v = design[f];
          const cls = v === '+' ? 'plus' : v === '-' ? 'minus' : v === '0' ? 'zero' : '';
          return (
            <React.Fragment key={f}>
              <span>{f}</span>
              <span className={'chip ' + cls}>{v === '+' ? '+' : v === '-' ? '−' : v}</span>
            </React.Fragment>
          );
        })}
      </div>

      <div className="castdate-row">
        <label>{T.castDate}:</label>
        <input type="date" value={mixMeta.castDate}
          onChange={(e) => onUpdateMeta({ ...mixMeta, castDate: e.target.value })} />
      </div>

      <ShrinkageSection specimens={mixData.retraction} T={T}
        onUpdate={(specs) => updateTest('retraction', specs)} />
      <MechTestSection testKey="flexion" specimens={mixData.flexion} T={T}
        onUpdate={(specs) => updateTest('flexion', specs)} />
      <MechTestSection testKey="compression" specimens={mixData.compression} T={T}
        onUpdate={(specs) => updateTest('compression', specs)} />
    </div>
  );
}

// ----- TILE DE LA GRILLA -----
function MixTile({ mix, design, mixData, expanded, onClick, T }) {
  const prog = window.mixProgress(mixData);
  const isCenter = mix === 45;
  const isStar = mix >= 33 && mix <= 44;

  // mini-grid: 3 ensayos × 4 columnas
  const cells = [];
  for (const a of window.SHRINKAGE_AGES) {
    let any = false, all = true;
    for (const s of mixData.retraction) {
      const arr = Array.isArray(s.values[a]) ? s.values[a] : [s.values[a]];
      const ok = arr.some(v => v !== '' && !isNaN(parseFloat(v)));
      if (ok) any = true; else all = false;
    }
    cells.push(all && any ? 'done' : any ? 'partial' : '');
  }
  // Flexión: 3 edades (1, 7, 28)
  for (const age of [1, 7, 28]) {
    const ageSpecs = mixData.flexion.filter(s => s.age === age);
    const done = ageSpecs.every(s => s.parsed && s.parsed.pmax > 0);
    const partial = ageSpecs.some(s => s.parsed && s.parsed.pmax > 0);
    cells.push(done ? 'done' : partial ? 'partial' : '');
  }
  // Compresión: 3 edades, 1 probeta c/u
  for (const age of [1, 7, 28]) {
    const ageSpecs = mixData.compression.filter(s => s.age === age);
    const done = ageSpecs.every(s => s.parsed && s.parsed.pmax > 0);
    cells.push(done ? 'done' : '');
  }

  return (
    <div className={'mix-tile' + (expanded ? ' expanded' : '') + (isCenter ? ' is-center' : '') + (isStar ? ' is-star' : '')}
         onClick={onClick}>
      <div className="num">N{mix}{isCenter && <small> ×3</small>}</div>
      <div className="mini-grid tile-mini">{cells.map((c, i) => <div key={i} className={'cell ' + c}></div>)}</div>
      <div className="tile-bar"><div style={{ width: (prog.pct * 100) + '%' }}></div></div>
      <div className="tile-pct">{prog.done}/{prog.total}</div>
    </div>
  );
}

function App() {
  const [state, setState] = useState(loadState());
  const [lang, setLang] = useState(() => localStorage.getItem(LANG_KEY) || 'es');
  const [expanded, setExpanded] = useState(null);
  const T = window.I18N[lang];

  useEffect(() => { saveState(state); }, [state]);
  useEffect(() => { localStorage.setItem(LANG_KEY, lang); document.documentElement.lang = lang; }, [lang]);

  const updateMix = (mix, mixData) => {
    setState(s => ({ ...s, results: { ...s.results, [mix]: mixData } }));
  };
  const updateMeta = (mix, meta) => {
    setState(s => ({ ...s, mixMeta: { ...s.mixMeta, [mix]: meta } }));
  };

  let gDone = 0, gTotal = 0;
  for (let m = 1; m <= 45; m++) {
    const p = window.mixProgress(state.results[m]);
    gDone += p.done; gTotal += p.total;
  }

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>{T.title}</h1>
          <div className="subtitle">{T.subtitle}</div>
        </div>
        <div className="lang-picker">
          {['es', 'en', 'it'].map(l => (
            <button key={l} className={lang === l ? 'active' : ''} onClick={() => setLang(l)}>{l.toUpperCase()}</button>
          ))}
        </div>
      </header>

      <div className="global-progress">
        <div>
          <div className="label">{T.overall}</div>
          <div className="num">{gDone} <small>/ {gTotal}</small></div>
        </div>
        <div className="gp-bar"><div style={{ width: (gTotal ? gDone / gTotal * 100 : 0) + '%' }}></div></div>
        <div>
          <div className="label">{T.mixes}</div>
          <div className="num">45</div>
        </div>
        <div>
          <div className="label">{T.tests}</div>
          <div className="num">3</div>
        </div>
      </div>

      <FactorialPanel T={T} lang={lang} />

      {expanded && (() => {
        const design = window.FACTORIAL_DESIGN.find(d => d.run === expanded);
        return (
          <MixDetail mix={expanded} design={design}
            mixData={state.results[expanded]}
            mixMeta={state.mixMeta[expanded]}
            onUpdate={(d) => updateMix(expanded, d)}
            onUpdateMeta={(m) => updateMeta(expanded, m)}
            onClose={() => setExpanded(null)}
            T={T} />
        );
      })()}

      <div className="mix-grid">
        {window.FACTORIAL_DESIGN.map(design => (
          <MixTile key={design.run} mix={design.run} design={design}
            mixData={state.results[design.run]}
            expanded={expanded === design.run}
            onClick={() => setExpanded(expanded === design.run ? null : design.run)}
            T={T} />
        ))}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
