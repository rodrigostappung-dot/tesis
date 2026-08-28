// Parámetros de mezcla (variables de diseño) para Rodrigo — actualizados desde
// "infoactu.xlsx". Constantes por mezcla, usadas como variables de eje en Análisis
// y como columnas de características en la exportación a Excel.
//
//   BR  = reemplazo de ligante/cemento (fracción)
//   FD  = dosis total de fibra (fracción volumétrica) = SD + AD
//   SD  = dosis de fibra de acero (fracción volumétrica)
//   AD  = dosis de fibra amorfa (fracción volumétrica)
//   SL  = largo de fibra de acero (mm)
//   AL  = largo de fibra amorfa (mm)
//   T   = temperatura (°C)
//   TMF = tamaño máximo de fibra (mm) = max(SL, AL)
//   tempCat = categoría cualitativa de temperatura (frio/neutro/caliente)

window.MIX_PARAMS = (function () {
  // [tempCat, BR, FD, SD, AD, SL, AL, T]
  const rows = {
    1:  ['frio',     0.3,  0.005,  0.00375,  0.00125,  6,  5,  10],
    2:  ['caliente', 0,    0.005,  0.00375,  0.00125,  6,  5,  30],
    3:  ['caliente', 0.3,  0.005,  0.00125,  0.00375,  6,  5,  30],
    4:  ['frio',     0,    0.005,  0.00125,  0.00375,  6,  5,  10],
    5:  ['caliente', 0.3,  0.01,   0.0075,   0.0025,   6,  5,  30],
    6:  ['frio',     0,    0.01,   0.0075,   0.0025,   6,  5,  10],
    7:  ['frio',     0.3,  0.01,   0.0025,   0.0075,   6,  5,  10],
    8:  ['caliente', 0,    0.01,   0.0025,   0.0075,   6,  5,  30],
    9:  ['caliente', 0.3,  0.005,  0.00375,  0.00125,  20, 5,  30],
    10: ['frio',     0,    0.005,  0.00375,  0.00125,  20, 5,  10],
    11: ['frio',     0.3,  0.005,  0.00125,  0.00375,  20, 5,  10],
    12: ['caliente', 0,    0.005,  0.00125,  0.00375,  20, 5,  30],
    13: ['frio',     0.3,  0.01,   0.0075,   0.0025,   20, 5,  10],
    14: ['caliente', 0,    0.01,   0.0075,   0.0025,   20, 5,  30],
    15: ['caliente', 0.3,  0.01,   0.0025,   0.0075,   20, 5,  30],
    16: ['frio',     0,    0.01,   0.0025,   0.0075,   20, 5,  10],
    17: ['caliente', 0.3,  0.005,  0.00375,  0.00125,  6,  20, 30],
    18: ['frio',     0,    0.005,  0.00375,  0.00125,  6,  20, 10],
    19: ['frio',     0.3,  0.005,  0.00125,  0.00375,  6,  20, 10],
    20: ['caliente', 0,    0.005,  0.00125,  0.00375,  6,  20, 30],
    21: ['frio',     0.3,  0.01,   0.0075,   0.0025,   6,  20, 10],
    22: ['caliente', 0,    0.01,   0.0075,   0.0025,   6,  20, 30],
    23: ['caliente', 0.3,  0.01,   0.0025,   0.0075,   6,  20, 30],
    24: ['frio',     0,    0.01,   0.0025,   0.0075,   6,  20, 10],
    25: ['frio',     0.3,  0.005,  0.00375,  0.00125,  20, 20, 10],
    26: ['caliente', 0,    0.005,  0.00375,  0.00125,  20, 20, 30],
    27: ['caliente', 0.3,  0.005,  0.00125,  0.00375,  20, 20, 30],
    28: ['frio',     0,    0.005,  0.00125,  0.00375,  20, 20, 10],
    29: ['caliente', 0.3,  0.01,   0.0075,   0.0025,   20, 20, 30],
    30: ['frio',     0,    0.01,   0.0075,   0.0025,   20, 20, 10],
    31: ['frio',     0.3,  0.01,   0.0025,   0.0075,   20, 20, 10],
    32: ['caliente', 0,    0.01,   0.0025,   0.0075,   20, 20, 30],
    33: ['neutro',   0.3,  0.0075, 0.00375,  0.00375,  13, 15, 20],
    34: ['neutro',   0,    0.0075, 0.00375,  0.00375,  13, 15, 20],
    35: ['neutro',   0.15, 0.0075, 0.005625, 0.001875, 13, 15, 20],
    36: ['neutro',   0.15, 0.0075, 0.001875, 0.005625, 13, 15, 20],
    37: ['neutro',   0.15, 0.005,  0.0025,   0.0025,   13, 15, 20],
    38: ['neutro',   0.15, 0.01,   0.005,    0.005,    13, 15, 20],
    39: ['neutro',   0.15, 0.0075, 0.00375,  0.00375,  6,  15, 20],
    40: ['neutro',   0.15, 0.0075, 0.00375,  0.00375,  20, 15, 20],
    41: ['neutro',   0.15, 0.0075, 0.00375,  0.00375,  13, 5,  20],
    42: ['neutro',   0.15, 0.0075, 0.00375,  0.00375,  13, 20, 20],
    43: ['frio',     0.15, 0.0075, 0.00375,  0.00375,  13, 15, 10],
    44: ['caliente', 0.15, 0.0075, 0.00375,  0.00375,  13, 15, 30],
    45: ['neutro',   0.15, 0.0075, 0.00375,  0.00375,  13, 15, 20],
  };
  const out = {};
  Object.entries(rows).forEach(([mix, r]) => {
    const [tempCat, BR, FD, SD, AD, SL, AL, T] = r;
    out[mix] = { tempCat, BR, FD, SD, AD, SL, AL, T, TMF: Math.max(SL, AL) };
  });
  return out;
})();

window.getMixParam = function(mix, key) {
  const p = window.MIX_PARAMS && window.MIX_PARAMS[mix];
  if (!p) return null;
  const v = p[key];
  return typeof v === 'number' ? v : null;
};

window.MIX_PARAM_LABELS = {
  BR:  { label: 'Relación ligante (BR)', unit: '' },
  FD:  { label: 'Dosis total de fibra', unit: '(fracción vol.)' },
  SD:  { label: 'Dosis fibra de acero', unit: '(fracción vol.)' },
  AD:  { label: 'Dosis fibra amorfa', unit: '(fracción vol.)' },
  SL:  { label: 'Largo fibra de acero', unit: '(mm)' },
  AL:  { label: 'Largo fibra amorfa', unit: '(mm)' },
  T:   { label: 'Temperatura', unit: '(°C)' },
  TMF: { label: 'Tamaño máx. de fibra', unit: '(mm)' },
};
