// Parser para archivos de ensayo (.txt formato Time/Load/Elong/Disp/Stress/Strain)
window.parseTestFile = function(text) {
  const lines = text.split(/\r?\n/);
  let curveStart = -1;
  const meta = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('-----') && line.toLowerCase().includes('curve')) {
      curveStart = i;
      break;
    }
    const parts = line.split('\t');
    if (parts.length >= 2 && parts[0].trim() && parts[1].trim()) {
      meta[parts[0].trim()] = parts[1].trim();
    }
  }
  if (curveStart === -1) {
    // intentar detectar por header Time\tLoad
    for (let i = 0; i < lines.length; i++) {
      if (/^Time\s+Load/i.test(lines[i])) { curveStart = i - 1; break; }
    }
  }
  const points = [];
  let headerFound = false;
  for (let i = curveStart + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    if (!headerFound) {
      if (/time/i.test(parts[0])) { headerFound = true; continue; }
    }
    if (parts.length < 5) continue;
    const t = parseFloat(parts[0]);
    const load = parseFloat(parts[1]);
    const elong = parseFloat(parts[2]);
    const disp = parseFloat(parts[3]);
    const stress = parseFloat(parts[4]);
    const strain = parseFloat(parts[5]);
    if (isNaN(t) || isNaN(load)) continue;
    points.push({ t, load, elong, disp: Math.abs(disp), stress, strain });
  }
  let pmax = 0, smax = 0, idxPmax = 0;
  points.forEach((p, i) => {
    if (p.load > pmax) { pmax = p.load; idxPmax = i; }
    if (p.stress > smax) smax = p.stress;
  });
  return {
    meta,
    points,
    pmax,
    smax,
    nPoints: points.length,
    idxPmax,
  };
};

// Estado por defecto: 45 mezclas
// Estructura por mezcla:
//   retraction: probetas A, B (cada una con valores en edades 0, 1, 7, 28 días)
//   flexion:    A(1d), B(1d), C(7d), D(7d), E(28d), F(28d) -- 6 probetas, archivo .txt c/u
//   compression: A(1d), B(7d), C(28d) -- 3 probetas, archivo .txt c/u
window.SHRINKAGE_AGES = [0, 1, 7, 28];
window.TESTS = ['retraction', 'flexion', 'compression'];

window.FLEXION_SPECIMENS = [
  { id: 'A', age: 1 }, { id: 'B', age: 1 },
  { id: 'C', age: 7 }, { id: 'D', age: 7 },
  { id: 'E', age: 28 }, { id: 'F', age: 28 },
];
window.COMPRESSION_SPECIMENS = [
  { id: 'A', age: 1 }, { id: 'B', age: 7 }, { id: 'C', age: 28 },
];
window.SHRINKAGE_SPECIMENS = [
  { id: 'A' }, { id: 'B' },
];

function emptyShrinkSpec(id) {
  const values = {};
  window.SHRINKAGE_AGES.forEach(a => { values[a] = []; });  // array of up to 12 readings
  return { id, values };
}
function emptyMechSpec(id, age) {
  return { id, age, file: null, parsed: null, length: '', height: '', width: '', weight: '', testDate: '', notes: '' };
}

window.makeEmptyResults = function() {
  const data = {};
  for (let mix = 1; mix <= 45; mix++) {
    data[mix] = {
      retraction: window.SHRINKAGE_SPECIMENS.map(s => emptyShrinkSpec(s.id)),
      flexion: window.FLEXION_SPECIMENS.map(s => emptyMechSpec(s.id, s.age)),
      compression: window.COMPRESSION_SPECIMENS.map(s => emptyMechSpec(s.id, s.age)),
    };
  }
  return data;
};

window.makeEmptyMixMeta = function() {
  const m = {};
  for (let i = 1; i <= 45; i++) m[i] = { castDate: '' };
  return m;
};

// Estadísticas
window.stats = function(values) {
  const v = values.filter(x => typeof x === 'number' && !isNaN(x) && x > 0);
  if (v.length === 0) return null;
  const avg = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - avg) ** 2, 0) / v.length);
  const cv = avg > 0 ? (sd / avg) * 100 : 0;
  return { avg, sd, cv, n: v.length };
};

// Progreso
// Una "medición" para retracción = un valor (probeta × edad)
// Una "medición" para mecánicos = una probeta con archivo procesado
window.specimenDoneCount = function(test, spec) {
  if (test === 'retraction') {
    let n = 0;
    for (const a of window.SHRINKAGE_AGES) {
      const arr = spec.values[a];
      if (Array.isArray(arr) ? arr.some(v => v !== '' && !isNaN(parseFloat(v))) : (arr !== '' && !isNaN(parseFloat(arr)))) n++;
    }
    return n;
  }
  return spec.parsed && spec.parsed.pmax > 0 ? 1 : 0;
};

window.shrinkAvg = function(spec, age) {
  const arr = spec.values[age];
  if (!Array.isArray(arr)) {
    const v = parseFloat(arr); return !isNaN(v) ? { avg: v, n: 1 } : null;
  }
  const v = arr.map(x => parseFloat(x)).filter(x => !isNaN(x));
  if (v.length === 0) return null;
  const avg = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - avg) ** 2, 0) / v.length);
  return { avg, sd, n: v.length };
};

window.specimenTotalCount = function(test) {
  return test === 'retraction' ? window.SHRINKAGE_AGES.length : 1;
};

window.testProgress = function(test, specs) {
  let done = 0, total = 0;
  for (const s of specs) {
    done += window.specimenDoneCount(test, s);
    total += window.specimenTotalCount(test);
  }
  return { done, total };
};

window.mixProgress = function(mixData) {
  let done = 0, total = 0;
  for (const test of window.TESTS) {
    const p = window.testProgress(test, mixData[test]);
    done += p.done; total += p.total;
  }
  return { done, total, pct: total > 0 ? done / total : 0 };
};

// Agrupar probetas mecánicas por edad (para mostrar en pestañas o secciones por edad)
window.groupByAge = function(specs) {
  const groups = {};
  for (const s of specs) {
    if (!groups[s.age]) groups[s.age] = [];
    groups[s.age].push(s);
  }
  return groups;
};
