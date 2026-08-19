/* Контрольные схемы для расчётного ядра.
 *
 * Каждая схема считается двумя независимыми путями:
 *   * решателем site/assets/solver.js (МНА + Гаусс);
 *   * «вручную» — здесь же, замкнутой формулой из учебника (закон Ома,
 *     делитель, формула двух узлов, преобразование треугольник–звезда,
 *     e^(−t/τ), резонанс, симметричная трёхфазная система …).
 * Совпадать они должны с точностью 0,5 % — это и проверяет test_solver.py.
 *
 * Запуск: node tests/solver_cases.js  → JSON со списком случаев и сверок.
 */
'use strict';
const E = require('../site/assets/solver.js');

/* ── маленькая комплексная арифметика для «ручных» ответов ── */
const C = {
  add: (a, b) => ({ re: a.re + b.re, im: a.im + b.im }),
  sub: (a, b) => ({ re: a.re - b.re, im: a.im - b.im }),
  mul: (a, b) => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re }),
  div: (a, b) => {
    const d = b.re * b.re + b.im * b.im;
    return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
  },
  abs: (a) => Math.hypot(a.re, a.im),
  arg: (a) => Math.atan2(a.im, a.re) * 180 / Math.PI,
  pol: (m, degrees) => ({ re: m * Math.cos(degrees * Math.PI / 180), im: m * Math.sin(degrees * Math.PI / 180) }),
};

const cases = [];
function put(name, note, checks) { cases.push({ name, note, checks }); }
const chk = (label, got, want, tol) => ({ label, got, want, tol: tol === undefined ? 0.005 : tol });

/* точка переходного процесса, ближайшая к моменту t */
function at(res, t) {
  let bi = 0, bd = Infinity;
  for (let i = 0; i < res.t.length; i++) {
    const d = Math.abs(res.t[i] - t);
    if (d < bd) { bd = d; bi = i; }
  }
  return bi;
}

/* ═══ 1. Делитель напряжения ═══ */
{
  const Ee = 12, R1 = 100, R2 = 200;
  const r = E.solveDC({ ground: 'g', elements: [
    { id: 'E1', type: 'V', nodes: ['a', 'g'], dc: Ee, r: 0 },
    { id: 'R1', type: 'R', nodes: ['a', 'b'], R: R1 },
    { id: 'R2', type: 'R', nodes: ['b', 'g'], R: R2 },
  ] });
  const I = Ee / (R1 + R2);
  put('Делитель напряжения 12 В, 100 + 200 Ом',
    'U2 = E·R2/(R1+R2), I = E/(R1+R2)', [
      chk('U2, В', r.node.b, Ee * R2 / (R1 + R2)),
      chk('I, А', r.elem.R1.i, I),
      chk('P источника, Вт', -r.elem.E1.p, Ee * I),
    ]);
}

/* ═══ 2. Параллельное соединение ═══ */
{
  const Ee = 24, R1 = 100, R2 = 150, R3 = 300;
  const r = E.solveDC({ ground: 'g', elements: [
    { id: 'E1', type: 'V', nodes: ['a', 'g'], dc: Ee, r: 0 },
    { id: 'R1', type: 'R', nodes: ['a', 'g'], R: R1 },
    { id: 'R2', type: 'R', nodes: ['a', 'g'], R: R2 },
    { id: 'R3', type: 'R', nodes: ['a', 'g'], R: R3 },
  ] });
  const Req = 1 / (1 / R1 + 1 / R2 + 1 / R3);
  put('Три резистора параллельно, 24 В',
    '1/Rэкв = ΣGk; ток каждой ветви U/Rk', [
      chk('I1, А', r.elem.R1.i, Ee / R1),
      chk('I2, А', r.elem.R2.i, Ee / R2),
      chk('I3, А', r.elem.R3.i, Ee / R3),
      chk('Iобщ, А', -r.elem.E1.i, Ee / Req),
      chk('Rэкв, Ом', E.resistanceBetween({ elements: [
        { id: 'R1', type: 'R', nodes: ['a', 'g'], R: R1 },
        { id: 'R2', type: 'R', nodes: ['a', 'g'], R: R2 },
        { id: 'R3', type: 'R', nodes: ['a', 'g'], R: R3 }] }, 'a', 'g'), Req),
    ]);
}

/* ═══ 3. Смешанное соединение ═══ */
{
  const Ee = 60, R1 = 10, R2 = 40, R3 = 60, R4 = 25;
  const R23 = R2 * R3 / (R2 + R3);
  const Req = R1 + R23 + R4;
  const I = Ee / Req;
  const r = E.solveDC({ ground: 'g', elements: [
    { id: 'E1', type: 'V', nodes: ['a', 'g'], dc: Ee, r: 0 },
    { id: 'R1', type: 'R', nodes: ['a', 'b'], R: R1 },
    { id: 'R2', type: 'R', nodes: ['b', 'c'], R: R2 },
    { id: 'R3', type: 'R', nodes: ['b', 'c'], R: R3 },
    { id: 'R4', type: 'R', nodes: ['c', 'g'], R: R4 },
  ] });
  put('Смешанное соединение: R1 − (R2‖R3) − R4',
    'свёртка: R23 = R2R3/(R2+R3), Rэкв = R1+R23+R4', [
      chk('I общий, А', r.elem.R1.i, I),
      chk('U на параллельном участке, В', r.node.b - r.node.c, I * R23),
      chk('I2, А', r.elem.R2.i, I * R23 / R2),
      chk('I3, А', r.elem.R3.i, I * R23 / R3),
    ]);
}

