// ===== PESTAÑA "GRÁFICO POR FÓRMULA" =====
// El usuario escribe un modelo (ej. fc = a + b*BR + c*log(t) ...) y se grafica
// Medido vs Predicho por edad, con línea 1:1, R² y n.

const FX_KEY = 'tesis_formula_chart_v1';
const FX_VARS = [
  { k: 'BR', l: 'BR · reemplazo de ligante (fracción)' },
  { k: 'FD', l: 'FD · dosis total de fibra (fracción vol.)' },
  { k: 'SD', l: 'SD · dosis fibra acero (fracción vol.)' },
  { k: 'AD', l: 'AD · dosis fibra amorfa (fracción vol.)' },
  { k: 'FM', l: 'FM% · fracción acero = SD/FD (0.25–0.75)' },
  { k: 'AMF', l: 'AMF · fracción amorfa = AD/FD (0–1)' },
  { k: 'FVF', l: 'FVF · FD / 1 %' },
  { k: 'SL', l: 'SL · largo fibra acero (mm)' },
  { k: 'AL', l: 'AL · largo fibra amorfa (mm)' },
  { k: 'TMF', l: 'TMF · tamaño máx. fibra (mm)' },
  { k: 'AAR', l: 'AAR · aspect ratio amorfa (416.7 / 1250 / 1666.7)' },
  { k: 'SAR', l: 'SAR · aspect ratio acero (150 / 260 / 400)' },
  { k: 'T', l: 'T · temperatura (°C)' },
  { k: 't', l: 't · edad de ensayo (días)' },
  { k: 'const', l: 'Constante…' },
];
const FX_GUESS = { DF: 'FD', FD: 'FD', BR: 'BR', SD: 'SD', AD: 'AD', AMF: 'AMF', FVF: 'FVF', SL: 'SL', AL: 'AL', TMF: 'TMF', T: 'T', t: 't', AAR: 'AAR', SAR: 'SAR', FM: 'FM', 'FM%': 'FM' };
const FX_AAR = { 5: 416.7, 15: 1250.0, 20: 1666.7 }, FX_SAR = { 6: 150, 13: 260, 20: 400 };
const FX_FUNCS = { log: 1, ln: 1, log10: 1, exp: 1, sqrt: 1, abs: 1 };
const FX_AGE_STYLE = {
  1: { shape: 'square', color: '#e8b83a', es: '1 día', en: '1 day' },
  7: { shape: 'triangle', color: '#4f9a4f', es: '7 días', en: '7 days' },
  28: { shape: 'circle', color: '#c8403a', es: '28 días', en: '28 days' },
  other: { shape: 'diamond', color: '#5b7fb5', es: 'Otras edades', en: 'Other ages' },
};

