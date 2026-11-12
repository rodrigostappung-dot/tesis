// Sube las curvas Fase 2 (window.PHASE2_UPLOAD) directo a la nube: lee cada mezcla
// desde Firestore, reemplaza/crea las probetas, ajusta tamaño (<1 MB) y guarda. Verifica releyendo.
(function () {
  const LIMIT = 900 * 1024;
  const toParsed = (pts) => {
    const points = pts.map(([t, disp, load]) => ({ t, disp, load }));
    let pmax = 0, idxPmax = 0;
    points.forEach((p, i) => { if (p.load > pmax) { pmax = p.load; idxPmax = i; } });
    return { meta: { source: 'Fase 2 corregida (carga masiva)' }, points, pmax, smax: 0, nPoints: points.length, idxPmax, preCorrected: true };
  };
  const halve = (parsed) => {
    const pts = parsed.points, out = [];
    for (let i = 0; i < pts.length; i++) if (i % 2 === 0 || i === parsed.idxPmax || i === pts.length - 1) out.push(pts[i]);
    let pmax = 0, idxPmax = 0;
    out.forEach((p, i) => { if (p.load > pmax) { pmax = p.load; idxPmax = i; } });
    return { ...parsed, points: out, idxPmax, nPoints: out.length };
  };
  const docSize = (md) => JSON.stringify({ f: md.flexion, c: md.compression }).length;

  window.uploadPhase2 = async function (user, remote) {
    const UP = window.PHASE2_UPLOAD || {};
    const results = {}, report = { ok: [], created: [], downsampled: [], failed: [], mismatch: [] };
    const mixes = new Set([...Object.keys(UP.compression || {}), ...Object.keys(UP.flexion || {})].map(Number));
    for (const mix of mixes) {
      const md = JSON.parse(JSON.stringify(remote.results[mix] || window.makeEmptyResults(user)[mix]));
      for (const test of ['compression', 'flexion']) {
        const byId = (UP[test] || {})[mix]; if (!byId) continue;
        md[test] = md[test] || [];
        for (const id in byId) {
          const d = byId[id]; if (!d.pts || !d.pts.length) continue;
          let spec = md[test].find(s => s.id === id);
          if (!spec) { spec = { id, age: d.age, phase: 2 }; md[test].push(spec); report.created.push(`${mix}/${test}/${id}`); }
          spec.age = d.age;
          spec.parsed = toParsed(d.pts);
          delete spec.correction; delete spec.trimIdx; delete spec.trimEndIdx; delete spec.file;
          if (d.L) spec.length = d.L; if (d.H) spec.height = d.H; if (d.W) spec.width = d.W;
          const wt = ((window.PHASE2_WEIGHTS || {})[mix]?.[test] || {})[id];
          if (wt) { spec.weight = wt.w; if (wt.L) spec.length = wt.L; if (wt.H) spec.height = wt.H; if (wt.W) spec.width = wt.W; }
        }
      }
      let guard = 0;
      while (docSize(md) > LIMIT && guard++ < 4) {
        for (const test of ['compression', 'flexion']) for (const s of md[test]) if (s.parsed && s.parsed.preCorrected && s.parsed.points.length > 150) s.parsed = halve(s.parsed);
        report.downsampled.push(mix);
      }
      results[mix] = md;
    }
    const list = [...mixes];
    for (let i = 0; i < list.length; i += 5) {
      await Promise.all(list.slice(i, i + 5).map(async mix => {
        try { await window.FB.saveMix(mix, results[mix], (remote.mixMeta || {})[mix] || {}, user); report.ok.push(mix); }
        catch (e) { console.error('[phase2] save', mix, e); report.failed.push(mix); }
      }));
    }
    // Verificación: releer y comparar Pmax por probeta
    const check = await window.FB.loadAll(user);
    if (!check) { report.mismatch.push('sin conexión al verificar'); return { results, report }; }
    for (const mix of list) for (const test of ['compression', 'flexion']) {
      const byId = (UP[test] || {})[mix]; if (!byId) continue;
      for (const id in byId) {
        const s = (check.results[mix]?.[test] || []).find(x => x.id === id);
        const pm = Math.max(...byId[id].pts.map(p => p[2]));
        if (!s || !s.parsed || Math.abs(s.parsed.pmax - pm) > 1e-3) report.mismatch.push(`${mix}/${test}/${id}`);
      }
    }
    return { results, report };
  };
})();