/* ═══ 4. Мост Уитстона в равновесии ═══ */
{
  const Ee = 10, R1 = 100, R2 = 200, R3 = 300, R4 = 600, Rg = 50;
  const r = E.solveDC({ ground: 'g', elements: [
    { id: 'E1', type: 'V', nodes: ['a', 'g'], dc: Ee, r: 0 },
    { id: 'R1', type: 'R', nodes: ['a', 'b'], R: R1 },
    { id: 'R2', type: 'R', nodes: ['b', 'g'], R: R2 },
    { id: 'R3', type: 'R', nodes: ['a', 'c'], R: R3 },
    { id: 'R4', type: 'R', nodes: ['c', 'g'], R: R4 },
    { id: 'Rg', type: 'R', nodes: ['b', 'c'], R: Rg },
  ] });
  put('Мост Уитстона в равновесии (R1/R2 = R3/R4)',
    'условие равновесия R1·R4 = R2·R3 — ток в диагонали ноль', [
      chk('Uб (напряжение диагонали), В', r.node.b - r.node.c, 0, 1e-6),
      chk('Iд (ток диагонали), А', r.elem.Rg.i, 0, 1e-6),
      chk('U точки b, В', r.node.b, Ee * R2 / (R1 + R2)),
    ]);
}

/* ═══ 5. Неуравновешенный мост (проверка через преобразование Δ→Y) ═══ */
{
  const Ee = 10, R1 = 100, R2 = 200, R3 = 300, R4 = 300, Rg = 500;
  // треугольник R1, R3, Rg (вершины a, b, c) → звезда
  const s = R1 + R3 + Rg;
  const Ra = R1 * R3 / s, Rb = R1 * Rg / s, Rc = R3 * Rg / s;
  const Rman = Ra + (Rb + R2) * (Rc + R4) / (Rb + R2 + Rc + R4);
  const Iman = Ee / Rman;
  const r = E.solveDC({ ground: 'g', elements: [
    { id: 'E1', type: 'V', nodes: ['a', 'g'], dc: Ee, r: 0 },
    { id: 'R1', type: 'R', nodes: ['a', 'b'], R: R1 },
    { id: 'R2', type: 'R', nodes: ['b', 'g'], R: R2 },
    { id: 'R3', type: 'R', nodes: ['a', 'c'], R: R3 },
    { id: 'R4', type: 'R', nodes: ['c', 'g'], R: R4 },
    { id: 'Rg', type: 'R', nodes: ['b', 'c'], R: Rg },
  ] });
  put('Неуравновешенный мост — сверка с преобразованием треугольник→звезда',
    'Δ(R1,R3,Rg) → Y, дальше обычная свёртка', [
      chk('Iобщ, А', -r.elem.E1.i, Iman),
      chk('Rвх, Ом', Ee / (-r.elem.E1.i), Rman),
    ]);
}

/* ═══ 6. Два контура по Кирхгофу (формула двух узлов) ═══ */
{
  const E1 = 100, R1 = 10, E2 = 60, R2 = 20, R3 = 40;
  const Uab = (E1 / R1 + E2 / R2) / (1 / R1 + 1 / R2 + 1 / R3);
  const I1 = (E1 - Uab) / R1, I2 = (E2 - Uab) / R2, I3 = Uab / R3;
  const r = E.solveDC({ ground: 'b', elements: [
    { id: 'E1', type: 'V', nodes: ['e1', 'b'], dc: E1, r: 0 },
    { id: 'R1', type: 'R', nodes: ['e1', 'a'], R: R1 },
    { id: 'E2', type: 'V', nodes: ['e2', 'b'], dc: E2, r: 0 },
    { id: 'R2', type: 'R', nodes: ['e2', 'a'], R: R2 },
    { id: 'R3', type: 'R', nodes: ['a', 'b'], R: R3 },
  ] });
  put('Две ЭДС на два узла — законы Кирхгофа',
    'метод двух узлов: Uab = Σ(E/R) / Σ(1/R)', [
      chk('Uab, В', r.node.a, Uab),
      chk('I1, А', r.elem.R1.i, I1),
      chk('I2, А', r.elem.R2.i, I2),
      chk('I3, А', r.elem.R3.i, I3),
      chk('баланс мощностей: ΣEI = ΣRI², Вт',
        E1 * I1 + E2 * I2, I1 * I1 * R1 + I2 * I2 * R2 + I3 * I3 * R3),
    ]);
}

