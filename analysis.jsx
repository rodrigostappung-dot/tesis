// ===== PESTAÑA ANÁLISIS =====
// Comparador tipo "scatter": el usuario elige qué variable va en el eje X y
// cuál en el eje Y, y agrega puntos (probeta individual / promedio por edad /
// ratio entre edades) con los mismos filtros que el comparador de curvas.
// Todas las métricas mecánicas se calculan siempre sobre la curva CORREGIDA
// (corrección + recorte aplicados), igual que en el resto de la app.

const ANALYSIS_PALETTE = [
  '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
  '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf',
];

// ---------- Métricas mecánicas (siempre sobre curva corregida + recortada) ----------
function analysisProcessMech(spec) {
  if (!spec || !spec.parsed) return null;
  let p = spec.parsed;
  if (spec.correction) p = window.applyCorrection(p, spec.correction);
  if (spec.trimIdx || spec.trimEndIdx != null) p = window.applyTrim(p, spec.trimIdx, spec.trimEndIdx);
  return p;
}

function analysisSlope(spec) {
  if (!spec || !spec.parsed || !spec.correction) return null;
  const { i1, i2 } = spec.correction;
  const pts = spec.parsed.points;
  if (i1 == null || i2 == null || !pts[i1] || !pts[i2]) return null;
  const x1 = pts[i1].disp, y1 = pts[i1].load, x2 = pts[i2].disp, y2 = pts[i2].load;
  const m = (y2 - y1) / (x2 - x1);
  return isFinite(m) ? m : null;
}

// Devuelve {slope, pmaxKN, pmaxMPa, defMax} para una probeta, o null si no tiene datos.
function analysisSpecMetrics(spec, testKey) {
  const p = analysisProcessMech(spec);
  if (!p || !p.points || !p.points.length || !(p.pmax > 0)) return null;
  let idx = 0, mv = -Infinity;
  p.points.forEach((pt, i) => { if (pt.load > mv) { mv = pt.load; idx = i; } });
  const pk = p.points[idx] || {};
  const pmaxKN = mv > 0 ? mv : p.pmax;
  const pmaxMPa = window.computeStressMPa(pmaxKN, testKey, spec);
  return {
    slope: analysisSlope(spec),
    pmaxKN,
    pmaxMPa,
    defMax: pk.disp != null ? pk.disp : null,
  };
}

