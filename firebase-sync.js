// Firebase init + sync helpers (multi-usuario)
// Cada usuario tiene su propia colección. Estructura del doc:
//   { castDate, castMoment, retraction, flexion, compression, shrinkAges? }

const firebaseConfig = {
  apiKey: "AIzaSyAHJisFNvTbxkfTJXYDS5tw8JSxlyVySk8",
  authDomain: "tesis-f1faa.firebaseapp.com",
  projectId: "tesis-f1faa",
  storageBucket: "tesis-f1faa.firebasestorage.app",
  messagingSenderId: "341322371127",
  appId: "1:341322371127:web:010e54701a492938beefb2"
};

let _db = null;
let _ready = false;
let _readyCallbacks = [];

window.FB = {
  init() {
    if (_ready) return;
    try {
      firebase.initializeApp(firebaseConfig);
      _db = firebase.firestore();
      _ready = true;
      _readyCallbacks.forEach(cb => cb());
      _readyCallbacks = [];
      console.log('[FB] initialized');
    } catch (e) {
      console.error('[FB] init failed', e);
    }
  },

  onReady(cb) { if (_ready) cb(); else _readyCallbacks.push(cb); },
  isReady() { return _ready; },

  // Lee todas las mezclas del usuario activo.
  async loadAll(user) {
    if (!_ready) throw new Error('Firebase not ready');
    const u = typeof user === 'string' ? window.USERS[user] : (user || window.getActiveUser());
    const coll = u.firestoreCollection;
    const snap = await _db.collection(coll).get();
    const results = {};
    const mixMeta = {};

    snap.forEach(doc => {
      const mix = parseInt(doc.id);
      if (!mix || mix < 1 || mix > u.mixCount) return;
      const d = doc.data();
      mixMeta[mix] = {
        castDate: d.castDate || '',
        castMoment: d.castMoment || '',
      };
      const fallbackEmpty = window.makeEmptyResults(u)[mix];
      results[mix] = {
        retraction: d.retraction || fallbackEmpty.retraction,
        flexion: d.flexion || fallbackEmpty.flexion,
        compression: d.compression || fallbackEmpty.compression,
        ...(d.shrinkAges ? { shrinkAges: d.shrinkAges } : {}),
      };
    });

    // Asegurar todas las mezclas
    const allEmpty = window.makeEmptyResults(u);
    for (let i = 1; i <= u.mixCount; i++) {
      if (!results[i]) {
        results[i] = allEmpty[i];
        mixMeta[i] = { castDate: '', castMoment: '' };
      }
    }
    if (snap.empty) return null;
    return { results, mixMeta };
  },

  async saveMix(mixId, mixData, meta, user) {
    if (!_ready) throw new Error('Firebase not ready');
    const u = typeof user === 'string' ? window.USERS[user] : (user || window.getActiveUser());
    const coll = u.firestoreCollection;
    // Compacta las curvas mecánicas: guarda solo t/load/disp (lo que usa la app),
    // conservando la MISMA cantidad de puntos para no romper los índices de
    // recorte/corrección. Reduce ~3x el tamaño del documento (límite Firestore: 1 MB).
    const compactMech = (specs) => (specs || []).map(s => {
      if (!s.parsed || !Array.isArray(s.parsed.points)) return s;
      const points = s.parsed.points.map(p => ({ t: p.t, load: p.load, disp: p.disp }));
      return { ...s, parsed: { ...s.parsed, points } };
    });
    const doc = {
      castDate: meta.castDate || '',
      castMoment: meta.castMoment || '',
      retraction: mixData.retraction,
      flexion: compactMech(mixData.flexion),
      compression: compactMech(mixData.compression),
      _updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };
    if (mixData.shrinkAges) doc.shrinkAges = mixData.shrinkAges;
    await _db.collection(coll).doc(String(mixId)).set(doc);
  },

  async saveMany(mixesToSave, state, user) {
    const results = await Promise.allSettled(
      mixesToSave.map(mix => this.saveMix(mix, state.results[mix], state.mixMeta[mix], user))
    );
    const failed = [];
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        failed.push(mixesToSave[i]);
        console.error('[FB] save failed for mix', mixesToSave[i], r.reason);
      }
    });
    if (failed.length) {
      const err = new Error('No se pudieron guardar las mezclas: ' + failed.join(', '));
      err.failedMixes = failed;
      throw err;
    }
  },
};

if (typeof firebase !== 'undefined' && firebase.initializeApp) {
  window.FB.init();
}
