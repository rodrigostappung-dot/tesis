// ===== USUARIOS =====
// Cada usuario tiene su propia colección en Firestore + claves de localStorage separadas.
// La estructura de las mezclas (cantidad, layouts de probetas) depende del usuario.

window.USERS = {
  rodrigo: {
    id: 'rodrigo',
    name: 'Rodrigo',
    mixCount: 45,
    hasFactorial: true,           // Mostrar matriz factorial
    hasFlexion: true,             // Tiene ensayo de flexión
    fixedShrinkAges: [0, 1, 7, 28],  // Edades fijas de retracción
    flexionSpecs: (mix) => mix === 45 ? window.M45_FLEXION_SPECIMENS : window.FLEXION_SPECIMENS,
    compressionSpecs: (mix) => mix === 45 ? window.M45_COMPRESSION_SPECIMENS : window.COMPRESSION_SPECIMENS,
    shrinkageSpecs: (mix) => {
      if (mix === 45) return window.M45_SHRINKAGE_SPECIMENS;       // centro: A–F
      if (mix >= 33 && mix <= 44) return window.SHRINKAGE_SPECIMENS; // puntos estrella: A, B
      return []; // vértices (1–32): sin retracción
    },
    factorialDesign: () => window.FACTORIAL_DESIGN,
    centerMix: 45,
    firestoreCollection: 'mixes',   // Backward compat: la colección original es de Rodrigo
    localStorageKey: 'tesis_ensayos_v2',
  },
  nicolas: {
    id: 'nicolas',
    name: 'Nicolás',
    mixCount: 36,
    hasFactorial: true,           // Carga el diseño después
    hasFlexion: false,            // Solo compresión + retracción
    fixedShrinkAges: null,        // Edades configurables por mezcla
    flexionSpecs: () => [],
    compressionSpecs: () => [
      { id: 'A', age: 7 }, { id: 'B', age: 7 }, { id: 'C', age: 7 },
      { id: 'D', age: 28 }, { id: 'E', age: 28 }, { id: 'F', age: 28 },
    ],
    shrinkageSpecs: () => [{ id: 'A' }, { id: 'B' }],
    factorialDesign: () => window.NICOLAS_FACTORIAL_DESIGN || [],
    centerMix: null,
    firestoreCollection: 'mixes_nicolas',
    localStorageKey: 'tesis_nicolas_v1',
  },
};

window.USER_LIST = ['rodrigo', 'nicolas'];

// Diseño factorial placeholder para Nicolás (hasta que lo cargue)
window.NICOLAS_FACTORIAL_DESIGN = [];
for (let i = 1; i <= 36; i++) {
  window.NICOLAS_FACTORIAL_DESIGN.push({ run: i });
}

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