// Promedio de una métrica mecánica entre las probetas de (mix, test) a una edad dada.
function analysisAvgMetricAtAge(state, mix, testKey, age, metricKey) {
  const ageNum = Number(age);
  const specs = (state.results[mix]?.[testKey] || []).filter(s => Number(s.age) === ageNum && s.parsed && s.parsed.pmax > 0);
  if (!specs.length) return null;
  const vals = specs.map(s => analysisSpecMetrics(s, testKey)?.[metricKey]).filter(v => v != null && !isNaN(v));
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

// ---------- Definición de variables de eje ----------
const AXIS_VARS = [
  { id: 'slope',   label: 'Pendiente inicial (kN/mm)',        group: 'mech' },
  { id: 'pmaxKN',  label: 'Carga máxima (kN)',                group: 'mech' },
  { id: 'pmaxMPa', label: 'Tensión máxima (MPa)',              group: 'mech' },
  { id: 'defMax',  label: 'Deformación en carga máx. (mm)',    group: 'mech' },
  { id: 'ratioKN',  label: 'Ratio carga máxima (kN)',          group: 'ratio', base: 'pmaxKN' },
  { id: 'ratioMPa', label: 'Ratio tensión máxima (MPa)',       group: 'ratio', base: 'pmaxMPa' },
  { id: 'design_BR',  label: 'Relación ligante — BR',                  group: 'design', key: 'BR' },
  { id: 'design_FD',  label: 'Dosis total de fibra',                   group: 'design', key: 'FD' },
  { id: 'design_SD',  label: 'Dosis fibra de acero',                   group: 'design', key: 'SD' },
  { id: 'design_AD',  label: 'Dosis fibra amorfa',                     group: 'design', key: 'AD' },
  { id: 'design_SL',  label: 'Largo fibra de acero (mm)',              group: 'design', key: 'SL' },
  { id: 'design_AL',  label: 'Largo fibra amorfa (mm)',                group: 'design', key: 'AL' },
  { id: 'design_T',   label: 'Temperatura (°C)',                       group: 'design', key: 'T' },
  { id: 'design_TMF', label: 'Tamaño máx. de fibra (mm)',              group: 'design', key: 'TMF' },
];
const GROUP_LABELS = { mech: 'Mecánico (siempre sobre curva corregida)', ratio: 'Ratio entre edades', design: 'Variables de mezcla' };

function keyOfItem(it) {
  if (it.kind === 'spec') return `${it.mix}_${it.testKey}_spec_${it.specimenId}`;
  if (it.kind === 'avg') return `${it.mix}_${it.testKey}_avg_${it.age}`;
  if (it.kind === 'ratio') return `${it.mix}_${it.testKey}_ratio_${it.ageA}_${it.ageB}`;
  if (it.kind === 'mix') return `${it.mix}_mix`;
  return `${it.mix}_${it.testKey}_${it.kind}`;
}

function defaultAnalysisLabel(it) {
  const prefix = it.testKey === 'flexion' ? 'F' : 'C';
  if (it.kind === 'spec') return `N${it.mix} ${prefix}-${it.specimenId} ${it.age}d`;
  if (it.kind === 'avg') return `N${it.mix} ${prefix}-avg ${it.age}d`;
  if (it.kind === 'ratio') return `N${it.mix} ${prefix}-ratio ${it.ageA}v${it.ageB}d`;
  if (it.kind === 'mix') return `N${it.mix}`;
  return `N${it.mix}`;
}

// Evalúa el valor numérico de una variable de eje para un ítem dado.
// ageOverride: si se define (1/7/28) para una variable 'mech', se ignora la edad
// propia del ítem y se usa el promedio de esa mezcla+ensayo a esa edad fija.
// axisTestKey: para ítems de tipo 'mix' (un punto por mezcla), el ensayo (compresión/flexión)
// se elige POR EJE — así se pueden mezclar ensayos entre el eje X y el eje Y para la misma mezcla.
function evalAxisVar(varDef, item, state, ageOverride, axisTestKey) {
  if (!varDef) return null;
  if (varDef.group === 'design') return window.getMixParam ? window.getMixParam(item.mix, varDef.key) : null;
  if (varDef.group === 'ratio') {
    if (item.kind !== 'ratio') return null;
    const a = analysisAvgMetricAtAge(state, item.mix, item.testKey, item.ageA, varDef.base);
    const b = analysisAvgMetricAtAge(state, item.mix, item.testKey, item.ageB, varDef.base);
    if (a == null || b == null || b === 0) return null;
    return a / b;
  }
  // group === 'mech'
  if (item.kind === 'mix') {
    // Un punto por mezcla: siempre se usa el promedio de las probetas del ensayo elegido
    // para ESTE eje, a la edad fija del eje.
    if (!ageOverride || ageOverride === 'item') return null;
    return analysisAvgMetricAtAge(state, item.mix, axisTestKey, ageOverride, varDef.id);
  }
  if (ageOverride && ageOverride !== 'item') {
    return analysisAvgMetricAtAge(state, item.mix, item.testKey, ageOverride, varDef.id);
  }
  if (item.kind === 'spec') {
    const spec = state.results[item.mix]?.[item.testKey]?.find(s => s.id === item.specimenId);
    if (!spec) return null;
    const m = analysisSpecMetrics(spec, item.testKey);
    return m ? m[varDef.id] : null;
  }
  if (item.kind === 'avg') {
    return analysisAvgMetricAtAge(state, item.mix, item.testKey, item.age, varDef.id);
  }
  if (item.kind === 'ratio') {
    // Sin ageOverride, una variable mecánica no aplica a un ítem de tipo ratio.
    return null;
  }
  return null;
}

// ---------- Formato de números para ejes / tooltips ----------
function fmtAxisNum(v) {
  if (v == null || isNaN(v)) return '—';
  const av = Math.abs(v);
  if (av !== 0 && av < 0.001) return v.toExponential(1);
  if (av < 1) return (Math.round(v * 10000) / 10000).toString();
  if (av < 100) return (Math.round(v * 100) / 100).toString();
  return (Math.round(v * 10) / 10).toString();
}

function niceTicksAnalysis(mn, mx, count = 5) {
  const range = (mx - mn) || 1;
  const step0 = range / count;
  const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(step0) || 1)));
  const norm = step0 / mag;
  const niceStep = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const start = Math.ceil(mn / niceStep) * niceStep;
  const ticks = [];
  for (let v = start; v <= mx + niceStep * 1e-6; v += niceStep) ticks.push(+v.toFixed(10));
  return ticks;
}

