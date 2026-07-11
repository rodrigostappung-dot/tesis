// Parámetros de mezcla (variables de diseño) para Rodrigo — extraídos de
// "caracteriticas.xlsx". Estos valores son constantes por mezcla (no dependen
// de ensayo/probeta/edad) y se usan como variables de eje en la pestaña Análisis.
//
// Columnas:
//   BR  = relación de ligante (fracción)
//   FD  = dosis total de fibra (fracción volumétrica) = SD + AD
//   SD  = dosis de fibra de acero (fracción volumétrica)
//   AD  = dosis de fibra amorfa (fracción volumétrica)
//   SL  = largo de fibra de acero (mm)
//   AL  = largo de fibra amorfa (mm)
//   T   = temperatura (°C)
//   TMF = tamaño máximo de fibra (mm) = max(SL, AL)
//   tempCat = categoría cualitativa de temperatura (frio/neutro/caliente), informativa

window.MIX_PARAMS = {
  1:  { tempCat:'frio',     BR:0.3,  FD:0.005,  SD:0.00375, AD:0.00125, SL:6,  AL:5,  T:10, TMF:6  },
  2:  { tempCat:'caliente', BR:0,    FD:0.005,  SD:0.00375, AD:0.00125, SL:6,  AL:5,  T:30, TMF:6  },
  3:  { tempCat:'caliente', BR:0.3,  FD:0.005,  SD:0.00125, AD:0.00375, SL:6,  AL:5,  T:30, TMF:6  },
  4:  { tempCat:'frio',     BR:0,    FD:0.005,  SD:0.00125, AD:0.00375, SL:6,  AL:5,  T:10, TMF:6  },
  5:  { tempCat:'caliente', BR:0.3,  FD:0.0075, SD:0.005625,AD:0.001875,SL:6,  AL:5,  T:30, TMF:6  },
  6:  { tempCat:'frio',     BR:0,    FD:0.0075, SD:0.005625,AD:0.001875,SL:6,  AL:5,  T:10, TMF:6  },
  7:  { tempCat:'frio',     BR:0.3,  FD:0.0075, SD:0.001875,AD:0.005625,SL:6,  AL:5,  T:10, TMF:6  },
  8:  { tempCat:'caliente', BR:0,    FD:0.0075, SD:0.001875,AD:0.005625,SL:6,  AL:5,  T:30, TMF:6  },
  9:  { tempCat:'caliente', BR:0.3,  FD:0.005,  SD:0.00375, AD:0.00125, SL:20, AL:5,  T:30, TMF:20 },
  10: { tempCat:'frio',     BR:0,    FD:0.005,  SD:0.00375, AD:0.00125, SL:20, AL:5,  T:10, TMF:20 },
  11: { tempCat:'frio',     BR:0.3,  FD:0.005,  SD:0.00125, AD:0.00375, SL:20, AL:5,  T:10, TMF:20 },
  12: { tempCat:'caliente', BR:0,    FD:0.005,  SD:0.00125, AD:0.00375, SL:20, AL:5,  T:30, TMF:20 },
  13: { tempCat:'frio',     BR:0.3,  FD:0.0075, SD:0.005625,AD:0.001875,SL:20, AL:5,  T:10, TMF:20 },
  14: { tempCat:'caliente', BR:0,    FD:0.0075, SD:0.005625,AD:0.001875,SL:20, AL:5,  T:30, TMF:20 },
  15: { tempCat:'caliente', BR:0.3,  FD:0.0075, SD:0.001875,AD:0.005625,SL:20, AL:5,  T:30, TMF:20 },
  16: { tempCat:'frio',     BR:0,    FD:0.0075, SD:0.001875,AD:0.005625,SL:20, AL:5,  T:10, TMF:20 },
  17: { tempCat:'caliente', BR:0.3,  FD:0.005,  SD:0.00375, AD:0.00125, SL:6,  AL:20, T:30, TMF:20 },
  18: { tempCat:'frio',     BR:0,    FD:0.005,  SD:0.00375, AD:0.00125, SL:6,  AL:20, T:10, TMF:20 },
  19: { tempCat:'frio',     BR:0.3,  FD:0.005,  SD:0.00125, AD:0.00375, SL:6,  AL:20, T:10, TMF:20 },
  20: { tempCat:'caliente', BR:0,    FD:0.005,  SD:0.00125, AD:0.00375, SL:6,  AL:20, T:30, TMF:20 },
  21: { tempCat:'frio',     BR:0.3,  FD:0.0075, SD:0.005625,AD:0.001875,SL:6,  AL:20, T:10, TMF:20 },
  22: { tempCat:'caliente', BR:0,    FD:0.0075, SD:0.005625,AD:0.001875,SL:6,  AL:20, T:30, TMF:20 },
  23: { tempCat:'caliente', BR:0.3,  FD:0.0075, SD:0.001875,AD:0.005625,SL:6,  AL:20, T:30, TMF:20 },
  24: { tempCat:'frio',     BR:0,    FD:0.0075, SD:0.001875,AD:0.005625,SL:6,  AL:20, T:10, TMF:20 },
  25: { tempCat:'frio',     BR:0.3,  FD:0.005,  SD:0.00375, AD:0.00125, SL:20, AL:20, T:10, TMF:20 },
  26: { tempCat:'caliente', BR:0,    FD:0.005,  SD:0.00375, AD:0.00125, SL:20, AL:20, T:30, TMF:20 },
  27: { tempCat:'caliente', BR:0.3,  FD:0.005,  SD:0.00125, AD:0.00375, SL:20, AL:20, T:30, TMF:20 },
  28: { tempCat:'frio',     BR:0,    FD:0.005,  SD:0.00125, AD:0.00375, SL:20, AL:20, T:10, TMF:20 },
  29: { tempCat:'caliente', BR:0.3,  FD:0.0075, SD:0.005625,AD:0.001875,SL:20, AL:20, T:30, TMF:20 },
  30: { tempCat:'frio',     BR:0,    FD:0.0075, SD:0.005625,AD:0.001875,SL:20, AL:20, T:10, TMF:20 },
  31: { tempCat:'frio',     BR:0.3,  FD:0.0075, SD:0.001875,AD:0.005625,SL:20, AL:20, T:10, TMF:20 },
  32: { tempCat:'caliente', BR:0,    FD:0.0075, SD:0.001875,AD:0.005625,SL:20, AL:20, T:30, TMF:20 },
  33: { tempCat:'neutro',   BR:0.3,  FD:0.01,   SD:0.005,   AD:0.005,   SL:13, AL:15, T:20, TMF:15 },
  34: { tempCat:'neutro',   BR:0,    FD:0.01,   SD:0.005,   AD:0.005,   SL:13, AL:15, T:20, TMF:15 },
  35: { tempCat:'neutro',   BR:0.15, FD:0.01,   SD:0.0075,  AD:0.0025,  SL:13, AL:15, T:20, TMF:15 },
  36: { tempCat:'neutro',   BR:0.15, FD:0.01,   SD:0.0025,  AD:0.0075,  SL:13, AL:15, T:20, TMF:15 },
  37: { tempCat:'neutro',   BR:0.15, FD:0.005,  SD:0.0025,  AD:0.0025,  SL:13, AL:15, T:20, TMF:15 },
  38: { tempCat:'neutro',   BR:0.15, FD:0.0075, SD:0.00375, AD:0.00375, SL:13, AL:15, T:20, TMF:15 },
  39: { tempCat:'neutro',   BR:0.15, FD:0.01,   SD:0.005,   AD:0.005,   SL:6,  AL:15, T:20, TMF:15 },
  40: { tempCat:'neutro',   BR:0.15, FD:0.01,   SD:0.005,   AD:0.005,   SL:20, AL:15, T:20, TMF:20 },
  41: { tempCat:'neutro',   BR:0.15, FD:0.01,   SD:0.005,   AD:0.005,   SL:13, AL:5,  T:20, TMF:13 },
  42: { tempCat:'neutro',   BR:0.15, FD:0.01,   SD:0.005,   AD:0.005,   SL:13, AL:20, T:20, TMF:20 },
  43: { tempCat:'frio',     BR:0.15, FD:0.01,   SD:0.005,   AD:0.005,   SL:13, AL:15, T:10, TMF:15 },
  44: { tempCat:'caliente', BR:0.15, FD:0.01,   SD:0.005,   AD:0.005,   SL:13, AL:15, T:30, TMF:15 },
  45: { tempCat:'neutro',   BR:0.15, FD:0.01,   SD:0.005,   AD:0.005,   SL:13, AL:15, T:20, TMF:15 },
};

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
