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
window.applyTrim = function(parsed, trimIdx) {
  if (!parsed || !parsed.points || !parsed.points.length) return parsed;
  if (!trimIdx || trimIdx <= 0) return parsed;
  const t0 = parsed.points[trimIdx];
  if (!t0) return parsed;
  const pts = parsed.points.slice(trimIdx).map(p => ({
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
  series = null, // si se pasa, es array de {points, color, label}
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
  const sy = (y) => H - padB - ((y - yMin) / (yMax - yMin || 1)) * (H - padT - padB);

  const buildPath = (pts) => pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p[xKey]).toFixed(1)},${sy(p[yKey]).toFixed(1)}`).join(' ');

  // Ticks
  const niceTicks = (mn, mx, count = 5) => {
    const range = mx - mn;
    const step0 = range / count;
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
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
        <path key={i} d={buildPath(s.points)} fill="none" stroke={s.color} strokeWidth="1.6" />
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
  const [mode, setMode] = React.useState('view'); // 'view' | 'setTrim' | 'setPeak'
  const [unitMode, setUnitMode] = React.useState('kN'); // 'kN' | 'MPa'

  // Apply trim
  const trimmed = specimen.trimIdx ? window.applyTrim(parsed, specimen.trimIdx) : parsed;

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
    } else if (mode === 'setPeak') {
      const absIdx = (specimen.trimIdx || 0) + i;
      onUpdate({ ...specimen, firstPeakIdx: absIdx });
      setMode('view');
    }
  };

  const reset = () => onUpdate({ ...specimen, trimIdx: null, firstPeakIdx: null });

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
            ✂ {T.setOrigin || 'Fijar origen'}
          </button>
          <button className={'vt-btn' + (mode === 'setPeak' ? ' active' : '')}
                  onClick={() => setMode(mode === 'setPeak' ? 'view' : 'setPeak')}>
            ⬆ {T.setFirstPeak || 'Primer peak'}
          </button>
          <button className="vt-btn" onClick={reset} disabled={!specimen.trimIdx && specimen.firstPeakIdx == null}>
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
          <div className="sb-v">{specimen.trimIdx ? `−${specimen.trimIdx}` : '—'}</div>
        </div>
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
  const [picker, setPicker] = React.useState(false);
  const [visibleMap, setVisibleMap] = React.useState({}); // key -> bool
  const [colorMap, setColorMap] = React.useState({});
  const [nameMap, setNameMap] = React.useState({});

  React.useEffect(() => {
    localStorage.setItem('tesis_compare_v1', JSON.stringify(selected));
  }, [selected]);

  const addItem = (mix, testKey, specimenId) => {
    const key = `${mix}_${testKey}_${specimenId}`;
    if (selected.find(s => s.key === key)) return;
    if (selected.length >= 10) return;
    const next = [...selected, { key, mix, testKey, specimenId }];
    setSelected(next);
    setVisibleMap(m => ({ ...m, [key]: true }));
    setColorMap(m => ({ ...m, [key]: PALETTE[next.length - 1] }));
  };

  const removeItem = (key) => {
    setSelected(s => s.filter(x => x.key !== key));
  };

  // Compose series for the plot
  const series = selected.filter(s => visibleMap[s.key] !== false).map((s, i) => {
    const spec = state.results[s.mix]?.[s.testKey]?.find(x => x.id === s.specimenId);
    if (!spec || !spec.parsed) return null;
    const trimmed = spec.trimIdx ? window.applyTrim(spec.parsed, spec.trimIdx) : spec.parsed;
    let pts = trimmed.points;
    if (unitMode === 'MPa') {
      pts = pts.map(p => {
        const mpa = window.computeStressMPa(p.load, s.testKey, spec);
        return { ...p, load: mpa != null ? mpa : 0 };
      });
    }
    return {
      points: pts,
      color: colorMap[s.key] || PALETTE[i % PALETTE.length],
      label: nameMap[s.key] || `N${s.mix} ${s.testKey[0].toUpperCase()}-${s.specimenId}`,
      key: s.key,
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
          <div className="unit-toggle">
            <button className={unitMode === 'kN' ? 'active' : ''} onClick={() => setUnitMode('kN')}>kN</button>
            <button className={unitMode === 'MPa' ? 'active' : ''} onClick={() => setUnitMode('MPa')}>MPa</button>
          </div>
          <button className="vt-btn" onClick={() => setPicker(true)} disabled={selected.length >= 10}>
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
            xLabel={T.disp || 'Desplazamiento (mm)'}
            yLabel={unitMode === 'kN' ? 'Carga P (kN)' : 'Tensión σ (MPa)'}
            width={900} height={520}
          />
        </div>
        <div className="comp-legend">
          <div className="legend-title">{T.curves || 'Curvas'} ({series.length}/{selected.length})</div>
          {selected.length === 0 && <div className="hint-empty">{T.compareEmpty || 'Añade curvas para comparar.'}</div>}
          {selected.map((s, i) => {
            const spec = state.results[s.mix]?.[s.testKey]?.find(x => x.id === s.specimenId);
            const trimmed = spec?.trimIdx ? window.applyTrim(spec.parsed, spec.trimIdx) : spec?.parsed;
            const pmax = trimmed?.pmax;
            const smax = trimmed?.smax;
            const color = colorMap[s.key] || PALETTE[i % PALETTE.length];
            const name = nameMap[s.key] || `N${s.mix} ${s.testKey[0].toUpperCase()}-${s.specimenId}`;
            const visible = visibleMap[s.key] !== false;
            return (
              <div key={s.key} className="legend-row">
                <input type="checkbox" checked={visible} onChange={(e) => setVisibleMap(m => ({ ...m, [s.key]: e.target.checked }))} />
                <input type="color" value={color} onChange={(e) => setColorMap(m => ({ ...m, [s.key]: e.target.value }))} />
                <input className="leg-name" value={name} onChange={(e) => setNameMap(m => ({ ...m, [s.key]: e.target.value }))} />
                <span className="leg-stats">
                  Pmax: {pmax?.toFixed(2) || '—'} kN · σmax: {smax?.toFixed(1) || '—'} MPa · {spec?.age}d
                </span>
                <button className="leg-x" onClick={() => removeItem(s.key)}>✕</button>
              </div>
            );
          })}
        </div>
      </div>

      {picker && (
        <CurvePicker state={state} onSelect={(mix, test, sid) => { addItem(mix, test, sid); setPicker(false); }} onClose={() => setPicker(false)} T={T} />
      )}
    </div>
  );
}

// ---------- Curve picker modal ----------
function CurvePicker({ state, onSelect, onClose, T }) {
  const items = [];
  for (const mixStr in state.results) {
    const mix = parseInt(mixStr);
    for (const test of ['flexion', 'compression']) {
      const specs = state.results[mixStr][test] || [];
      for (const s of specs) {
        if (s.parsed && s.parsed.pmax > 0) {
          items.push({ mix, test, id: s.id, age: s.age, pmax: s.parsed.pmax, smax: s.parsed.smax });
        }
      }
    }
  }
  items.sort((a, b) => a.mix - b.mix || a.test.localeCompare(b.test) || a.id.localeCompare(b.id));

  const [filter, setFilter] = React.useState('');
  const filtered = items.filter(it => {
    if (!filter) return true;
    const s = `N${it.mix} ${it.test} ${it.id} ${it.age}d`.toLowerCase();
    return s.includes(filter.toLowerCase());
  });

  return (
    <div className="cal-modal-backdrop" onClick={onClose}>
      <div className="picker-modal" onClick={(e) => e.stopPropagation()}>
        <div className="picker-header">
          <h3>{T.pickCurve || 'Seleccionar ensayo'}</h3>
          <button className="cal-close" onClick={onClose}>✕</button>
        </div>
        <input className="picker-search" placeholder={T.search || 'Buscar…'}
               value={filter} onChange={(e) => setFilter(e.target.value)} autoFocus />
        <div className="picker-list">
          {filtered.length === 0 && <div className="hint-empty">{T.noCurves || 'No hay ensayos cargados.'}</div>}
          {filtered.map(it => (
            <div key={it.mix + it.test + it.id} className="picker-item"
                 onClick={() => onSelect(it.mix, it.test, it.id)}>
              <span className="pi-mix">N{it.mix}</span>
              <span className="pi-test">{it.test === 'flexion' ? 'F' : 'C'}-{it.id}</span>
              <span className="pi-age">{it.age}d</span>
              <span className="pi-pmax">{it.pmax.toFixed(2)} kN</span>
              <span className="pi-smax">{it.smax.toFixed(1)} MPa</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

window.IndividualViewer = IndividualViewer;
window.ComparatorView = ComparatorView;
window.CurvePicker = CurvePicker;
window.CurvePlot = CurvePlot;
