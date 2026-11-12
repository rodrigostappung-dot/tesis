// ===== EXPORTACIÓN A EXCEL =====
// Genera un .xlsx con toda la información de las mezclas usando SheetJS (window.XLSX).
//
// Una sola función de exportación configurable por variables: window.exportMixesExcel
// recibe un mapa {fieldId: true/false} que decide qué columnas incluir por cada
// probeta/edad. Tres hojas: Compresión, Flexión y Ambos (columnas de ambos ensayos
// una junto a la otra, en la misma fila por mezcla/réplica). Incluye además las
// características de diseño de cada mezcla (BR, dosis y largo de fibras, temperatura, TMF).
//
// Falla frágil: caída abrupta de la carga (∝ tensión) de más del 20% del valor
// pico en una ventana de tiempo ≤ 3 s después de alcanzar el máximo.

(function () {
  const FACTORS = ['BR', 'AMF', 'FVF', 'SFL', 'AFL', 'T'];
  // Orden de las características reales de mezcla (mix-params.js), si están disponibles.
  const DESIGN_PARAM_KEYS = ['BR', 'FD', 'SD', 'AD', 'SL', 'AL', 'T', 'TMF'];

  const r2 = (v) => (v == null || isNaN(v)) ? '' : Math.round(v * 100) / 100;
  const r3 = (v) => (v == null || isNaN(v)) ? '' : Math.round(v * 1000) / 1000;

  // ---------- Definición de variables exportables ----------
  // get(m) recibe las métricas calculadas de la probeta; fromSpec(spec) lee directo de la probeta.
  window.EXPORT_FIELDS = [
    { id: 'pmax', label: 'P máx (kN)', get: (m) => r3(m.pmaxKN) },
    { id: 'sigma', label: 'σ máx (MPa)', get: (m) => r2(m.sigmaMPa) },
    { id: 'disp', label: 'Desplaz./Deflexión máx (mm)', get: (m) => r3(m.dispAtMax) },
    { id: 'dispCorr', label: 'Deflexión en carga máx corregida (mm)', flexOnly: true, get: (m) => r3(m.dispAtMaxCorr) },
    { id: 'strain', label: 'Deformación unitaria máx (mm/mm)', compOnly: true, get: (m) => r3(m.strainUnit) },
    { id: 'slope', label: 'Pendiente recta de corrección (kN/mm)', get: (m) => r3(m.correctionSlope) },
    { id: 'fpLoad', label: 'Primer peak P (kN)', flexOnly: true, get: (m) => r3(m.firstPeakKN) },
    { id: 'fpSigma', label: 'Primer peak σ (MPa)', flexOnly: true, get: (m) => r2(m.firstPeakSigma) },
    { id: 'fpDisp', label: 'Primer peak deflexión (mm)', flexOnly: true, get: (m) => r3(m.firstPeakDisp) },
    { id: 'brittle', label: 'Falla frágil', get: (m) => m.brittle ? 'Sí' : 'No' },
    { id: 'length', label: 'Largo (mm)', fromSpec: (sp) => r2(parseFloat(sp.length)) },
    { id: 'height', label: 'Alto (mm)', fromSpec: (sp) => r2(parseFloat(sp.height)) },
    { id: 'width', label: 'Ancho (mm)', fromSpec: (sp) => r2(parseFloat(sp.width)) },
    { id: 'weight', label: 'Peso (g)', fromSpec: (sp) => r2(parseFloat(sp.weight)) },
  ];
  window.EXPORT_FIELDS_DEFAULT = window.EXPORT_FIELDS.reduce((o, f) => { o[f.id] = true; return o; }, {});

  // Procesa una probeta mecánica como en el visualizador (corrección + recorte).
  function processMech(spec) {
    if (!spec || !spec.parsed) return null;
    let p = spec.parsed;
    if (spec.correction) p = window.applyCorrection(p, spec.correction);
    if (spec.trimIdx || spec.trimEndIdx != null) p = window.applyTrim(p, spec.trimIdx, spec.trimEndIdx);
    return p;
  }

  // Pendiente (kN/mm) de la recta de corrección aplicada, calculada sobre la curva CRUDA.
  function correctionSlope(spec) {
    if (!spec || !spec.parsed || !spec.correction) return null;
    const { i1, i2 } = spec.correction;
    const pts = spec.parsed.points;
    if (i1 == null || i2 == null || !pts[i1] || !pts[i2]) return null;
    const x1 = pts[i1].disp, y1 = pts[i1].load, x2 = pts[i2].disp, y2 = pts[i2].load;
    const m = (y2 - y1) / (x2 - x1);
    return isFinite(m) ? m : null;
  }

  // Detección de falla frágil: tras el pico, ¿cae la carga > 20% del pico en ≤ 3 s?
  function detectBrittle(points, idxPmax, peakLoad) {
    if (!points || points.length < 2 || !(peakLoad > 0)) return { brittle: false };
    for (let i = Math.max(0, idxPmax); i < points.length; i++) {
      const ti = points[i].t, li = points[i].load;
      if (li == null || ti == null) continue;
      for (let j = i + 1; j < points.length; j++) {
        const dt = points[j].t - ti;
        if (dt > 3) break;
        if ((li - points[j].load) / peakLoad > 0.20) return { brittle: true };
      }
    }
    return { brittle: false };
  }

  // Extrae métricas de una probeta mecánica procesada.
  function specMetrics(spec, testKey, mix) {
    const p = processMech(spec);
    if (!p || !p.points || !p.points.length || !(p.pmax > 0)) return null;
    let idx = 0, mv = -Infinity;
    p.points.forEach((pt, i) => { if (pt.load > mv) { mv = pt.load; idx = i; } });
    const pk = p.points[idx] || {};
    const pmaxKN = mv > 0 ? mv : p.pmax;
    const sigma = window.computeStressMPa(pmaxKN, testKey, spec);
    const br = detectBrittle(p.points, idx, pmaxKN);
    const h = parseFloat(spec.height);
    const strainUnit = (testKey === 'compression' && h > 0 && pk.disp != null) ? pk.disp / h : null;
    let firstPeakKN = null, firstPeakSigma = null, firstPeakDisp = null, dispAtMaxCorr = null;
    if (testKey === 'flexion') {
      const fp = window.applyFirstPeakCorrection(p, { mix: mix != null ? mix : spec.mix, age: spec.age });
      if (fp) {
        firstPeakKN = fp.firstPeakLoad;
        firstPeakDisp = fp.firstPeakDisp;
        firstPeakSigma = window.computeStressMPa(firstPeakKN, testKey, spec);
      }
      // Deflexión en carga máxima sobre la curva CORREGIDA (o recortada a 0.5 mm tras el máx si no aplica el primer peak).
      const corr = fp || window.truncateAtMax(p);
      if (corr && corr.points && corr.points.length) {
        let ci = 0, cv = -Infinity;
        corr.points.forEach((pt, i) => { if (pt.load > cv) { cv = pt.load; ci = i; } });
        dispAtMaxCorr = corr.points[ci] ? corr.points[ci].disp : null;
      }
    }
    return {
      pmaxKN, sigmaMPa: sigma, strainUnit, dispAtMax: pk.disp, dispAtMaxCorr,
      brittle: br.brittle, correctionSlope: correctionSlope(spec),
      firstPeakKN, firstPeakSigma, firstPeakDisp,
    };
  }

  function designOf(mix) {
    return (window.FACTORIAL_DESIGN || []).find(d => d.run === mix) || {};
  }
  function specsDef(user, mix, test) {
    return (window.getSpecsForUser ? window.getSpecsForUser(user, mix, test) : window.getSpecsFor(mix, test)) || [];
  }

  // Columnas de características reales de mezcla (mix-params.js), si existen para este usuario.
  function designParamKeysAvailable() {
    if (!window.MIX_PARAMS) return [];
    return DESIGN_PARAM_KEYS.filter(k => window.MIX_PARAM_LABELS && window.MIX_PARAM_LABELS[k]);
  }
  let INCLUDE_INFO = true;
  const facHead = () => INCLUDE_INFO ? FACTORS : [];
  const facValsOf = (mix) => INCLUDE_INFO ? FACTORS.map(f => designOf(mix)[f] ?? '') : [];
  function designParamHead() {
    if (!INCLUDE_INFO) return [];
    const keys = designParamKeysAvailable();
    return keys.map(k => {
      const info = window.MIX_PARAM_LABELS[k];
      return info.unit ? `${info.label} ${info.unit}` : info.label;
    });
  }
  function designParamValsForMix(mix) {
    if (!INCLUDE_INFO) return [];
    const keys = designParamKeysAvailable();
    return keys.map(k => {
      const v = window.getMixParam ? window.getMixParam(mix, k) : null;
      return v == null ? '' : v;
    });
  }

  // Metadatos de columnas (edades/slots activos) para un ensayo, según la mezcla de referencia.
  function testMeta(user, refMix, testKey, fields) {
    const activeFields = window.EXPORT_FIELDS.filter(f =>
      fields[f.id] && !(f.compOnly && testKey !== 'compression') && !(f.flexOnly && testKey !== 'flexion'));
    const defByAgeRef = {};
    specsDef(user, refMix, testKey).forEach(s => { (defByAgeRef[s.age] = defByAgeRef[s.age] || []).push(s.id); });
    const ageList = Object.keys(defByAgeRef).map(Number).sort((a, b) => a - b);
    const slotsPerAge = Math.max(1, ...ageList.map(a => defByAgeRef[a].length));
    return { activeFields, ageList, slotsPerAge };
  }

  function testMetricsHead(meta, testKey) {
    const head = [];
    meta.ageList.forEach(age => {
      for (let slot = 1; slot <= meta.slotsPerAge; slot++) {
        const lbl = meta.slotsPerAge > 1 ? `${age}d #${slot}` : `${age}d`;
        meta.activeFields.forEach(f => head.push(`${testKey === 'flexion' ? 'Flex ' : 'Comp '}${lbl} ${f.label}`));
      }
    });
    return head;
  }

  // Filas de métricas (sin prefijo mezcla/réplica/factores) para un ensayo, mapeadas por réplica.
  function testMetricsRows(state, user, mix, testKey, meta) {
    const md = state.results[mix];
    const defByAge = {}; meta.ageList.forEach(a => defByAge[a] = []);
    specsDef(user, mix, testKey).forEach(s => { if (defByAge[s.age]) defByAge[s.age].push(s.id); });
    const loaded = {}; ((md && md[testKey]) || []).forEach(s => { loaded[s.id] = s; });
    let replicaCount = Math.max(1, ...meta.ageList.map(a => Math.ceil(defByAge[a].length / meta.slotsPerAge)));
    // Mezcla centro: se divide en 3 réplicas (45.1/45.2/45.3), repartiendo por igual las probetas de cada fase y edad.
    let slotIds = (age, r, slot) => defByAge[age][r * meta.slotsPerAge + slot];
    if (mix === user.centerMix) {
      const N = 3; replicaCount = N;
      const byRep = {};
            meta.ageList.forEach(age => {
        const defs = specsDef(user, mix, testKey).filter(s => s.age === age);
        const reps = Array.from({ length: N }, () => []);
        [1, 2].forEach(ph => {
          const ids = defs.filter(s => window.specPhase(s) === ph).map(s => s.id);
          const k = Math.ceil(ids.length / N);
          for (let r = 0; r < N; r++) reps[r].push(...ids.slice(r * k, (r + 1) * k));
        });
        byRep[age] = reps;
      });
      slotIds = (age, r, slot) => byRep[age][r][slot];
    }

    const rows = [];
    for (let r = 0; r < replicaCount; r++) {
      const row = [];
      meta.ageList.forEach(age => {
        for (let slot = 0; slot < meta.slotsPerAge; slot++) {
          const id = slotIds(age, r, slot);
          const spec = id ? loaded[id] : null;
          const m = spec ? specMetrics(spec, testKey, mix) : null;
          meta.activeFields.forEach(f => {
            if (f.fromSpec) { row.push(spec ? f.fromSpec(spec) : ''); }
            else { row.push(m ? f.get(m) : ''); }
          });
        }
      });
      rows.push(row);
    }
    return { rows, colCount: meta.ageList.length * meta.slotsPerAge * meta.activeFields.length };
  }

  const rowLabel = (user, mix, r) => mix === user.centerMix ? `${window.mixLabel(mix)}.${r + 1}` : window.mixLabel(mix);

  // Construye una hoja ancha para un ensayo: una fila por mezcla (la mezcla centro
  // se divide en N réplicas). Columnas = mezcla/réplica/factores/características + variables activas.
  function buildTestSheet(state, user, mixCount, testKey, refMix, fields) {
    const meta = testMeta(user, refMix, testKey, fields);
    const paramHead = designParamHead();
    const head = ['N° mezcla', 'Réplica', ...facHead(), ...paramHead, ...testMetricsHead(meta, testKey)];
    const rows = [head];

    for (let mix = 1; mix <= mixCount; mix++) {
      if (!state.results[mix] || window.isValidationMix?.(mix)) continue;
      const facVals = facValsOf(mix);
      const paramVals = designParamValsForMix(mix);
      const { rows: metricRows } = testMetricsRows(state, user, mix, testKey, meta);
      metricRows.forEach((mr, r) => rows.push([rowLabel(user, mix, r), r + 1, ...facVals, ...paramVals, ...mr]));
    }
    return rows;
  }

  // Construye la hoja "Ambos": mezcla/réplica/factores/características, seguido de las
  // columnas de Compresión y luego las de Flexión, todo en la MISMA fila por mezcla/réplica.
  function buildBothSheet(state, user, mixCount, refMix, fields) {
    const compMeta = testMeta(user, refMix, 'compression', fields);
    const flexMeta = testMeta(user, refMix, 'flexion', fields);
    const compHead = testMetricsHead(compMeta, 'compression');
    const flexHead = testMetricsHead(flexMeta, 'flexion');
    const paramHead = designParamHead();
    const head = ['N° mezcla', 'Réplica', ...facHead(), ...paramHead, ...compHead, ...flexHead];
    const rows = [head];

    for (let mix = 1; mix <= mixCount; mix++) {
      if (!state.results[mix] || window.isValidationMix?.(mix)) continue;
      const facVals = facValsOf(mix);
      const paramVals = designParamValsForMix(mix);
      const { rows: compRows, colCount: compCols } = testMetricsRows(state, user, mix, 'compression', compMeta);
      const { rows: flexRows, colCount: flexCols } = testMetricsRows(state, user, mix, 'flexion', flexMeta);
      const replicaCount = Math.max(compRows.length, flexRows.length, 1);
      for (let r = 0; r < replicaCount; r++) {
        const c = compRows[r] || new Array(compCols).fill('');
        const fl = flexRows[r] || new Array(flexCols).fill('');
        rows.push([rowLabel(user, mix, r), r + 1, ...facVals, ...paramVals, ...c, ...fl]);
      }
    }
    return rows;
  }

  // Hoja de validación: una fila por mezcla P, con su edad real de ensayo y las réplicas de cada ensayo.
  function buildValidationSheet(state, user, mixCount, fields, tests) {
    const mixes = [];
    for (let m = 1; m <= mixCount; m++) if (window.isValidationMix?.(m) && state.results[m]) mixes.push(m);
    if (!mixes.length) return null;
    const metas = tests.map(testKey => {
      const activeFields = window.EXPORT_FIELDS.filter(f =>
        fields[f.id] && !(f.compOnly && testKey !== 'compression') && !(f.flexOnly && testKey !== 'flexion'));
      const slots = Math.max(1, ...mixes.map(m => specsDef(user, m, testKey).length));
      return { testKey, activeFields, slots };
    });
    const VK = [['BRp','BR (%)'],['AMFp','AMF (%)'],['FVFp','FVF (%)'],['Tc','T (°C)'],['SFL','SFL'],['AFL','AFL']];
    const head = ['N° mezcla', 'Edad (d)', ...(INCLUDE_INFO ? VK.map(k => k[1]) : []), ...designParamHead()];
    metas.forEach(mt => { for (let k = 1; k <= mt.slots; k++) mt.activeFields.forEach(f => head.push(`${mt.testKey === 'flexion' ? 'Flex' : 'Comp'} #${k} ${f.label}`)); });
    const rows = [head];
    mixes.forEach(mix => {
      const v = (window.VALIDATION_MIXES || []).find(x => x.run === mix);
      const defs0 = specsDef(user, mix, metas[0].testKey);
      const age = v && v.t != null ? v.t : (defs0[0] ? defs0[0].age : '');
      const row = [window.mixLabel(mix), age, ...(INCLUDE_INFO ? VK.map(k => (v && v[k[0]] != null) ? v[k[0]] : '') : []), ...designParamValsForMix(mix)];
      metas.forEach(mt => {
        const loaded = {}; ((state.results[mix] && state.results[mix][mt.testKey]) || []).forEach(sp => { loaded[sp.id] = sp; });
        const defs = specsDef(user, mix, mt.testKey);
        for (let k = 0; k < mt.slots; k++) {
          const spec = defs[k] ? loaded[defs[k].id] : null;
          const m = spec ? specMetrics(spec, mt.testKey, mix) : null;
          mt.activeFields.forEach(f => row.push(f.fromSpec ? (spec ? f.fromSpec(spec) : '') : (m ? f.get(m) : '')));
        }
      });
      rows.push(row);
    });
    return rows;
  }

  // Exporta según las variables activas (fields: {fieldId: bool}). Si se omite, exporta todo.
  window.exportMixesExcel = function (state, user, T, fields, opts) {
    opts = opts || {};
    INCLUDE_INFO = opts.includeMixInfo !== false;
    if (!window.XLSX) { alert('No se pudo cargar el generador de Excel (XLSX). Revisa tu conexión.'); return; }
    fields = fields || window.EXPORT_FIELDS_DEFAULT;
    const XLSX = window.XLSX;
    const mixCount = user.mixCount;
    const hasFlexion = user.hasFlexion !== false;

    let refMix = 1;
    for (let m = 1; m <= mixCount; m++) { if (m !== user.centerMix) { refMix = m; break; } }

    const wb = XLSX.utils.book_new();
    const compRows = buildTestSheet(state, user, mixCount, 'compression', refMix, fields);
    const wsComp = XLSX.utils.aoa_to_sheet(compRows);
    wsComp['!cols'] = compRows[0].map((h, i) => ({ wch: i < 8 ? 10 : 15 }));
    XLSX.utils.book_append_sheet(wb, wsComp, 'Compresión');

    if (hasFlexion) {
      const flexRows = buildTestSheet(state, user, mixCount, 'flexion', refMix, fields);
      const wsFlex = XLSX.utils.aoa_to_sheet(flexRows);
      wsFlex['!cols'] = flexRows[0].map((h, i) => ({ wch: i < 8 ? 10 : 15 }));
      XLSX.utils.book_append_sheet(wb, wsFlex, 'Flexión');

      const bothRows = buildBothSheet(state, user, mixCount, refMix, fields);
      const wsBoth = XLSX.utils.aoa_to_sheet(bothRows);
      wsBoth['!cols'] = bothRows[0].map((h, i) => ({ wch: i < 8 ? 10 : 15 }));
      XLSX.utils.book_append_sheet(wb, wsBoth, 'Ambos');
    }

    if (opts.includeValidation !== false) {
      const valRows = buildValidationSheet(state, user, mixCount, fields, hasFlexion ? ['compression', 'flexion'] : ['compression']);
      if (valRows) {
        const wsVal = XLSX.utils.aoa_to_sheet(valRows);
        wsVal['!cols'] = valRows[0].map((h, i) => ({ wch: i < 8 ? 10 : 15 }));
        XLSX.utils.book_append_sheet(wb, wsVal, 'Validación');
      }
    }

    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `Resultados_${user.id || 'tesis'}_${dateStr}.xlsx`);
  };
})();