/* ═══ 7. Реальный источник: внутреннее сопротивление ═══ */
{
  const Ee = 12, ri = 0.5, R = 5.5;
  const I = Ee / (ri + R);
  const r = E.solveDC({ ground: 'g', elements: [
    { id: 'E1', type: 'V', nodes: ['a', 'g'], dc: Ee, r: ri },
    { id: 'R1', type: 'R', nodes: ['a', 'g'], R },
  ] });
  put('Аккумулятор с внутренним сопротивлением 0,5 Ом на нагрузку 5,5 Ом',
    'I = E/(R+r), U = E − I·r, КПД = R/(R+r)', [
      chk('I, А', r.elem.R1.i, I),
      chk('U на зажимах, В', r.node.a, Ee - I * ri),
      chk('P нагрузки, Вт', r.elem.R1.p, I * I * R),
      chk('КПД', r.elem.R1.p / (Ee * I), R / (R + ri)),
    ]);
}

/* ═══ 8. Согласованный режим ═══ */
{
  const Ee = 12, ri = 2;
  const scan = [];
  for (let k = 1; k <= 40; k++) {
    const R = k * 0.25;
    const rr = E.solveDC({ ground: 'g', elements: [
      { id: 'E1', type: 'V', nodes: ['a', 'g'], dc: Ee, r: ri },
      { id: 'R1', type: 'R', nodes: ['a', 'g'], R },
    ] });
    scan.push({ R, P: rr.elem.R1.p });
  }
  const best = scan.reduce((a, b) => (b.P > a.P ? b : a));
  put('Согласованный режим: максимум отдаваемой мощности при R = r',
    'Pmax = E²/(4r) достигается при R = r', [
      chk('R при максимуме P, Ом', best.R, ri, 0.15),
      chk('Pmax, Вт', best.P, Ee * Ee / (4 * ri), 0.01),
    ]);
}

/* ═══ 9. Заряд конденсатора ═══ */
{
  const Ee = 10, R = 1000, Cap = 100e-6, tau = R * Cap;
  const r = E.solveTransient({ ground: 'g', elements: [
    { id: 'E1', type: 'V', nodes: ['a', 'g'], dc: Ee, r: 0 },
    { id: 'R1', type: 'R', nodes: ['a', 'b'], R },
    { id: 'C1', type: 'C', nodes: ['b', 'g'], C: Cap, v0: 0 },
  ] }, { tEnd: 5 * tau, h: tau / 2000, points: 4000 });
  const ch = [];
  [0.5, 1, 2, 3].forEach((k) => {
    const i = at(r, k * tau);
    ch.push(chk('uC(' + k + 'τ), В', r.elem.C1.u[i], Ee * (1 - Math.exp(-r.t[i] / tau))));
    ch.push(chk('i(' + k + 'τ), мА', r.elem.R1.i[i] * 1000, (Ee / R) * Math.exp(-r.t[i] / tau) * 1000));
  });
  put('Заряд конденсатора через резистор (RC, τ = 0,1 с)',
    'uC = E(1 − e^(−t/τ)), i = (E/R)·e^(−t/τ)', ch);
}

/* ═══ 10. Разряд конденсатора ═══ */
{
  const U0 = 24, R = 4700, Cap = 47e-6, tau = R * Cap;
  const r = E.solveTransient({ ground: 'g', elements: [
    { id: 'R1', type: 'R', nodes: ['b', 'g'], R },
    { id: 'C1', type: 'C', nodes: ['b', 'g'], C: Cap, v0: U0 },
  ] }, { tEnd: 4 * tau, h: tau / 2000, points: 4000 });
  const ch = [];
  [1, 2, 3].forEach((k) => {
    const i = at(r, k * tau);
    ch.push(chk('uC(' + k + 'τ), В', r.elem.C1.u[i], U0 * Math.exp(-r.t[i] / tau)));
  });
  put('Разряд конденсатора на резистор (τ = 0,221 с)',
    'uC = U0·e^(−t/τ)', ch);
}

/* ═══ 11. Ток в катушке (RL) ═══ */
{
  const Ee = 10, R = 100, L = 1, tau = L / R;
  const r = E.solveTransient({ ground: 'g', elements: [
    { id: 'E1', type: 'V', nodes: ['a', 'g'], dc: Ee, r: 0 },
    { id: 'R1', type: 'R', nodes: ['a', 'b'], R },
    { id: 'L1', type: 'L', nodes: ['b', 'g'], L, r: 0 },
  ] }, { tEnd: 5 * tau, h: tau / 2000, points: 4000 });
  const ch = [];
  [0.5, 1, 2, 3].forEach((k) => {
    const i = at(r, k * tau);
    ch.push(chk('iL(' + k + 'τ), мА', r.elem.L1.i[i] * 1000, (Ee / R) * (1 - Math.exp(-r.t[i] / tau)) * 1000));
    ch.push(chk('uL(' + k + 'τ), В', r.elem.L1.u[i], Ee * Math.exp(-r.t[i] / tau)));
  });
  put('Нарастание тока в катушке (RL, τ = 10 мс)',
    'i = (E/R)(1 − e^(−t/τ)), uL = E·e^(−t/τ)', ch);
}

