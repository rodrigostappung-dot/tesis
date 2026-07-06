// ===== CARGA RÁPIDA: drop multiple .txt files, auto-detect (mix, test, specimen) =====
// Workflow:
//   1. User drops N files
//   2. For each file, parser detects {mix, test, specimen} from filename + content
//   3. App walks through queue one-by-one with a preview card:
//      - shows detected assignment + parsed curve preview
//      - "✓ Confirmar y siguiente" / "Editar manualmente" / "Saltar"
//   4. Confirmed files are written to state.results

// Parsea nombres como:
//   "FLEXO 22A", "22B COM", "COM 22A", "COMP P34A", "com 33a", "FLEXO P34B", "32B COM.txt"
// Devuelve { mix, test, specimen } o { mix?, test?, specimen?, raw }
window.classifyTestFilename = function(fname) {
  const f = fname.replace(/\.txt$/i, '').toUpperCase().replace(/\s+/g, ' ').trim();
  let test = null;
  if (/FLEXO|FLEX/i.test(f)) test = 'flexion';
  else if (/COMP|COM/i.test(f)) test = 'compression';

  // Strip test word, P prefix, etc
  let rest = f.replace(/FLEXO|FLEX|COMP|COM/g, '').replace(/\s+/g, ' ').trim().replace(/^P/, '').trim();
  // Patterns like 22A, 34D, 45A, etc.
  const m = rest.match(/(\d{1,2})\s*([A-Za-z])?/);
  if (!m) return { test, raw: f, mix: null, specimen: null };
  const mix = parseInt(m[1]);
  let specimen = m[2] || null;
  // For non-45 mixes: uppercase. For 45: preserve case (the table has both cases meaningful).
  if (specimen != null) {
    specimen = mix === 45 ? specimen : specimen.toUpperCase();
  }
  return { mix: mix >= 1 && mix <= 45 ? mix : null, test, specimen, raw: f };
};

