// ===== EXPORTACIÓN A EXCEL =====
// Genera un .xlsx con toda la información de las mezclas usando SheetJS (window.XLSX).
//
// Una sola función de exportación configurable por variables: window.exportMixesExcel
// recibe un mapa {fieldId: true/false} que decide qué columnas incluir por cada
// probeta/edad. Dos hojas: Compresión y Flexión. Una fila por mezcla (N45 en 3 réplicas).
//
// Falla frágil: caída abrupta de la carga (∝ tensión) de más del 20% del valor
// pico en una ventana de tiempo ≤ 3 s después de alcanzar el máximo.

(function () {
  const FACTORS = ['BR', 'AMF', 'FVF', 'SFL', 'AFL', 'T'];

  const r2 = (v) => (v == null || isNaN(v)) ? '' : Math.round(v * 100) / 100;
  const r3 = (v) => (v == null || isNaN(v)) ? '' : Math.round(v * 1000) / 1000;

  // ---------- Definición de variables exportables ----------
  // get(m) recibe las métricas calculadas de la probeta; fromSpec(spec) lee directo de la probeta.
  window.EXPORT_FIELDS = [
    { id: 'pmax', label: 'P máx (kN)', get: (m) => r3(m.pmaxKN) },
    { id: 'sigma', label: 'σ máx (MPa)', get: (m) => r2(m.sigmaMPa) },
    { id: 'disp', label: 'Desplaz./Deflexión máx (mm)', get: (m) => r3(m.dispAtMax) },
    { id: 'strain', label: 'Deformación unitaria máx (mm/mm)', compOnly: true, get: (m) => r3(m.strainUnit) },
    { id: 'slope', label: 'Pendiente recta de corrección (kN/mm)', get: (m) => r3(m.correctionSlope) },
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
  function specMetrics(spec, testKey) {
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
    return {
      pmaxKN, sigmaMPa: sigma, strainUnit, dispAtMax: pk.disp,
      brittle: br.brittle, correctionSlope: correctionSlope(spec),
    };
  }

  function designOf(mix) {
    return (window.FACTORIAL_DESIGN || []).find(d => d.run === mix) || {};
  }
  function specsDef(user, mix, test) {
    return (window.getSpecsForUser ? window.getSpecsForUser(user, mix, test) : window.getSpecsFor(mix, test)) || [];
  }

  // Construye una hoja ancha para un ensayo: una fila por mezcla (la mezcla centro
  // se divide en N réplicas). Columnas = solo las variables activas en `fields`,
  // repetidas por edad y por "slot" de probeta (flexión: 2 slots/edad).
  function buildTestSheet(state, user, mixCount, testKey, refMix, fields) {
    const activeFields = window.EXPORT_FIELDS.filter(f =>
      fields[f.id] && !(f.compOnly && testKey !== 'compression'));

    const defByAgeRef = {};
    specsDef(user, refMix, testKey).forEach(s => { (defByAgeRef[s.age] = defByAgeRef[s.age] || []).push(s.id); });
    const ageList = Object.keys(defByAgeRef).map(Number).sort((a, b) => a - b);
    const slotsPerAge = Math.max(1, ...ageList.map(a => defByAgeRef[a].length));

    const head = ['N° mezcla', 'Réplica', ...FACTORS];
    ageList.forEach(age => {
      for (let slot = 1; slot <= slotsPerAge; slot++) {
        const lbl = slotsPerAge > 1 ? `${age}d #${slot}` : `${age}d`;
        activeFields.forEach(f => head.push(`${lbl} ${f.label}`));
      }
    });
    const rows = [head];

    for (let mix = 1; mix <= mixCount; mix++) {
      const md = state.results[mix];
      if (!md) continue;
      const facVals = FACTORS.map(f => designOf(mix)[f] ?? '');

      const defByAge = {}; ageList.forEach(a => defByAge[a] = []);
      specsDef(user, mix, testKey).forEach(s => { if (defByAge[s.age]) defByAge[s.age].push(s.id); });
      const loaded = {}; (md[testKey] || []).forEach(s => { loaded[s.id] = s; });
      const replicaCount = Math.max(1, ...ageList.map(a => Math.ceil(defByAge[a].length / slotsPerAge)));

      for (let r = 0; r < replicaCount; r++) {
        const row = [mix, r + 1, ...facVals];
        ageList.forEach(age => {
          for (let slot = 0; slot < slotsPerAge; slot++) {
            const id = defByAge[age][r * slotsPerAge + slot];
            const spec = id ? loaded[id] : null;
            const m = spec ? specMetrics(spec, testKey) : null;
            activeFields.forEach(f => {
              if (f.fromSpec) { row.push(spec ? f.fromSpec(spec) : ''); }
              else { row.push(m ? f.get(m) : ''); }
            });
          }
        });
        rows.push(row);
      }
    }
    return rows;
  }

  // Exporta según las variables activas (fields: {fieldId: bool}). Si se omite, exporta todo.
  window.exportMixesExcel = function (state, user, T, fields) {
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
    }

    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `Resultados_${user.id || 'tesis'}_${dateStr}.xlsx`);
  };
})();