/* ═══ 12. Цепь R–L на переменном токе ═══ */
{
  const U = 220, f = 50, R = 30, L = 0.1273;   // XL ≈ 40 Ом
  const w = 2 * Math.PI * f, XL = w * L;
  const Z = Math.hypot(R, XL), I = U / Z, phi = Math.atan2(XL, R) * 180 / Math.PI;
  const r = E.solveAC({ ground: 'g', elements: [
    { id: 'E1', type: 'V', nodes: ['a', 'g'], mag: U, ph: 0, f, r: 0 },
    { id: 'R1', type: 'R', nodes: ['a', 'b'], R },
    { id: 'L1', type: 'L', nodes: ['b', 'g'], L, r: 0 },
  ] }, { f });
  put('Последовательная R–L цепь, 220 В, 50 Гц',
    'Z = √(R²+XL²), I = U/Z, cos φ = R/Z, P = UI cos φ', [
      chk('I, А', r.elem.R1.I, I),
      chk('UR, В', r.elem.R1.U, I * R),
      chk('UL, В', r.elem.L1.U, I * XL),
      chk('φ, град', -r.elem.R1.phI, phi, 0.01),
      chk('P, Вт', r.elem.R1.P, I * I * R),
      chk('Q, вар', r.elem.L1.Q, I * I * XL),
      chk('cos φ цепи', -r.elem.E1.P / (U * I), R / Z),
    ]);
}

/* ═══ 13. Последовательный резонанс напряжений ═══ */
{
  const L = 0.1, Cap = 10e-6, R = 10, U = 10;
  const f0 = 1 / (2 * Math.PI * Math.sqrt(L * Cap));
  const rho = Math.sqrt(L / Cap), Q = rho / R;
  const r = E.solveAC({ ground: 'g', elements: [
    { id: 'E1', type: 'V', nodes: ['a', 'g'], mag: U, f: f0, r: 0 },
    { id: 'R1', type: 'R', nodes: ['a', 'b'], R },
    { id: 'L1', type: 'L', nodes: ['b', 'c'], L, r: 0 },
    { id: 'C1', type: 'C', nodes: ['c', 'g'], C: Cap },
  ] }, { f: f0 });
  put('Последовательный резонанс (резонанс напряжений), f₀ = 159,15 Гц',
    'f₀ = 1/(2π√LC); в резонансе I = U/R, UL = UC = Q·U', [
      chk('f₀, Гц', E.resonance(L, Cap), f0),
      chk('I, А', r.elem.R1.I, U / R),
      chk('UL, В', r.elem.L1.U, Q * U),
      chk('UC, В', r.elem.C1.U, Q * U),
      chk('cos φ источника', -r.elem.E1.P / (U * r.elem.R1.I), 1),
      chk('добротность Q', r.elem.L1.U / U, Q),
    ]);
}

/* ═══ 14. Параллельный резонанс токов ═══ */
{
  const L = 0.05, Cap = 20e-6, U = 100;
  const f0 = 1 / (2 * Math.PI * Math.sqrt(L * Cap));
  const w = 2 * Math.PI * f0;
  const r = E.solveAC({ ground: 'g', elements: [
    { id: 'E1', type: 'V', nodes: ['a', 'g'], mag: U, f: f0, r: 0.001 },
    { id: 'L1', type: 'L', nodes: ['a', 'g'], L, r: 0 },
    { id: 'C1', type: 'C', nodes: ['a', 'g'], C: Cap },
  ] }, { f: f0 });
  put('Параллельный резонанс (резонанс токов)',
    'IL = U/(ωL) и IC = U·ωC равны и противоположны, ток источника → 0', [
      chk('IL, А', r.elem.L1.I, U / (w * L)),
      chk('IC, А', r.elem.C1.I, U * w * Cap),
      chk('ток источника, А', Math.abs(r.elem.E1.I), 0, 1e-3),
    ]);
}

/* ═══ 15. Компенсация коэффициента мощности ═══ */
{
  const U = 220, f = 50, w = 2 * Math.PI * f, R = 30, L = 0.1273;
  const XL = w * L, Z2 = R * R + XL * XL;
  const P = U * U * R / Z2, Qload = U * U * XL / Z2;
  const Cap = Qload / (w * U * U);          // конденсатор, компенсирующий Q полностью
  const r = E.solveAC({ ground: 'g', elements: [
    { id: 'E1', type: 'V', nodes: ['a', 'g'], mag: U, f, r: 0 },
    { id: 'R1', type: 'R', nodes: ['a', 'b'], R },
    { id: 'L1', type: 'L', nodes: ['b', 'g'], L, r: 0 },
    { id: 'C1', type: 'C', nodes: ['a', 'g'], C: Cap },
  ] }, { f });
  const Is = r.elem.E1.I;
  put('Компенсация cos φ параллельным конденсатором',
    'C = Q/(ωU²) — реактивная мощность катушки гасится конденсатором, ток линии падает до P/U', [
      chk('P нагрузки, Вт', r.elem.R1.P, P),
      chk('ток линии после компенсации, А', Is, P / U),
      chk('cos φ после компенсации', Math.abs(-r.elem.E1.P / (U * Is)), 1),
    ]);
}

