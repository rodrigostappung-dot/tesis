// Firebase init + sync helpers
// Una mezcla = un documento en colección "mixes". 45 docs total.
// Estructura del doc: { castDate, castMoment, retraction, flexion, compression }

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

  onReady(cb) {
    if (_ready) cb();
    else _readyCallbacks.push(cb);
  },

  isReady() { return _ready; },

  // Lee todas las mezclas (45 docs). Devuelve {results, mixMeta} en formato app.
  async loadAll() {
    if (!_ready) throw new Error('Firebase not ready');
    const snap = await _db.collection('mixes').get();
    if (snap.empty) return null;
    const results = {};
    const mixMeta = {};
    snap.forEach(doc => {
      const mix = parseInt(doc.id);
      if (!mix || mix < 1 || mix > 45) return;
      const d = doc.data();
      mixMeta[mix] = {
        castDate: d.castDate || '',
        castMoment: d.castMoment || '',
      };
      results[mix] = {
        retraction: d.retraction || window.getSpecsFor(mix, 'retraction').map(s => ({ id: s.id, values: { 0: [], 1: [], 7: [], 28: [] } })),
        flexion: d.flexion || window.getSpecsFor(mix, 'flexion').map(s => ({ id: s.id, age: s.age, file: null, parsed: null, length: '', height: '', width: '', weight: '', testDate: '', firstPeakIdx: null, trimIdx: null })),
        compression: d.compression || window.getSpecsFor(mix, 'compression').map(s => ({ id: s.id, age: s.age, file: null, parsed: null, length: '', height: '', width: '', weight: '', testDate: '', firstPeakIdx: null, trimIdx: null })),
      };
    });
    // Asegurar las 45 mezclas
    for (let i = 1; i <= 45; i++) {
      if (!results[i]) {
        const empty = window.makeEmptyResults()[i];
        results[i] = empty;
        mixMeta[i] = { castDate: '', castMoment: '' };
      }
    }
    return { results, mixMeta };
  },

  // Guarda una mezcla específica (batch para reducir writes)
  async saveMix(mixId, mixData, meta) {
    if (!_ready) throw new Error('Firebase not ready');
    const doc = {
      castDate: meta.castDate || '',
      castMoment: meta.castMoment || '',
      retraction: mixData.retraction,
      flexion: mixData.flexion,
      compression: mixData.compression,
      _updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };
    await _db.collection('mixes').doc(String(mixId)).set(doc);
  },

  // Guarda múltiples mezclas en paralelo
  async saveMany(mixesToSave, state) {
    const promises = mixesToSave.map(mix => this.saveMix(mix, state.results[mix], state.mixMeta[mix]));
    await Promise.all(promises);
  },
};

// Auto-init en cuanto el script de firebase esté cargado
if (typeof firebase !== 'undefined' && firebase.initializeApp) {
  window.FB.init();
}
