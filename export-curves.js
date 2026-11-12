// ===== EXPORTACIÓN DE CURVAS A .ZIP =====
// Estructura:
//   Curvas_<usuario>_<fecha>/
//     LEEME.txt, indice.csv
//     Originales|Corregidas/<Fase>/<Ensayo>/<Mezcla>/<Mezcla>_<Fase>_<Ensayo>_<Probeta>_<edad>d.txt
(function () {
  const PH_DIR = { p1: 'Fase 1', p2: 'Fase 2', valid: 'Validacion' };
  const PH_TAG = { p1: 'F1', p2: 'F2', valid: 'VAL' };
  const TEST_DIR = { flexion: 'Flexion', compression: 'Compresion' };
  const safe = (s) => String(s).replace(/[^\w.\-]+/g, '_');
  const n = (v, d) => (v == null || isNaN(v) ? '' : Number(v).toFixed(d));

  function processed(spec, testKey, mix) {
    let p = spec.parsed;
    if (spec.correction) p = window.applyCorrection(p, spec.correction);
    if (spec.trimIdx || spec.trimEndIdx != null) p = window.applyTrim(p, spec.trimIdx, spec.trimEndIdx);
    let fp = null;
    if (testKey === 'flexion') {
      fp = window.applyFirstPeakCorrection(p, { mix, age: spec.age });
      p = fp || window.truncateAtMax(p);
    }
    return { p, fp };
  }

  function buildTxt(header, points, testKey, spec) {
    const lines = header.map(([k, v]) => `${k}\t${v}`);
    lines.push('', 'Time(s)\tDisp(mm)\tLoad(kN)\tStress(MPa)');
    for (const pt of points) {
      const mpa = window.computeStressMPa(pt.load, testKey, spec);
      lines.push([n(pt.t, 3), n(pt.disp, 5), n(pt.load, 5), n(mpa, 4)].join('\t'));
    }
    return lines.join('\r\n');
  }

  window.exportCurvesZip = async function (state, user, opts) {
    if (!window.JSZip) throw new Error('JSZip no cargó');
    const { orig = true, corr = true, phases = ['p1', 'p2', 'valid'], tests = ['flexion', 'compression'] } = opts || {};
    const date = new Date().toISOString().slice(0, 10);
    const rootName = `Curvas_${safe(user.name || user.id || 'usuario')}_${date}`;
    const zip = new JSZip();
    const root = zip.folder(rootName);
    const idx = [['Mezcla', 'Fase', 'Ensayo', 'Probeta', 'Edad_d', 'Lado1_largo_mm', 'Lado2_alto_mm', 'Lado3_ancho_mm', 'Pmax_kN', 'Sigma_max_MPa', 'Corregida_manual', 'Recortada', 'Primer_peak', 'N_puntos_original', 'Archivo_original', 'Archivo_corregido']];
    let count = 0;
    const mixes = Object.keys(state.results).map(Number).sort((a, b) => a - b);
    for (const mix of mixes) {
      const ml = safe(window.mixLabel(mix));
      for (const testKey of tests) {
        for (const spec of (state.results[mix][testKey] || [])) {
          if (!spec.parsed || !spec.parsed.points || !spec.parsed.points.length) continue;
          const ph = window.phaseOf(mix, spec);
          if (!phases.includes(ph)) continue;
          const sid = safe(window.specDisplayId ? window.specDisplayId(spec) : spec.id);
          const base = `${ml}_${PH_TAG[ph]}_${TEST_DIR[testKey]}_${sid}_${spec.age}d`;
          const sub = `${PH_DIR[ph]}/${TEST_DIR[testKey]}/${ml}`;
          const { p, fp } = processed(spec, testKey, mix);
          const pmax = spec.parsed.pmax;
          const header = [
            ['Mezcla', window.mixLabel(mix)], ['Fase', PH_DIR[ph]], ['Ensayo', TEST_DIR[testKey]],
            ['Probeta', spec.id], ['Edad (d)', spec.age],
            ['Lado1 largo (mm)', spec.length ?? ''], ['Lado2 alto (mm)', spec.height ?? ''], ['Lado3 ancho (mm)', spec.width ?? ''],
            ['Pmax (kN)', n(pmax, 4)], ['Sigma max (MPa)', n(window.computeStressMPa(pmax, testKey, spec), 3)],
          ];
          let fo = '', fc = '';
          if (orig) {
            fo = `Originales/${sub}/${base}_original.txt`;
            root.file(fo, buildTxt([...header, ['Curva', 'Original (sin corrección)']], spec.parsed.points, testKey, spec));
            count++;
          }
          if (corr && p && p.points) {
            const steps = [spec.correction && 'corrección inicial', (spec.trimIdx || spec.trimEndIdx != null) && 'recorte', fp && 'primer peak', testKey === 'flexion' && !fp && 'recorte 0.5 mm tras Pmax'].filter(Boolean);
            fc = `Corregidas/${sub}/${base}_corregida.txt`;
            root.file(fc, buildTxt([...header, ['Curva', 'Corregida: ' + (steps.join(' + ') || 'sin cambios')]], p.points, testKey, spec));
            count++;
          }
          idx.push([window.mixLabel(mix), PH_DIR[ph], TEST_DIR[testKey], spec.id, spec.age, spec.length ?? '', spec.height ?? '', spec.width ?? '',
            n(pmax, 4), n(window.computeStressMPa(pmax, testKey, spec), 3), spec.correction ? 'si' : 'no',
            (spec.trimIdx || spec.trimEndIdx != null) ? 'si' : 'no', fp ? 'si' : 'no', spec.parsed.nPoints || spec.parsed.points.length, fo, fc]);
        }
      }
    }
    if (!count) throw new Error('No hay curvas que cumplan la selección.');
    root.file('indice.csv', '\ufeff' + idx.map(r => r.map(c => /[;"\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c).join(';')).join('\r\n'));
    root.file('LEEME.txt', [
      `Exportación de curvas — ${date}`, '',
      'Carpetas: <Originales|Corregidas>/<Fase>/<Ensayo>/<Mezcla>/',
      'Nombre:   <Mezcla>_<Fase>_<Ensayo>_<Probeta>_<Edad>d_<tipo>.txt', '',
      'Columnas: Time(s), Disp(mm), Load(kN), Stress(MPa)',
      'Stress calculado con:',
      '  Compresión: σ = P / (lado2 · lado3)',
      '  Flexión:    σ = 3·P·L / (2·b·d²), L = 100 mm, b = lado2, d = lado1', '',
      'Originales: curva cargada (ceros iniciales eliminados; máx. 600 puntos, se conserva el pico).',
      'Corregidas: corrección inicial + recorte; en flexión además corrección de primer peak o recorte a 0.5 mm tras Pmax.',
      'indice.csv: resumen de todas las probetas (separador ;).',
    ].join('\r\n'));
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = rootName + '.zip';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return count;
  };
})();