/* ═══ 16. Трёхфазная симметричная звезда ═══ */
{
  const Ul = 380, Uf = Ul / Math.sqrt(3), R = 10, f = 50;
  const els = [];
  ['A', 'B', 'C'].forEach((p, k) => {
    els.push({ id: 'E' + p, type: 'V', nodes: ['n' + p, 'N'], mag: Uf, ph: -120 * k, f, r: 0 });
    els.push({ id: 'Z' + p, type: 'R', nodes: ['n' + p, 'O'], R });
  });
  els.push({ id: 'N0', type: 'W', nodes: ['O', 'N'] });
  const r = E.solveAC({ ground: 'N', elements: els }, { f });
  const Uab = C.abs(C.sub(r.node.nA, r.node.nB));
  put('Трёхфазная симметричная звезда, Uл = 380 В, Zф = 10 Ом',
    'Uл = √3·Uф, Iл = Iф = Uф/Z, P = 3·Uф·Iф·cos φ', [
      chk('Uф, В', C.abs(r.node.nA), Uf),
      chk('Uл, В', Uab, Ul),
      chk('Iф, А', r.elem.ZA.I, Uf / R),
      chk('P трёхфазная, Вт', r.elem.ZA.P + r.elem.ZB.P + r.elem.ZC.P, 3 * Uf * (Uf / R)),
      chk('ток нулевого провода, А', C.abs(C.add(C.add(r.elem.ZA.i, r.elem.ZB.i), r.elem.ZC.i)), 0, 1e-6),
    ]);
}

/* ═══ 17. Трёхфазный треугольник ═══ */
{
  const Ul = 380, R = 20, f = 50, Uf = Ul / Math.sqrt(3);
  const els = [];
  ['A', 'B', 'C'].forEach((p, k) => {
    els.push({ id: 'E' + p, type: 'V', nodes: ['n' + p, 'N'], mag: Uf, ph: -120 * k, f, r: 0 });
  });
  els.push({ id: 'Zab', type: 'R', nodes: ['nA', 'nB'], R });
  els.push({ id: 'Zbc', type: 'R', nodes: ['nB', 'nC'], R });
  els.push({ id: 'Zca', type: 'R', nodes: ['nC', 'nA'], R });
  const r = E.solveAC({ ground: 'N', elements: els }, { f });
  const Ia = C.abs(C.add(r.elem.Zab.i, C.mul(r.elem.Zca.i, { re: -1, im: 0 })));
  put('Трёхфазный треугольник, Uл = 380 В, Zф = 20 Ом',
    'Uф = Uл, Iф = Uл/Z, Iл = √3·Iф, P = 3·Uл·Iф', [
      chk('Iф, А', r.elem.Zab.I, Ul / R),
      chk('Iл, А', Ia, Math.sqrt(3) * Ul / R),
      chk('P трёхфазная, Вт', r.elem.Zab.P + r.elem.Zbc.P + r.elem.Zca.P, 3 * Ul * Ul / R),
    ]);
}

/* ═══ 18. Несимметричная звезда без нулевого провода ═══ */
{
  const Ul = 380, Uf = Ul / Math.sqrt(3), f = 50;
  const Ra = 10, Rb = 20, Rc = 40;
  const UA = C.pol(Uf, 0), UB = C.pol(Uf, -120), UC = C.pol(Uf, 120);
  const Ya = { re: 1 / Ra, im: 0 }, Yb = { re: 1 / Rb, im: 0 }, Yc = { re: 1 / Rc, im: 0 };
  const numr = C.add(C.add(C.mul(UA, Ya), C.mul(UB, Yb)), C.mul(UC, Yc));
  const den = C.add(C.add(Ya, Yb), Yc);
  const U0 = C.div(numr, den);                       // смещение нейтрали
  const Ua = C.sub(UA, U0), Ub = C.sub(UB, U0), Uc = C.sub(UC, U0);
  const els = [
    { id: 'EA', type: 'V', nodes: ['nA', 'N'], mag: Uf, ph: 0, f, r: 0 },
    { id: 'EB', type: 'V', nodes: ['nB', 'N'], mag: Uf, ph: -120, f, r: 0 },
    { id: 'EC', type: 'V', nodes: ['nC', 'N'], mag: Uf, ph: 120, f, r: 0 },
    { id: 'ZA', type: 'R', nodes: ['nA', 'O'], R: Ra },
    { id: 'ZB', type: 'R', nodes: ['nB', 'O'], R: Rb },
    { id: 'ZC', type: 'R', nodes: ['nC', 'O'], R: Rc },
  ];
  const r = E.solveAC({ ground: 'N', elements: els }, { f });
  put('Несимметричная звезда без нулевого провода — смещение нейтрали',
    'U₀ = Σ(U·Y)/ΣY, Uф′ = Uф − U₀ (формула смещения нейтрали)', [
      chk('U смещения нейтрали, В', C.abs(r.node.O), C.abs(U0)),
      chk('Ua, В', r.elem.ZA.U, C.abs(Ua)),
      chk('Ub, В', r.elem.ZB.U, C.abs(Ub)),
      chk('Uc, В', r.elem.ZC.U, C.abs(Uc)),
      chk('Ia, А', r.elem.ZA.I, C.abs(Ua) / Ra),
    ]);
}

