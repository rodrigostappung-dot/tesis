// ===== VISUALIZADOR + COMPARADOR =====
// El visualizador permite:
//   - Mostrar la curva completa de un ensayo
//   - Recortar el origen: clickear un punto y desplazar t/load/disp/stress/strain a 0 ahí
//   - Marcar "first peak" manualmente con click
//   - Toggle kN ↔ MPa (recalcula stress según test y dimensiones)
//   - Botón "Reset" para volver al original
//
// Los cambios (trimIdx, firstPeakIdx) se guardan en la propia probeta.
// El comparador toma N ensayos en una lista y los grafica juntos con
// la trim/firstPeak aplicada de cada uno.

const PALETTE = [
  '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
  '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf',
];

// Aplica recorte: devuelve {points: [...]} con valores desplazados al origen del trimIdx
// y opcionalmente truncados en trimEndIdx (inclusive).
window.applyTrim = function(parsed, trimIdx, trimEndIdx) {
  if (!parsed || !parsed.points || !parsed.points.length) return parsed;
  const start = trimIdx && trimIdx > 0 ? trimIdx : 0;
  const end = trimEndIdx != null && trimEndIdx > start ? Math.min(trimEndIdx + 1, parsed.points.length) : parsed.points.length;
  if (start === 0 && end === parsed.points.length) return parsed;
  const t0 = parsed.points[start];
  if (!t0) return parsed;
  const pts = parsed.points.slice(start, end).map(p => ({
    t: p.t - t0.t,
    load: p.load - t0.load,
    disp: p.disp - t0.disp,
    stress: p.stress - t0.stress,
    strain: p.strain - t0.strain,
    elong: p.elong - t0.elong,
  }));
  let pmax = 0, smax = 0, idxPmax = 0;
  pts.forEach((p, i) => {
    if (p.load > pmax) { pmax = p.load; idxPmax = i; }
    if (p.stress > smax) smax = p.stress;
  });
  return { ...parsed, points: pts, pmax, smax, idxPmax, nPoints: pts.length };
};

// Calcula tensión en MPa para flexión / compresión usando dimensiones de la probeta.
// length=lado1 (largo), height=lado2, width=lado3
// Flexión: σ = 3·P·L / (2·b·d²), P en N, dim mm, L=100mm (10cm), b=height, d=length
// Compresión: σ = P / (height·width), área en mm²
window.computeStressMPa = function(loadKN, testKey, dims) {
  const L = 100; // mm
  const len = parseFloat(dims.length);
  const hei = parseFloat(dims.height);
  const wid = parseFloat(dims.width);
  const P = loadKN * 1000; // N
  if (testKey === 'compression') {
    if (!hei || !wid) return null;
    return P / (hei * wid);
  }
  if (testKey === 'flexion') {
    if (!hei || !len) return null;
    return (3 * P * L) / (2 * hei * len * len);
  }
  return null;
};

// ----- RETRACCIÓN: serie tiempo (días) vs cambio (μm/m) -----
// Día 0 = base. Para cada edad t, change(t) = mean(values[t]) - mean(values[0]).
// Si una probeta no tiene día 0 cargado, no se puede normalizar — devolvemos null.
window.shrinkageSeries = function(specimen, ages = [0, 1, 7, 28]) {
  const meanOf = (arr) => {
    if (!Array.isArray(arr)) arr = [arr];
    const v = arr.map(x => parseFloat(x)).filter(x => !isNaN(x));
    if (!v.length) return null;
    return v.reduce((a, b) => a + b, 0) / v.length;
  };
  const base = meanOf(specimen.values?.[0]);
  if (base == null) return null;
  const pts = [];
  for (const t of ages) {
    const m = meanOf(specimen.values?.[t]);
    if (m == null) continue;
    pts.push({ t, change: m - base, raw: m });
  }
  return { base, points: pts };
};

// Promedio de las dos probetas A y B para una mezcla (cambio vs tiempo)
window.shrinkageMixSeries = function(retractionSpecs, ages = [0, 1, 7, 28]) {
  // Para cada edad, promediar el "cambio" entre las probetas que tengan día 0 + ese día t
  const pts = [];
  for (const t of ages) {
    const changes = [];
    for (const spec of retractionSpecs) {
      const s = window.shrinkageSeries(spec, [0, t]);
      if (!s) continue;
      const found = s.points.find(p => p.t === t);
      if (found) changes.push(found.change);
    }
    if (changes.length === 0) continue;
    const avg = changes.reduce((a, b) => a + b, 0) / changes.length;
    pts.push({ t, change: avg, n: changes.length });
  }
  return pts;
};