// ---------- Gráfico de dispersión (scatter) ----------
function ScatterPlot({ points, xLabel, yLabel, width = 780, height = 460, viewBox = null, onZoom = null }) {
  const W = width, H = height, padL = 66, padR = 20, padT = 20, padB = 48;
  const [drag, setDrag] = React.useState(null);
  const [hover, setHover] = React.useState(null);
  const svgRef = React.useRef(null);

  const svgCoords = (e) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: ((e.clientX - rect.left) / rect.width) * W, y: ((e.clientY - rect.top) / rect.height) * H };
  };

  const valid = (points || []).filter(p => p.x != null && p.y != null && !isNaN(p.x) && !isNaN(p.y));

  if (!valid.length) {
    return (
      <svg width={W} height={H} style={{ background: '#fcfcfd' }}>
        <text x="50%" y="50%" textAnchor="middle" fontSize="13" fill="#999">Sin puntos con datos válidos para estos ejes</text>
      </svg>
    );
  }

  const xs = valid.map(p => p.x), ys = valid.map(p => p.y);
  let xMin = viewBox ? viewBox.xMin : Math.min(...xs);
  let xMax = viewBox ? viewBox.xMax : Math.max(...xs);
  let yMin = viewBox ? viewBox.yMin : Math.min(...ys);
  let yMax = viewBox ? viewBox.yMax : Math.max(...ys);
  if (!viewBox) {
    const xr = (xMax - xMin) || Math.abs(xMax) || 1;
    const yr = (yMax - yMin) || Math.abs(yMax) || 1;
    xMin -= xr * 0.08; xMax += xr * 0.08;
    yMin -= yr * 0.1; yMax += yr * 0.1;
  }
  const sx = (x) => padL + ((x - xMin) / ((xMax - xMin) || 1)) * (W - padL - padR);
  const sy = (y) => H - padB - ((y - yMin) / ((yMax - yMin) || 1)) * (H - padT - padB);
  const xTicks = niceTicksAnalysis(xMin, xMax);
  const yTicks = niceTicksAnalysis(yMin, yMax);

  const handleMouseDown = (e) => {
    if (!onZoom) return;
    setHover(null);
    const c = svgCoords(e);
    setDrag({ x0: c.x, y0: c.y, x1: c.x, y1: c.y });
    e.preventDefault();
  };
  const handleMouseMove = (e) => { if (!drag) return; const c = svgCoords(e); setDrag(d => ({ ...d, x1: c.x, y1: c.y })); };
  const handleMouseUp = () => {
    if (!drag) return;
    const dx = Math.abs(drag.x1 - drag.x0), dy = Math.abs(drag.y1 - drag.y0);
    if (dx > 10 && dy > 10) {
      const toDataX = (px) => xMin + ((px - padL) / (W - padL - padR)) * (xMax - xMin);
      const toDataY = (py) => yMax - ((py - padT) / (H - padT - padB)) * (yMax - yMin);
      onZoom({
        xMin: toDataX(Math.min(drag.x0, drag.x1)), xMax: toDataX(Math.max(drag.x0, drag.x1)),
        yMin: toDataY(Math.max(drag.y0, drag.y1)), yMax: toDataY(Math.min(drag.y0, drag.y1)),
      });
    }
    setDrag(null);
  };

  return (
    <svg ref={svgRef} width={W} height={H}
         style={{ background: '#fcfcfd', cursor: onZoom ? (drag ? 'crosshair' : 'zoom-in') : 'default', userSelect: 'none' }}
         onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={() => setDrag(null)}>
      {xTicks.map(t => <line key={'gx' + t} x1={sx(t)} y1={padT} x2={sx(t)} y2={H - padB} stroke="#eef0f3" strokeWidth="1" />)}
      {yTicks.map(t => <line key={'gy' + t} x1={padL} y1={sy(t)} x2={W - padR} y2={sy(t)} stroke="#eef0f3" strokeWidth="1" />)}
      <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="#666" strokeWidth="1" />
      <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke="#666" strokeWidth="1" />
      {xTicks.map(t => <text key={'lx' + t} x={sx(t)} y={H - padB + 16} textAnchor="middle" fontSize="11" fill="#555" fontFamily="ui-monospace, monospace">{fmtAxisNum(t)}</text>)}
      {yTicks.map(t => <text key={'ly' + t} x={padL - 8} y={sy(t) + 4} textAnchor="end" fontSize="11" fill="#555" fontFamily="ui-monospace, monospace">{fmtAxisNum(t)}</text>)}
      <text x={(W + padL) / 2} y={H - 8} textAnchor="middle" fontSize="12" fill="#333">{xLabel}</text>
      <text x={16} y={(H - padB + padT) / 2} textAnchor="middle" fontSize="12" fill="#333"
            transform={`rotate(-90 16 ${(H - padB + padT) / 2})`}>{yLabel}</text>
      {valid.map((p, i) => (
        <circle key={p.key || i} cx={sx(p.x)} cy={sy(p.y)} r={5.5} fill={p.color} stroke="white" strokeWidth="1.3"
                onMouseMove={(e) => { if (drag) return; const c = svgCoords(e); setHover({ x: c.x, y: c.y, label: p.label, color: p.color, xv: p.x, yv: p.y }); }}
                onMouseLeave={() => setHover(null)} />
      ))}
      {drag && (
        <rect x={Math.min(drag.x0, drag.x1)} y={Math.min(drag.y0, drag.y1)}
              width={Math.abs(drag.x1 - drag.x0)} height={Math.abs(drag.y1 - drag.y0)}
              fill="rgba(26,79,139,.10)" stroke="var(--accent, #1a4f8b)" strokeWidth="1.5" strokeDasharray="4,2" pointerEvents="none" />
      )}
      {hover && !drag && (() => {
        const txt = `${hover.label}  (${fmtAxisNum(hover.xv)}, ${fmtAxisNum(hover.yv)})`;
        const tw = txt.length * 6.4 + 24;
        const flip = hover.x + 12 + tw > W;
        const bx = flip ? hover.x - 12 - tw : hover.x + 12;
        const by = Math.max(padT + 2, hover.y - 26);
        return (
          <g pointerEvents="none">
            <rect x={bx} y={by} width={tw} height={20} rx={4} fill="rgba(20,25,35,.92)" />
            <circle cx={bx + 11} cy={by + 10} r={4} fill={hover.color} />
            <text x={bx + 20} y={by + 14} fontSize="11" fill="#fff" fontFamily="ui-monospace, monospace">{txt}</text>
          </g>
        );
      })()}
    </svg>
  );
}