/* ═══ 19. Обрыв фазы в звезде без нуля ═══ */
{
  const Ul = 380, Uf = Ul / Math.sqrt(3), f = 50, R = 20;
  // фаза A оборвана: B и C оказываются последовательно под линейным Ubc
  const els = [
    { id: 'EA', type: 'V', nodes: ['nA', 'N'], mag: Uf, ph: 0, f, r: 0 },
    { id: 'EB', type: 'V', nodes: ['nB', 'N'], mag: Uf, ph: -120, f, r: 0 },
    { id: 'EC', type: 'V', nodes: ['nC', 'N'], mag: Uf, ph: 120, f, r: 0 },
    { id: 'ZB', type: 'R', nodes: ['nB', 'O'], R },
    { id: 'ZC', type: 'R', nodes: ['nC', 'O'], R },
  ];
  const r = E.solveAC({ ground: 'N', elements: els }, { f });
  put('Обрыв фазы А в звезде без нулевого провода',
    'две уцелевшие фазы включаются последовательно на линейное напряжение: U = Uл/2 на каждой', [
      chk('Ub, В', r.elem.ZB.U, Ul / 2),
      chk('Uc, В', r.elem.ZC.U, Ul / 2),
      chk('Ib, А', r.elem.ZB.I, Ul / (2 * R)),
    ]);
}

/* ═══ 20. Трансформатор: коэффициент трансформации и нагрузка ═══ */
{
  const n = 10, L1 = 50, L2 = L1 / (n * n), f = 50, U1 = 220, RL = 22;
  const els = [
    { id: 'E1', type: 'V', nodes: ['a', 'g'], mag: U1, f, r: 0 },
    { id: 'W1', type: 'L', nodes: ['a', 'g'], L: L1, r: 0 },
    { id: 'W2', type: 'L', nodes: ['s', 'g'], L: L2, r: 0 },
    { id: 'M1', type: 'MUT', l1: 'W1', l2: 'W2', k: 1 },
    { id: 'RL', type: 'R', nodes: ['s', 'g'], R: RL },
  ];
  const r = E.solveAC({ ground: 'g', elements: els }, { f });
  put('Трансформатор 220/22 В (k = 10) под нагрузкой 22 Ом',
    'U2 = U1/k, I2 = U2/R, I1 ≈ I2/k, P1 = P2 (потери не учитываем)', [
      chk('U2, В', r.elem.RL.U, U1 / n),
      chk('I2, А', r.elem.RL.I, U1 / n / RL),
      chk('I1, А', r.elem.W1.I, U1 / n / RL / n, 0.02),
      chk('P2, Вт', r.elem.RL.P, (U1 / n) * (U1 / n) / RL),
    ]);
}

/* ═══ 21. Однополупериодный выпрямитель ═══ */
{
  const U = 12, f = 50, R = 100;
  const r = E.solveTransient({ ground: 'g', elements: [
    { id: 'E1', type: 'V', nodes: ['a', 'g'], mag: U, f, r: 0.01 },
    { id: 'D1', type: 'D', nodes: ['a', 'b'], Is: 1e-13, N: 1, Rs: 0.05 },
    { id: 'R1', type: 'R', nodes: ['b', 'g'], R },
  ] }, { tEnd: 0.06, h: 1e-6, points: 6000 });
  const Um = U * Math.SQRT2;
  put('Однополупериодный выпрямитель на резистивную нагрузку',
    'Uср ≈ (Um − ΔUд)/π; действующее ≈ Um/2', [
      chk('Uср нагрузки, В', r.rms.R1.Uavg, (Um - 0.75) / Math.PI, 0.05),
      chk('U действующее, В', r.rms.R1.U, Math.sqrt(Math.max(0, (Um - 0.75)) ** 2 / 4), 0.05),
      chk('обратный ток в закрытом состоянии, А', Math.min.apply(null, r.elem.R1.i), 0, 1e-5),
    ]);
}

/* ═══ 22. Мостовой выпрямитель со сглаживанием ═══ */
{
  const U = 12, f = 50, R = 100, Cap = 1000e-6;
  const D = (id, a, b) => ({ id, type: 'D', nodes: [a, b], Is: 1e-13, N: 1, Rs: 0.05 });
  const r = E.solveTransient({ ground: 'g', elements: [
    { id: 'E1', type: 'V', nodes: ['a', 'b'], mag: U, f, r: 0.01 },
    D('D1', 'a', 'p'), D('D2', 'b', 'p'), D('D3', 'g', 'a'), D('D4', 'g', 'b'),
    { id: 'R1', type: 'R', nodes: ['p', 'g'], R },
    { id: 'C1', type: 'C', nodes: ['p', 'g'], C: Cap, v0: 0 },
  ] }, { tEnd: 0.3, h: 2e-6, points: 6000 });
  const Um = U * Math.SQRT2;
  const last = r.elem.R1.u.slice(-200);
  const Umax = Math.max.apply(null, last);
  put('Мостовой выпрямитель с конденсаторным сглаживанием',
    'на холостом ходу конденсатор заряжается почти до амплитуды Um − 2ΔUд; под нагрузкой добавляются пульсации', [
      chk('максимум напряжения на нагрузке, В', Umax, Um - 1.6, 0.06),
      chk('среднее напряжение, В', r.rms.R1.Uavg, Um - 2.2, 0.10),
      chk('пульсации меньше 15 % среднего', (Umax - Math.min.apply(null, last)) / r.rms.R1.Uavg, 0.08, 0.9),
    ]);
}

