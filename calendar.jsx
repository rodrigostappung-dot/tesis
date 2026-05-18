// ----- CALENDARIO DE MEZCLAS -----
// Auto-deduce fechas de medición a partir de la fecha de fundido + edad (0/1/7/28d).
// Vista tabla: semana × (Lun-Vie) × (Mañana/Tarde)

// Italia: feriados nacionales 2026
const HOLIDAYS_2026 = {
  '2026-01-01': "Capodanno",
  '2026-01-06': "Epifania",
  '2026-04-05': "Pasqua",
  '2026-04-06': "Lunedì dell'Angelo",
  '2026-04-25': "Festa della Liberazione",
  '2026-05-01': "Festa del Lavoro",
  '2026-06-02': "Festa della Repubblica",
  '2026-08-15': "Ferragosto",
  '2026-11-01': "Ognissanti",
  '2026-12-08': "Immacolata",
  '2026-12-25': "Natale",
  '2026-12-26': "Santo Stefano",
};

function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseYMD(s) {
  // Local-date constructor avoids UTC-shift bugs
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(d, n) {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

// Monday of the week containing `d`
function mondayOf(d) {
  const c = new Date(d);
  const dow = c.getDay(); // 0=Sun, 1=Mon...
  const diff = dow === 0 ? -6 : 1 - dow;
  c.setDate(c.getDate() + diff);
  return c;
}

// Build event index: date -> [{type, mix, moment, age, test}]
function buildCalendarEvents(state, retractionAges = [0, 1, 7, 28]) {
  const events = {}; // 'YYYY-MM-DD' -> [...]
  const push = (date, ev) => {
    if (!events[date]) events[date] = [];
    events[date].push(ev);
  };

  for (const mixStr in state.mixMeta) {
    const meta = state.mixMeta[mixStr];
    if (!meta || !meta.castDate) continue;
    const mix = parseInt(mixStr);
    const cast = parseYMD(meta.castDate);
    const moment = meta.castMoment || 'AM';

    // Cast event (verde)
    push(meta.castDate, { type: 'cast', mix, moment });

    // Deduced retraction measurements (azul si hay valores cargados)
    const retr = state.results[mixStr]?.retraction || [];
    for (const age of retractionAges) {
      const day = ymd(addDays(cast, age));
      // ¿Hay datos en alguna probeta para esa edad?
      let hasData = false;
      for (const spec of retr) {
        const v = spec.values?.[age];
        const arr = Array.isArray(v) ? v : [v];
        if (arr.some(x => x !== '' && x != null && !isNaN(parseFloat(x)))) {
          hasData = true;
          break;
        }
      }
      // Saltar el día 0 si coincide con el fundido (mismo día)
      if (age === 0 && day === meta.castDate) continue;
      push(day, { type: 'shrink', mix, age, hasData, moment: 'AM' });
    }
  }

  return events;
}

function CalendarModal({ state, onClose, onSelectMix, T, lang }) {
  // Determinar rango de semanas: desde la primera fecha de fundido hasta +60 días
  const allCastDates = Object.values(state.mixMeta || {})
    .map(m => m?.castDate)
    .filter(Boolean)
    .sort();
  const firstDate = allCastDates[0] ? parseYMD(allCastDates[0]) : new Date(2026, 3, 27);
  // Mostrar 1 semana antes y hasta 28 días después de la última
  const startMonday = mondayOf(addDays(firstDate, -7));
  const lastCast = allCastDates[allCastDates.length - 1] ? parseYMD(allCastDates[allCastDates.length - 1]) : firstDate;
  const endDate = addDays(lastCast, 35); // hasta cubrir 28d
  const numWeeks = Math.max(8, Math.ceil((endDate - startMonday) / (7 * 86400000)));

  const events = React.useMemo(() => buildCalendarEvents(state), [state]);

  const weeks = [];
  for (let w = 0; w < numWeeks; w++) {
    const weekStart = addDays(startMonday, w * 7);
    weeks.push(weekStart);
  }

  const monthLabel = (d) => {
    const months = {
      es: ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'],
      en: ['January','February','March','April','May','June','July','August','September','October','November','December'],
      it: ['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'],
    }[lang || 'es'];
    return `${d.getDate()} ${months[d.getMonth()]}`;
  };

  const dayLabels = {
    es: ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'],
    en: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    it: ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì'],
  }[lang || 'es'];

  const momentLabels = {
    es: { AM: 'mañana', PM: 'tarde' },
    en: { AM: 'morning', PM: 'afternoon' },
    it: { AM: 'mattina', PM: 'pomeriggio' },
  }[lang || 'es'];

  const renderCell = (date, moment) => {
    const dateStr = ymd(date);
    const holiday = HOLIDAYS_2026[dateStr];
    const dayEvents = (events[dateStr] || []).filter(e => (e.moment || 'AM') === moment);

    // Cast events: verde
    const casts = dayEvents.filter(e => e.type === 'cast');
    // Shrinkage measurements: azul si hasData, gris si pendiente
    const shrinks = dayEvents.filter(e => e.type === 'shrink');
    const shrinksDone = shrinks.filter(e => e.hasData);
    const shrinksPending = shrinks.filter(e => !e.hasData);

    // Cell color priority: holiday(red) > cast(green) > shrinks-done(blue) > pending(light blue) > empty
    let cls = 'cal-cell';
    if (holiday) cls += ' holiday';
    else if (casts.length > 0) cls += ' cast';
    else if (shrinksDone.length > 0) cls += ' done';
    else if (shrinksPending.length > 0) cls += ' pending';

    const labels = [
      ...casts.map(c => `M${c.mix}`),
      ...shrinksDone.map(s => `M${s.mix}·${s.age}d`),
      ...shrinksPending.map(s => `M${s.mix}·${s.age}d`),
    ];

    const handleClick = () => {
      // Si hay un solo mix asociado, abrirlo. Si hay varios, abrir el primero.
      const mixes = [...casts, ...shrinks].map(e => e.mix);
      if (mixes.length > 0) onSelectMix(mixes[0]);
    };

    return (
      <td className={cls} onClick={handleClick} title={holiday || labels.join(', ')}>
        {holiday && <div className="cal-holiday-tag">{holiday}</div>}
        {labels.length > 0 && (
          <div className="cal-labels">
            {labels.map((l, i) => <span key={i} className="cal-label">{l}</span>)}
          </div>
        )}
      </td>
    );
  };

  return (
    <div className="cal-modal-backdrop" onClick={onClose}>
      <div className="cal-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cal-modal-header">
          <h2>{T.calendar2026 || 'Calendario 2026'}</h2>
          <div className="cal-legend">
            <span className="lg-dot cast" /> {T.legendCast || 'Fundido'}
            <span className="lg-dot done" /> {T.legendDone || 'Medición'}
            <span className="lg-dot pending" /> {T.legendPending || 'Pendiente'}
            <span className="lg-dot holiday" /> {T.legendHoliday || 'Feriado'}
          </div>
          <button className="cal-close" onClick={onClose}>✕</button>
        </div>
        <div className="cal-table-wrap">
          <table className="cal-table">
            <thead>
              <tr>
                <th rowSpan="2" className="wk-h">{T.week || 'Semana'}</th>
                <th rowSpan="2" className="mom-h">{T.moment || 'Momento'}</th>
                {dayLabels.map(d => <th key={d} colSpan="1">{d}</th>)}
              </tr>
            </thead>
            <tbody>
              {weeks.map((wkStart, wi) => {
                return ['AM', 'PM'].map(moment => (
                  <tr key={wi + '-' + moment}>
                    {moment === 'AM' && (
                      <td rowSpan="2" className="wk-cell">{monthLabel(wkStart)}</td>
                    )}
                    <td className="mom-cell">{momentLabels[moment]}</td>
                    {[0, 1, 2, 3, 4].map(di => {
                      const date = addDays(wkStart, di);
                      return renderCell(date, moment);
                    })}
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

window.CalendarModal = CalendarModal;