// ---------- Parser ----------
function fxTokenize(src) {
  const toks = []; let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    const num = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
    if (num) { toks.push({ t: 'num', v: parseFloat(num[0]) }); i += num[0].length; continue; }
    const id = /^[A-Za-z_][A-Za-z0-9_]*%?/.exec(src.slice(i));
    if (id) { toks.push({ t: 'id', v: id[0] }); i += id[0].length; continue; }
    if ('+-*/^()'.includes(c)) { toks.push({ t: c }); i++; continue; }
    if (c === ',') throw new Error('Usa punto decimal, no coma (posición ' + (i + 1) + ')');
    throw new Error('Carácter no válido "' + c + '" (posición ' + (i + 1) + ')');
  }
  return toks;
}
function fxParse(src) {
  let lhs = '', rhs = src.trim();
  const eq = rhs.indexOf('=');
  if (eq >= 0) { lhs = rhs.slice(0, eq).trim(); rhs = rhs.slice(eq + 1); }
  const toks = fxTokenize(rhs); let p = 0; const vars = new Set();
  const peek = () => toks[p], eat = (t) => { if (!toks[p] || toks[p].t !== t) throw new Error('Se esperaba "' + t + '"'); return toks[p++]; };
  const expr = () => { let n = term(); while (peek() && (peek().t === '+' || peek().t === '-')) { const op = toks[p++].t; n = { op, a: n, b: term() }; } return n; };
  const term = () => { let n = unary(); while (peek() && (peek().t === '*' || peek().t === '/')) { const op = toks[p++].t; n = { op, a: n, b: unary() }; } return n; };
  const unary = () => { if (peek() && (peek().t === '-' || peek().t === '+')) { const op = toks[p++].t; const a = unary(); return op === '-' ? { op: 'neg', a } : a; } return power(); };
  const power = () => { const b = primary(); if (peek() && peek().t === '^') { p++; return { op: '^', a: b, b: unary() }; } return b; };
  const primary = () => {
    const tk = peek(); if (!tk) throw new Error('Fórmula incompleta');
    if (tk.t === 'num') { p++; return { num: tk.v }; }
    if (tk.t === '(') { p++; const n = expr(); eat(')'); return n; }
    if (tk.t === 'id') {
      p++;
      if (peek() && peek().t === '(') {
        if (!FX_FUNCS[tk.v.toLowerCase()]) throw new Error('Función desconocida: ' + tk.v);
        p++; const a = expr(); eat(')'); return { fn: tk.v.toLowerCase(), a };
      }
      vars.add(tk.v); return { v: tk.v };
    }
    throw new Error('Símbolo inesperado "' + tk.t + '"');
  };
  if (!toks.length) throw new Error('Fórmula vacía');
  const ast = expr();
  if (p < toks.length) throw new Error('Sobra texto después de la posición ' + p);
  return { lhs, ast, vars: [...vars] };
}
function fxEval(n, env, logBase) {
  if (n.num != null) return n.num;
  if (n.v != null) return env[n.v];
  if (n.fn) {
    const a = fxEval(n.a, env, logBase);
    switch (n.fn) {
      case 'log': return logBase === 'ln' ? Math.log(a) : Math.log10(a);
      case 'log10': return Math.log10(a);
      case 'ln': return Math.log(a);
      case 'exp': return Math.exp(a);
      case 'sqrt': return Math.sqrt(a);
      case 'abs': return Math.abs(a);
    }
  }
  if (n.op === 'neg') return -fxEval(n.a, env, logBase);
  const a = fxEval(n.a, env, logBase), b = fxEval(n.b, env, logBase);
  switch (n.op) { case '+': return a + b; case '-': return a - b; case '*': return a * b; case '/': return a / b; case '^': return Math.pow(a, b); }
  return NaN;
}

function fxMixEnv(mix, age) {
  const p = (window.MIX_PARAMS || {})[mix]; if (!p) return null;
  return { BR: p.BR, FD: p.FD, SD: p.SD, AD: p.AD, AMF: p.FD ? p.AD / p.FD : 0, FVF: p.FD / 0.01, SL: p.SL, AL: p.AL, TMF: p.TMF, T: p.T, t: Number(age), AAR: FX_AAR[p.AL], SAR: FX_SAR[p.SL], FM: p.FD ? p.SD / p.FD : 0 };
}