/* ═══ 23. Лампа накаливания в номинальном режиме ═══ */
{
  const r = E.solveDC({ ground: 'g', elements: [
    { id: 'E1', type: 'V', nodes: ['a', 'g'], dc: 12, r: 0.001 },
    { id: 'H1', type: 'LAMP', nodes: ['a', 'g'], Unom: 12, Pnom: 5 },
  ] });
  put('Лампа 12 В / 5 Вт на номинальном напряжении',
    'в номинале модель нити должна давать ровно паспортные P и I = P/U', [
      chk('P, Вт', Math.abs(r.elem.H1.p), 5),
      chk('I, А', Math.abs(r.elem.H1.i), 5 / 12),
      chk('R горячей нити, Ом', Math.abs(r.elem.H1.u / r.elem.H1.i), 144 / 5),
    ]);
}

/* ═══ 24. Предохранитель и короткое замыкание ═══ */
{
  const r = E.solveDC({ ground: 'g', elements: [
    { id: 'E1', type: 'V', nodes: ['a', 'g'], dc: 12, r: 0.01, imax: 50 },
    { id: 'FU', type: 'V', nodes: ['a', 'b'], dc: 0, r: 0, role: 'fuse', inom: 2, label: 'FU1' },
    { id: 'R1', type: 'R', nodes: ['b', 'g'], R: 2 },
  ] });
  put('Предохранитель на 2 А при нагрузке 2 Ом (ток 6 А)',
    'предохранитель должен сработать и разомкнуть цепь, а решатель — объяснить почему', [
      chk('ток после срабатывания, А', Math.abs(r.elem.R1.i), 0, 1e-6),
      chk('выдано предупреждение о предохранителе', r.warnings.some((w) => w.kind === 'fuse') ? 1 : 0, 1, 1e-9),
    ]);
}

/* ═══ 25. Мощность в трёхфазной цепи с индуктивной нагрузкой ═══ */
{
  const Ul = 380, Uf = Ul / Math.sqrt(3), f = 50, R = 8, L = 0.0191;  // XL ≈ 6 Ом
  const w = 2 * Math.PI * f, XL = w * L, Z = Math.hypot(R, XL);
  const els = [];
  ['A', 'B', 'C'].forEach((p, k) => {
    els.push({ id: 'E' + p, type: 'V', nodes: ['n' + p, 'N'], mag: Uf, ph: -120 * k, f, r: 0 });
    els.push({ id: 'R' + p, type: 'R', nodes: ['n' + p, 'm' + p], R });
    els.push({ id: 'L' + p, type: 'L', nodes: ['m' + p, 'O'], L, r: 0 });
  });
  els.push({ id: 'N0', type: 'W', nodes: ['O', 'N'] });
  const r = E.solveAC({ ground: 'N', elements: els }, { f });
  const I = Uf / Z, cosf = R / Z;
  put('Трёхфазная симметричная звезда с активно-индуктивной нагрузкой',
    'P = √3·Uл·Iл·cos φ, Q = √3·Uл·Iл·sin φ, S = √3·Uл·Iл', [
      chk('Iф, А', r.elem.RA.I, I),
      chk('cos φ', cosf, R / Z),
      chk('P, Вт', r.elem.RA.P * 3, Math.sqrt(3) * Ul * I * cosf),
      chk('Q, вар', r.elem.LA.Q * 3, Math.sqrt(3) * Ul * I * Math.sqrt(1 - cosf * cosf)),
    ]);
}

/* ═══ 26. Реостат как делитель (потенциометр) ═══ */
{
  const Ee = 12, Rtot = 1000, Rload = 1000;
  const ch = [];
  [0.25, 0.5, 0.75].forEach((k) => {
    const Rup = Rtot * (1 - k), Rdn = Rtot * k;
    const r = E.solveDC({ ground: 'g', elements: [
      { id: 'E1', type: 'V', nodes: ['a', 'g'], dc: Ee, r: 0 },
      { id: 'Ru', type: 'R', nodes: ['a', 'w'], R: Rup },
      { id: 'Rd', type: 'R', nodes: ['w', 'g'], R: Rdn },
      { id: 'RL', type: 'R', nodes: ['w', 'g'], R: Rload },
    ] });
    const Rpar = Rdn * Rload / (Rdn + Rload);
    ch.push(chk('U выхода при k=' + k + ', В', r.node.w, Ee * Rpar / (Rup + Rpar)));
  });
  put('Реостат потенциометром с нагрузкой 1 кОм',
    'нагруженный делитель: Uвых = E·(Rн‖Rниз)/(Rверх + Rн‖Rниз) — характеристика перестаёт быть линейной', ch);
}

