const { useState, useEffect, useMemo, useRef, useCallback } = React;

const LANG_KEY = 'tesis_lang_v1';
const ACTIVE_USER_KEY = 'tesis_active_user';

function getActiveUserId() {
  return localStorage.getItem(ACTIVE_USER_KEY) || '';  // empty if not set yet
}
function getActiveUser() {
  const id = getActiveUserId();
  return id && window.USERS[id] ? window.USERS[id] : null;
}

const PRELOAD_FLAG = 'tesis_preload_v3_applied';
function loadState(user) {
  if (!user) return null;
  const key = user.localStorageKey;
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.results && parsed.mixMeta) {
        // Migrate all mixes to match current spec definitions
        for (let i = 1; i <= user.mixCount; i++) {
          if (parsed.results[i]) parsed.results[i] = window.migrateMixSpecs(i, parsed.results[i], user);
        }
        // Aplicar preload solo a Rodrigo (los datos hist\u00f3ricos vienen de ah\u00ed)
        if (user.id === 'rodrigo' && window.PRELOAD_STATE && !localStorage.getItem(PRELOAD_FLAG)) {
          for (const mix in window.PRELOAD_STATE.results) {
            // Flexion / compression: parsed file data + dimensions/weight
            for (const test of ['flexion', 'compression']) {
              const preSpecs = window.PRELOAD_STATE.results[mix][test];
              if (!preSpecs) continue;
              for (const ps of preSpecs) {
                const slot = parsed.results[mix]?.[test]?.find(s => s.id === ps.id);
                if (!slot) continue;
                if (ps.parsed && ps.parsed.pmax > 0 && !(slot.parsed && slot.parsed.pmax > 0)) {
                  slot.file = ps.file; slot.parsed = ps.parsed; slot.testDate = ps.testDate || slot.testDate;
                }
                for (const k of ['length', 'height', 'width', 'weight']) {
                  if ((slot[k] == null || slot[k] === '') && ps[k] != null && ps[k] !== '') {
                    slot[k] = ps[k];
                  }
                }
              }
            }
            const preRetr = window.PRELOAD_STATE.results[mix].retraction;
            if (preRetr) {
              for (const ps of preRetr) {
                const slot = parsed.results[mix]?.retraction?.find(s => s.id === ps.id);
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
  if (user.id === 'rodrigo' && window.PRELOAD_STATE) {
    localStorage.setItem(PRELOAD_FLAG, '1');
    return window.PRELOAD_STATE;
  }
  return { results: window.makeEmptyResults(user), mixMeta: window.makeEmptyMixMeta(user) };
}

function saveState(state, user) {
  if (!user) return;
  const key = user.localStorageKey;
  try {
    const compact = JSON.parse(JSON.stringify(state));
    for (const m in compact.results) {
      for (const t of ['flexion', 'compression']) {
        const specs = compact.results[m][t];
        if (!Array.isArray(specs)) continue;
        for (const r of specs) {
          if (r.parsed && r.parsed.points && r.parsed.points.length > 500) {
            const step = Math.ceil(r.parsed.points.length / 500);
            r.parsed.points = r.parsed.points.filter((_, i) => i % step === 0);
          }
        }
      }
    }
    localStorage.setItem(key, JSON.stringify(compact));
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

function FactorialPanel({ T, lang, user }) {
  const factors = ['BR', 'AMF', 'FVF', 'SFL', 'AFL', 'T'];
  const design = user.factorialDesign();
  if (!design || design.length === 0 || !design[0].BR) return null;
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
            {design.map(row => {
              const isCenter = row.run === user.centerMix;
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
function ShrinkageTable({ specimens, onUpdate, T, user, mix, mixData, onUpdateMixData }) {
  const ages = user
    ? window.getShrinkAgesForMix(user, mixData)
    : (window.SHRINKAGE_AGES || [0,1,7,28]);
  const variableAges = user && !user.fixedShrinkAges;
  const [expanded, setExpanded] = useState(false);
  const [newAgeInput, setNewAgeInput] = useState('');

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

  const addAge = () => {
    const n = parseInt(newAgeInput);
    if (isNaN(n) || n < 0) return;
    if (ages.includes(n)) { setNewAgeInput(''); return; }
    // Add to mixData.shrinkAges and to each specimen's values
    if (onUpdateMixData) {
      const nextAges = [...(mixData.shrinkAges || []), n].sort((a,b)=>a-b);
      const nextSpecs = specimens.map(s => ({
        ...s, values: { ...s.values, [n]: s.values?.[n] || [] }
      }));
      onUpdateMixData({ ...mixData, shrinkAges: nextAges, retraction: nextSpecs });
    }
    setNewAgeInput('');
  };

  const removeAge = (a) => {
    if (!variableAges) return;
    if (!confirm(`¿Eliminar la edad ${a} días?`)) return;
    if (onUpdateMixData) {
      const nextAges = (mixData.shrinkAges || []).filter(x => x !== a);
      const nextSpecs = specimens.map(s => {
        const vv = { ...s.values }; delete vv[a]; return { ...s, values: vv };
      });
      onUpdateMixData({ ...mixData, shrinkAges: nextAges, retraction: nextSpecs });
    }
  };

  return (
    <div className="shrink-table-wrap">
      <div className="shrink-toolbar">
        {variableAges && (
          <div style={{display:'flex',gap:6,alignItems:'center',marginRight:'auto'}}>
            <input type="number" placeholder="días" value={newAgeInput}
              onChange={(e)=>setNewAgeInput(e.target.value)}
              onKeyDown={(e)=>e.key==='Enter'&&addAge()}
              style={{width:60,padding:'3px 6px',border:'1px solid var(--border)',borderRadius:3,fontSize:11,fontFamily:'var(--mono)'}}/>
            <button onClick={addAge} className="expand-btn">+ {T.addAge || 'Añadir edad'}</button>
          </div>
        )}
        <button onClick={() => setExpanded(!expanded)} className="expand-btn">
          {expanded ? '▾ ' : '▸ '}{expanded ? T.collapse || 'Colapsar' : T.expandAll || 'Ver 12 mediciones'}
        </button>
      </div>
      <table className="shrink-table">
        <thead>
          <tr>
            <th>{T.specimen}</th>
            {ages.map(a => (
              <th key={a}>
                {a} {a === 1 ? T.day : T.days}
                {variableAges && (
                  <button onClick={()=>removeAge(a)}
                    style={{marginLeft:4,border:'none',background:'transparent',cursor:'pointer',color:'var(--text-3)',fontSize:10}}
                    title="Eliminar edad">✕</button>
                )}
              </th>
            ))}
            {ages.length === 0 && <th style={{color:'var(--text-3)'}}>—</th>}
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
            <td>{T.avg}</td>
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
function MechSpecimenCard({ specimen, onUpdate, onOpenViewer, T }) {
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
              {onOpenViewer && (
                <button className="view-curve-btn" onClick={() => onOpenViewer(specimen.id)}>
                  📈 {T.viewCurve || 'Ver curva'}
                </button>
              )}
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
function MechTestSection({ testKey, specimens, onUpdate, onOpenViewer, T }) {
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
                    onOpenViewer={onOpenViewer ? (id) => onOpenViewer(testKey, id) : null}
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

function ShrinkageSection({ specimens, onUpdate, onOpenViewer, user, mix, mixData, onUpdateMixData, T }) {
  const prog = window.testProgress('retraction', specimens);
  return (
    <div className="test-section">
      <h3>
        {T.retraction}
        <span className="test-summary">{prog.done}/{prog.total} {T.measurements}</span>
        {onOpenViewer && (
          <button className="view-curve-btn" style={{width: 'auto', marginLeft: 'auto'}}
                  onClick={() => onOpenViewer('retraction', null)}>
            📈 {T.viewCurve || 'Ver curva'}
          </button>
        )}
      </h3>
      <ShrinkageTable specimens={specimens} onUpdate={onUpdate} T={T}
        user={user} mix={mix} mixData={mixData} onUpdateMixData={onUpdateMixData} />
    </div>
  );
}

// ----- DETALLE DE MEZCLA -----
function MixDetail({ mix, design, mixData, mixMeta, onUpdate, onUpdateMeta, onClose, onOpenViewer, user, T }) {
  const factors = ['BR', 'AMF', 'FVF', 'SFL', 'AFL', 'T'];
  const isCenter = user?.centerMix === mix;
  const isStar = user?.id === 'rodrigo' && mix >= 33 && mix <= 44;
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
        {user.hasFactorial && design.BR && factors.map(f => {
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

      {window.getSpecsForUser(user, mix, 'retraction').length > 0 && (
        <ShrinkageSection specimens={mixData.retraction} T={T}
          user={user} mix={mix} mixData={mixData}
          onUpdateMixData={onUpdate}
          onOpenViewer={onOpenViewer}
          onUpdate={(specs) => updateTest('retraction', specs)} />
      )}
      {user.hasFlexion && (
        <MechTestSection testKey="flexion" specimens={mixData.flexion} T={T}
          onOpenViewer={onOpenViewer}
          onUpdate={(specs) => updateTest('flexion', specs)} />
      )}
      <MechTestSection testKey="compression" specimens={mixData.compression} T={T}
        onOpenViewer={onOpenViewer}
        onUpdate={(specs) => updateTest('compression', specs)} />
    </div>
  );
}

// ----- TILE DE LA GRILLA -----
function MixTile({ mix, design, mixData, expanded, onClick, T, user }) {
  const prog = window.mixProgress(mixData);
  const isCenter = user?.centerMix === mix;
  const cells = [];
  // Shrink ages
  const shrinkAges = window.getShrinkAgesForMix(user, mixData);
  for (const a of shrinkAges) {
    let any = false, all = mixData.retraction.length > 0;
    for (const s of mixData.retraction) {
      const arr = Array.isArray(s.values[a]) ? s.values[a] : [s.values[a]];
      const ok = arr.some(v => v !== '' && !isNaN(parseFloat(v)));
      if (ok) any = true; else all = false;
    }
    cells.push(all && any ? 'done' : any ? 'partial' : '');
  }
  // Flexion ages (skip if no flexion)
  if (user.hasFlexion) {
    const flexAges = [...new Set(mixData.flexion.map(s => s.age))].sort((a, b) => a - b);
    for (const age of flexAges) {
      const ageSpecs = mixData.flexion.filter(s => s.age === age);
      const done = ageSpecs.length > 0 && ageSpecs.every(s => s.parsed && s.parsed.pmax > 0);
      const partial = ageSpecs.some(s => s.parsed && s.parsed.pmax > 0);
      cells.push(done ? 'done' : partial ? 'partial' : '');
    }
  }
  // Compression ages
  const compAges = [...new Set(mixData.compression.map(s => s.age))].sort((a, b) => a - b);
  for (const age of compAges) {
    const ageSpecs = mixData.compression.filter(s => s.age === age);
    const done = ageSpecs.length > 0 && ageSpecs.every(s => s.parsed && s.parsed.pmax > 0);
    const partial = ageSpecs.some(s => s.parsed && s.parsed.pmax > 0);
    cells.push(done ? 'done' : partial ? 'partial' : '');
  }

  const isStar = user.id === 'rodrigo' && mix >= 33 && mix <= 44;

  return (
    <div className={'mix-tile' + (expanded ? ' expanded' : '') + (isCenter ? ' is-center' : '') + (isStar ? ' is-star' : '')}
         onClick={onClick}>
      <div className="num">N{mix}{isCenter && <small> ×3</small>}</div>
      {cells.length > 0 && (
        <div className="mini-grid tile-mini">{cells.map((c, i) => <div key={i} className={'cell ' + c}></div>)}</div>
      )}
      <div className="tile-bar"><div style={{ width: (prog.pct * 100) + '%' }}></div></div>
      <div className="tile-pct">{prog.done}/{prog.total}</div>
    </div>
  );
}


// ===== Welcome screen + user selector =====
function UserPicker({ onPick, T }) {
  return (
    <div className="user-picker-screen">
      <div className="user-picker-card">
        <div className="up-logo">🧱</div>
        <h1>{T.welcome || 'Bienvenido'}</h1>
        <p>{T.pickUserDesc || 'Elige el usuario con el que vas a trabajar.'}</p>
        <div className="up-options">
          {window.USER_LIST.map(uid => {
            const u = window.USERS[uid];
            return (
              <button key={uid} className="up-option" onClick={() => onPick(uid)}>
                <div className="up-avatar">{u.name[0]}</div>
                <div className="up-name">{u.name}</div>
                <div className="up-meta">{u.mixCount} mezclas</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function UserSelector({ activeId, onSwitch }) {
  const active = window.USERS[activeId];
  return (
    <div className="user-selector">
      {window.USER_LIST.map(uid => {
        const u = window.USERS[uid];
        return (
          <button key={uid}
            className={'us-btn' + (uid === activeId ? ' active' : '')}
            onClick={() => uid !== activeId && onSwitch(uid)}>
            {u.name}
          </button>
        );
      })}
    </div>
  );
}

// ===== Viewer navigation bar =====
function ViewerNavBar({ state, user, viewerMix, viewerSpec, onNav, onClear, T }) {
  // Build list of available specimens with filters
  const [filterMix, setFilterMix] = useState('all');
  const [filterTest, setFilterTest] = useState('all');
  const [filterAge, setFilterAge] = useState('all');
  const [onlyData, setOnlyData] = useState(true);
  const [paramFilters, setParamFilters] = useState({}); // {BR:'+'|'-'|'0', ...}

  const factors = ['BR', 'AMF', 'FVF', 'SFL', 'AFL', 'T'];
  const designByRun = useMemo(() => {
    const m = {};
    (user.factorialDesign() || []).forEach(d => { m[d.run] = d; });
    return m;
  }, [user]);

  const items = useMemo(() => {
    const out = [];
    for (let mix = 1; mix <= user.mixCount; mix++) {
      const md = state.results[mix];
      if (!md) continue;
      if (user.hasFlexion) {
        for (const s of (md.flexion || [])) {
          if (onlyData && !(s.parsed && s.parsed.pmax > 0)) continue;
          out.push({ mix, test: 'flexion', id: s.id, age: s.age });
        }
      }
      for (const s of (md.compression || [])) {
        if (onlyData && !(s.parsed && s.parsed.pmax > 0)) continue;
        out.push({ mix, test: 'compression', id: s.id, age: s.age });
      }
    }
    return out;
  }, [state, user, onlyData]);

  const filtered = items.filter(it => {
    if (filterMix !== 'all' && it.mix !== parseInt(filterMix)) return false;
    if (filterTest !== 'all' && it.test !== filterTest) return false;
    if (filterAge !== 'all' && it.age !== parseInt(filterAge)) return false;
    // parameter filters
    const design = designByRun[it.mix];
    for (const f of factors) {
      const want = paramFilters[f];
      if (want && want !== 'all') {
        if (!design || design[f] !== want) return false;
      }
    }
    return true;
  });

  const currentIdx = filtered.findIndex(it =>
    it.mix === viewerMix && it.test === viewerSpec?.test && it.id === viewerSpec?.id);

  const goTo = (idx) => {
    if (idx < 0 || idx >= filtered.length) return;
    const it = filtered[idx];
    onNav(it.mix, it.test, it.id);
  };

  const allMixes = [...new Set(items.map(i => i.mix))].sort((a,b)=>a-b);
  const allAges = [...new Set(items.map(i => i.age))].sort((a,b)=>a-b);

  return (
    <div className="viewer-navbar">
      <div className="vn-arrows">
        <button onClick={() => goTo(0)} disabled={!filtered.length || currentIdx === 0} title="Primero">⏮</button>
        <button onClick={() => goTo(currentIdx > 0 ? currentIdx - 1 : filtered.length - 1)} disabled={!filtered.length} title="Anterior">←</button>
        <span className="vn-pos">{filtered.length > 0 ? `${Math.max(0, currentIdx)+1} / ${filtered.length}` : '0 / 0'}</span>
        <button onClick={() => goTo(currentIdx >= 0 && currentIdx < filtered.length - 1 ? currentIdx + 1 : 0)} disabled={!filtered.length} title="Siguiente">→</button>
        <button onClick={() => goTo(filtered.length - 1)} disabled={!filtered.length || currentIdx === filtered.length - 1} title="Último">⏭</button>
      </div>
      <div className="vn-filters">
        <select value={filterMix} onChange={(e)=>setFilterMix(e.target.value)}>
          <option value="all">{T.allMixes || 'Todas las mezclas'}</option>
          {allMixes.map(m => <option key={m} value={m}>N{m}</option>)}
        </select>
        <select value={filterTest} onChange={(e)=>setFilterTest(e.target.value)}>
          <option value="all">{T.allTests || 'Todos los ensayos'}</option>
          {user.hasFlexion && <option value="flexion">{T.flexion}</option>}
          <option value="compression">{T.compression}</option>
        </select>
        <select value={filterAge} onChange={(e)=>setFilterAge(e.target.value)}>
          <option value="all">{T.allAges || 'Todas las edades'}</option>
          {allAges.map(a => <option key={a} value={a}>{a}{T.day || 'd'}</option>)}
        </select>
        <label style={{fontSize:11,display:'flex',alignItems:'center',gap:4}}>
          <input type="checkbox" checked={onlyData} onChange={(e)=>setOnlyData(e.target.checked)} />
          {T.onlyWithData || 'Con datos'}
        </label>
      </div>
      {user.hasFactorial && (designByRun[1]?.BR) && (
        <div className="vn-params">
          <span className="vn-params-label">{T.params || 'Parámetros'}:</span>
          {factors.map(f => (
            <div key={f} className="vn-param">
              <span className="vn-param-name">{f}</span>
              <select value={paramFilters[f] || 'all'}
                onChange={(e) => setParamFilters(p => ({ ...p, [f]: e.target.value }))}>
                <option value="all">—</option>
                <option value="+">+</option>
                <option value="0">0</option>
                <option value="-">−</option>
              </select>
            </div>
          ))}
          {Object.values(paramFilters).some(v => v && v !== 'all') && (
            <button className="vn-param-clear" onClick={() => setParamFilters({})}>✕ {T.clear || 'Limpiar'}</button>
          )}
        </div>
      )}
    </div>
  );
}

function App() {
  // ---- Active user ----
  const [activeUserId, setActiveUserId] = useState(() => getActiveUserId());
  const user = activeUserId ? window.USERS[activeUserId] : null;

  // ---- App state (depends on user) ----
  const [state, setState] = useState(() => loadState(user));
  const [lang, setLang] = useState(() => localStorage.getItem(LANG_KEY) || 'es');
  const [expanded, setExpanded] = useState(null);
  const [tab, setTab] = useState('mixes');
  const [viewerMix, setViewerMix] = useState(null);
  const [viewerSpec, setViewerSpec] = useState(null);
  const [dirty, setDirty] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [fbReady, setFbReady] = useState(false);
  const [fbLastSync, setFbLastSync] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const T = window.I18N[lang];

  // Switch user: reload from localStorage / Firebase
  const switchUser = (newId) => {
    if (!window.USERS[newId]) return;
    if (dirty.size > 0) {
      if (!confirm(T.unsavedSwitch || 'Tienes cambios sin guardar. ¿Cambiar de usuario igualmente?')) return;
    }
    localStorage.setItem(ACTIVE_USER_KEY, newId);
    setActiveUserId(newId);
    setExpanded(null);
    setViewerMix(null);
    setViewerSpec(null);
    setDirty(new Set());
    setTab('mixes');
    const newUser = window.USERS[newId];
    setState(loadState(newUser));
    // Refresh from cloud
    if (window.FB && window.FB.isReady()) {
      window.FB.loadAll(newUser).then(remote => {
        if (remote) {
          for (let i = 1; i <= newUser.mixCount; i++) {
            if (remote.results[i]) remote.results[i] = window.migrateMixSpecs(i, remote.results[i], newUser);
          }
          setState(remote);
          setFbLastSync(new Date());
        }
      }).catch(e => console.error('[FB] reload error', e));
    }
  };

  useEffect(() => { if (state && user) saveState(state, user); }, [state, user]);
  useEffect(() => { localStorage.setItem(LANG_KEY, lang); document.documentElement.lang = lang; }, [lang]);

  // ---- Firebase: cargar al iniciar ----
  useEffect(() => {
    if (!window.FB || !user) return;
    window.FB.onReady(async () => {
      setFbReady(true);
      try {
        const remote = await window.FB.loadAll(user);
        let base = null;
        if (remote && Object.keys(remote.results).length > 0) {
          for (let i = 1; i <= user.mixCount; i++) {
            if (remote.results[i]) remote.results[i] = window.migrateMixSpecs(i, remote.results[i], user);
          }
          base = remote;
        } else {
          console.log('[FB] empty cloud for', user.id, '— using local state');
        }
        if (base) {
          setState(base);
          setFbLastSync(new Date());
          console.log('[FB] loaded from cloud for', user.id);
        }

        // Aplicar una vez dimensiones + retracción de Rodrigo (sobreescribe esos campos)
        if (user.id === 'rodrigo' && (window.RODRIGO_DIMS || window.RODRIGO_RETRACTION)) {
          const flagKey = 'tesis_rodrigo_data_' + (window.RODRIGO_DATA_VERSION || 'v1');
          if (!localStorage.getItem(flagKey)) {
            const target = base || stateRef.current;
            const nextResults = { ...target.results };
            const changed = new Set();
            // Dimensiones / peso
            const DIMS = window.RODRIGO_DIMS || {};
            for (const mixStr in DIMS) {
              const mix = parseInt(mixStr);
              if (!nextResults[mix]) continue;
              const md = JSON.parse(JSON.stringify(nextResults[mix]));
              for (const test of ['flexion', 'compression']) {
                const byId = DIMS[mixStr][test]; if (!byId) continue;
                for (const spec of (md[test] || [])) {
                  const d = byId[spec.id]; if (!d) continue;
                  spec.length = d.length; spec.height = d.height; spec.width = d.width; spec.weight = d.weight;
                  changed.add(mix);
                }
              }
              nextResults[mix] = md;
            }
            // Retracción (star + center)
            const RETR = window.RODRIGO_RETRACTION || {};
            for (const mixStr in RETR) {
              const mix = parseInt(mixStr);
              if (!nextResults[mix]) continue;
              const md = JSON.parse(JSON.stringify(nextResults[mix]));
              for (const spec of (md.retraction || [])) {
                const vals = RETR[mixStr][spec.id]; if (!vals) continue;
                spec.values = { ...spec.values };
                for (const age in vals) spec.values[age] = vals[age];
                changed.add(mix);
              }
              nextResults[mix] = md;
            }
            if (changed.size) {
              const updated = { ...target, results: nextResults };
              setState(updated);
              stateRef.current = updated;
              setDirty(prev => { const n = new Set(prev); changed.forEach(m => n.add(m)); return n; });
              console.log('[rodrigo data] applied to', changed.size, 'mixes');
            }
            localStorage.setItem(flagKey, '1');
          }
        }
      } catch (e) {
        console.error('[FB] load error', e);
      }
    });
  }, [user?.id]);

  const markDirty = (mix) => setDirty(d => new Set(d).add(mix));

  const updateMix = (mix, mixData) => {
    setState(s => ({ ...s, results: { ...s.results, [mix]: mixData } }));
    markDirty(mix);
  };
  const updateMeta = (mix, meta) => {
    setState(s => ({ ...s, mixMeta: { ...s.mixMeta, [mix]: meta } }));
    markDirty(mix);
  };

  // ---- Auto-guardado en Firebase (debounce) ----
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);
  const autosaveTimer = useRef(null);
  useEffect(() => {
    if (!fbReady || !user || dirty.size === 0) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(async () => {
      const toSave = [...dirty];
      setSaving(true);
      try {
        await window.FB.saveMany(toSave, stateRef.current, user);
        setDirty(prev => {
          const next = new Set(prev);
          toSave.forEach(m => next.delete(m));
          return next;
        });
        setFbLastSync(new Date());
        setSaveError(null);
      } catch (e) {
        console.error('[FB] autosave error', e);
        // Mantener sucias las mezclas que fallaron para reintentar
        const failed = e.failedMixes || toSave;
        setSaveError('No se guardaron: N' + failed.join(', N'));
      }
      setSaving(false);
    }, 1200);
    return () => { if (autosaveTimer.current) clearTimeout(autosaveTimer.current); };
  }, [dirty, fbReady, user]);

  const saveToCloud = async () => {
    if (!fbReady) { return; }
    if (!user) return;
    setSaving(true);
    try {
      const toSave = dirty.size > 0 ? [...dirty] : Array.from({length: user.mixCount}, (_, i) => i + 1);
      await window.FB.saveMany(toSave, state, user);
      setDirty(new Set());
      setFbLastSync(new Date());
    } catch (e) {
      console.error(e);
    }
    setSaving(false);
  };

  // ---- Pantalla de bienvenida si no hay usuario ----
  if (!user) {
    return <UserPicker onPick={(id) => {
      localStorage.setItem(ACTIVE_USER_KEY, id);
      setActiveUserId(id);
      setState(loadState(window.USERS[id]));
    }} T={T} />;
  }

  let gDone = 0, gTotal = 0;
  for (let m = 1; m <= user.mixCount; m++) {
    const p = window.mixProgress(state.results[m]);
    gDone += p.done; gTotal += p.total;
  }

  const openViewer = (mix, test, id) => {
    setViewerMix(mix);
    setViewerSpec({ test, id });
    setTab('viewer');
  };

  const currentSpec = viewerMix && viewerSpec
    ? state.results[viewerMix]?.[viewerSpec.test]?.find(s => s.id === viewerSpec.id)
    : null;

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>{T.title}</h1>
          <div className="subtitle">{T.subtitle}</div>
        </div>
        <div className="header-right">
          <UserSelector activeId={user.id} onSwitch={switchUser} />
          <div className="save-cluster">
            <div className="fb-status">
              <span className={'fb-dot' + (fbReady ? ' ready' : '') + (saveError ? ' err' : '')}></span>
              {!fbReady ? 'conectando…'
                : saveError ? '⚠ ' + saveError
                : saving ? '⟳ Guardando…'
                : dirty.size > 0 ? `✎ ${dirty.size} sin guardar`
                : fbLastSync ? `✓ Guardado ${fbLastSync.toLocaleTimeString()}` : 'Conectado'}
            </div>
          </div>
          <div className="lang-picker">
            {['es', 'en', 'it'].map(l => (
              <button key={l} className={lang === l ? 'active' : ''} onClick={() => setLang(l)}>{l.toUpperCase()}</button>
            ))}
          </div>
        </div>
      </header>

      <nav className="main-tabs">
        <button className={tab === 'mixes' ? 'active' : ''} onClick={() => setTab('mixes')}>
          {T.mixes || 'Mezclas'}
        </button>
        <button className={tab === 'viewer' ? 'active' : ''} onClick={() => setTab('viewer')}>
          {T.viewerTab || 'Visualizador'}
        </button>
        <button className={tab === 'upload' ? 'active' : ''} onClick={() => setTab('upload')}>
          {T.quickUpload || 'Carga rápida'}
        </button>
      </nav>

      {tab === 'mixes' && (
        <>
          <div className="global-progress">
            <div>
              <div className="label">{T.overall}</div>
              <div className="num">{gDone} <small>/ {gTotal}</small></div>
            </div>
            <div className="gp-bar"><div style={{ width: (gTotal ? gDone / gTotal * 100 : 0) + '%' }}></div></div>
            <div>
              <div className="label">{T.mixes}</div>
              <div className="num">{user.mixCount}</div>
            </div>
            <div>
              <div className="label">{T.tests}</div>
              <div className="num">{user.hasFlexion ? 3 : 2}</div>
            </div>
          </div>

          <FactorialPanel T={T} lang={lang} user={user} />

          {expanded && (() => {
            const design = user.factorialDesign().find(d => d.run === expanded) || { run: expanded };
            return (
              <MixDetail mix={expanded} design={design}
                mixData={state.results[expanded]}
                mixMeta={state.mixMeta[expanded]}
                user={user}
                onUpdate={(d) => updateMix(expanded, d)}
                onUpdateMeta={(m) => updateMeta(expanded, m)}
                onClose={() => setExpanded(null)}
                onOpenViewer={(test, id) => openViewer(expanded, test, id)}
                T={T} />
            );
          })()}

          <div className="mix-grid">
            {user.factorialDesign().map(design => (
              <MixTile key={design.run} mix={design.run} design={design}
                mixData={state.results[design.run]}
                expanded={expanded === design.run}
                onClick={() => setExpanded(expanded === design.run ? null : design.run)}
                T={T} user={user} />
            ))}
          </div>
        </>
      )}

      {tab === 'viewer' && (
        <div className="viewer-tab">
          <ViewerNavBar
            state={state}
            user={user}
            viewerMix={viewerMix}
            viewerSpec={viewerSpec}
            onNav={(mix, test, id) => { setViewerMix(mix); setViewerSpec({ test, id }); }}
            onClear={() => { setViewerMix(null); setViewerSpec(null); }}
            T={T} />
          <div className="viewer-tab-header">
            <h2>{T.viewerTab || 'Visualizador'}</h2>
            {viewerMix ? (
              <div className="viewer-context">
                <span className="ctx-mix">N{viewerMix}</span>
                <span className="ctx-sep">·</span>
                <span className="ctx-test">{T[viewerSpec.test]}</span>
                {viewerSpec.test !== 'retraction' && (
                  <>
                    <span className="ctx-sep">·</span>
                    <span className="ctx-spec">{T.specimen} {viewerSpec.id}</span>
                    {currentSpec && (
                      <>
                        <span className="ctx-sep">·</span>
                        <span className="ctx-age">{currentSpec.age}{T.day || 'd'}</span>
                      </>
                    )}
                  </>
                )}
                <button className="vt-btn" style={{marginLeft: 16}} onClick={() => { setViewerMix(null); setViewerSpec(null); }}>
                  {T.clear || 'Limpiar'}
                </button>
              </div>
            ) : (
              <div className="hint-empty">{T.viewerPickHint || 'Selecciona un ensayo desde Mezclas → click en una probeta o Retracción.'}</div>
            )}
          </div>

          {viewerMix && viewerSpec?.test === 'retraction' && (
            <window.ShrinkageViewer
              mix={viewerMix}
              specimens={state.results[viewerMix].retraction}
              user={user}
              mixData={state.results[viewerMix]}
              T={T}
            />
          )}

          {currentSpec && viewerSpec?.test !== 'retraction' && (
            <window.IndividualViewer
              specimen={currentSpec}
              testKey={viewerSpec.test}
              onUpdate={(updated) => {
                const specs = state.results[viewerMix][viewerSpec.test].map(s => s.id === viewerSpec.id ? updated : s);
                const next = { ...state.results[viewerMix], [viewerSpec.test]: specs };
                updateMix(viewerMix, next);
              }}
              T={T}
            />
          )}

          <div style={{marginTop: 32, borderTop: '1px solid var(--border)', paddingTop: 20}}>
            <window.ComparatorView state={state} T={T} lang={lang} />
          </div>
        </div>
      )}

      {tab === 'upload' && (
        <window.QuickUploadTab
          state={state}
          onUpdateMix={updateMix}
          T={T} lang={lang}
        />
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