// ---------- Curve plot component (SVG, supports zoom/pan, hover, click) ----------
function CurvePlot({
  points, xKey = 'disp', yKey = 'load',
  width = 760, height = 420,
  pmaxIdx = null, firstPeakIdx = null, trimIdx = null,
  onClickPoint = null, onHover = null,
  highlightPmax = true, highlightFirstPeak = true,
  xLabel = 'Desplazamiento (mm)', yLabel = 'Carga (kN)',
  color = '#1a4f8b', viewBox = null,
  showAxes = true,
  invertY = false,
  series = null,
}) {
  const W = width, H = height;
  const padL = 60, padR = 16, padT = 16, padB = 44;

  // Si hay series múltiples (modo comparador), unir todos para autoscale
  const allPoints = series ? series.flatMap(s => s.points) : points;
  if (!allPoints || !allPoints.length) {
    return <svg width={W} height={H}><text x="50%" y="50%" textAnchor="middle" fill="#999">Sin datos</text></svg>;
  }

  const xs = allPoints.map(p => p[xKey]);
  const ys = allPoints.map(p => p[yKey]);
  let xMin = viewBox ? viewBox.xMin : Math.min(...xs, 0);
  let xMax = viewBox ? viewBox.xMax : Math.max(...xs);
  let yMin = viewBox ? viewBox.yMin : Math.min(...ys, 0);
  let yMax = viewBox ? viewBox.yMax : Math.max(...ys);
  // padding
  if (!viewBox) {
    const xR = xMax - xMin || 1, yR = yMax - yMin || 1;
    xMax += xR * 0.02; yMax += yR * 0.05;
  }
  const sx = (x) => padL + ((x - xMin) / (xMax - xMin || 1)) * (W - padL - padR);
  const sy = invertY
    ? (y) => padT + ((y - yMin) / (yMax - yMin || 1)) * (H - padT - padB)
    : (y) => H - padB - ((y - yMin) / (yMax - yMin || 1)) * (H - padT - padB);

  const buildPath = (pts) => pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p[xKey]).toFixed(1)},${sy(p[yKey]).toFixed(1)}`).join(' ');

  // Ticks
  const niceTicks = (mn, mx, count = 5) => {
    const range = mx - mn;
    const step0 = range / count;
    const mag = Math.pow(, Math.floor(Math.log(step0)));
    const norm = step0 / mag;
    const niceStep = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
    const start = Math.ceil(mn / niceStep) * niceStep;
    const ticks = [];
    for (let v = start; v <= mx; v += niceStep) ticks.push(v);
    return ticks;
  };
  const xTicks = niceTicks(xMin, xMax);
  const yTicks = niceTicks(yMin, yMax);

  const handleClick = (e) => {
    if (!onClickPoint || !points) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * W;
    // Find nearest point by X
    let best = 0, bestD = Infinity;
    for (let i = 0; i < points.length; i++) {
      const px = sx(points[i][xKey]);
      const d = Math.abs(px - mx);
      if (d < bestD) { bestD = d; best = i; }
    }
    onClickPoint(best, points[best]);
  };

  return (
    <svg width={W} height={H} className="curve-plot"
         style={{ cursor: onClickPoint ? 'crosshair' : 'default', background: '#fcfcfd' }}
         onClick={handleClick}>
      {/* Grid */}
      {showAxes && (
        <>
          {xTicks.map(t => (
            <line key={'gx' + t} x1={sx(t)} y1={padT} x2={sx(t)} y2={H - padB}
                  stroke="#eef0f3" strokeWidth="1" />
          ))}
          {yTicks.map(t => (
            <line key={'gy' + t} x1={padL} y1={sy(t)} x2={W - padR} y2={sy(t)}
                  stroke="#eef0f3" strokeWidth="1" />
          ))}
        </>
      )}
      {/* Axes */}
      <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="#666" strokeWidth="1" />
      <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke="#666" strokeWidth="1" />
      {/* Tick labels */}
      {showAxes && xTicks.map(t => (
        <text key={'lx' + t} x={sx(t)} y={H - padB + 16} textAnchor="middle" fontSize="11" fill="#555" fontFamily="ui-monospace, monospace">{t.toFixed(2)}</text>
      ))}
      {showAxes && yTicks.map(t => (
        <text key={'ly' + t} x={padL - 8} y={sy(t) + 4} textAnchor="end" fontSize="11" fill="#555" fontFamily="ui-monospace, monospace">{t.toFixed(2)}</text>
      ))}
      {/* Axis labels */}
      <text x={(W + padL) / 2} y={H - 8} textAnchor="middle" fontSize="12" fill="#333">{xLabel}</text>
      <text x={16} y={(H - padB + padT) / 2} textAnchor="middle" fontSize="12" fill="#333"
            transform={`rotate(-90 16 ${(H - padB + padT) / 2})`}>{yLabel}</text>

      {/* Data */}
      {series ? series.map((s, i) => (
        <path key={i} d={buildPath(s.points)} fill="none"
              stroke={s.color}
              strokeWidth={s.kind === 'avg' || s.kind === 'mechAvg' || s.kind === 'shrinkMix' ? 2.6 : 1.6}
              strokeDasharray={s.kind === 'avg' ? '6,3' : (s.kind === 'mechAvg' || s.kind === 'shrinkMix' ? '4,2' : undefined)} />
      )) : (
        <path d={buildPath(points)} fill="none" stroke={color} strokeWidth="1.6" />
      )}

      {/* Markers */}
      {!series && highlightPmax && pmaxIdx != null && points[pmaxIdx] && (
        <g>
          <circle cx={sx(points[pmaxIdx][xKey])} cy={sy(points[pmaxIdx][yKey])} r="5" fill="#d62728" />
          <text x={sx(points[pmaxIdx][xKey]) + 8} y={sy(points[pmaxIdx][yKey]) - 6} fontSize="11" fill="#d62728" fontWeight="600">P max</text>
        </g>
      )}
      {!series && highlightFirstPeak && firstPeakIdx != null && points[firstPeakIdx] && (
        <g>
          <circle cx={sx(points[firstPeakIdx][xKey])} cy={sy(points[firstPeakIdx][yKey])} r="5" fill="#2ca02c" />
          <text x={sx(points[firstPeakIdx][xKey]) + 8} y={sy(points[firstPeakIdx][yKey]) - 6} fontSize="11" fill="#2ca02c" fontWeight="600">1st peak</text>
        </g>
      )}
      {!series && trimIdx != null && trimIdx > 0 && points[0] && (
        <g>
          <line x1={sx(0)} y1={padT} x2={sx(0)} y2={H - padB} stroke="#888" strokeDasharray="3,3" />
        </g>
      )}
    </svg>
  );
}

// ---------- Visualizador individual ----------
function IndividualViewer({ specimen, testKey, onUpdate, onAddToCompare, T }) {
  const parsed = specimen?.parsed;
  if (!parsed || !parsed.points || !parsed.points.length) {
    return <div className="viewer-empty">{T.viewerEmpty || 'Sin datos cargados'}</div>;
  }
  const [mode, setMode] = React.useState('view'); // 'view' | 'setTrim' | 'setTrimEnd' | 'setPeak'
  const [unitMode, setUnitMode] = React.useState('kN');

  // Apply trim
  const trimmed = (specimen.trimIdx || specimen.trimEndIdx != null)
    ? window.applyTrim(parsed, specimen.trimIdx, specimen.trimEndIdx)
    : parsed;

  // If MPa, recompute stress for each point using dimensions
  const displayPoints = React.useMemo(() => {
    if (unitMode === 'kN') return trimmed.points;
    return trimmed.points.map(p => {
      const mpa = window.computeStressMPa(p.load, testKey, specimen);
      return { ...p, load: mpa != null ? mpa : 0 };
    });
  }, [trimmed.points, unitMode, testKey, specimen.length, specimen.height, specimen.width]);

  // Indices in trimmed array (firstPeakIdx and pmaxIdx might need adjustment if trim was applied)
  // We store firstPeakIdx relative to the ORIGINAL parsed.points
  const trimOffset = specimen.trimIdx || 0;
  const localPmaxIdx = trimmed.idxPmax;
  const localFirstPeakIdx = specimen.firstPeakIdx != null
    ? Math.max(0, specimen.firstPeakIdx - trimOffset)
    : null;

  const handlePlotClick = (i, pt) => {
    if (mode === 'setTrim') {
      const absIdx = (specimen.trimIdx || 0) + i;
      onUpdate({ ...specimen, trimIdx: absIdx });
      setMode('view');
    } else if (mode === 'setTrimEnd') {
      const absIdx = (specimen.trimIdx || 0) + i;
      onUpdate({ ...specimen, trimEndIdx: absIdx });
      setMode('view');
    } else if (mode === 'setPeak') {
      const absIdx = (specimen.trimIdx || 0) + i;
      onUpdate({ ...specimen, firstPeakIdx: absIdx });
      setMode('view');
    }
  };

  const reset = () => onUpdate({ ...specimen, trimIdx: null, trimEndIdx: null, firstPeakIdx: null });

  const yLabel = unitMode === 'kN' ? 'Carga P (kN)' : 'Tensión σ (MPa)';
  const xLabel = 'Desplazamiento (mm)';

  // First-peak value
  const firstPeakValue = localFirstPeakIdx != null && displayPoints[localFirstPeakIdx]
    ? displayPoints[localFirstPeakIdx].load
    : null;
  const pmaxValue = displayPoints[localPmaxIdx]?.load;

  return (
    <div className="viewer-individual">
      <div className="viewer-toolbar">
        <div className="vt-group">
          <button className={'vt-btn' + (mode === 'setTrim' ? ' active' : '')}
                  onClick={() => setMode(mode === 'setTrim' ? 'view' : 'setTrim')}>
            ✂ {T.setOrigin || 'Fijar inicio'}
          </button>
          <button className={'vt-btn' + (mode === 'setTrimEnd' ? ' active' : '')}
                  onClick={() => setMode(mode === 'setTrimEnd' ? 'view' : 'setTrimEnd')}>
            ✂▸ {T.setEnd || 'Fijar fin'}
          </button>
          <button className={'vt-btn' + (mode === 'setPeak' ? ' active' : '')}
                  onClick={() => setMode(mode === 'setPeak' ? 'view' : 'setPeak')}>
            ⬆ {T.setFirstPeak || 'Primer peak'}
          </button>
          <button className="vt-btn" onClick={reset}
                  disabled={!specimen.trimIdx && specimen.trimEndIdx == null && specimen.firstPeakIdx == null}>
            ↺ {T.reset || 'Resetear'}
          </button>
        </div>
        <div className="vt-group">
          <div className="unit-toggle">
            <button className={unitMode === 'kN' ? 'active' : ''} onClick={() => setUnitMode('kN')}>kN</button>
            <button className={unitMode === 'MPa' ? 'active' : ''} onClick={() => setUnitMode('MPa')}>MPa</button>
          </div>
          {onAddToCompare && (
            <button className="vt-btn primary" onClick={onAddToCompare}>
              + {T.addToCompare || 'Comparar'}
            </button>
          )}
        </div>
      </div>

      {mode !== 'view' && (
        <div className="viewer-hint">
          {mode === 'setTrim'
            ? (T.hintTrim || 'Click en el punto que será el nuevo origen (t=0, P=0, disp=0).')
            : mode === 'setTrimEnd'
            ? (T.hintTrimEnd || 'Click en el último punto a conservar.')
            : (T.hintPeak || 'Click en el primer peak de la curva.')}
        </div>
      )}

      <CurvePlot
        points={displayPoints}
        pmaxIdx={localPmaxIdx}
        firstPeakIdx={localFirstPeakIdx}
        trimIdx={specimen.trimIdx}
        onClickPoint={handlePlotClick}
        xLabel={xLabel}
        yLabel={yLabel}
      />

      <div className="viewer-stats">
        <div className="stat-block">
          <div className="sb-k">P max</div>
          <div className="sb-v">{pmaxValue != null ? pmaxValue.toFixed(2) : '—'} {unitMode}</div>
        </div>
        <div className="stat-block">
          <div className="sb-k">{T.firstPeak || 'Primer peak'}</div>
          <div className="sb-v">{firstPeakValue != null ? firstPeakValue.toFixed(2) : '—'} {firstPeakValue != null ? unitMode : ''}</div>
        </div>
        <div className="stat-block">
          <div className="sb-k">{T.points || 'puntos'}</div>
          <div className="sb-v">{displayPoints.length}</div>
        </div>
        <div className="stat-block">
          <div className="sb-k">{T.trimmed || 'Recorte'}</div>
          <div className="sb-v" style={{fontSize: 12}}>
            {specimen.trimIdx ? `↦ ${specimen.trimIdx}` : '—'}
            {specimen.trimEndIdx != null ? ` ↤ ${specimen.trimEndIdx}` : ''}
          </div>
        </div>
      </div>
    </div>
  );
}

// Largo inicial de probeta para % retracción
window.SHRINKAGE_L0_MM = 250;

// Convierte Δ (μm/m o unidad bruta) a % usando L0=250mm. Usuario indicó dividir por 250.
window.shrinkToPercent = function(delta) {
  return delta / window.SHRINKAGE_L0_MM;
};

// ---------- Visualizador de RETRACCIÓN (cambio vs tiempo) ----------
function ShrinkageViewer({ specimens, mix, T, user, mixData }) {
  const [unit, setUnit] = React.useState('um'); // 'um' | 'percent'
  const series = [];
  const ages = user
    ? window.getShrinkAgesForMix(user, mixData || { retraction: specimens })
    : window.SHRINKAGE_AGES;

  const PALETTE_RET = ['#1f77b4', '#ff7f0e', '#9467bd', '#8c564b', '#e377c2', '#bcbd22'];
  const toUnit = (v) => unit === 'percent' ? window.shrinkToPercent(v) : v;

  specimens.forEach((spec, i) => {
    const s = window.shrinkageSeries(spec, ages);
    if (!s) return;
    series.push({
      points: s.points.map(p => ({ disp: p.t, load: toUnit(p.change), t: p.t, stress: toUnit(p.change), strain: 0, elong: 0 })),
      color: PALETTE_RET[i % PALETTE_RET.length],
      label: `${T.specimen || 'Probeta'} ${spec.id}`,
    });
  });

  const avgPts = window.shrinkageMixSeries(specimens, ages);
  if (avgPts.length > 0) {
    series.push({
      points: avgPts.map(p => ({ disp: p.t, load: toUnit(p.change), t: p.t, stress: toUnit(p.change), strain: 0, elong: 0 })),
      color: '#2ca02c',
      label: T.avg || 'Promedio',
    });
  }

  if (series.length === 0) {
    return <div className="viewer-empty">{T.shrinkNeedsBase || 'Falta ingresar el día 0 (base) en al menos una probeta.'}</div>;
  }

  const yLabel = unit === 'percent'
    ? (T.shrinkChangePct || 'Cambio Δ (%)')
    : (T.shrinkChange || 'Cambio Δ (μm/m)');
  const fmt = unit === 'percent' ? (v) => v.toFixed(3) : (v) => v.toFixed(0);

  return (
    <div className="viewer-individual">
      <div className="viewer-toolbar">
        <div className="vt-group">
          <span style={{fontSize: 11, color: 'var(--text-3)'}}>
            {T.shrinkBaselineHint || 'Día 0 = base. Curva = lectura − base.'}
          </span>
        </div>
        <div className="vt-group">
          <div className="unit-toggle">
            <button className={unit === 'um' ? 'active' : ''} onClick={() => setUnit('um')}>μm/m</button>
            <button className={unit === 'percent' ? 'active' : ''} onClick={() => setUnit('percent')}>%</button>
          </div>
        </div>
      </div>
      <CurvePlot
        series={series}
        xLabel={T.timeDays || 'Tiempo (días)'}
        yLabel={yLabel}
        width={760} height={420}
        invertY={true}
        highlightPmax={false} highlightFirstPeak={false}
      />
      <div className="comp-legend" style={{maxHeight: 'none', marginTop: 10}}>
        <div className="legend-title">{T.values || 'Valores'} {unit === 'percent' ? '(%)' : '(μm/m)'}</div>
        <table className="shrink-table" style={{margin: 0, border: 0}}>
          <thead>
            <tr>
              <th>{T.specimen}</th>
              {ages.map(a => <th key={a}>{a}{T.day || 'd'}</th>)}
            </tr>
          </thead>
          <tbody>
            {specimens.map((spec) => {
              const s = window.shrinkageSeries(spec, ages);
              return (
                <tr key={spec.id}>
                  <td className="spec-id">{spec.id}</td>
                  {ages.map(a => {
                    if (!s) return <td key={a} className="empty">—</td>;
                    const pt = s.points.find(p => p.t === a);
                    return <td key={a}>{pt ? fmt(toUnit(pt.change)) : '—'}</td>;
                  })}
                </tr>
              );
            })}
            <tr className="avg-row">
              <td>{T.avg}</td>
              {ages.map(a => {
                const pt = avgPts.find(p => p.t === a);
                return <td key={a} className={pt ? 'has-val' : 'empty'}>{pt ? fmt(toUnit(pt.change)) : '—'}</td>;
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- Comparador ----------
function ComparatorView({ state, T, lang }) {
  // Lista de "selecciones" en localStorage temporal
  const [selected, setSelected] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem('tesis_compare_v1') || '[]'); } catch { return []; }
  });
  const [unitMode, setUnitMode] = React.useState('kN');
  const [shrinkUnit, setShrinkUnit] = React.useState('um'); // 'um' | 'percent'
  const [picker, setPicker] = React.useState(false);
  const [visibleMap, setVisibleMap] = React.useState({}); // key -> bool
  const [colorMap, setColorMap] = React.useState({});
  const [nameMap, setNameMap] = React.useState({});

  React.useEffect(() => {
    localStorage.setItem('tesis_compare_v1', JSON.stringify(selected));
  }, [selected]);

  const addMany = (items) => {
    setSelected(prev => {
      const existingKeys = new Set(prev.map(s => s.key));
      const toAdd = [];
      for (const it of items) {
        let key;
        if (it.kind === 'shrink') key = `${it.mix}_retraction_${it.specimenId}`;
        else if (it.kind === 'shrinkMix') key = `${it.mix}_retraction_mix`;
        else if (it.kind === 'mechAvg') key = `${it.mix}_${it.testKey}_avg_${it.age}`;
        else key = `${it.mix}_${it.testKey}_${it.specimenId}`;
        if (existingKeys.has(key)) continue;
        if (prev.length + toAdd.length >= 100) break;
        existingKeys.add(key);
        toAdd.push({ key, ...it });
      }
      // Set color defaults for new
      setColorMap(m => {
        const next = { ...m };
        toAdd.forEach((it, i) => {
          if (!next[it.key]) next[it.key] = PALETTE[(prev.length + i) % PALETTE.length];
        });
        return next;
      });
      setVisibleMap(m => {
        const next = { ...m };
        toAdd.forEach(it => { if (next[it.key] === undefined) next[it.key] = true; });
        return next;
      });
      return [...prev, ...toAdd];
    });
  };
  const addItem = (item) => addMany([item]);

  const removeItem = (key) => {
    setSelected(s => s.filter(x => x.key !== key));
  };

  // Determinar el "modo" predominante para decidir ejes
  const hasShrink = selected.some(s => s.kind === 'shrink' || s.kind === 'shrinkMix');
  const hasMech = selected.some(s => s.kind === 'mech' || s.kind === 'mechAvg');
  const mixedMode = hasShrink && hasMech;

  // Compose series for the plot
  const toShrinkUnit = (v) => shrinkUnit === 'percent' ? window.shrinkToPercent(v) : v;

  let series = selected.filter(s => visibleMap[s.key] !== false).map((s, i) => {
    const color = colorMap[s.key] || PALETTE[i % PALETTE.length];
    const name = nameMap[s.key];

    if (s.kind === 'shrink') {
      const spec = state.results[s.mix]?.retraction?.find(x => x.id === s.specimenId);
      const seriesData = spec && window.shrinkageSeries(spec);
      if (!seriesData || seriesData.points.length === 0) return null;
      return {
        points: seriesData.points.map(p => ({ disp: p.t, load: toShrinkUnit(p.change), t: p.t, stress: toShrinkUnit(p.change), strain: 0, elong: 0 })),
        color,
        label: name || `N${s.mix} R-${s.specimenId}`,
        key: s.key,
        kind: 'shrink',
      };
    }
    if (s.kind === 'shrinkMix') {
      const retr = state.results[s.mix]?.retraction;
      const pts = retr ? window.shrinkageMixSeries(retr) : [];
      if (!pts.length) return null;
      return {
        points: pts.map(p => ({ disp: p.t, load: toShrinkUnit(p.change), t: p.t, stress: toShrinkUnit(p.change), strain: 0, elong: 0 })),
        color,
        label: name || `N${s.mix} R-avg`,
        key: s.key,
        kind: 'shrinkMix',
      };
    }
    if (s.kind === 'mechAvg') {
      // Promedio de réplicas mecánicas en (mix, test, age)
      const allSpecs = state.results[s.mix]?.[s.testKey] || [];
      const specsAtAge = allSpecs.filter(x => x.age === s.age && x.parsed && x.parsed.pmax > 0);
      if (specsAtAge.length === 0) return null;
      const seriesPts = specsAtAge.map(spec => {
        const trimmed = (spec.trimIdx || spec.trimEndIdx != null)
          ? window.applyTrim(spec.parsed, spec.trimIdx, spec.trimEndIdx)
          : spec.parsed;
        let pts = trimmed.points;
        if (unitMode === 'MPa') {
          pts = pts.map(p => {
            const mpa = window.computeStressMPa(p.load, s.testKey, spec);
            return { ...p, load: mpa != null ? mpa : 0 };
          });
        }
        return pts;
      });
      // Interpolar en X común
      const allXs = new Set();
      for (const pts of seriesPts) for (const p of pts) allXs.add(Math.round(p.disp * 1000) / 1000);
      const xsSorted = [...allXs].sort((a, b) => a - b);
      const sample = (pts, x) => {
        if (pts.length === 0) return null;
        if (x < pts[0].disp || x > pts[pts.length - 1].disp) return null;
        for (let i = 1; i < pts.length; i++) {
          if (pts[i].disp >= x) {
            const a = pts[i - 1], b = pts[i];
            const t = b.disp === a.disp ? 0 : (x - a.disp) / (b.disp - a.disp);
            return a.load + t * (b.load - a.load);
          }
        }
        return null;
      };
      const avgPts = [];
      for (const x of xsSorted) {
        const vals = seriesPts.map(pts => sample(pts, x)).filter(v => v != null);
        if (vals.length === 0) continue;
        const m = vals.reduce((a, b) => a + b, 0) / vals.length;
        avgPts.push({ disp: x, load: m, t: x, stress: m, strain: 0, elong: 0 });
      }
      if (avgPts.length === 0) return null;
      return {
        points: avgPts,
        color,
        label: name || `N${s.mix} ${s.testKey[0].toUpperCase()}-avg ${s.age}d`,
        key: s.key,
        kind: 'mechAvg',
      };
    }
    // mech
    const spec = state.results[s.mix]?.[s.testKey]?.find(x => x.id === s.specimenId);
    if (!spec || !spec.parsed) return null;
    const trimmed = (spec.trimIdx || spec.trimEndIdx != null)
      ? window.applyTrim(spec.parsed, spec.trimIdx, spec.trimEndIdx)
      : spec.parsed;
    let pts = trimmed.points;
    if (unitMode === 'MPa') {
      pts = pts.map(p => {
        const mpa = window.computeStressMPa(p.load, s.testKey, spec);
        return { ...p, load: mpa != null ? mpa : 0 };
      });
    }
    return {
      points: pts,
      color,
      label: name || `N${s.mix} ${s.testKey[0].toUpperCase()}-${s.specimenId}`,
      key: s.key,
      kind: 'mech',
    };
  }).filter(Boolean);

  const exportPNG = async () => {
    const svg = document.querySelector('.compare-plot-wrap svg');
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
      canvas.toBlob(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = 'comparacion.png'; a.click();
      });
    };
    img.src = url;
  };

  const exportCSV = () => {
    let csv = 'Curve,disp_mm,load_' + unitMode + '\n';
    series.forEach(s => {
      s.points.forEach(p => {
        csv += `"${s.label}",${p.disp.toFixed(4)},${p.load.toFixed(4)}\n`;
      });
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'comparacion.csv'; a.click();
  };

  return (
    <div className="comparator">
      <div className="comp-header">
        <h2>{T.comparator || 'Comparador'}</h2>
        <div className="comp-actions">
          {hasShrink && !hasMech ? (
            <div className="unit-toggle">
              <button className={shrinkUnit === 'um' ? 'active' : ''} onClick={() => setShrinkUnit('um')}>μm/m</button>
              <button className={shrinkUnit === 'percent' ? 'active' : ''} onClick={() => setShrinkUnit('percent')}>%</button>
            </div>
          ) : (
            <div className="unit-toggle">
              <button className={unitMode === 'kN' ? 'active' : ''} onClick={() => setUnitMode('kN')}>kN</button>
              <button className={unitMode === 'MPa' ? 'active' : ''} onClick={() => setUnitMode('MPa')}>MPa</button>
            </div>
          )}
          <label style={{display:'none'}}>
            <input type="checkbox" />
          </label>
          <button className="vt-btn" onClick={() => setPicker(true)} disabled={selected.length >= 100}>
            + {T.addCurve || 'Añadir curva'}
          </button>
          <button className="vt-btn" onClick={exportPNG} disabled={!series.length}>PNG</button>
          <button className="vt-btn" onClick={exportCSV} disabled={!series.length}>CSV</button>
        </div>
      </div>

      <div className="comp-layout">
        <div className="compare-plot-wrap">
          <CurvePlot
            series={series}
            xLabel={hasShrink && !hasMech ? (T.timeDays || 'Tiempo (días)') : (T.disp || 'Desplazamiento (mm)')}
            yLabel={hasShrink && !hasMech
              ? (shrinkUnit === 'percent' ? (T.shrinkChangePct || 'Cambio Δ (%)') : (T.shrinkChange || 'Cambio Δ (μm/m)'))
              : (unitMode === 'kN' ? 'Carga P (kN)' : 'Tensión σ (MPa)')}
            width={900} height={520}
            invertY={hasShrink && !hasMech}
            highlightPmax={false} highlightFirstPeak={false}
          />
          {mixedMode && (
            <div className="viewer-hint" style={{margin: 8}}>
              {T.compareMixedWarn || 'Estás mezclando ensayos mecánicos y de retracción: los ejes pueden no ser comparables.'}
            </div>
          )}
        </div>
        <div className="comp-legend">
          <div className="legend-title">{T.curves || 'Curvas'} ({series.length}/{selected.length})</div>
          {selected.length === 0 && <div className="hint-empty">{T.compareEmpty || 'Añade curvas para comparar.'}</div>}
          {selected.map((s, i) => {
            const color = colorMap[s.key] || PALETTE[i % PALETTE.length];
            const visible = visibleMap[s.key] !== false;
            let defaultName, statsLine;
            if (s.kind === 'shrink') {
              const spec = state.results[s.mix]?.retraction?.find(x => x.id === s.specimenId);
              const seriesData = spec && window.shrinkageSeries(spec);
              const last = seriesData?.points[seriesData.points.length - 1];
              defaultName = `N${s.mix} R-${s.specimenId}`;
              statsLine = `Δ${last?.t || '?'}d: ${last?.change?.toFixed(0) || '—'} μm/m`;
            } else if (s.kind === 'shrinkMix') {
              const retr = state.results[s.mix]?.retraction;
              const pts = retr ? window.shrinkageMixSeries(retr) : [];
              const last = pts[pts.length - 1];
              defaultName = `N${s.mix} R-avg`;
              statsLine = `Δ${last?.t || '?'}d: ${last?.change?.toFixed(0) || '—'} μm/m`;
            } else if (s.kind === 'mechAvg') {
              const allSpecs = state.results[s.mix]?.[s.testKey] || [];
              const specsAtAge = allSpecs.filter(x => x.age === s.age && x.parsed && x.parsed.pmax > 0);
              const pmaxes = specsAtAge.map(spec => {
                const t = (spec.trimIdx || spec.trimEndIdx != null) ? window.applyTrim(spec.parsed, spec.trimIdx, spec.trimEndIdx) : spec.parsed;
                return t.pmax;
              });
              const avgPmax = pmaxes.length ? pmaxes.reduce((a,b)=>a+b,0)/pmaxes.length : null;
              defaultName = `N${s.mix} ${s.testKey[0].toUpperCase()}-avg ${s.age}d`;
              statsLine = `Pmax̄ ${avgPmax?.toFixed(2) || '—'} kN · ${specsAtAge.length} probetas · ${s.age}d`;
            } else {
              const spec = state.results[s.mix]?.[s.testKey]?.find(x => x.id === s.specimenId);
              const trimmed = spec && (spec.trimIdx || spec.trimEndIdx != null)
                ? window.applyTrim(spec.parsed, spec.trimIdx, spec.trimEndIdx)
                : spec?.parsed;
              defaultName = `N${s.mix} ${s.testKey[0].toUpperCase()}-${s.specimenId}`;
              statsLine = `Pmax: ${trimmed?.pmax?.toFixed(2) || '—'} kN · σmax: ${trimmed?.smax?.toFixed(1) || '—'} MPa · ${spec?.age}d`;
            }
            const name = nameMap[s.key] || defaultName;
            return (
              <div key={s.key} className="legend-row">
                <input type="checkbox" checked={visible} onChange={(e) => setVisibleMap(m => ({ ...m, [s.key]: e.target.checked }))} />
                <input type="color" value={color} onChange={(e) => setColorMap(m => ({ ...m, [s.key]: e.target.value }))} />
                <input className="leg-name" value={name} onChange={(e) => setNameMap(m => ({ ...m, [s.key]: e.target.value }))} />
                <span className="leg-stats">{statsLine}</span>
                <button className="leg-x" onClick={() => removeItem(s.key)}>✕</button>
              </div>
            );
          })}
        </div>
      </div>

      {picker && (
        <CurvePicker state={state}
          onSelectMany={(items) => { addMany(items); setPicker(false); }}
          onClose={() => setPicker(false)}
          T={T} />
      )}
    </div>
  );
}

// ---------- Curve picker modal (filtros + multi-select) ----------
function CurvePicker({ state, onSelectMany, onClose, T }) {
  // Build items: mech (flexion / compression) + mech-avg + shrinkage per specimen + shrinkage mix-avg
  const items = [];
  for (const mixStr in state.results) {
    const mix = parseInt(mixStr);
    // mechanical: individual + average per (mix, test, age)
    for (const test of ['flexion', 'compression']) {
      const specs = state.results[mixStr][test] || [];
      // group by age
      const byAge = new Map();
      for (const s of specs) {
        if (s.parsed && s.parsed.pmax > 0) {
          items.push({
            kind: 'mech', mix, testKey: test, specimenId: s.id,
            age: s.age, pmax: s.parsed.pmax, smax: s.parsed.smax,
          });
          if (!byAge.has(s.age)) byAge.set(s.age, []);
          byAge.get(s.age).push(s);
        }
      }
      for (const [age, specsAtAge] of byAge.entries()) {
        if (specsAtAge.length >= 2) {
          const pmaxes = specsAtAge.map(s => {
            const t = (s.trimIdx || s.trimEndIdx != null) ? window.applyTrim(s.parsed, s.trimIdx, s.trimEndIdx) : s.parsed;
            return t.pmax;
          });
          const avgPmax = pmaxes.reduce((a,b)=>a+b,0) / pmaxes.length;
          items.push({
            kind: 'mechAvg', mix, testKey: test, specimenId: 'avg',
            age, pmax: avgPmax, smax: 0,
            specimenIds: specsAtAge.map(s => s.id),
          });
        }
      }
    }
    // shrinkage: por probeta (si tiene día 0)
    const retr = state.results[mixStr]?.retraction || [];
    for (const sp of retr) {
      const sd = window.shrinkageSeries(sp);
      if (sd && sd.points.length > 0) {
        const last = sd.points[sd.points.length - 1];
        items.push({
          kind: 'shrink', mix, testKey: 'retraction', specimenId: sp.id,
          age: last.t, change: last.change,
        });
      }
    }
    // shrinkage avg
    const avgPts = window.shrinkageMixSeries(retr);
    if (avgPts.length > 0) {
      const last = avgPts[avgPts.length - 1];
      items.push({
        kind: 'shrinkMix', mix, testKey: 'retraction', specimenId: 'avg',
        age: last.t, change: last.change,
      });
    }
  }
  items.sort((a, b) => a.mix - b.mix || (a.kind || '').localeCompare(b.kind || '') || (a.testKey || '').localeCompare(b.testKey || '') || (a.specimenId || '').localeCompare(b.specimenId || ''));

  const [text, setText] = React.useState('');
  const [filterMix, setFilterMix] = React.useState('all');
  const [filterTest, setFilterTest] = React.useState('all'); // all / retraction / flexion / compression
  const [filterAge, setFilterAge] = React.useState('all');
  const [picked, setPicked] = React.useState(new Set());

  const allMixes = [...new Set(items.map(i => i.mix))].sort((a, b) => a - b);
  const allAges = [...new Set(items.map(i => i.age))].sort((a, b) => a - b);

  const filtered = items.filter(it => {
    if (filterMix !== 'all' && it.mix !== parseInt(filterMix)) return false;
    if (filterTest !== 'all') {
      if (filterTest === 'retraction' && it.kind !== 'shrink' && it.kind !== 'shrinkMix') return false;
      if (filterTest !== 'retraction' && it.testKey !== filterTest) return false;
    }
    if (filterAge !== 'all' && it.age !== parseInt(filterAge)) return false;
    if (text) {
      const s = `N${it.mix} ${it.testKey} ${it.specimenId} ${it.age}d`.toLowerCase();
      if (!s.includes(text.toLowerCase())) return false;
    }
    return true;
  });

  const keyOf = (it) => {
    if (it.kind === 'mechAvg') return `${it.mix}_${it.testKey}_avg_${it.age}`;
    return `${it.mix}_${it.testKey}_${it.specimenId}_${it.kind}`;
  };
  const toggle = (it) => {
    const k = keyOf(it);
    setPicked(p => {
      const n = new Set(p);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });
  };
  const selectAllVisible = () => {
    const n = new Set(picked);
    filtered.forEach(it => n.add(keyOf(it)));
    setPicked(n);
  };
  const clearPicked = () => setPicked(new Set());

  const confirmAdd = () => {
    const list = items.filter(it => picked.has(keyOf(it))).map(it => ({
      kind: it.kind, mix: it.mix, testKey: it.testKey, specimenId: it.specimenId,
      ...(it.kind === 'mechAvg' ? { age: it.age, specimenIds: it.specimenIds } : {}),
    }));
    if (list.length === 0) return;
    onSelectMany(list);
  };

  const testLabel = (it) => {
    if (it.kind === 'shrink') return `R-${it.specimenId}`;
    if (it.kind === 'shrinkMix') return `R-avg`;
    if (it.kind === 'mechAvg') return `${it.testKey === 'flexion' ? 'F' : 'C'}-avg`;
    return `${it.testKey === 'flexion' ? 'F' : 'C'}-${it.specimenId}`;
  };
  const statLabel = (it) => {
    if (it.kind === 'shrink' || it.kind === 'shrinkMix') return `Δ ${it.change?.toFixed(0) ?? '—'} μm/m`;
    if (it.kind === 'mechAvg') return `Pmax̄ ${it.pmax?.toFixed(2)} kN · ${it.specimenIds?.length || 0} probetas`;
    return `${it.pmax?.toFixed(2)} kN · ${it.smax?.toFixed(1)} MPa`;
  };

  return (
    <div className="cal-modal-backdrop" onClick={onClose}>
      <div className="picker-modal" onClick={(e) => e.stopPropagation()} style={{maxWidth: 820}}>
        <div className="picker-header">
          <h3>{T.pickCurve || 'Seleccionar ensayos'}</h3>
          <div style={{display: 'flex', gap: 8, alignItems: 'center'}}>
            <span style={{fontSize: 11, color: 'var(--text-3)'}}>{picked.size} {T.selectedCount || 'seleccionados'}</span>
            <button className="vt-btn" onClick={selectAllVisible}>{T.selectVisible || 'Todos visibles'}</button>
            <button className="vt-btn" onClick={clearPicked}>{T.clear || 'Limpiar'}</button>
            <button className="vt-btn primary" onClick={confirmAdd} disabled={picked.size === 0}>
              + {T.addSelected || 'Añadir'} ({picked.size})
            </button>
            <button className="cal-close" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="picker-filters">
          <input className="picker-search" placeholder={T.search || 'Buscar…'}
                 value={text} onChange={(e) => setText(e.target.value)} />
          <select value={filterMix} onChange={(e) => setFilterMix(e.target.value)}>
            <option value="all">{T.allMixes || 'Todas las mezclas'}</option>
            {allMixes.map(m => <option key={m} value={m}>N{m}</option>)}
          </select>
          <select value={filterTest} onChange={(e) => setFilterTest(e.target.value)}>
            <option value="all">{T.allTests || 'Todos los ensayos'}</option>
            <option value="retraction">{T.retraction}</option>
            <option value="flexion">{T.flexion}</option>
            <option value="compression">{T.compression}</option>
          </select>
          <select value={filterAge} onChange={(e) => setFilterAge(e.target.value)}>
            <option value="all">{T.allAges || 'Todas las edades'}</option>
            {allAges.map(a => <option key={a} value={a}>{a}{T.day || 'd'}</option>)}
          </select>
        </div>
        <div className="picker-list">
          {filtered.length === 0 && <div className="hint-empty">{T.noCurves || 'No hay ensayos.'}</div>}
          {filtered.map(it => {
            const k = keyOf(it);
            const sel = picked.has(k);
            return (
              <div key={k} className={'picker-item' + (sel ? ' selected' : '')}
                   onClick={() => toggle(it)}>
                <input type="checkbox" checked={sel} readOnly />
                <span className="pi-mix">N{it.mix}</span>
                <span className="pi-test">{testLabel(it)}</span>
                <span className="pi-age">{it.age}{T.day || 'd'}</span>
                <span className="pi-pmax">{statLabel(it)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

window.IndividualViewer = IndividualViewer;
window.ShrinkageViewer = ShrinkageViewer;
window.ComparatorView = ComparatorView;
window.CurvePicker = CurvePicker;
window.CurvePlot = CurvePlot;
