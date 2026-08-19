/* parts.js — каталог деталей электронного конструктора.
 *
 * Здесь три вещи и ничего больше:
 *   * условные графические обозначения (УГО) по ГОСТ 2.721/2.723/2.727/2.728/
 *     2.729/2.730/2.732 — рисуются своей разметкой SVG, без картинок;
 *   * список настраиваемых параметров детали (что показывать в панели свойств);
 *   * разворачивание детали в примитивы расчётного ядра solver.js.
 *
 * Геометрия. Деталь ставится между узлами сетки. Двухполюсник занимает одно
 * ребро: вывод «a» в начале, вывод «b» в конце; рисунок строится в локальных
 * координатах от (0,0) до (len,0), поворот делает конструктор. Многополюсник
 * (трансформатор, ваттметр, трёхфазные источник и нагрузка) занимает блок
 * nw×nh узлов, выводы перечислены в terms как смещения в узлах.
 *
 * Единицы: сопротивление в омах, ёмкость в фарадах, индуктивность в генри,
 * напряжение в вольтах (у переменного — действующее), частота в герцах.
 */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ElecParts = api;
}(typeof self !== 'undefined' ? self : this, function () {

  /* ── форматирование чисел с приставками СИ ── */
  const PREF = [
    [1e9, 'Г'], [1e6, 'М'], [1e3, 'к'], [1, ''], [1e-3, 'м'],
    [1e-6, 'мк'], [1e-9, 'н'], [1e-12, 'п'],
  ];
  function si(x, unit, digits) {
    if (!isFinite(x)) return '—';
    if (x === 0) return '0 ' + (unit || '');
    const a = Math.abs(x);
    let p = PREF[PREF.length - 1];
    for (let i = 0; i < PREF.length; i++) if (a >= PREF[i][0] * 0.999) { p = PREF[i]; break; }
    // от 0,1 до 1 приставку «милли» не берём: «0,5 Ом» читается лучше, чем
    // «500 мОм», и совпадает с тем, как пишут в учебнике
    if (p[0] === 1e-3 && a >= 0.1) p = [1, ''];
    const v = x / p[0];
    const d = digits === undefined ? (Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2) : digits;
    let str = v.toFixed(d);
    // хвостовые нули убираем только в дробной части: иначе «380» превращается
    // в «38», а «100 Ом» — в «1 Ом»
    if (str.indexOf('.') >= 0) str = str.replace(/0+$/, '').replace(/\.$/, '');
    return str.replace('.', ',') + ' ' + p[1] + (unit || '');
  }
  /* Число «как в отчёте»: запятая, разумное число знаков. */
  function fm(x, d) {
    if (!isFinite(x)) return '—';
    return x.toFixed(d === undefined ? 2 : d).replace('.', ',');
  }

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  /* ── кирпичики УГО ── */
  const lead = (x1, x2) => `<path class="wire" d="M${x1},0 H${x2}"/>`;
  const box = (cx, w, h) => `<rect class="dev" x="${cx - w / 2}" y="${-h / 2}" width="${w}" height="${h}"/>`;
  const circ = (cx, r) => `<circle class="dev" cx="${cx}" cy="0" r="${r}"/>`;
  const txt = (x, y, s, cls) => `<text class="lbl ${cls || ''}" x="${x}" y="${y}" text-anchor="middle">${esc(s)}</text>`;
  /* Надпись внутри символа двухполюсника: контр-поворот, чтобы буква стояла
     прямо и на вертикально поставленной детали. */
  const ctxt = (cx, s, size, rot) =>
    `<g transform="translate(${cx},0) rotate(${-(rot || 0)})">`
    + `<text class="lbl b" x="0" y="${(size * 0.35).toFixed(1)}" text-anchor="middle" font-size="${size}">${esc(s)}</text></g>`;

  /* ══════════════ каталог ══════════════ */
  const P = {};

  const def = (key, o) => { o.key = key; P[key] = o; return o; };

  /* ─── провод и земля ─── */
  def('WIRE', {
    name: 'Провод', group: 'база', tag: '', gost: '',
    props: [],
    draw: (len) => `<path class="wire" d="M0,0 H${len}"/>`,
    expand: (el, n) => [{ id: el.id, type: 'W', nodes: [n[0], n[1]] }],
  });

  def('GND', {
    name: 'Корпус (общий провод)', group: 'база', tag: '', gost: 'ГОСТ 2.721',
    single: true, props: [],
    hint: 'Точка нулевого потенциала. На судне её роль играет корпус: приборы и защиты отсчитывают напряжение именно от него.',
    draw: () => `<path class="wire" d="M0,0 V10"/>`
      + `<path class="dev" fill="none" d="M-11,10 H11 M-7,15 H7 M-3,20 H3"/>`,
    expand: () => [],
    ground: true,
  });

  /* ─── источники ─── */
  def('VDC', {
    source: true,
    name: 'Источник постоянного напряжения', group: 'источники', tag: 'G', gost: 'ГОСТ 2.721',
    props: [
      { k: 'E', label: 'ЭДС', unit: 'В', def: 12, min: 0, max: 500, step: 0.5 },
      { k: 'r', label: 'внутреннее сопротивление', unit: 'Ом', def: 0.01, min: 0, max: 100, step: 0.01 },
      { k: 'imax', label: 'предел тока (предупреждение о КЗ)', unit: 'А', def: 20, min: 0.1, max: 1000, step: 1 },
    ],
    hint: 'Идеализированный источник: держит заданное напряжение, пока ток не выходит за предел.',
    draw: (len, e, v, rot) => {
      const c = len / 2;
      return lead(0, c - 6) + lead(c + 6, len)
        + `<path class="dev" d="M${c - 6},-13 V13"/>`
        + `<path class="dev" d="M${c + 6},-7 V7"/>`
        + `<g transform="translate(${c - 14},0) rotate(${-(rot || 0)})">`
        + `<text class="lbl b" x="0" y="-16" text-anchor="middle">+</text></g>`;
    },
    expand: (el, n, v) => [{ id: el.id, type: 'V', nodes: [n[0], n[1]], dc: v.E, r: Math.max(v.r, 0.001),
                             imax: v.imax, label: el.label }],
    meas: (el, r) => (r.elem[el.id] ? [['U', r.elem[el.id].u, 'В'], ['I', -r.elem[el.id].i, 'А'],
                                       ['P отдаёт', -r.elem[el.id].p, 'Вт']] : []),
  });

  def('BAT', {
    source: true,
    name: 'Аккумулятор', group: 'источники', tag: 'GB', gost: 'ГОСТ 2.721',
    props: [
      { k: 'E', label: 'ЭДС', unit: 'В', def: 24, min: 0, max: 500, step: 0.5 },
      { k: 'r', label: 'внутреннее сопротивление', unit: 'Ом', def: 0.4, min: 0, max: 100, step: 0.01 },
      { k: 'imax', label: 'предел тока', unit: 'А', def: 200, min: 0.1, max: 5000, step: 10 },
    ],
    hint: 'Батарея с заметным внутренним сопротивлением: под нагрузкой напряжение на зажимах проседает.',
    draw: (len, e, v, rot) => {
      const c = len / 2;
      return lead(0, c - 13) + lead(c + 13, len)
        + `<path class="dev" d="M${c - 13},-13 V13 M${c - 5},-7 V7 M${c + 5},-13 V13 M${c + 13},-7 V7"/>`
        + `<g transform="translate(${c - 20},0) rotate(${-(rot || 0)})">`
        + `<text class="lbl b" x="0" y="-14" text-anchor="middle">+</text></g>`;
    },
    expand: (el, n, v) => [{ id: el.id, type: 'V', nodes: [n[0], n[1]], dc: v.E, r: Math.max(v.r, 0.001),
                             imax: v.imax, label: el.label }],
    meas: (el, r) => (r.elem[el.id] ? [['U на зажимах', r.elem[el.id].u, 'В'], ['I', -r.elem[el.id].i, 'А']] : []),
  });

  def('VAC', {
    source: true,
    name: 'Источник переменного напряжения', group: 'источники', tag: 'G', gost: 'ГОСТ 2.721',
    props: [
      { k: 'U', label: 'напряжение', unit: 'В', def: 36, min: 0, max: 400, step: 1 },
      { k: 'kind', label: 'значение задано', type: 'select', def: 'rms',
        options: [['rms', 'действующее'], ['amp', 'амплитудное']] },
      { k: 'f', label: 'частота', unit: 'Гц', def: 50, min: 0.1, max: 20000, step: 1 },
      { k: 'ph', label: 'начальная фаза', unit: '°', def: 0, min: -180, max: 180, step: 5 },
      { k: 'r', label: 'внутреннее сопротивление', unit: 'Ом', def: 0.01, min: 0, max: 100, step: 0.01 },
      { k: 'imax', label: 'предел тока', unit: 'А', def: 20, min: 0.1, max: 1000, step: 1 },
    ],
    hint: 'Синусоида u(t) = Um·sin(ωt + ψ). Приборы показывают действующее значение U = Um/√2.',
    draw: (len) => {
      const c = len / 2;
      return lead(0, c - 15) + lead(c + 15, len) + circ(c, 15)
        + `<path class="dev" fill="none" d="M${c - 8},0 a4,4 0 0 1 8,0 a4,4 0 0 0 8,0"/>`;
    },
    expand: (el, n, v) => [{ id: el.id, type: 'V', nodes: [n[0], n[1]],
                             mag: v.kind === 'amp' ? v.U / Math.SQRT2 : v.U,
                             ph: v.ph, f: v.f, r: Math.max(v.r, 0.001), imax: v.imax, label: el.label }],
    meas: (el, r) => (r.elem[el.id] ? [['U', r.elem[el.id].U !== undefined ? r.elem[el.id].U : r.elem[el.id].u, 'В'],
                                       ['I', r.elem[el.id].I !== undefined ? r.elem[el.id].I : -r.elem[el.id].i, 'А']] : []),
  });

  /* ─── пассивные ─── */
  def('R', {
    name: 'Резистор', group: 'пассивные', tag: 'R', gost: 'ГОСТ 2.728',
    props: [{ k: 'R', label: 'сопротивление', unit: 'Ом', def: 100, min: 0.01, max: 1e7, step: 1 }],
    draw: (len) => lead(0, len / 2 - 17) + lead(len / 2 + 17, len) + box(len / 2, 34, 14),
    expand: (el, n, v) => [{ id: el.id, type: 'R', nodes: [n[0], n[1]], R: Math.max(v.R, 1e-3) }],
    val: (v) => si(v.R, 'Ом'),
  });

  def('RHEO', {
    name: 'Реостат (потенциометр)', group: 'пассивные', tag: 'RP', gost: 'ГОСТ 2.728',
    props: [
      { k: 'R', label: 'полное сопротивление', unit: 'Ом', def: 1000, min: 1, max: 1e6, step: 10 },
      { k: 'k', label: 'положение движка', unit: '', def: 0.5, min: 0, max: 1, step: 0.01, slider: true },
    ],
    hint: 'Включён реостатом: в цепь входит часть обмотки от начала до движка, R = k·Rполн. Делитель напряжения собирается из двух реостатов или резисторов.',
    draw: (len, e, v) => lead(0, len / 2 - 17) + lead(len / 2 + 17, len) + box(len / 2, 34, 14)
      + `<path class="dev" fill="none" d="M${len / 2 - 12},14 L${len / 2 + 12},-12"/>`
      + `<path class="dev" d="M${len / 2 + 6},-12 L${len / 2 + 12},-12 L${len / 2 + 12},-6"/>`,
    expand: (el, n, v) => {
      const R = Math.max(v.R, 1);
      const k = Math.min(Math.max(v.k, 0), 1);
      return [{ id: el.id, type: 'R', nodes: [n[0], n[1]], R: Math.max(R * k, 0.05) }];
    },
    val: (v) => si(Math.max(v.R * v.k, 0.05), 'Ом'),
  });

  def('LAMP', {
    name: 'Лампа накаливания', group: 'пассивные', tag: 'EL', gost: 'ГОСТ 2.732',
    props: [
      { k: 'Unom', label: 'номинальное напряжение', unit: 'В', def: 12, min: 1, max: 400, step: 1 },
      { k: 'Pnom', label: 'номинальная мощность', unit: 'Вт', def: 5, min: 0.1, max: 5000, step: 0.5 },
    ],
    hint: 'Сопротивление нити растёт с нагревом (модель R ∝ U^0,45, холодная нить ≈ в 13 раз меньше горячей). Свыше 1,7 номинальной мощности нить перегорает.',
    draw: (len) => {
      const c = len / 2, r = 15;
      const d = r / Math.SQRT2;
      return lead(0, c - r) + lead(c + r, len) + circ(c, r)
        + `<path class="dev" fill="none" d="M${c - d},${-d} L${c + d},${d} M${c - d},${d} L${c + d},${-d}"/>`;
    },
    expand: (el, n, v) => [{ id: el.id, type: 'LAMP', nodes: [n[0], n[1]], Unom: v.Unom, Pnom: v.Pnom,
                             label: el.label }],
    val: (v) => fm(v.Unom, 0) + ' В · ' + fm(v.Pnom, 1) + ' Вт',
    glow: true,
  });

  def('C', {
    name: 'Конденсатор', group: 'пассивные', tag: 'C', gost: 'ГОСТ 2.728',
    props: [
      { k: 'C', label: 'ёмкость', unit: 'Ф', def: 100e-6, min: 1e-12, max: 1, step: 1e-6, si: true },
      { k: 'v0', label: 'начальное напряжение', unit: 'В', def: 0, min: -400, max: 400, step: 1 },
    ],
    draw: (len) => {
      const c = len / 2;
      return lead(0, c - 5) + lead(c + 5, len)
        + `<path class="dev" d="M${c - 5},-14 V14 M${c + 5},-14 V14"/>`;
    },
    expand: (el, n, v) => [{ id: el.id, type: 'C', nodes: [n[0], n[1]], C: Math.max(v.C, 1e-12), v0: v.v0 }],
    val: (v) => si(v.C, 'Ф'),
  });

  def('L', {
    name: 'Катушка индуктивности', group: 'пассивные', tag: 'L', gost: 'ГОСТ 2.723',
    props: [
      { k: 'L', label: 'индуктивность', unit: 'Гн', def: 0.1, min: 1e-6, max: 100, step: 0.01, si: true },
      { k: 'r', label: 'активное сопротивление обмотки', unit: 'Ом', def: 1, min: 0, max: 1e5, step: 0.1 },
    ],
    draw: (len) => {
      const c = len / 2, w = 9;
      let d = `M${c - 2 * w},0`;
      for (let i = 0; i < 4; i++) d += ` a${w / 2},${w / 2} 0 0 1 ${w},0`;
      return lead(0, c - 2 * w) + lead(c + 2 * w, len)
        + `<path class="dev" fill="none" d="${d}"/>`;
    },
    expand: (el, n, v) => [{ id: el.id, type: 'L', nodes: [n[0], n[1]], L: Math.max(v.L, 1e-9), r: v.r }],
    val: (v) => si(v.L, 'Гн'),
  });

  /* ─── полупроводники ─── */
  def('D', {
    name: 'Диод', group: 'полупроводники', tag: 'VD', gost: 'ГОСТ 2.730',
    props: [{ k: 'Uf', label: 'прямое падение при 0,1 А', unit: 'В', def: 0.7, min: 0.2, max: 3, step: 0.05 }],
    hint: 'Пропускает ток в направлении треугольника. Модель Шокли, прямое падение подобрано под указанное.',
    draw: (len) => {
      const c = len / 2;
      return lead(0, c - 9) + lead(c + 9, len)
        + `<path class="dev" d="M${c - 9},-11 L${c + 9},0 L${c - 9},11 Z"/>`
        + `<path class="dev" d="M${c + 9},-11 V11"/>`;
    },
    expand: (el, n, v) => {
      const Is = 0.1 / Math.exp(v.Uf / 0.025852);
      return [{ id: el.id, type: 'D', nodes: [n[0], n[1]], Is, N: 1, Rs: 0.05 }];
    },
  });

  def('LED', {
    name: 'Светодиод', group: 'полупроводники', tag: 'HL', gost: 'ГОСТ 2.730',
    props: [
      { k: 'Uf', label: 'прямое падение', unit: 'В', def: 2.0, min: 1.4, max: 3.6, step: 0.1 },
      { k: 'Inom', label: 'номинальный ток', unit: 'А', def: 0.02, min: 0.001, max: 1, step: 0.005 },
    ],
    hint: 'Светится при прямом токе; последовательный резистор обязателен, иначе ток ничем не ограничен.',
    draw: (len) => {
      const c = len / 2;
      return lead(0, c - 9) + lead(c + 9, len)
        + `<path class="dev" d="M${c - 9},-11 L${c + 9},0 L${c - 9},11 Z"/>`
        + `<path class="dev" d="M${c + 9},-11 V11"/>`
        + `<path class="dev" fill="none" d="M${c - 2},-15 l7,-7 M${c + 4},-15 l7,-7"/>`
        + `<path class="dev" d="M${c + 4},-22 l4,0 l0,4 z M${c + 10},-22 l4,0 l0,4 z"/>`;
    },
    expand: (el, n, v) => {
      const N = 2;
      const Is = v.Inom / Math.exp(v.Uf / (N * 0.025852));
      return [{ id: el.id, type: 'D', nodes: [n[0], n[1]], Is, N, Rs: 2 }];
    },
    glow: true,
  });

  /* ─── коммутация и защита ─── */
  def('SW', {
    name: 'Выключатель', group: 'коммутация', tag: 'SA', gost: 'ГОСТ 2.755',
    props: [{ k: 'on', label: 'замкнут', type: 'bool', def: false }],
    draw: (len, e, v) => {
      const c = len / 2;
      return lead(0, c - 14) + lead(c + 14, len)
        + `<circle class="node" cx="${c - 14}" cy="0" r="2.6"/><circle class="node" cx="${c + 14}" cy="0" r="2.6"/>`
        + (v.on ? `<path class="dev" fill="none" d="M${c - 14},0 H${c + 14}"/>`
                : `<path class="dev" fill="none" d="M${c - 14},0 L${c + 12},-13"/>`);
    },
    expand: (el, n, v) => [{ id: el.id, type: 'SW', nodes: [n[0], n[1]], closed: !!v.on }],
    toggle: 'on',
  });

  def('BTN', {
    name: 'Кнопка', group: 'коммутация', tag: 'SB', gost: 'ГОСТ 2.755',
    props: [{ k: 'on', label: 'нажата', type: 'bool', def: false }],
    hint: 'Замыкает цепь, пока нажата. Щёлкните по кнопке на поле, чтобы нажать и отпустить.',
    draw: (len, e, v) => {
      const c = len / 2;
      return lead(0, c - 14) + lead(c + 14, len)
        + `<circle class="node" cx="${c - 14}" cy="0" r="2.6"/><circle class="node" cx="${c + 14}" cy="0" r="2.6"/>`
        + (v.on ? `<path class="dev" fill="none" d="M${c - 14},0 H${c + 14}"/>`
                : `<path class="dev" fill="none" d="M${c - 14},-9 H${c + 14}"/>`)
        + `<path class="dev" fill="none" d="M${c},${v.on ? -9 : -9} V-17 M${c - 8},-17 H${c + 8}"/>`;
    },
    expand: (el, n, v) => [{ id: el.id, type: 'SW', nodes: [n[0], n[1]], closed: !!v.on }],
    toggle: 'on',
  });

  def('FU', {
    name: 'Предохранитель', group: 'коммутация', tag: 'FU', gost: 'ГОСТ 2.727',
    props: [{ k: 'inom', label: 'номинальный ток', unit: 'А', def: 2, min: 0.05, max: 1000, step: 0.5 }],
    hint: 'Перегорает, когда ток превышает номинал: дальше цепь разомкнута, пока предохранитель не заменят.',
    draw: (len) => {
      const c = len / 2;
      return lead(0, c - 17) + lead(c + 17, len) + box(c, 34, 13)
        + `<path class="dev" d="M${c - 17},0 H${c + 17}"/>`;
    },
    expand: (el, n, v) => [{ id: el.id, type: 'V', nodes: [n[0], n[1]], dc: 0, r: 0,
                             role: 'fuse', inom: v.inom, label: el.label }],
    val: (v) => fm(v.inom, 1) + ' А',
  });

  /* ─── приборы ─── */
  const meter = (key, letter, name, tag, unitOf) => def(key, {
    name, group: 'приборы', tag, gost: 'ГОСТ 2.729', meter: true,
    props: key === 'VM'
      ? [{ k: 'Rin', label: 'внутреннее сопротивление', unit: 'Ом', def: 1e6, min: 1e3, max: 1e9, step: 1e4 }]
      : [{ k: 'ilim', label: 'предел измерения', unit: 'А', def: 10, min: 0.001, max: 1000, step: 1 }],
    draw: (len, e, v, rot) => {
      const c = len / 2, r = 15;
      return lead(0, c - r) + lead(c + r, len) + circ(c, r) + ctxt(c, letter, 15, rot);
    },
    expand: (el, n, v) => (key === 'VM'
      ? [{ id: el.id, type: 'R', nodes: [n[0], n[1]], R: Math.max(v.Rin, 1000) }]
      : [{ id: el.id, type: 'V', nodes: [n[0], n[1]], dc: 0, r: 0, role: 'meter', label: el.label }]),
    unitOf,
  });
  meter('AM', 'A', 'Амперметр', 'PA', 'А');
  meter('VM', 'V', 'Вольтметр', 'PV', 'В');

  def('WM', {
    name: 'Ваттметр', group: 'приборы', tag: 'PW', gost: 'ГОСТ 2.729', meter: true,
    block: { nw: 2, nh: 2, terms: [[0, 0], [1, 0], [0, 1], [1, 1]] },
    props: [{ k: 'Rin', label: 'сопротивление обмотки напряжения', unit: 'Ом', def: 1e6, min: 1e3, max: 1e9, step: 1e4 }],
    hint: 'Как на стенде: токовая обмотка (верхние выводы) включается последовательно с нагрузкой, обмотка напряжения (нижние выводы) — параллельно ей. Показывает активную мощность P = U·I·cos φ.',
    drawBlock: (w, h) => {
      const cx = w / 2, cy = h / 2, r = 17;
      return `<path class="wire" d="M0,0 H${cx - r} M${cx + r},0 H${w}"/>`
        + `<path class="wire" d="M0,${h} H${cx - 26} V${cy + 4} M${w},${h} H${cx + 26} V${cy + 4}"/>`
        + `<path class="wire ln-dash" d="M${cx - 26},${cy + 4} H${cx - r * 0.7} M${cx + 26},${cy + 4} H${cx + r * 0.7}"/>`
        + `<circle class="dev" cx="${cx}" cy="0" r="${r}"/>`
        + `<text class="lbl b" x="${cx}" y="5" text-anchor="middle" font-size="15">W</text>`;
    },
    expand: (el, n, v) => [
      { id: el.id, type: 'V', nodes: [n[0], n[1]], dc: 0, r: 0, role: 'meter', label: el.label },
      { id: el.id + 'u', type: 'R', nodes: [n[2], n[3]], R: Math.max(v.Rin, 1000) },
    ],
  });

  /* ─── машины ─── */
  def('M', {
    name: 'Двигатель постоянного тока', group: 'машины', tag: 'M', gost: 'ГОСТ 2.722',
    props: [
      { k: 'Ra', label: 'сопротивление якоря', unit: 'Ом', def: 2, min: 0.01, max: 1000, step: 0.1 },
      { k: 'ke', label: 'постоянная (В·с/рад)', unit: '', def: 0.05, min: 0.001, max: 10, step: 0.005 },
      { k: 'Tload', label: 'момент нагрузки', unit: 'Н·м', def: 0.05, min: 0, max: 500, step: 0.01 },
      { k: 'B', label: 'коэффициент трения', unit: 'Н·м·с', def: 2e-4, min: 1e-6, max: 1, step: 1e-4 },
      { k: 'J', label: 'момент инерции', unit: 'кг·м²', def: 1e-3, min: 1e-6, max: 100, step: 1e-3 },
      { k: 'La', label: 'индуктивность якоря', unit: 'Гн', def: 0.01, min: 0, max: 10, step: 0.005 },
    ],
    hint: 'Уравнения: U = I·Rя + kе·ω и M = kе·I = J·dω/dt + B·ω + Mн. Решаются вместе с цепью.',
    draw: (len, e, v, rot) => {
      const c = len / 2, r = 17;
      return lead(0, c - r) + lead(c + r, len) + circ(c, r) + ctxt(c, 'M', 15, rot);
    },
    expand: (el, n, v) => [{ id: el.id, type: 'MOTOR', nodes: [n[0], n[1]], Ra: v.Ra, ke: v.ke,
                             B: v.B, J: v.J, La: v.La, Tload: v.Tload, label: el.label }],
    spin: true,
  });

  def('BELL', {
    name: 'Звонок', group: 'машины', tag: 'HA', gost: 'ГОСТ 2.741',
    props: [
      { k: 'R', label: 'сопротивление обмотки', unit: 'Ом', def: 50, min: 1, max: 1e5, step: 1 },
      { k: 'ion', label: 'ток срабатывания', unit: 'А', def: 0.05, min: 0.001, max: 10, step: 0.005 },
    ],
    draw: (len) => {
      const c = len / 2, r = 15;
      return lead(0, c - r) + lead(c + r, len)
        + `<path class="dev" d="M${c - r},0 a${r},${r} 0 0 1 ${2 * r},0 Z"/>`
        + `<path class="dev" fill="none" d="M${c - r - 3},0 H${c + r + 3}"/>`;
    },
    expand: (el, n, v) => [{ id: el.id, type: 'R', nodes: [n[0], n[1]], R: v.R }],
    ring: true,
  });

  def('TR', {
    name: 'Трансформатор (две обмотки)', group: 'машины', tag: 'T', gost: 'ГОСТ 2.723',
    block: { nw: 2, nh: 2, terms: [[0, 0], [0, 1], [1, 0], [1, 1]] },
    props: [
      { k: 'k', label: 'коэффициент трансформации w1/w2', unit: '', def: 10, min: 0.05, max: 200, step: 0.5 },
      { k: 'L1', label: 'индуктивность первичной обмотки', unit: 'Гн', def: 20, min: 0.01, max: 1e4, step: 1, si: true },
      { k: 'r1', label: 'активное первичной', unit: 'Ом', def: 1, min: 0, max: 1e4, step: 0.1 },
      { k: 'r2', label: 'активное вторичной', unit: 'Ом', def: 0.02, min: 0, max: 1e4, step: 0.01 },
      { k: 'kc', label: 'коэффициент связи', unit: '', def: 0.995, min: 0.5, max: 1, step: 0.005 },
    ],
    hint: 'Модель — две магнитно связанные катушки: U2/U1 = w2/w1 выходит сам собой, а не задаётся насильно. Поэтому видно и падение под нагрузкой, и ток холостого хода.',
    drawBlock: (w, h) => {
      const x1 = w / 2 - 14, x2 = w / 2 + 14;
      const coil = (x, dir) => {
        let d = `M${x},${h / 2 - 22}`;
        for (let i = 0; i < 4; i++) d += ` a5,5 0 0 ${dir} 0,11`;
        return `<path class="dev" fill="none" d="${d}"/>`;
      };
      return `<path class="wire" d="M0,0 H${x1} V${h / 2 - 22} M0,${h} H${x1} V${h / 2 + 22}"/>`
        + `<path class="wire" d="M${w},0 H${x2} V${h / 2 - 22} M${w},${h} H${x2} V${h / 2 + 22}"/>`
        + coil(x1, 1) + coil(x2, 0)
        + `<path class="dev" d="M${w / 2 - 3},${h / 2 - 26} V${h / 2 + 26} M${w / 2 + 3},${h / 2 - 26} V${h / 2 + 26}"/>`;
    },
    expand: (el, n, v) => {
      const k = Math.max(v.k, 0.05);
      const L1 = Math.max(v.L1, 1e-4), L2 = L1 / (k * k);
      return [
        { id: el.id + 'w1', type: 'L', nodes: [n[0], n[1]], L: L1, r: v.r1 },
        { id: el.id + 'w2', type: 'L', nodes: [n[2], n[3]], L: L2, r: v.r2 },
        { id: el.id + 'm', type: 'MUT', l1: el.id + 'w1', l2: el.id + 'w2', k: Math.min(v.kc, 0.99999) },
      ];
    },
    val: (v) => 'k = ' + fm(v.k, 1),
  });

  /* ─── трёхфазные ─── */
  const PH = ['a', 'b', 'c'];
  const phaseProps = (letter) => ([
    { k: 'R' + letter, label: 'R фазы ' + letter.toUpperCase(), unit: 'Ом', def: 50, min: 0, max: 1e6, step: 1 },
    { k: 'L' + letter, label: 'L фазы ' + letter.toUpperCase(), unit: 'Гн', def: 0, min: 0, max: 100, step: 0.01, si: true },
    { k: 'C' + letter, label: 'C фазы ' + letter.toUpperCase(), unit: 'Ф', def: 0, min: 0, max: 1, step: 1e-6, si: true },
    { k: 'f' + letter, label: 'состояние фазы ' + letter.toUpperCase(), type: 'select', def: 'ok',
      options: [['ok', 'норма'], ['open', 'обрыв'], ['short', 'короткое замыкание']] },
  ]);

  def('SRC3', {
    name: 'Трёхфазный источник', group: 'трёхфазные', tag: 'G', gost: 'ГОСТ 2.721',
    block: { nw: 2, nh: 3, terms: [[1, 0], [1, 1], [1, 2], [0, 1]] },   // A, B, C, N
    props: [
      { k: 'Ul', label: 'линейное напряжение', unit: 'В', def: 380, min: 1, max: 1000, step: 1 },
      { k: 'f', label: 'частота', unit: 'Гц', def: 50, min: 1, max: 400, step: 1 },
      { k: 'seq', label: 'порядок следования фаз', type: 'select', def: 'abc',
        options: [['abc', 'прямой A–B–C'], ['acb', 'обратный A–C–B']] },
    ],
    hint: 'Три ЭДС, сдвинутые на 120°, соединённые звездой. Задаётся линейное напряжение, фазное получается в √3 раз меньше.',
    drawBlock: (w, h) => {
      const cx = w * 0.55, cy = h / 2, r = 26;
      let s = `<circle class="dev" cx="${cx}" cy="${cy}" r="${r}"/>`;
      s += `<path class="dev" fill="none" d="M${cx},${cy - 12} V${cy} M${cx},${cy} l-10,7 M${cx},${cy} l10,7"/>`;
      s += `<path class="wire" d="M${w},0 H${cx + 6} L${cx + 6},${cy - r}"/>`;
      s += `<path class="wire" d="M${w},${h / 2} H${cx + r}"/>`;
      s += `<path class="wire" d="M${w},${h} H${cx + 6} L${cx + 6},${cy + r}"/>`;
      s += `<path class="wire" d="M0,${h / 2} H${cx - r}"/>`;
      s += txt(w - 14, -8, 'A') + txt(w - 14, h / 2 - 8, 'B') + txt(w - 14, h + 16, 'C') + txt(14, h / 2 - 8, 'N');
      return s;
    },
    expand: (el, n, v) => {
      const Uf = v.Ul / Math.sqrt(3);
      const sgn = v.seq === 'acb' ? 1 : -1;
      return [0, 1, 2].map((i) => ({
        id: el.id + 'e' + i, type: 'V', nodes: [n[i], n[3]],
        mag: Uf, ph: sgn * 120 * i, f: v.f, r: 0.01, imax: 1e4, label: (el.label || 'G') + '.' + 'ABC'[i],
      }));
    },
    val: (v) => fm(v.Ul, 0) + ' В, ' + fm(v.f, 0) + ' Гц',
  });

  def('LOAD3Y', {
    name: 'Трёхфазная нагрузка звездой', group: 'трёхфазные', tag: 'Z', gost: 'ГОСТ 2.728',
    block: { nw: 2, nh: 3, terms: [[0, 0], [0, 1], [0, 2], [1, 1]] },   // A, B, C, N
    props: [{ k: 'neutral', label: 'нулевой провод подключён', type: 'bool', def: true }]
      .concat(phaseProps('a'), phaseProps('b'), phaseProps('c')),
    hint: 'Звезда: три фазы сходятся в нулевую точку. Нулевой провод удерживает фазные напряжения при неравной нагрузке.',
    sym: true,
    drawBlock: (w, h) => {
      const cx = w * 0.62, cy = h / 2;
      let s = '';
      [0, 1, 2].forEach((i) => {
        const y = i * h / 2;
        s += `<path class="wire" d="M0,${y} H${cx - 40}"/>`;
        s += `<rect class="dev" x="${cx - 40}" y="${y - 7}" width="28" height="14"/>`;
        s += `<path class="wire" d="M${cx - 12},${y} L${cx},${cy}"/>`;
        s += txt(16, y - 10, 'ABC'[i]);
      });
      s += `<circle class="node" cx="${cx}" cy="${cy}" r="3"/>`;
      s += `<path class="wire" d="M${cx},${cy} H${w}"/>` + txt(w - 12, cy - 10, 'N');
      return s;
    },
    expand: (el, n, v) => {
      const out = [];
      PH.forEach((p, i) => {
        const st = v['f' + p];
        const mid = el.id + 'm' + p;
        if (st === 'open') return;                       // обрыв фазы
        if (st === 'short') { out.push({ id: el.id + 's' + p, type: 'W', nodes: [n[i], el.id + 'O'] }); return; }
        let a = n[i];
        const R = v['R' + p], L = v['L' + p], Cc = v['C' + p];
        const parts = [];
        if (R > 0) parts.push(['R', { R }]);
        if (L > 0) parts.push(['L', { L, r: 0 }]);
        if (Cc > 0) parts.push(['C', { C: Cc }]);
        if (!parts.length) parts.push(['R', { R: 1e6 }]);
        parts.forEach((pr, j) => {
          const b = j === parts.length - 1 ? el.id + 'O' : mid + j;
          out.push(Object.assign({ id: el.id + p + pr[0], type: pr[0], nodes: [a, b] }, pr[1]));
          a = b;
        });
      });
      out.push({ id: el.id + 'n', type: v.neutral ? 'W' : 'R', nodes: [el.id + 'O', n[3]], R: 1e9 });
      return out;
    },
  });

  def('LOAD3D', {
    name: 'Трёхфазная нагрузка треугольником', group: 'трёхфазные', tag: 'Z', gost: 'ГОСТ 2.728',
    block: { nw: 2, nh: 3, terms: [[0, 0], [0, 1], [0, 2], [1, 1]] },
    props: [].concat(phaseProps('a'), phaseProps('b'), phaseProps('c')),
    hint: 'Треугольник: каждая фаза нагрузки включена на линейное напряжение. Фазы обозначены ab, bc, ca.',
    sym: true,
    drawBlock: (w, h) => {
      const x = w * 0.5;
      let s = '';
      [0, 1, 2].forEach((i) => { s += `<path class="wire" d="M0,${i * h / 2} H${x - 26}"/>` + txt(16, i * h / 2 - 10, 'ABC'[i]); });
      s += `<path class="wire" d="M${x - 26},0 V${h}"/>`;
      s += `<rect class="dev" x="${x - 40}" y="${h / 4 - 7}" width="28" height="14"/>`;
      s += `<rect class="dev" x="${x - 40}" y="${3 * h / 4 - 7}" width="28" height="14"/>`;
      s += `<path class="wire" d="M${x - 26},0 H${x + 30} V${h} H${x - 26}"/>`;
      s += `<rect class="dev" x="${x + 16}" y="${h / 2 - 7}" width="28" height="14"/>`;
      return s;
    },
    expand: (el, n, v) => {
      const out = [];
      const pairs = [[0, 1], [1, 2], [2, 0]];
      PH.forEach((p, i) => {
        const st = v['f' + p];
        if (st === 'open') return;
        const from = n[pairs[i][0]], to = n[pairs[i][1]];
        if (st === 'short') { out.push({ id: el.id + 's' + p, type: 'W', nodes: [from, to] }); return; }
        let a = from;
        const R = v['R' + p], L = v['L' + p], Cc = v['C' + p];
        const parts = [];
        if (R > 0) parts.push(['R', { R }]);
        if (L > 0) parts.push(['L', { L, r: 0 }]);
        if (Cc > 0) parts.push(['C', { C: Cc }]);
        if (!parts.length) parts.push(['R', { R: 1e6 }]);
        parts.forEach((pr, j) => {
          const b = j === parts.length - 1 ? to : el.id + p + 'm' + j;
          out.push(Object.assign({ id: el.id + p + pr[0], type: pr[0], nodes: [a, b] }, pr[1]));
          a = b;
        });
      });
      return out;
    },
  });

  def('IM3', {
    name: 'Асинхронный двигатель (трёхфазный)', group: 'трёхфазные', tag: 'M', gost: 'ГОСТ 2.722',
    block: { nw: 2, nh: 3, terms: [[0, 0], [0, 1], [0, 2], [1, 1]] },
    props: [
      { k: 'Pn', label: 'номинальная мощность', unit: 'Вт', def: 5500, min: 100, max: 1e6, step: 100 },
      { k: 'Un', label: 'номинальное напряжение (линейное)', unit: 'В', def: 380, min: 100, max: 1000, step: 10 },
      { k: 'cosf', label: 'cos φ номинальный', unit: '', def: 0.85, min: 0.3, max: 1, step: 0.01 },
      { k: 'eta', label: 'КПД', unit: '', def: 0.88, min: 0.3, max: 1, step: 0.01 },
      { k: 'ki', label: 'кратность пускового тока', unit: '', def: 6, min: 1, max: 12, step: 0.5 },
      { k: 'mode', label: 'режим', type: 'select', def: 'run',
        options: [['run', 'номинальная работа'], ['start', 'прямой пуск']] },
    ],
    hint: 'Упрощённая модель: двигатель заменяется симметричной звездой R + L, посчитанной по паспортным данным. В пуске сопротивление меньше в «кратность пускового тока» раз, а cos φ принимается 0,3 — так ведёт себя реальная машина при прямом пуске.',
    drawBlock: (w, h) => {
      const cx = w * 0.55, cy = h / 2, r = 26;
      let s = '';
      [0, 1, 2].forEach((i) => { s += `<path class="wire" d="M0,${i * h / 2} H${cx - r - 6} L${cx - r + 4},${cy}"/>` + txt(16, i * h / 2 - 10, 'ABC'[i]); });
      s += `<circle class="dev" cx="${cx}" cy="${cy}" r="${r}"/>`;
      s += `<text class="lbl b" x="${cx}" y="${cy + 5}" text-anchor="middle" font-size="14">M</text>`;
      s += `<text class="lbl" x="${cx}" y="${cy + 17}" text-anchor="middle" font-size="9">3~</text>`;
      return s;
    },
    expand: (el, n, v) => {
      const S = v.Pn / Math.max(v.eta * v.cosf, 0.05);
      const I = S / (Math.sqrt(3) * v.Un);
      const cosf = v.mode === 'start' ? 0.3 : v.cosf;
      const Z = (v.Un / Math.sqrt(3)) / Math.max(I * (v.mode === 'start' ? v.ki : 1), 1e-3);
      const R = Z * cosf, X = Z * Math.sqrt(Math.max(0, 1 - cosf * cosf));
      const out = [];
      [0, 1, 2].forEach((i) => {
        out.push({ id: el.id + 'r' + i, type: 'R', nodes: [n[i], el.id + 'm' + i], R: Math.max(R, 0.01) });
        out.push({ id: el.id + 'l' + i, type: 'L', nodes: [el.id + 'm' + i, el.id + 'O'], L: X / (2 * Math.PI * 50), r: 0 });
      });
      out.push({ id: el.id + 'n', type: 'R', nodes: [el.id + 'O', n[3]], R: 1e9 });
      return out;
    },
    val: (v) => si(v.Pn, 'Вт', 1) + (v.mode === 'start' ? ' · пуск' : ''),
  });

  /* ── список групп в порядке показа в палитре ── */
  const GROUPS = ['база', 'источники', 'пассивные', 'полупроводники', 'коммутация', 'приборы', 'машины', 'трёхфазные'];

  /* ══════════════ схема → сеть для решателя ══════════════
     Эти функции живут здесь, а не в builder.js, чтобы одна и та же схема
     одинаково разворачивалась и на странице, и в тестах под node. */

  const nn = (x, y) => 'n' + x + '_' + y;

  function endOf(p) {
    return p.d === 'v' ? { x: p.x, y: p.y + 1 } : { x: p.x + 1, y: p.y };
  }
  /* Узлы выводов детали в порядке, который ждёт её expand(). */
  function termNodes(p) {
    const d = P[p.k];
    if (d.single) return [nn(p.x, p.y)];
    if (d.block) return d.block.terms.map((t) => nn(p.x + t[0], p.y + t[1]));
    const e = endOf(p);
    const a = nn(p.x, p.y), b = nn(e.x, e.y);
    return p.f ? [b, a] : [a, b];
  }
  /* Узлы, которые деталь занимает на поле. */
  function cellsOf(p) {
    const d = P[p.k];
    if (d.single) return [[p.x, p.y]];
    if (d.block) {
      const out = [];
      for (let i = 0; i < d.block.nw; i++) for (let j = 0; j < d.block.nh; j++) out.push([p.x + i, p.y + j]);
      return out;
    }
    const e = endOf(p);
    return [[p.x, p.y], [e.x, e.y]];
  }
  /* Обозначения R1, C2, EL1, PA1 … — по порядку появления среди своих. */
  function designators(parts) {
    const cnt = {}, map = {};
    parts.forEach((p) => {
      const tag = P[p.k] ? P[p.k].tag : '';
      if (!tag) { map[p.id] = ''; return; }
      cnt[tag] = (cnt[tag] || 0) + 1;
      map[p.id] = tag + cnt[tag];
    });
    return map;
  }

  function netlistOf(schema) {
    const parts = (schema && schema.parts) || [];
    const map = designators(parts);
    const els = [];
    let ground = null;
    parts.forEach((p) => {
      const d = P[p.k];
      if (!d) return;
      const nodes = termNodes(p);
      if (d.ground) { ground = nodes[0]; return; }
      const made = d.expand({ id: p.id, label: map[p.id] }, nodes, values(p)) || [];
      made.forEach((e) => els.push(e));
    });
    return { elements: els, ground };
  }

  /* Какой расчёт нужен схеме и его результат. Elec передаётся снаружи:
     в браузере это window.Elec, в тестах — require('solver.js'). */
  function analyse(schema, Elec, opts) {
    opts = opts || {};
    const net = netlistOf(schema);
    if (!net.elements.length) return { kind: 'empty', res: { warnings: [], elem: {}, node: {} }, net };
    const src = net.elements.find((e) => (e.type === 'V' || e.type === 'I') && e.mag);
    const f = src ? (src.f || 50) : 0;
    const nonlin = net.elements.some((e) => e.type === 'D');
    let kind, res;
    if (!f) {
      kind = 'dc';
      res = Elec.solveDC(net);
      if (opts.scope) res.tran = Elec.solveTransient(net, { ic: 'zero', points: 1200 });
    } else if (nonlin || opts.force === 'tran') {
      kind = 'tran';
      res = Elec.solveTransient(net, { tEnd: 4 / f, points: 1500 });
      res.tran = res;
    } else {
      kind = 'ac';
      res = Elec.solveAC(net, { f });
    }
    res.f = f;
    return { kind, res, net };
  }

  /* Показание прибора: амперметр — ток, вольтметр — напряжение,
     ваттметр — активная мощность (токовая обмотка × обмотка напряжения). */
  function reading(p, kind, res) {
    const e = res.elem && res.elem[p.id];
    const rms = res.rms && res.rms[p.id];
    if (p.k === 'AM') {
      if (kind === 'ac') return e ? { v: e.I, u: 'А' } : null;
      if (kind === 'tran') return rms ? { v: rms.I, u: 'А' } : null;
      return e ? { v: Math.abs(e.i), u: 'А' } : null;
    }
    if (p.k === 'VM') {
      if (kind === 'ac') return e ? { v: e.U, u: 'В' } : null;
      if (kind === 'tran') return rms ? { v: rms.U, u: 'В' } : null;
      return e ? { v: Math.abs(e.u), u: 'В' } : null;
    }
    if (p.k === 'WM') {
      const cur = res.elem && res.elem[p.id], vol = res.elem && res.elem[p.id + 'u'];
      if (!cur || !vol) return null;
      if (kind === 'ac') return { v: vol.u.re * cur.i.re + vol.u.im * cur.i.im, u: 'Вт' };
      if (kind === 'tran') {
        const n = Math.min(cur.i.length, vol.u.length);
        const from = Math.max(0, n - Math.round(n / 4));
        let s = 0;
        for (let i = from; i < n; i++) s += cur.i[i] * vol.u[i];
        return { v: n > from ? s / (n - from) : 0, u: 'Вт' };
      }
      return { v: cur.i * vol.u, u: 'Вт' };
    }
    return null;
  }

  /* Контекст автопроверки опыта: то, что видит функция check(). */
  function makeCtx(schema, kind, res) {
    const parts = (schema && schema.parts) || [];
    const byKey = (k) => parts.filter((p) => p.k === k);
    const map = designators(parts);
    return {
      parts, kind, res, map,
      count: (k) => byKey(k).length,
      val: (k, prop, i) => { const p = byKey(k)[i || 0]; return p ? values(p)[prop] : undefined; },
      meter: (k, i) => { const p = byKey(k)[i || 0]; const r = p ? reading(p, kind, res) : null; return r ? r.v : undefined; },
      elem: (k, i) => { const p = byKey(k)[i || 0]; return p ? (res.elem || {})[p.id] : undefined; },
      rms: (k, i) => { const p = byKey(k)[i || 0]; return p && res.rms ? res.rms[p.id] : undefined; },
      warn: res.warnings || [],
      near: (a, b, tol) => (a !== undefined && isFinite(a) && Math.abs(a - b) <= Math.abs(tol)),
      has: (k, n) => byKey(k).length >= (n || 1),
      expect: (label, got, want, tol, unit) => ({
        ok: got !== undefined && isFinite(got) && Math.abs(got - want) <= Math.abs(tol),
        text: label + ': получилось ' + (got === undefined || !isFinite(got) ? '—' : fm(got, 3))
          + ', ожидается ' + fm(want, 3) + ' ± ' + fm(tol, 3) + (unit ? ' ' + unit : ''),
      }),
      ok: (cond, text) => ({ ok: !!cond, text }),
      fm, si,
    };
  }

  /* Значения свойств детали: заданные пользователем поверх умолчаний. */
  function values(part) {
    const d = P[part.k];
    const v = {};
    (d.props || []).forEach((pr) => {
      const x = part.p && part.p[pr.k];
      v[pr.k] = (x === undefined || x === null) ? pr.def : x;
    });
    return v;
  }

  return { P, GROUPS, values, si, fm, esc, nn, endOf, termNodes, cellsOf,
           designators, netlistOf, analyse, reading, makeCtx };
}));
