// ===== USUARIOS =====
// Cada usuario tiene su propia colección en Firestore + claves de localStorage separadas.
// La estructura de las mezclas (cantidad, layouts de probetas) depende del usuario.

window.USERS = {
  rodrigo: {
    id: 'rodrigo',
    name: 'Rodrigo',
    mixCount: 59,               // 1–45 factorial + 46–59 validación (P1–P14)
    hasFactorial: true,           // Mostrar matriz factorial
    hasFlexion: true,             // Tiene ensayo de flexión
    fixedShrinkAges: [0, 1, 7, 28],  // Edades fijas de retracción
    flexionSpecs: (mix) => mix > 45 ? window.validSpecs(mix) : (mix === 45 ? window.M45_FLEXION_SPECIMENS.concat(window.M45_PHASE2_FLEXION_SPECIMENS) : window.FLEXION_SPECIMENS.concat(window.PHASE2_FLEXION_SPECIMENS)),
    compressionSpecs: (mix) => mix > 45 ? window.validSpecs(mix) : (mix === 45 ? window.M45_COMPRESSION_SPECIMENS.concat(window.M45_PHASE2_COMPRESSION_SPECIMENS) : window.COMPRESSION_SPECIMENS.concat(window.PHASE2_COMPRESSION_SPECIMENS)),
    shrinkageSpecs: () => [],     // retracción eliminada
    factorialDesign: () => window.FACTORIAL_DESIGN,
    centerMix: 45,
    firestoreCollection: 'mixes',   // Backward compat: la colección original es de Rodrigo
    localStorageKey: 'tesis_ensayos_v2',
  },
};

window.USER_LIST = ['rodrigo'];

// Helpers que reemplazan getSpecsFor, considerando el usuario activo
window.getActiveUser = function() {
  const id = localStorage.getItem('tesis_active_user') || 'rodrigo';
  return window.USERS[id] || window.USERS.rodrigo;
};

window.setActiveUser = function(id) {
  if (!window.USERS[id]) return false;
  localStorage.setItem('tesis_active_user', id);
  return true;
};

// Versión de getSpecsFor que toma en cuenta el usuario activo
window.getSpecsForUser = function(user, mix, test) {
  const u = typeof user === 'string' ? window.USERS[user] : user;
  if (!u) return [];
  if (test === 'flexion') return u.flexionSpecs(mix);
  if (test === 'compression') return u.compressionSpecs(mix);
  if (test === 'retraction') return u.shrinkageSpecs(mix);
  return [];
};

// Edades de retracción para una mezcla. Si el usuario tiene fixedShrinkAges, las usa.
// Si no, lee las edades de la propia data de la mezcla (ages personalizadas).
window.getShrinkAgesForMix = function(user, mixData) {
  const u = typeof user === 'string' ? window.USERS[user] : user;
  if (u.fixedShrinkAges) return u.fixedShrinkAges;
  // Variable: leer del primer spec disponible
  const retr = mixData?.retraction;
  if (!retr || !retr.length) return [];
  // Combinar las keys numéricas de todos los specs
  const set = new Set();
  for (const sp of retr) {
    if (sp.values) for (const k of Object.keys(sp.values)) {
      const n = parseInt(k);
      if (!isNaN(n)) set.add(n);
    }
  }
  // También tomar ages declaradas en mixData.shrinkAges si existe
  if (Array.isArray(mixData.shrinkAges)) {
    for (const a of mixData.shrinkAges) set.add(parseInt(a));
  }
  return [...set].sort((a, b) => a - b);
};