/* ═══ 27. Двигатель постоянного тока ═══ */
{
  const U = 24, Ra = 2, ke = 0.05, B = 2e-4, T = 0.05;
  const r = E.solveDC({ ground: 'g', elements: [
    { id: 'E1', type: 'V', nodes: ['a', 'g'], dc: U, r: 0 },
    { id: 'M1', type: 'MOTOR', nodes: ['a', 'g'], Ra, ke, B, J: 1e-3, Tload: T },
  ] });
  // установившийся режим: U = I·Ra + ke·ω, ke·I = B·ω + T
  const wman = (U * ke - Ra * T) / (ke * ke + Ra * B);
  const Iman = (B * wman + T) / ke;
  put('Двигатель постоянного тока с моментом нагрузки 0,05 Н·м',
    'U = I·Ra + ke·ω и ke·I = B·ω + Tн — два уравнения, решаемые совместно', [
      chk('ток якоря, А', r.elem.M1.i, Iman),
      chk('частота вращения, рад/с', r.elem.M1.w, wman),
      chk('момент, Н·м', r.elem.M1.M, ke * Iman),
    ]);
}

/* ═══ 28. Законы Кирхгофа на трёх ветвях с проверкой баланса ═══ */
{
  const Ee = 100, R1 = 5, R2 = 10, R3 = 20, R4 = 30, R5 = 15;
  const net = { ground: 'g', elements: [
    { id: 'E1', type: 'V', nodes: ['a', 'g'], dc: Ee, r: 0 },
    { id: 'R1', type: 'R', nodes: ['a', 'b'], R: R1 },
    { id: 'R2', type: 'R', nodes: ['b', 'c'], R: R2 },
    { id: 'R3', type: 'R', nodes: ['b', 'd'], R: R3 },
    { id: 'R4', type: 'R', nodes: ['c', 'g'], R: R4 },
    { id: 'R5', type: 'R', nodes: ['d', 'g'], R: R5 },
  ] };
  const r = E.solveDC(net);
  const Rman = R1 + (R2 + R4) * (R3 + R5) / (R2 + R4 + R3 + R5);
  const Pdis = ['R1', 'R2', 'R3', 'R4', 'R5'].reduce((s, id) => s + r.elem[id].p, 0);
  put('Разветвлённая цепь: первый и второй законы Кирхгофа',
    'узел b: I1 = I2 + I3; свёртка даёт Rвх = R1 + (R2+R4)‖(R3+R5)', [
      chk('Rвх, Ом', Ee / (-r.elem.E1.i), Rman),
      chk('первый закон в узле b, А', r.elem.R1.i - r.elem.R2.i - r.elem.R3.i, 0, 1e-9),
      chk('баланс мощностей, Вт', Pdis, Ee * (-r.elem.E1.i)),
    ]);
}

/* ═══ 29. RLC переходный процесс: колебательный разряд ═══ */
{
  const L = 0.1, Cap = 1e-6, R = 100, U0 = 10;
  const a = R / (2 * L), w0 = 1 / Math.sqrt(L * Cap);
  const wd = Math.sqrt(w0 * w0 - a * a);
  const r = E.solveTransient({ ground: 'g', elements: [
    { id: 'R1', type: 'R', nodes: ['b', 'c'], R },
    { id: 'L1', type: 'L', nodes: ['c', 'g'], L, r: 0 },
    { id: 'C1', type: 'C', nodes: ['b', 'g'], C: Cap, v0: U0 },
  ] }, { tEnd: 0.004, h: 2e-8, points: 8000 });
  const ch = [];
  [0.0005, 0.001, 0.002].forEach((t) => {
    const i = at(r, t);
    const tt = r.t[i];
    const uman = U0 * Math.exp(-a * tt) * (Math.cos(wd * tt) + (a / wd) * Math.sin(wd * tt));
    ch.push(chk('uC(' + (tt * 1000).toFixed(2) + ' мс), В', r.elem.C1.u[i], uman, 0.005));
  });
  ch.push(chk('частота свободных колебаний, Гц', wd / (2 * Math.PI), Math.sqrt(w0 * w0 - a * a) / (2 * Math.PI)));
  put('Колебательный разряд RLC-контура',
    'uC = U0·e^(−αt)(cos ω_св t + (α/ω_св)·sin ω_св t), α = R/2L, ω_св = √(ω₀² − α²)', ch);
}

/* ═══ 30. Падение напряжения в судовом кабеле ═══ */
{
  const U = 220, len = 60, S = 6, rho = 0.0175, I = 25;
  const Rc = 2 * rho * len / S;             // туда и обратно
  const Rload = U / I - Rc;
  const r = E.solveDC({ ground: 'g', elements: [
    { id: 'E1', type: 'V', nodes: ['a', 'g'], dc: U, r: 0 },
    { id: 'Rk1', type: 'R', nodes: ['a', 'b'], R: Rc / 2 },
    { id: 'RL', type: 'R', nodes: ['b', 'c'], R: Rload },
    { id: 'Rk2', type: 'R', nodes: ['c', 'g'], R: Rc / 2 },
  ] });
  const Ical = U / (Rc + Rload);
  put('Падение напряжения в кабеле 2×60 м сечением 6 мм²',
    'Rк = 2ρl/S, ΔU = I·Rк, потери ΔP = I²·Rк', [
      chk('Rкабеля, Ом', Rc, 2 * rho * len / S),
      chk('I, А', -r.elem.E1.i, Ical),
      chk('ΔU, В', U - (r.node.b - r.node.c), Ical * Rc),
      chk('потери в кабеле, Вт', r.elem.Rk1.p + r.elem.Rk2.p, Ical * Ical * Rc),
    ]);
}

process.stdout.write(JSON.stringify(cases, null, 1));