// ---------- Picker de puntos (individual / promedio / ratio) ----------
function AnalysisPicker({ state, user, onSelectMany, onClose, T }) {
  const items = [];
  const testsToUse = user.hasFlexion ? ['flexion', 'compression'] : ['compression'];
  for (let mix = 1; mix <= user.mixCount; mix++) {
    const md = state.results[mix];
    if (!md) continue;
    for (const test of testsToUse) {
      const specs = md[test] || [];
      const byAge = new Map();
      for (const s of specs) {
        if (s.parsed && s.parsed.pmax > 0) {
          items.push({ kind: 'spec', mix, testKey: test, specimenId: s.id, age: s.age, pmax: s.parsed.pmax, smax: s.parsed.smax });
          if (!byAge.has(s.age)) byAge.set(s.age, []);
          byAge.get(s.age).push(s);
        }
      }
      for (const [age, arr] of byAge.entries()) {
        if (arr.length >= 2) {
          const avgP = analysisAvgMetricAtAge(state, mix, test, age, 'pmaxKN');
          items.push({ kind: 'avg', mix, testKey: test, age, n: arr.length, pmax: avgP });
        }
      }
      const agesWithData = [...byAge.keys()];
      [[1, 7], [1, 28], [7, 28]].forEach(([a, b]) => {
        if (agesWithData.includes(a) && agesWithData.includes(b)) {
          const ratioKN = evalAxisVar({ group: 'ratio', base: 'pmaxKN' }, { kind: 'ratio', mix, testKey: test, ageA: a, ageB: b }, state);
          items.push({ kind: 'ratio', mix, testKey: test, ageA: a, ageB: b, ratioKN });
        }
      });
    }
  }
  items.sort((a, b) => a.mix - b.mix || a.testKey.localeCompare(b.testKey) || a.kind.localeCompare(b.kind));

  const [text, setText] = React.useState('');
  const [filterMix, setFilterMix] = React.useState('all');
  const [filterTest, setFilterTest] = React.useState('all');
  const [filterAge, setFilterAge] = React.useState('all');
  const [filterAgg, setFilterAgg] = React.useState('all');
  const [picked, setPicked] = React.useState(new Set());
  const [paramFilters, setParamFilters] = React.useState({});

  const designByRun = React.useMemo(() => {
    const m = {}; (user.factorialDesign() || []).forEach(d => { m[d.run] = d; });
    return m;
  }, [user]);
  const factors = ['BR', 'AMF', 'FVF', 'SFL', 'AFL', 'T'];
  const hasParamFilters = Object.values(paramFilters).some(v => v && v !== 'all');
  const allMixes = [...new Set(items.map(i => i.mix))].sort((a, b) => a - b);
  const allAges = [...new Set(items.filter(i => i.kind !== 'ratio').map(i => i.age))].sort((a, b) => a - b);

  const filtered = items.filter(it => {
    if (filterMix !== 'all' && it.mix !== parseInt(filterMix)) return false;
    if (filterTest !== 'all' && it.testKey !== filterTest) return false;
    if (filterAge !== 'all') {
      if (it.kind === 'ratio') return false;
      if (it.age !== parseInt(filterAge)) return false;
    }
    if (filterAgg === 'avg' && it.kind !== 'avg') return false;
    if (filterAgg === 'individual' && it.kind !== 'spec') return false;
    if (filterAgg === 'ratio' && it.kind !== 'ratio') return false;
    if (hasParamFilters) {
      const d = designByRun[it.mix];
      for (const f of factors) {
        const want = paramFilters[f];
        if (want && want !== 'all') { if (!d || d[f] !== want) return false; }
      }
    }
    if (text) {
      const s = `N${it.mix} ${it.testKey} ${it.specimenId || ''} ${it.age || ''} ${it.kind === 'ratio' ? it.ageA + 'v' + it.ageB : ''}`.toLowerCase();
      if (!s.includes(text.toLowerCase())) return false;
    }
    return true;
  });

  const toggle = (it) => {
    const k = keyOfItem(it);
    setPicked(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  };
  const selectAllVisible = () => { const n = new Set(picked); filtered.forEach(it => n.add(keyOfItem(it))); setPicked(n); };
  const clearPicked = () => setPicked(new Set());
  const confirmAdd = () => {
    const list = items.filter(it => picked.has(keyOfItem(it)));
    if (!list.length) return;
    onSelectMany(list);
  };

  const testLabel = (it) => {
    const prefix = it.testKey === 'flexion' ? 'F' : 'C';
    if (it.kind === 'spec') return `${prefix}-${it.specimenId}`;
    if (it.kind === 'avg') return `${prefix}-avg`;
    return `${prefix}-ratio`;
  };
  const ageLabel = (it) => it.kind === 'ratio' ? `${it.ageA}v${it.ageB}d` : `${it.age}d`;
  const statLabel = (it) => {
    if (it.kind === 'spec') return `${it.pmax != null ? it.pmax.toFixed(2) : '—'} kN · ${it.smax != null ? it.smax.toFixed(1) : '—'} MPa`;
    if (it.kind === 'avg') return `Pmax̄ ${it.pmax != null ? it.pmax.toFixed(2) : '—'} kN · n=${it.n}`;
    return `Ratio(kN) ${it.ratioKN != null ? it.ratioKN.toFixed(2) : '—'}`;
  };

  return (
    <div className="cal-modal-backdrop" onClick={onClose}>
      <div className="picker-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 820 }}>
        <div className="picker-header">
          <h3>{T.pickAnalysisPoints || 'Seleccionar puntos'}</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{picked.size} {T.selectedCount || 'seleccionados'}</span>
            <button className="vt-btn" onClick={selectAllVisible}>{T.selectVisible || 'Todos visibles'}</button>
            <button className="vt-btn" onClick={clearPicked}>{T.clear || 'Limpiar'}</button>
            <button className="vt-btn primary" onClick={confirmAdd} disabled={picked.size === 0}>+ {T.addSelected || 'Añadir'} ({picked.size})</button>
            <button className="cal-close" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="picker-filters">
          <input className="picker-search" placeholder={T.search || 'Buscar…'} value={text} onChange={(e) => setText(e.target.value)} />
          <select value={filterMix} onChange={(e) => setFilterMix(e.target.value)}>
            <option value="all">{T.allMixes || 'Todas las mezclas'}</option>
            {allMixes.map(m => <option key={m} value={m}>N{m}</option>)}
          </select>
          <select value={filterTest} onChange={(e) => setFilterTest(e.target.value)}>
            <option value="all">{T.allTests || 'Todos los ensayos'}</option>
            {user.hasFlexion && <option value="flexion">{T.flexion}</option>}
            <option value="compression">{T.compression}</option>
          </select>
          <select value={filterAge} onChange={(e) => setFilterAge(e.target.value)}>
            <option value="all">{T.allAges || 'Todas las edades'}</option>
            {allAges.map(a => <option key={a} value={a}>{a}{T.day || 'd'}</option>)}
          </select>
          <select value={filterAgg} onChange={(e) => setFilterAgg(e.target.value)}>
            <option value="all">{T.aggAllAnalysis || 'Individual + Promedio + Ratio'}</option>
            <option value="individual">{T.aggInd || 'Solo individual'}</option>
            <option value="avg">{T.aggAvg || 'Solo promedio'}</option>
            <option value="ratio">{T.aggRatio || 'Solo ratio'}</option>
          </select>
        </div>
        {user.hasFactorial && (
          <div className="picker-params">
            {factors.map(f => (
              <div key={f} className="picker-param">
                <span>{f}</span>
                <select value={paramFilters[f] || 'all'} onChange={(e) => setParamFilters(p => ({ ...p, [f]: e.target.value }))}>
                  <option value="all">—</option><option value="+">+</option><option value="0">0</option><option value="-">−</option>
                </select>
              </div>
            ))}
            {hasParamFilters && (
              <button className="vt-btn" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => setParamFilters({})}>✕ Limpiar</button>
            )}
          </div>
        )}
        <div className="picker-list">
          {filtered.length === 0 && <div className="hint-empty">{T.noCurves || 'No hay ensayos.'}</div>}
          {filtered.map(it => {
            const k = keyOfItem(it), sel = picked.has(k);
            return (
              <div key={k} className={'picker-item' + (sel ? ' selected' : '')} onClick={() => toggle(it)}>
                <input type="checkbox" checked={sel} readOnly />
                <span className="pi-mix">N{it.mix}</span>
                <span className="pi-test">{testLabel(it)}</span>
                <span className="pi-age">{ageLabel(it)}</span>
                <span className="pi-pmax">{statLabel(it)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------- Picker de MEZCLAS: un punto por mezcla (siempre promedio de probetas) ----------
// El ensayo (compresión/flexión) NO se fija aquí: se elige por eje al graficar, así se
// pueden mezclar ensayos entre el eje X y el eje Y para la misma mezcla.
function MixPicker({ state, user, onSelectMany, onClose, T }) {
  const testsToCheck = user.hasFlexion ? ['flexion', 'compression'] : ['compression'];
  const mixes = [];
  for (let mix = 1; mix <= user.mixCount; mix++) {
    const md = state.results[mix];
    if (!md) continue;
    const has = testsToCheck.some(t => (md[t] || []).some(s => s.parsed && s.parsed.pmax > 0));
    if (has) mixes.push({ mix });
  }

  const [text, setText] = React.useState('');
  const [paramFilters, setParamFilters] = React.useState({});
  const [picked, setPicked] = React.useState(new Set());

  const designByRun = React.useMemo(() => {
    const m = {}; (user.factorialDesign() || []).forEach(d => { m[d.run] = d; });
    return m;
  }, [user]);
  const factors = ['BR', 'AMF', 'FVF', 'SFL', 'AFL', 'T'];
  const hasParamFilters = Object.values(paramFilters).some(v => v && v !== 'all');

  const filtered = mixes.filter(({ mix }) => {
    if (hasParamFilters) {
      const d = designByRun[mix];
      for (const f of factors) {
        const want = paramFilters[f];
        if (want && want !== 'all') { if (!d || d[f] !== want) return false; }
      }
    }
    if (text && !`N${mix}`.toLowerCase().includes(text.toLowerCase())) return false;
    return true;
  });

  const toggleMix = (mix) => {
    setPicked(p => { const n = new Set(p); n.has(mix) ? n.delete(mix) : n.add(mix); return n; });
  };
  const selectAllVisible = () => setPicked(p => { const n = new Set(p); filtered.forEach(({ mix }) => n.add(mix)); return n; });
  const clearPicked = () => setPicked(new Set());

  const confirmAdd = () => {
    const items = [...picked].map(mix => ({ kind: 'mix', mix }));
    if (items.length) onSelectMany(items);
  };

  return (
    <div className="cal-modal-backdrop" onClick={onClose}>
      <div className="picker-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720 }}>
        <div className="picker-header">
          <h3>{T.pickMixes || 'Añadir mezclas (1 punto por mezcla)'}</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{picked.size} {T.selectedCount || 'seleccionados'}</span>
            <button className="vt-btn" onClick={selectAllVisible}>{T.selectVisible || 'Todos visibles'}</button>
            <button className="vt-btn" onClick={clearPicked}>{T.clear || 'Limpiar'}</button>
            <button className="vt-btn primary" onClick={confirmAdd} disabled={picked.size === 0}>+ {T.addSelected || 'Añadir'} ({picked.size})</button>
            <button className="cal-close" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="viewer-hint" style={{ margin: '4px 12px' }}>
          {T.mixPickerHint || 'Cada mezcla marcada se agrega como un solo punto. El ensayo (compresión/flexión) y la edad se eligen por eje, arriba del gráfico — pueden mezclarse entre el eje X y el eje Y.'}
        </div>
        <div className="picker-filters">
          <input className="picker-search" placeholder={T.search || 'Buscar…'} value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        {user.hasFactorial && (
          <div className="picker-params">
            {factors.map(f => (
              <div key={f} className="picker-param">
                <span>{f}</span>
                <select value={paramFilters[f] || 'all'} onChange={(e) => setParamFilters(p => ({ ...p, [f]: e.target.value }))}>
                  <option value="all">—</option><option value="+">+</option><option value="0">0</option><option value="-">−</option>
                </select>
              </div>
            ))}
            {hasParamFilters && (
              <button className="vt-btn" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => setParamFilters({})}>✕ Limpiar</button>
            )}
          </div>
        )}
        <div className="picker-list">
          {filtered.length === 0 && <div className="hint-empty">{T.noCurves || 'No hay ensayos.'}</div>}
          {filtered.map(({ mix }) => {
            const sel = picked.has(mix);
            return (
              <div key={mix} className={'picker-item' + (sel ? ' selected' : '')} onClick={() => toggleMix(mix)}>
                <input type="checkbox" checked={sel} readOnly />
                <span className="pi-mix">N{mix}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------- Pestaña principal de Análisis ----------
function AnalysisTab({ state, user, T, lang }) {
  const storeKey = 'tesis_analysis_' + user.id + '_v2';
  const [selected, setSelected] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem(storeKey) || '[]'); } catch { return []; }
  });
  const [xVarId, setXVarId] = React.useState('pmaxKN');
  const [yVarId, setYVarId] = React.useState('pmaxMPa');
  const [xAge, setXAge] = React.useState('item');
  const [yAge, setYAge] = React.useState('item');
  const [picker, setPicker] = React.useState(false);
  const [mixPicker, setMixPicker] = React.useState(false);
  const [xTest, setXTest] = React.useState('compression');
  const [yTest, setYTest] = React.useState('compression');
  const [visibleMap, setVisibleMap] = React.useState({});
  const [colorMap, setColorMap] = React.useState({});
  const [nameMap, setNameMap] = React.useState({});
  const [colorBy, setColorBy] = React.useState('none');
  const [zoomViewBox, setZoomViewBox] = React.useState(null);
  const [axisMode, setAxisMode] = React.useState('auto');
  const [manualAxis, setManualAxis] = React.useState({ xMin: 0, xMax: 1, yMin: 0, yMax: 1 });

  React.useEffect(() => { localStorage.setItem(storeKey, JSON.stringify(selected)); }, [selected, storeKey]);

  const showDesign = user.id === 'rodrigo' && !!window.MIX_PARAMS;
  const availableVars = AXIS_VARS.filter(v => v.group !== 'design' || showDesign);
  const xVar = availableVars.find(v => v.id === xVarId) || availableVars[0];
  const yVar = availableVars.find(v => v.id === yVarId) || availableVars[1];

  const designByRun = React.useMemo(() => {
    const m = {}; (user.factorialDesign() || []).forEach(d => { m[d.run] = d; });
    return m;
  }, [user]);
  const hasFactorLevels = user.hasFactorial && designByRun[1] && designByRun[1].BR;
  const COLOR_FACTORS = ['BR', 'AMF', 'FVF', 'SFL', 'AFL', 'T'];
  const LEVEL_COLOR = { '-': '#2166ac', '0': '#7f7f7f', '+': '#b2182b' };
  const LEVEL_NAME = { '-': (T.low || 'Bajo (−1)'), '0': (T.center || 'Centro (0)'), '+': (T.high || 'Alto (+1)') };

  const addMany = (items) => {
    setSelected(prev => {
      const existing = new Set(prev.map(s => s.key));
      const toAdd = [];
      for (const it of items) {
        const key = keyOfItem(it);
        if (existing.has(key)) continue;
        if (prev.length + toAdd.length >= 150) break;
        existing.add(key);
        toAdd.push({ key, ...it });
      }
      setColorMap(m => {
        const n = { ...m };
        toAdd.forEach((it, i) => { if (!n[it.key]) n[it.key] = ANALYSIS_PALETTE[(prev.length + i) % ANALYSIS_PALETTE.length]; });
        return n;
      });
      setVisibleMap(m => {
        const n = { ...m };
        toAdd.forEach(it => { if (n[it.key] === undefined) n[it.key] = true; });
        return n;
      });
      return [...prev, ...toAdd];
    });
  };
  const removeItem = (key) => setSelected(s => s.filter(x => x.key !== key));

  const points = selected.map((s, i) => {
    const x = evalAxisVar(xVar, s, state, xVar.group === 'mech' ? xAge : null, xTest);
    const y = evalAxisVar(yVar, s, state, yVar.group === 'mech' ? yAge : null, yTest);
    let color = colorMap[s.key] || ANALYSIS_PALETTE[i % ANALYSIS_PALETTE.length];
    if (colorBy !== 'none') {
      const d = designByRun[s.mix];
      if (d && d[colorBy] != null && LEVEL_COLOR[d[colorBy]]) color = LEVEL_COLOR[d[colorBy]];
    }
    return { key: s.key, x, y, color, label: nameMap[s.key] || defaultAnalysisLabel(s), visible: visibleMap[s.key] !== false };
  });
  const plotPoints = points.filter(p => p.visible);
  const validCount = plotPoints.filter(p => p.x != null && p.y != null).length;

  const autoExtent = React.useMemo(() => {
    const valid = plotPoints.filter(p => p.x != null && p.y != null);
    if (!valid.length) return { xMin: 0, xMax: 1, yMin: 0, yMax: 1 };
    const xs = valid.map(p => p.x), ys = valid.map(p => p.y);
    return { xMin: Math.min(...xs), xMax: Math.max(...xs), yMin: Math.min(...ys), yMax: Math.max(...ys) };
  }, [plotPoints]);
  const enterManual = () => {
    const r = (v) => Math.round(v * 10000) / 10000;
    setManualAxis({ xMin: r(autoExtent.xMin), xMax: r(autoExtent.xMax), yMin: r(autoExtent.yMin), yMax: r(autoExtent.yMax) });
    setAxisMode('manual');
  };
  const setAx = (k, v) => setManualAxis(a => ({ ...a, [k]: v === '' ? '' : parseFloat(v) }));
  const effectiveViewBox = axisMode === 'manual'
    ? { xMin: +manualAxis.xMin || 0, xMax: +manualAxis.xMax || 1, yMin: +manualAxis.yMin || 0, yMax: +manualAxis.yMax || 1 }
    : zoomViewBox;

  const axisFullLabel = (v, age, test) => {
    if (v.group !== 'mech') return v.label;
    const testLabel = user.hasFlexion ? (test === 'flexion' ? (T.flexion || 'Flexión') : (T.compression || 'Compresión')) : '';
    const ageLabel = age && age !== 'item' ? `${age}d` : '';
    const suffix = [testLabel, ageLabel].filter(Boolean).join(', ');
    return suffix ? `${v.label} — ${suffix}` : v.label;
  };

  const exportCSV = () => {
    let csv = `Label,X (${axisFullLabel(xVar, xAge, xTest)}),Y (${axisFullLabel(yVar, yAge, yTest)})\n`;
    points.forEach(p => { csv += `"${p.label}",${p.x != null ? p.x : ''},${p.y != null ? p.y : ''}\n`; });
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'analisis.csv'; a.click();
  };
  const exportPNG = async () => {
    const svg = document.querySelector('.scatter-plot-wrap svg');
    if (!svg) return;
    const xml = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = svg.clientWidth * 2; canvas.height = svg.clientHeight * 2;
      const ctx = canvas.getContext('2d');
      ctx.scale(2, 2);
      ctx.fillStyle = 'white'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'analisis.png'; a.click(); });
    };
    img.src = url;
  };

  const renderVarSelect = (value, onChange) => (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {['mech', 'ratio', 'design'].map(g => {
        const opts = availableVars.filter(v => v.group === g);
        if (!opts.length) return null;
        return (
          <optgroup key={g} label={GROUP_LABELS[g]}>
            {opts.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
          </optgroup>
        );
      })}
    </select>
  );

  const allAgesForAxis = React.useMemo(() => {
    const s = new Set();
    for (let mix = 1; mix <= user.mixCount; mix++) {
      const md = state.results[mix];
      if (!md) continue;
      (user.hasFlexion ? ['flexion', 'compression'] : ['compression']).forEach(test => {
        (md[test] || []).forEach(sp => { if (sp.parsed && sp.parsed.pmax > 0) s.add(sp.age); });
      });
    }
    return [...s].sort((a, b) => a - b);
  }, [state, user]);

  const renderAgeSelect = (varDef, value, onChange) => {
    if (varDef.group !== 'mech') return null;
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} title={T.axisAgeHint || 'Edad fija para este eje (ignora la edad del punto)'}>
        <option value="item">{T.axisAgeItem || 'Edad del punto'}</option>
        {allAgesForAxis.map(a => <option key={a} value={a}>{a}{T.day || 'd'} {T.fixed || 'fijo'}</option>)}
      </select>
    );
  };

  const renderTestSelect = (varDef, value, onChange) => {
    if (varDef.group !== 'mech' || !user.hasFlexion) return null;
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} title={T.axisTestHint || 'Ensayo usado para este eje (compresión o flexión)'}>
        <option value="compression">{T.compression || 'Compresión'}</option>
        <option value="flexion">{T.flexion || 'Flexión'}</option>
      </select>
    );
  };

  return (
    <div className="comparator">
      <div className="comp-header">
        <h2>{T.analysisTitle || 'Análisis de variables'}</h2>
        <div className="comp-actions">
          <button className="vt-btn" onClick={() => setMixPicker(true)} disabled={selected.length >= 150}>
            + {T.addMixPoint || 'Añadir mezclas'}
          </button>
          <button className="vt-btn" onClick={() => setPicker(true)} disabled={selected.length >= 150}>
            + {T.addPoint || 'Añadir puntos'}
          </button>
          <button className="vt-btn" onClick={() => setSelected([])} disabled={selected.length === 0}>
            🗑 {T.clearAll || 'Quitar todas'}
          </button>
          <button className="vt-btn" onClick={exportPNG} disabled={!plotPoints.length}>PNG</button>
          <button className="vt-btn" onClick={exportCSV} disabled={!points.length}>CSV</button>
        </div>
      </div>

      <div className="comp-controls">
        <div className="vt-group">
          <span className="vt-label">{T.xAxis || 'Eje X'}</span>
          {renderVarSelect(xVarId, setXVarId)}
          {renderTestSelect(xVar, xTest, setXTest)}
          {renderAgeSelect(xVar, xAge, setXAge)}
        </div>
        <div className="vt-group">
          <span className="vt-label">{T.yAxis || 'Eje Y'}</span>
          {renderVarSelect(yVarId, setYVarId)}
          {renderTestSelect(yVar, yTest, setYTest)}
          {renderAgeSelect(yVar, yAge, setYAge)}
        </div>
        <div className="vt-group">
          <span className="vt-label">{T.axisLabel || 'Ejes'}</span>
          <div className="unit-toggle">
            <button className={axisMode === 'auto' ? 'active' : ''} onClick={() => { setAxisMode('auto'); }}>{T.axisAuto || 'Auto'}</button>
            <button className={axisMode === 'manual' ? 'active' : ''} onClick={enterManual}>{T.axisManual || 'Manual'}</button>
          </div>
          {axisMode === 'manual' && (
            <div className="axis-inputs">
              <label>X<input type="number" step="any" value={manualAxis.xMin} onChange={(e) => setAx('xMin', e.target.value)} /></label>
              <span>–</span>
              <label><input type="number" step="any" value={manualAxis.xMax} onChange={(e) => setAx('xMax', e.target.value)} /></label>
              <label>Y<input type="number" step="any" value={manualAxis.yMin} onChange={(e) => setAx('yMin', e.target.value)} /></label>
              <span>–</span>
              <label><input type="number" step="any" value={manualAxis.yMax} onChange={(e) => setAx('yMax', e.target.value)} /></label>
            </div>
          )}
        </div>
      </div>

      {hasFactorLevels && (
        <div className="comp-controls comp-encode">
          <div className="vt-group">
            <span className="vt-label">{T.colorByLabel || 'Color por factor'}</span>
            <select value={colorBy} onChange={(e) => setColorBy(e.target.value)}>
              <option value="none">{T.encNone || '— (colores individuales)'}</option>
              {COLOR_FACTORS.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
            {colorBy !== 'none' && (
              <div className="enc-legend">
                {['-', '0', '+'].map(lv => (
                  <span key={lv} className="enc-item">
                    <span className="swatch" style={{ background: LEVEL_COLOR[lv] }}></span>
                    {colorBy} {LEVEL_NAME[lv]}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="comp-layout">
        <div className="compare-plot-wrap scatter-plot-wrap">
          {axisMode === 'auto' && zoomViewBox && (
            <div className="zoom-reset-bar">
              <span>Zoom activo</span>
              <button className="vt-btn" onClick={() => setZoomViewBox(null)}>↺ Reset zoom</button>
            </div>
          )}
          <ScatterPlot
            points={plotPoints}
            xLabel={axisFullLabel(xVar, xAge, xTest)}
            yLabel={axisFullLabel(yVar, yAge, yTest)}
            width={640} height={640}
            viewBox={effectiveViewBox}
            onZoom={axisMode === 'manual' ? null : ((box) => setZoomViewBox(box))}
          />
          <div className="viewer-hint" style={{ margin: 8 }}>
            {validCount}/{selected.length} {T.pointsWithData || 'puntos con datos válidos para los ejes elegidos'}.
          </div>
        </div>
        <div className="comp-legend">
          <div className="legend-title">{T.points || 'Puntos'} ({points.length})</div>
          {selected.length === 0 && <div className="hint-empty">{T.analysisEmpty || 'Añade puntos para analizar.'}</div>}
          {points.map((p) => (
            <div key={p.key} className="legend-row" style={{ gridTemplateColumns: '20px 26px 1fr auto auto' }}>
              <input type="checkbox" checked={visibleMap[p.key] !== false} onChange={(e) => setVisibleMap(m => ({ ...m, [p.key]: e.target.checked }))} />
              <input type="color" value={colorMap[p.key] || '#1a4f8b'} onChange={(e) => setColorMap(m => ({ ...m, [p.key]: e.target.value }))} />
              <input className="leg-name" value={nameMap[p.key] || defaultAnalysisLabel(selected.find(s => s.key === p.key))}
                     onChange={(e) => setNameMap(m => ({ ...m, [p.key]: e.target.value }))} />
              <span className="leg-stats">X: {fmtAxisNum(p.x)} · Y: {fmtAxisNum(p.y)}</span>
              <button className="leg-x" onClick={() => removeItem(p.key)}>✕</button>
            </div>
          ))}
        </div>
      </div>

      {picker && (
        <AnalysisPicker state={state} user={user}
          onSelectMany={(items) => { addMany(items); setPicker(false); }}
          onClose={() => setPicker(false)}
          T={T} />
      )}
      {mixPicker && (
        <MixPicker state={state} user={user}
          onSelectMany={(items) => {
            addMany(items);
            setMixPicker(false);
            // Las mezclas requieren una edad fija por eje (no tienen "edad propia").
            if (xVar.group === 'mech' && xAge === 'item') setXAge(allAgesForAxis.includes(7) ? '7' : (allAgesForAxis[0] ? String(allAgesForAxis[0]) : 'item'));
            if (yVar.group === 'mech' && yAge === 'item') setYAge(allAgesForAxis.includes(28) ? '28' : (allAgesForAxis[allAgesForAxis.length - 1] ? String(allAgesForAxis[allAgesForAxis.length - 1]) : 'item'));
          }}
          onClose={() => setMixPicker(false)}
          T={T} />
      )}
    </div>
  );
}

window.AnalysisTab = AnalysisTab;