// Etiqueta con subíndices: "f_c" → f itálica + c subíndice
function FxRichLabel({ text }) {
  const parts = []; const re = /([A-Za-z])_([A-Za-z0-9]+)/g; let last = 0, m, k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(<tspan key={k++}>{text.slice(last, m.index)}</tspan>);
    parts.push(<tspan key={k++} fontStyle="italic">{m[1]}</tspan>);
    parts.push(<tspan key={k++} fontStyle="italic" fontSize="0.72em" dy="0.3em">{m[2]}</tspan>);
    parts.push(<tspan key={k++} dy="-0.3em">{''}</tspan>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(<tspan key={k++}>{text.slice(last)}</tspan>);
  return <>{parts}</>;
}

function FxMarker({ shape, x, y, r, fill }) {
  const st = { fill, stroke: '#111', strokeWidth: 1 };
  if (shape === 'square') return <rect x={x - r} y={y - r} width={2 * r} height={2 * r} {...st} />;
  if (shape === 'triangle') return <polygon points={`${x},${y - r * 1.2} ${x - r * 1.1},${y + r * 0.8} ${x + r * 1.1},${y + r * 0.8}`} {...st} />;
  if (shape === 'diamond') return <polygon points={`${x},${y - r * 1.25} ${x + r},${y} ${x},${y + r * 1.25} ${x - r},${y}`} {...st} />;
  return <circle cx={x} cy={y} r={r} {...st} />;
}

function fxTicks(mn, mx) {
  const range = mx - mn || 1, raw = range / 4, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(f => f * mag).find(s => range / s <= 5) || 10 * mag;
  const out = []; for (let v = Math.ceil(mn / step) * step; v <= mx + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

function FxChart({ pts, groups, xLabel, yLabel, stats, lang, svgRef, range }) {
  const S = 560, padL = 92, padB = 84, padT = 26, padR = 26, W = S - padL - padR, H = S - padT - padB;
  const [mn, mx] = range;
  const sx = v => padL + (v - mn) / (mx - mn) * W, sy = v => padT + H - (v - mn) / (mx - mn) * H;
  const ticks = fxTicks(mn, mx);
  const font = "'Helvetica Neue', Helvetica, Arial, sans-serif";
  const legH = groups.length * 30 + 14, legW = Math.max(...groups.map(g => g.label.length), 6) * 11 + 54;
  return (
    <svg ref={svgRef} xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${S} ${S}`} width="100%" style={{ maxWidth: 620, display: 'block', background: '#fff' }} fontFamily={font}>
      <rect x="0" y="0" width={S} height={S} fill="#fff" />
      <defs><clipPath id="fx-clip"><rect x={padL} y={padT} width={W} height={H} /></clipPath></defs>
      <line x1={sx(mn)} y1={sy(mn)} x2={sx(mx)} y2={sy(mx)} stroke="#111" strokeWidth="2.2" strokeDasharray="7 5" clipPath="url(#fx-clip)" />
      <g clipPath="url(#fx-clip)">
        {pts.map((p, i) => <g key={i}><FxMarker shape={p.style.shape} x={sx(p.meas)} y={sy(p.pred)} r={6.5} fill={p.color} /><title>{p.tip}</title></g>)}
      </g>
      <rect x={padL} y={padT} width={W} height={H} fill="none" stroke="#111" strokeWidth="2" />
      {ticks.map(v => <g key={'x' + v}><line x1={sx(v)} x2={sx(v)} y1={padT + H} y2={padT + H + 7} stroke="#111" strokeWidth="1.4" /><text x={sx(v)} y={padT + H + 30} textAnchor="middle" fontSize="22" fill="#111">{v}</text></g>)}
      {ticks.map(v => <g key={'y' + v}><line x1={padL - 7} x2={padL} y1={sy(v)} y2={sy(v)} stroke="#111" strokeWidth="1.4" /><text x={padL - 12} y={sy(v) + 8} textAnchor="end" fontSize="22" fill="#111">{v}</text></g>)}
      <text x={padL + W / 2} y={S - 18} textAnchor="middle" fontSize="24" fill="#111"><FxRichLabel text={xLabel} /></text>
      <text transform={`translate(26 ${padT + H / 2}) rotate(-90)`} textAnchor="middle" fontSize="24" fill="#111"><FxRichLabel text={yLabel} /></text>
      {groups.length > 0 && <g transform={`translate(${padL + 12} ${padT + 12})`}>
        <rect width={legW} height={legH} rx="6" fill="#fff" stroke="#bbb" strokeWidth="1.2" />
        {groups.map((g, i) => <g key={g.key} transform={`translate(0 ${22 + i * 30})`}><FxMarker shape={g.shape} x={22} y={0} r={7} fill={g.color} /><text x={42} y={7} fontSize="19" fill="#111">{g.label}</text></g>)}
      </g>}
      {stats && <g transform={`translate(${padL + W - 12} ${padT + H - 12})`}>
        <rect x={-150} y={-70} width={150} height={70} rx="6" fill="#fff" stroke="#999" strokeWidth="1.4" />
        <text x={-12} y={-40} textAnchor="end" fontSize="21" fill="#111"><tspan fontStyle="italic">R</tspan><tspan fontSize="0.7em" dy="-0.5em">2</tspan><tspan dy="0.5em">{' = ' + (isFinite(stats.r2) ? stats.r2.toFixed(2) : '—')}</tspan></text>
        <text x={-12} y={-12} textAnchor="end" fontSize="21" fill="#111"><tspan fontStyle="italic">n</tspan>{' = ' + stats.n}</text>
      </g>}
    </svg>
  );
}

function FormulaChartTab({ state, user, T, lang }) {
  const saved = React.useMemo(() => { try { return JSON.parse(localStorage.getItem(FX_KEY)) || {}; } catch (e) { return {}; } }, []);
  const [formula, setFormula] = React.useState(saved.formula || 'fc = 31.1779058328203-11788.8436160208*DF-4.24856202879002E-02*AAR+121.883911031301*log(t)-23.8931639705723*log(t)^2+10125.5666351016*BR*DF+3.31746952116264E-02*BR*AAR+268.326493925847*DF*T+7.8526615271583E-04*AAR*T-2.02917642356695*T*log(t)');
  const [map, setMap] = React.useState(saved.map || {});
  const [consts, setConsts] = React.useState(saved.consts || {});
  const [logBase, setLogBase] = React.useState(saved.logBase || 'log10');
  const [test, setTest] = React.useState(saved.test || '');
  const [metricSel, setMetric] = React.useState(saved.metricSel || '');
  const [phases, setPhases] = React.useState(saved.phases || { p1: true, p2: false, valid: false });
  const [agg, setAgg] = React.useState(saved.agg || 'avg');
  const [colorBy, setColorBy] = React.useState(saved.colorBy || 'age');
  const [xLabel, setXLabel] = React.useState(saved.xLabel || '');
  const [yLabel, setYLabel] = React.useState(saved.yLabel || '');
  const [axMin, setAxMin] = React.useState(saved.axMin ?? '');
  const [axMax, setAxMax] = React.useState(saved.axMax ?? '');
  const svgRef = React.useRef(null);
  const en = lang === 'en';

  React.useEffect(() => {
    localStorage.setItem(FX_KEY, JSON.stringify({ formula, map, consts, logBase, test, metricSel, phases, agg, colorBy, xLabel, yLabel, axMin, axMax }));
  }, [formula, map, consts, logBase, test, metricSel, phases, agg, colorBy, xLabel, yLabel, axMin, axMax]);

  const parsed = React.useMemo(() => { try { return { ...fxParse(formula), error: null }; } catch (e) { return { error: e.message, vars: [], lhs: '' }; } }, [formula]);
  const lhs = parsed.lhs || 'y';
  const testKey = test || (/^f?c/i.test(lhs) && !/^f(f|t|r|ct|lex)/i.test(lhs) ? 'compression' : 'flexion');
  const isKN = /kn|^p/i.test(lhs);
  const metric = metricSel || (isKN ? 'pmaxKN' : 'pmaxMPa');
  const unit = /KN$/.test(metric) ? 'kN' : 'MPa';
  const sym = isKN && /kn/i.test(lhs) ? 'P' : lhs.replace(/^([A-Za-z])([A-Za-z0-9]+)$/, '$1_$2');
  const xL = xLabel || (en ? `Measured ${sym} (${unit})` : `${sym} medido (${unit})`);
  const yL = yLabel || (en ? `Predicted ${sym} (${unit})` : `${sym} predicho (${unit})`);
  const mapOf = v => map[v] || FX_GUESS[v] || '';
  const unmapped = parsed.vars.filter(v => !mapOf(v) || (mapOf(v) === 'const' && (consts[v] === '' || consts[v] == null || isNaN(parseFloat(consts[v])))));

  const result = React.useMemo(() => {
    if (parsed.error || unmapped.length || !window.analysisSpecMetrics) return null;
    const groups = new Map();
    for (const mixStr of Object.keys(state.results || {})) {
      const mix = parseInt(mixStr);
      for (const s of (state.results[mix]?.[testKey] || [])) {
        if (!s.parsed || !(s.parsed.pmax > 0)) continue;
        const ph = window.phaseOf(mix, s); if (!phases[ph]) continue;
        const m = window.analysisSpecMetrics(s, testKey, mix, 'corrected');
        const val = m && m[metric]; if (val == null || !isFinite(val)) continue;
        const key = agg === 'avg' ? `${mix}|${ph}|${s.age}` : `${mix}|${s.id}`;
        if (!groups.has(key)) groups.set(key, { mix, ph, age: Number(s.age), vals: [], ids: [] });
        const g = groups.get(key); g.vals.push(val); g.ids.push(s.id);
      }
    }
    const pts = [];
    for (const g of groups.values()) {
      const env = fxMixEnv(g.mix, g.age); if (!env) continue;
      const e = {}; parsed.vars.forEach(v => { const k = mapOf(v); e[v] = k === 'const' ? parseFloat(consts[v]) : env[k]; });
      const pred = fxEval(parsed.ast, e, logBase); if (!isFinite(pred)) continue;
      const meas = g.vals.reduce((a, b) => a + b, 0) / g.vals.length;
      const style = FX_AGE_STYLE[g.age] || FX_AGE_STYLE.other;
      const color = colorBy === 'phase' ? window.PHASE_COLOR[g.ph] : style.color;
      const tip = `${window.mixLabel(g.mix)} ${window.PHASE_TAG[g.ph]} · ${g.age}d${agg === 'avg' ? ` (n=${g.vals.length})` : ' · ' + g.ids[0]}\n${en ? 'Measured' : 'Medido'} ${meas.toFixed(2)} · ${en ? 'Predicted' : 'Predicho'} ${pred.toFixed(2)}`;
      pts.push({ ...g, meas, pred, style, color, tip });
    }
    const n = pts.length;
    let stats = null;
    if (n) {
      const mean = pts.reduce((a, p) => a + p.meas, 0) / n;
      const ssr = pts.reduce((a, p) => a + (p.meas - p.pred) ** 2, 0), sst = pts.reduce((a, p) => a + (p.meas - mean) ** 2, 0);
      stats = { n, r2: 1 - ssr / sst, rmse: Math.sqrt(ssr / n), mae: pts.reduce((a, p) => a + Math.abs(p.meas - p.pred), 0) / n };
    }
    // Leyenda
    const legend = [];
    if (colorBy === 'age') {
      const ages = [...new Set(pts.map(p => FX_AGE_STYLE[p.age] ? p.age : 'other'))].sort((a, b) => (a === 'other' ? 99 : a) - (b === 'other' ? 99 : b));
      ages.forEach(a => { const st = FX_AGE_STYLE[a]; legend.push({ key: a, shape: st.shape, color: st.color, label: en ? st.en : st.es }); });
    } else {
      ['p1', 'p2', 'valid'].filter(ph => pts.some(p => p.ph === ph)).forEach(ph => legend.push({ key: ph, shape: 'circle', color: window.PHASE_COLOR[ph], label: en ? ({ p1: 'Phase 1', p2: 'Phase 2', valid: 'Validation' })[ph] : window.PHASE_NAME[ph] }));
    }
    return { pts, stats, legend };
  }, [state, parsed, map, consts, logBase, testKey, metric, phases, agg, colorBy, lang, unmapped.length]);

  const range = React.useMemo(() => {
    if (!result || !result.pts.length) return [0, 1];
    const all = result.pts.flatMap(p => [p.meas, p.pred]);
    let lo = Math.min(0, ...all), hi = Math.max(...all);
    const pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
    if (axMin !== '' && !isNaN(parseFloat(axMin))) lo = parseFloat(axMin);
    if (axMax !== '' && !isNaN(parseFloat(axMax))) hi = parseFloat(axMax);
    return [lo, hi > lo ? hi : lo + 1];
  }, [result, axMin, axMax]);

  const fileBase = `medido_vs_predicho_${lhs}`;
  const svgString = () => new XMLSerializer().serializeToString(svgRef.current);
  const dlBlob = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
  const downloadSVG = () => svgRef.current && dlBlob(new Blob([svgString()], { type: 'image/svg+xml' }), fileBase + '.svg');
  const downloadPNG = () => {
    if (!svgRef.current) return;
    const img = new Image(), scale = 4, S = 560;
    img.onload = () => { const c = document.createElement('canvas'); c.width = S * scale; c.height = S * scale; const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height); c.toBlob(b => dlBlob(b, fileBase + '.png')); };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString());
  };
  const downloadCSV = () => {
    if (!result) return;
    const rows = [['mezcla', 'fase', 'edad_d', agg === 'avg' ? 'n_probetas' : 'probeta', 'medido', 'predicho', 'residuo']];
    result.pts.forEach(p => rows.push([window.mixLabel(p.mix), window.PHASE_TAG[p.ph], p.age, agg === 'avg' ? p.vals.length : p.ids[0], p.meas.toFixed(4), p.pred.toFixed(4), (p.meas - p.pred).toFixed(4)]));
    dlBlob(new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' }), fileBase + '.csv');
  };

  const metricOpts = [['pmaxMPa', en ? 'Peak stress (MPa)' : 'Tensión máxima (MPa)'], ['pmaxKN', en ? 'Peak load (kN)' : 'Carga máxima (kN)']]
    .concat(testKey === 'flexion' ? [['fpMPa', en ? 'First peak (MPa)' : 'Primer peak (MPa)'], ['fpKN', en ? 'First peak (kN)' : 'Primer peak (kN)']] : []);
  React.useEffect(() => { if (metricSel && !metricOpts.find(o => o[0] === metricSel)) setMetric(''); }, [testKey]);

  return (
    <div className="fx-tab">
      <div className="fx-side">
        <section className="fx-card">
          <div className="fx-label">{en ? 'Formula' : 'Fórmula'}</div>
          <textarea className="fx-formula" value={formula} spellCheck={false} onChange={e => setFormula(e.target.value)} rows={6} />
          {parsed.error
            ? <div className="fx-err">{parsed.error}</div>
            : <div className="fx-hint">{en ? 'Functions' : 'Funciones'}: log, ln, log10, exp, sqrt, abs · ^ = potencia · T ≠ t</div>}
          <div className="fx-row">
            <span className="fx-label">log( )</span>
            <div className="fx-seg">
              {[['log10', 'log₁₀'], ['ln', 'ln']].map(([k, l]) => <button key={k} className={logBase === k ? 'on' : ''} onClick={() => setLogBase(k)}>{l}</button>)}
            </div>
          </div>
        </section>
        {parsed.vars.length > 0 && <section className="fx-card">
          <div className="fx-label">{en ? 'Variables' : 'Variables de la fórmula'}</div>
          <div className="fx-vars">
            {parsed.vars.map(v => {
              const k = mapOf(v), bad = unmapped.includes(v);
              return <div key={v} className={'fx-var' + (bad ? ' bad' : '')}>
                <code>{v}</code>
                <select value={k} onChange={e => setMap({ ...map, [v]: e.target.value })}>
                  <option value="">{en ? '— assign —' : '— asignar —'}</option>
                  {FX_VARS.map(o => <option key={o.k} value={o.k}>{o.l}</option>)}
                </select>
                {k === 'const' && <input type="number" step="any" placeholder="valor" value={consts[v] ?? ''} onChange={e => setConsts({ ...consts, [v]: e.target.value })} />}
              </div>;
            })}
          </div>
          {unmapped.length > 0 && <div className="fx-err">{en ? 'Assign: ' : 'Falta asignar: '}{unmapped.join(', ')}</div>}
        </section>}
        <section className="fx-card">
          <div className="fx-label">{en ? 'Data' : 'Datos medidos'}</div>
          <div className="fx-grid2">
            <label>{en ? 'Test' : 'Ensayo'}<select value={test} onChange={e => setTest(e.target.value)}>
              <option value="">{en ? 'Auto' : 'Auto'} ({testKey === 'compression' ? (en ? 'compression' : 'compresión') : (en ? 'flexure' : 'flexión')})</option>
              <option value="compression">{en ? 'Compression' : 'Compresión'}</option>
              {user.hasFlexion !== false && <option value="flexion">{en ? 'Flexure' : 'Flexión'}</option>}
            </select></label>
            <label>{en ? 'Response' : 'Respuesta'}<select value={metricSel} onChange={e => setMetric(e.target.value)}><option value="">Auto ({unit})</option>{metricOpts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label>{en ? 'Points' : 'Puntos'}<select value={agg} onChange={e => setAgg(e.target.value)}>
              <option value="avg">{en ? 'Mean per mix · age' : 'Promedio por mezcla · edad'}</option>
              <option value="spec">{en ? 'Each specimen' : 'Cada probeta'}</option>
            </select></label>
            <label>{en ? 'Color by' : 'Color por'}<select value={colorBy} onChange={e => setColorBy(e.target.value)}>
              <option value="age">{en ? 'Age' : 'Edad'}</option>
              <option value="phase">{en ? 'Phase' : 'Fase'}</option>
            </select></label>
          </div>
          <div className="fx-row">
            {['p1', 'p2', 'valid'].map(ph => <label key={ph} className="fx-chip" style={{ '--c': window.PHASE_COLOR[ph] }}>
              <input type="checkbox" checked={!!phases[ph]} onChange={e => setPhases({ ...phases, [ph]: e.target.checked })} />{window.PHASE_NAME[ph]}
            </label>)}
          </div>
        </section>
        <section className="fx-card">
          <div className="fx-label">{en ? 'Chart' : 'Gráfico'}</div>
          <div className="fx-grid2">
            <label>{en ? 'X label' : 'Etiqueta X'}<input value={xLabel} placeholder={xL} onChange={e => setXLabel(e.target.value)} /></label>
            <label>{en ? 'Y label' : 'Etiqueta Y'}<input value={yLabel} placeholder={yL} onChange={e => setYLabel(e.target.value)} /></label>
            <label>{en ? 'Axis min' : 'Eje mín.'}<input type="number" step="any" value={axMin} placeholder="auto" onChange={e => setAxMin(e.target.value)} /></label>
            <label>{en ? 'Axis max' : 'Eje máx.'}<input type="number" step="any" value={axMax} placeholder="auto" onChange={e => setAxMax(e.target.value)} /></label>
          </div>
          <div className="fx-hint">{en ? 'Use _ for subscript: f_c' : 'Usa _ para subíndice: f_c'}</div>
        </section>
      </div>
      <div className="fx-main">
        {result && result.pts.length
          ? <>
            <FxChart pts={result.pts} groups={result.legend} xLabel={xL} yLabel={yL} stats={result.stats} lang={lang} svgRef={svgRef} range={range} />
            <div className="fx-foot">
              <span>R² {result.stats.r2.toFixed(3)} · RMSE {result.stats.rmse.toFixed(2)} {unit} · MAE {result.stats.mae.toFixed(2)} {unit} · n {result.stats.n}</span>
              <div className="fx-actions">
                <button onClick={downloadPNG}>PNG</button><button onClick={downloadSVG}>SVG</button><button onClick={downloadCSV}>CSV</button>
              </div>
            </div>
          </>
          : <div className="fx-empty">{parsed.error ? (en ? 'Fix the formula to plot.' : 'Corrige la fórmula para graficar.') : unmapped.length ? (en ? 'Assign every variable to plot.' : 'Asigna todas las variables para graficar.') : (en ? 'No data for the selected filters.' : 'No hay datos con los filtros elegidos.')}</div>}
      </div>
    </div>
  );
}

window.FormulaChartTab = FormulaChartTab;