function QuickUploadTab({ state, onUpdateMix, T, lang }) {
  const [queue, setQueue] = React.useState([]); // [{file, text, parsed, detected, status}]
  const [cursor, setCursor] = React.useState(0);
  const [editMode, setEditMode] = React.useState(false);

  // Drop / pick handlers
  const handleFiles = async (files) => {
    const items = [];
    for (const file of files) {
      try {
        const text = await file.text();
        const parsed = window.parseTestFile(text);
        const detected = window.classifyTestFilename(file.name);
        items.push({
          file: { name: file.name, size: file.size },
          text,
          parsed,
          detected: { ...detected },
          original: { ...detected },
          status: 'pending', // pending / confirmed / skipped
        });
      } catch (e) {
        console.error('[quick upload] error parsing', file.name, e);
      }
    }
    setQueue(q => [...q, ...items]);
  };

  const onDrop = (e) => {
    e.preventDefault();
    const files = [...e.dataTransfer.files].filter(f => f.name.toLowerCase().endsWith('.txt'));
    if (files.length) handleFiles(files);
  };
  const onPickFiles = (e) => {
    const files = [...e.target.files].filter(f => f.name.toLowerCase().endsWith('.txt'));
    if (files.length) handleFiles(files);
  };

  const current = queue[cursor];
  const pendingCount = queue.filter(q => q.status === 'pending').length;
  const confirmedCount = queue.filter(q => q.status === 'confirmed').length;
  const skippedCount = queue.filter(q => q.status === 'skipped').length;

  const skipCurrent = () => {
    setQueue(q => q.map((it, i) => i === cursor ? { ...it, status: 'skipped' } : it));
    advance();
  };

  const confirmCurrent = () => {
    if (!current) return;
    const det = current.detected;
    if (det.mix == null || !det.test || !det.specimen) {
      alert(T.errIncomplete || 'Faltan campos. Completa la asignación.');
      return;
    }
    const slot = state.results[det.mix]?.[det.test]?.find(s => s.id === det.specimen);
    if (!slot) {
      alert(T.errNoSlot || `No existe probeta ${det.specimen} en N${det.mix} ${T[det.test] || det.test}.`);
      return;
    }
    // Apply
    const specs = state.results[det.mix][det.test].map(s => {
      if (s.id !== det.specimen) return s;
      const next = { ...s, file: current.file, parsed: current.parsed };
      if (current.parsed?.meta?.TestDate) {
        const mm = current.parsed.meta.TestDate.match(/(\d+)\/(\d+)\/(\d+)/);
        if (mm) next.testDate = `${mm[3]}-${String(mm[1]).padStart(2,'0')}-${String(mm[2]).padStart(2,'0')}`;
      }
      return next;
    });
    const nextMix = { ...state.results[det.mix], [det.test]: specs };
    onUpdateMix(det.mix, nextMix);
    setQueue(q => q.map((it, i) => i === cursor ? { ...it, status: 'confirmed' } : it));
    advance();
  };

  const advance = () => {
    setEditMode(false);
    // Find next pending
    setCursor(c => {
      for (let i = c + 1; i < queue.length; i++) if (queue[i].status === 'pending') return i;
      for (let i = 0; i < queue.length; i++) if (queue[i].status === 'pending') return i;
      return c;
    });
  };

  const goTo = (i) => { setCursor(i); setEditMode(false); };

  const updateDetected = (patch) => {
    setQueue(q => q.map((it, i) => i === cursor ? { ...it, detected: { ...it.detected, ...patch } } : it));
  };

  const clearQueue = () => {
    if (queue.length > 0 && !confirm(T.confirmClearQueue || '¿Descartar la cola actual?')) return;
    setQueue([]); setCursor(0); setEditMode(false);
  };

  // Available specimen IDs for current detected (mix, test)
  const availableSpecs = (current && current.detected.mix && current.detected.test)
    ? window.getSpecsFor(current.detected.mix, current.detected.test)
    : [];

  return (
    <div className="quick-upload">
      <div className="qu-header">
        <h2>{T.quickUpload || 'Carga rápida'}</h2>
        <p className="qu-desc">{T.quickUploadDesc || 'Arrastra varios archivos .txt y la app intentará asignarlos automáticamente. Confirmá uno por uno.'}</p>
      </div>

      {queue.length === 0 ? (
        <label className="qu-dropzone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}>
          <div className="qu-icon">⤓</div>
          <div className="qu-title">{T.dropFiles || 'Arrastra archivos .txt aquí'}</div>
          <div className="qu-hint">{T.orClick || 'o haz click para seleccionar'}</div>
          <input type="file" multiple accept=".txt" onChange={onPickFiles} style={{display:'none'}} />
        </label>
      ) : (
        <div className="qu-layout">
          {/* Sidebar: queue */}
          <div className="qu-sidebar">
            <div className="qu-stats">
              <span>{queue.length} {T.files || 'archivos'}</span>
              <span style={{color: 'var(--done)'}}>✓ {confirmedCount}</span>
              <span style={{color: 'var(--text-3)'}}>⊘ {skippedCount}</span>
              <span>⋯ {pendingCount}</span>
            </div>
            <div className="qu-queue-list">
              {queue.map((it, i) => (
                <div key={i}
                  className={'qu-queue-item ' + (it.status) + (i === cursor ? ' active' : '')}
                  onClick={() => goTo(i)}>
                  <span className="qu-q-status">
                    {it.status === 'confirmed' ? '✓' : it.status === 'skipped' ? '⊘' : '⋯'}
                  </span>
                  <span className="qu-q-name" title={it.file.name}>{it.file.name}</span>
                  {it.detected.mix && (
                    <span className="qu-q-tag">N{it.detected.mix}·{it.detected.test?.[0]?.toUpperCase()}-{it.detected.specimen}</span>
                  )}
                </div>
              ))}
            </div>
            <div style={{display: 'flex', gap: 6, marginTop: 8}}>
              <label className="vt-btn" style={{flex:1, textAlign:'center'}}>
                + {T.addMore || 'Más archivos'}
                <input type="file" multiple accept=".txt" onChange={onPickFiles} style={{display:'none'}} />
              </label>
              <button className="vt-btn" onClick={clearQueue}>{T.clear || 'Limpiar'}</button>
            </div>
          </div>

          {/* Main: current file preview */}
          <div className="qu-main">
            {current ? (
              <QuickUploadCard
                item={current}
                detected={current.detected}
                editMode={editMode}
                onEdit={() => setEditMode(true)}
                onUpdate={updateDetected}
                availableSpecs={availableSpecs}
                onConfirm={confirmCurrent}
                onSkip={skipCurrent}
                T={T}
                state={state}
              />
            ) : (
              <div className="hint-empty">{T.queueDone || 'Cola completada.'}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function QuickUploadCard({ item, detected, editMode, onEdit, onUpdate, availableSpecs, onConfirm, onSkip, T, state }) {
  const parsed = item.parsed;
  const auto = item.original;
  const isOK = detected.mix && detected.test && detected.specimen;
  // Check if there's already data in that slot
  const existingSpec = (detected.mix && detected.test && detected.specimen)
    ? state.results[detected.mix]?.[detected.test]?.find(s => s.id === detected.specimen)
    : null;
  const willOverwrite = existingSpec && existingSpec.parsed && existingSpec.parsed.pmax > 0;

  // For mix selector: all 45
  const allMixes = Array.from({length: 45}, (_, i) => i + 1);

  return (
    <div className="qu-card">
      <div className="qu-card-header">
        <div>
          <div className="qu-fname">📄 {item.file.name}</div>
          <div className="qu-status-tag" data-status={item.status}>
            {item.status === 'confirmed' ? '✓ ' + (T.confirmed || 'Confirmado')
              : item.status === 'skipped' ? '⊘ ' + (T.skipped || 'Saltado')
              : (T.pending || 'Pendiente')}
          </div>
        </div>
      </div>

      <div className="qu-card-body">
        <div className="qu-assignment">
          <div className="qu-detected-title">
            {auto.mix && auto.test && auto.specimen
              ? (T.autoDetected || 'Detección automática:')
              : (T.couldNotDetect || 'No se pudo detectar automáticamente. Completá:')}
          </div>
          <div className="qu-fields">
            <div className="qu-field">
              <label>{T.mix || 'Mezcla'}</label>
              <select value={detected.mix || ''} onChange={(e) => onUpdate({ mix: e.target.value ? parseInt(e.target.value) : null })}>
                <option value="">—</option>
                {allMixes.map(m => <option key={m} value={m}>N{m}</option>)}
              </select>
            </div>
            <div className="qu-field">
              <label>{T.test || 'Ensayo'}</label>
              <select value={detected.test || ''} onChange={(e) => onUpdate({ test: e.target.value || null, specimen: null })}>
                <option value="">—</option>
                <option value="flexion">{T.flexion}</option>
                <option value="compression">{T.compression}</option>
              </select>
            </div>
            <div className="qu-field">
              <label>{T.specimen || 'Probeta'}</label>
              <select value={detected.specimen || ''} onChange={(e) => onUpdate({ specimen: e.target.value || null })}
                      disabled={availableSpecs.length === 0}>
                <option value="">—</option>
                {availableSpecs.map(s => <option key={s.id} value={s.id}>{s.id} ({s.age}{T.day || 'd'})</option>)}
              </select>
            </div>
          </div>

          {willOverwrite && (
            <div className="qu-warning">
              ⚠ {T.willOverwrite || 'Esta probeta ya tiene un archivo cargado. Confirmar reemplazará los datos existentes.'}
            </div>
          )}

          {parsed && (
            <div className="qu-preview">
              <div className="qu-preview-stats">
                <div><span className="k">P max</span><span className="v">{parsed.pmax.toFixed(2)} kN</span></div>
                <div><span className="k">σ max</span><span className="v">{parsed.smax.toFixed(1)} MPa</span></div>
                <div><span className="k">{T.points || 'puntos'}</span><span className="v">{parsed.nPoints}</span></div>
                <div><span className="k">{T.testDate || 'Fecha'}</span><span className="v">{parsed.meta?.TestDate || '—'}</span></div>
              </div>
              <window.CurvePlot
                points={parsed.points}
                pmaxIdx={parsed.idxPmax}
                width={620} height={220}
                xLabel={T.disp || 'Desplazamiento (mm)'}
                yLabel="Carga (kN)"
              />
            </div>
          )}
        </div>
      </div>

      <div className="qu-card-actions">
        <button className="vt-btn" onClick={onSkip}>{T.skip || 'Saltar'}</button>
        <button className="vt-btn primary" onClick={onConfirm} disabled={!isOK}>
          ✓ {T.confirmNext || 'Confirmar y siguiente'}
        </button>
      </div>
    </div>
  );
}

window.QuickUploadTab = QuickUploadTab;
window.classifyTestFilename = window.classifyTestFilename;
