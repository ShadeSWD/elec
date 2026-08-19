/* solver.js — расчётное ядро электронного конструктора.
 *
 * Своё, без внешних библиотек; один и тот же файл работает в браузере
 * (глобальный объект `Elec`) и в node (`module.exports`) — поэтому тесты
 * гоняют ровно тот код, который считает на странице.
 *
 * Что умеет:
 *   solveDC(net)          — постоянный ток, модифицированный метод узловых
 *                           потенциалов (МНА); нелинейные элементы (диод,
 *                           лампа, двигатель) — методом Ньютона;
 *   solveAC(net, {f})     — установившийся режим синусоидального тока: тот же
 *                           МНА в комплексной форме; действующие значения,
 *                           фазы, P/Q/S/cos φ;
 *   solveTransient(net,…) — переходный процесс: метод трапеций (companion-
 *                           модели C и L), шаг выбирается по наименьшей
 *                           постоянной времени схемы.
 *
 * Система уравнений решается методом Гаусса с выбором главного элемента по
 * столбцу (LU-разложение с частичным поворотом). Разложение переиспользуется
 * между шагами переходного процесса, пока матрица не меняется.
 *
 * ─────────────────── формат сети ───────────────────
 * net = { ground: 'n12'|null, elements: [ … ] }
 * Элемент: { id, type, nodes: ['a','b'], …параметры }
 *   'R'     R                       — резистор, Ом
 *   'C'     C, v0                   — конденсатор, Ф (v0 — начальное напряжение)
 *   'L'     L, r, i0                — катушка, Гн (r — активное обмотки)
 *   'MUT'   l1, l2, k               — магнитная связь двух катушек (по id)
 *   'V'     dc, mag, ph, f, r       — источник ЭДС: постоянная часть, действующее
 *                                     значение переменной, фаза (град), частота,
 *                                     внутреннее сопротивление
 *   'I'     dc, mag, ph, f          — источник тока
 *   'D'     Is, N, Rs               — диод/светодиод (модель Шокли)
 *   'LAMP'  Pnom, Unom              — лампа накаливания (R растёт с нагревом)
 *   'MOTOR' Ra, La, ke, B, J, Tload — двигатель постоянного тока
 *   'SW'    closed                  — выключатель (замкнутый — идеальная перемычка)
 *   'W'                             — провод (узлы просто объединяются)
 *
 * Служебные поля: role:'fuse' + inom — размыкается при перегрузке; imax —
 * порог предупреждения о коротком замыкании.
 *
 * Знаки. Всюду «потребительская» система: ток элемента i — это ток, входящий
 * в первый узел (nodes[0]) и выходящий из второго; напряжение u = V(a) − V(b);
 * мощность p = u·i. У источника, который отдаёт энергию, p < 0.
 */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Elec = api;
}(typeof self !== 'undefined' ? self : this, function () {

  const SQRT2 = Math.SQRT2;
  const VT = 0.025852;          // тепловой потенциал перехода при 27 °C, В
  const GMIN = 1e-12;           // «утечка» каждого узла на землю: страхует от
                                // вырожденной матрицы у висящих в воздухе кусков

  /* ══════════════════ 1. Линейная алгебра ══════════════════ */

  /* LU-разложение вещественной матрицы с выбором главного элемента по столбцу.
     A — массив строк, портится на месте. piv[i] — номер исходной строки,
     оказавшейся на месте i (по нему переставляется правая часть). */
  function luReal(A, n) {
    const piv = new Int32Array(n);
    for (let i = 0; i < n; i++) piv[i] = i;
    for (let k = 0; k < n; k++) {
      let p = k, best = Math.abs(A[k][k]);
      for (let i = k + 1; i < n; i++) {
        const v = Math.abs(A[i][k]);
        if (v > best) { best = v; p = i; }
      }
      if (!(best > 1e-13)) return null;            // вырождена
      if (p !== k) {
        const t = A[p]; A[p] = A[k]; A[k] = t;
        const q = piv[p]; piv[p] = piv[k]; piv[k] = q;
      }
      const d = A[k][k];
      for (let i = k + 1; i < n; i++) {
        const f = A[i][k] / d;
        A[i][k] = f;
        if (f !== 0) {
          const Ai = A[i], Ak = A[k];
          for (let j = k + 1; j < n; j++) Ai[j] -= f * Ak[j];
        }
      }
    }
    return { A, piv, n };
  }

  function luSolveReal(f, b) {
    const A = f.A, piv = f.piv, n = f.n, x = new Float64Array(n);
    for (let i = 0; i < n; i++) x[i] = b[piv[i]];
    for (let i = 1; i < n; i++) {
      let s = x[i]; const Ai = A[i];
      for (let j = 0; j < i; j++) s -= Ai[j] * x[j];
      x[i] = s;
    }
    for (let i = n - 1; i >= 0; i--) {
      let s = x[i]; const Ai = A[i];
      for (let j = i + 1; j < n; j++) s -= Ai[j] * x[j];
      x[i] = s / Ai[i];
    }
    return x;
  }

  /* То же для комплексной матрицы. Вещественная и мнимая части хранятся
     отдельными массивами строк — так не нужен объект комплексного числа
     в самом горячем цикле. */
  function luCplx(Ar, Ai, n) {
    const piv = new Int32Array(n);
    for (let i = 0; i < n; i++) piv[i] = i;
    for (let k = 0; k < n; k++) {
      let p = k, best = Math.hypot(Ar[k][k], Ai[k][k]);
      for (let i = k + 1; i < n; i++) {
        const v = Math.hypot(Ar[i][k], Ai[i][k]);
        if (v > best) { best = v; p = i; }
      }
      if (!(best > 1e-13)) return null;
      if (p !== k) {
        let t = Ar[p]; Ar[p] = Ar[k]; Ar[k] = t;
        t = Ai[p]; Ai[p] = Ai[k]; Ai[k] = t;
        const q = piv[p]; piv[p] = piv[k]; piv[k] = q;
      }
      const dr = Ar[k][k], di = Ai[k][k], dd = dr * dr + di * di;
      for (let i = k + 1; i < n; i++) {
        const nr = Ar[i][k], ni = Ai[i][k];
        const fr = (nr * dr + ni * di) / dd;
        const fi = (ni * dr - nr * di) / dd;
        Ar[i][k] = fr; Ai[i][k] = fi;
        if (fr !== 0 || fi !== 0) {
          for (let j = k + 1; j < n; j++) {
            Ar[i][j] -= fr * Ar[k][j] - fi * Ai[k][j];
            Ai[i][j] -= fr * Ai[k][j] + fi * Ar[k][j];
          }
        }
      }
    }
    return { Ar, Ai, piv, n };
  }

  function luSolveCplx(f, br, bi) {
    const Ar = f.Ar, Ai = f.Ai, piv = f.piv, n = f.n;
    const xr = new Float64Array(n), xi = new Float64Array(n);
    for (let i = 0; i < n; i++) { xr[i] = br[piv[i]]; xi[i] = bi[piv[i]]; }
    for (let i = 1; i < n; i++) {
      let sr = xr[i], si = xi[i];
      for (let j = 0; j < i; j++) {
        sr -= Ar[i][j] * xr[j] - Ai[i][j] * xi[j];
        si -= Ar[i][j] * xi[j] + Ai[i][j] * xr[j];
      }
      xr[i] = sr; xi[i] = si;
    }
    for (let i = n - 1; i >= 0; i--) {
      let sr = xr[i], si = xi[i];
      for (let j = i + 1; j < n; j++) {
        sr -= Ar[i][j] * xr[j] - Ai[i][j] * xi[j];
        si -= Ar[i][j] * xi[j] + Ai[i][j] * xr[j];
      }
      const dr = Ar[i][i], di = Ai[i][i], dd = dr * dr + di * di;
      xr[i] = (sr * dr + si * di) / dd;
      xi[i] = (si * dr - sr * di) / dd;
    }
    return { re: xr, im: xi };
  }

  /* ══════════════════ 2. Модели нелинейных элементов ══════════════════ */

  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);

  /* Лампа накаливания.
     Честная модель нити — тепловой баланс с излучением; для учебной задачи
     берём проверенную инженерную аппроксимацию вольфрама: ток растёт примерно
     как U^0,55, значит R = U/I ∝ U^0,45. Ниже холодного сопротивления
     (≈ 1/13 номинального) не опускаемся. Это упрощение, но качественная
     картина верная: лампа мягко ограничивает ток и берёт бросок в холодном
     состоянии. */
  function lampR(el, u) {
    const Un = num(el.Unom, 12), Pn = Math.max(num(el.Pnom, 5), 1e-6);
    const Rn = Un * Un / Pn;
    const Rcold = Rn / num(el.coldRatio, 13);
    const a = Math.abs(u) / Un;
    if (!(a > 0)) return Rcold;
    return Math.max(Rcold, Rn * Math.pow(a, 0.45));
  }

  /* Ограничение напряжения на p-n переходе между итерациями Ньютона
     (классический pnjlim): не даёт экспоненте улететь на первых шагах. */
  function diodeLim(vnew, vold, vt) {
    const vcrit = vt * Math.log(vt / Math.SQRT2 / 1e-14);
    if (vnew > vcrit && Math.abs(vnew - vold) > 2 * vt) {
      if (vold > 0) {
        const arg = 1 + (vnew - vold) / vt;
        vnew = arg > 0 ? vold + vt * Math.log(arg) : vcrit;
      } else vnew = vt * Math.log(Math.max(vnew, vt) / vt);
    }
    return Math.max(-60 * vt, Math.min(vnew, 5));
  }

  /* ══════════════════ 3. Разбор сети ══════════════════ */

  const hasNodes = (e) => Array.isArray(e.nodes) && e.nodes.length >= 2;
  /* Ток как отдельная неизвестная нужен элементам, у которых задано
     напряжение: источникам ЭДС (в том числе «нулевым» — амперметрам,
     предохранителям, ваттметрам), катушкам и якорю двигателя. */
  const needsBranch = (t) => t === 'V' || t === 'L' || t === 'MOTOR';

  function compile(net) {
    const src = (net.elements || []).filter(Boolean);
    const els = [];
    const auxNodes = {};
    let autoNode = 0;

    // Диод с последовательным сопротивлением получает внутренний узел —
    // модель остаётся точной, а матрица устойчивой.
    src.forEach((e0) => {
      let e = e0;
      if (e.type === 'D' && num(e.Rs, 0) > 0) {
        const mid = 'rs' + (autoNode++);
        auxNodes[mid] = 1;
        els.push({ id: e.id + 'rs', type: 'R', nodes: [mid, e.nodes[1]], R: e.Rs, aux: true });
        e = Object.assign({}, e, { nodes: [e.nodes[0], mid] });
      }
      els.push(e);
    });

    // объединяем узлы проводами и замкнутыми выключателями
    const parent = {};
    const find = (x) => {
      while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
      return x;
    };
    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
    els.forEach((e) => { if (hasNodes(e)) e.nodes.forEach((n) => { if (!(n in parent)) parent[n] = n; }); });
    if (net.ground && !(net.ground in parent)) parent[net.ground] = net.ground;
    els.forEach((e) => {
      if (!hasNodes(e)) return;
      if (e.type === 'W' || (e.type === 'SW' && e.closed)) union(e.nodes[0], e.nodes[1]);
    });

    // земля: явная, иначе «минус» первого источника, иначе первый узел
    let gnd = net.ground;
    if (!gnd) {
      const s = els.find((e) => e.type === 'V' && hasNodes(e) && (num(e.dc, 0) || num(e.mag, 0)));
      const any = els.find(hasNodes);
      gnd = s ? s.nodes[1] : (any ? any.nodes[1] : null);
    }
    const gRoot = gnd ? find(gnd) : null;

    const idx = {};                 // корень узла → номер неизвестной
    let n = 0;
    Object.keys(parent).forEach((k) => {
      const r = find(k);
      if (r === gRoot) return;
      if (!(r in idx)) idx[r] = n++;
    });
    const nodeIdx = (name) => {
      const r = find(name);
      return r === gRoot ? -1 : idx[r];
    };

    const live = els.filter((e) => e.type !== 'W' && e.type !== 'SW');
    const br = {};
    let m = 0;
    live.forEach((e) => { if (needsBranch(e.type) && hasNodes(e)) br[e.id] = n + (m++); });
    // у двигателя, кроме тока якоря, неизвестна и угловая скорость: уравнение
    // механики (момент = нагрузка + трение) входит в ту же систему, поэтому
    // электрическая и механическая части решаются совместно, а не итерациями
    const mw = {};
    live.forEach((e) => { if (e.type === 'MOTOR' && hasNodes(e)) mw[e.id] = n + (m++); });

    // магнитные связи: для каждой катушки — список партнёров и M
    const mut = {};
    live.forEach((e) => {
      if (e.type !== 'MUT') return;
      const e1 = live.find((x) => x.id === e.l1), e2 = live.find((x) => x.id === e.l2);
      if (!e1 || !e2) return;
      const M = num(e.k, 0.99) * Math.sqrt(Math.abs(num(e1.L, 1) * num(e2.L, 1)));
      (mut[e1.id] = mut[e1.id] || []).push({ other: e2.id, M });
      (mut[e2.id] = mut[e2.id] || []).push({ other: e1.id, M });
    });

    const nodeMap = {};
    Object.keys(parent).forEach((k) => { if (!auxNodes[k]) nodeMap[k] = nodeIdx(k); });

    return { els: live, n, m, size: n + m, br, mw, mut, nodeIdx, nodeMap, ground: gnd };
  }

  /* ══════════════════ 4. Вещественная сборка (постоянный ток и шаг во времени) ══════════════════ */

  function srcValue(e, mode, tNow) {
    let val = num(e.dc, 0);
    if (mode === 'tran' && num(e.mag, 0)) {
      const w = 2 * Math.PI * num(e.f, 50);
      val += num(e.mag, 0) * SQRT2 * Math.sin(w * tNow + num(e.ph, 0) * Math.PI / 180);
    }
    return val;
  }

  /* mode: 'dc' | 'tran'.  st — состояние нелинейных и реактивных элементов. */
  function assembleReal(cx, st, mode, h, tNow) {
    const N = cx.size;
    const A = [];
    for (let i = 0; i < N; i++) A.push(new Float64Array(N));
    const b = new Float64Array(N);

    const G = (a, p, g) => {
      if (a >= 0) A[a][a] += g;
      if (p >= 0) A[p][p] += g;
      if (a >= 0 && p >= 0) { A[a][p] -= g; A[p][a] -= g; }
    };
    const Isrc = (a, p, i) => {            // ток i течёт внутри элемента a → b
      if (a >= 0) b[a] -= i;
      if (p >= 0) b[p] += i;
    };
    const branch = (k, a, p, coef, rhs) => {   // V(a) − V(b) + coef·i = rhs
      if (a >= 0) { A[k][a] += 1; A[a][k] += 1; }
      if (p >= 0) { A[k][p] -= 1; A[p][k] -= 1; }
      A[k][k] += coef;
      b[k] += rhs;
    };

    for (let i = 0; i < cx.n; i++) A[i][i] += GMIN;

    cx.els.forEach((e) => {
      if (!hasNodes(e)) return;
      const a = cx.nodeIdx(e.nodes[0]), p = cx.nodeIdx(e.nodes[1]);
      const s = st[e.id] || (st[e.id] = {});
      switch (e.type) {
        case 'R':
          G(a, p, 1 / Math.max(num(e.R, 1), 1e-9));
          break;
        case 'LAMP':
          G(a, p, 1 / lampR(e, num(s.u, 0)));
          break;
        case 'D': {
          const vt = VT * num(e.N, 1);
          const v = num(s.v, 0);
          const Is = num(e.Is, 1e-13);
          const ex = Math.exp(Math.min(v / vt, 80));
          const id = Is * (ex - 1);
          const gd = Math.max(Is * ex / vt, 1e-12);
          G(a, p, gd);
          Isrc(a, p, id - gd * v);
          break;
        }
        case 'C': {
          if (mode === 'dc') break;                     // на постоянном токе — разрыв
          const C = Math.max(num(e.C, 1e-6), 1e-15);
          const geq = 2 * C / h;
          G(a, p, geq);
          Isrc(a, p, -(geq * num(s.uPrev, 0) + num(s.iPrev, 0)));
          break;
        }
        case 'L': {
          const k = cx.br[e.id];
          const r = num(e.r, 0);
          if (mode === 'dc') { branch(k, a, p, -r, 0); break; }
          const L = Math.max(num(e.L, 1e-3), 1e-12);
          let rhs = -(2 * L / h) * num(s.iPrev, 0) - num(s.vL, 0);
          branch(k, a, p, -(r + 2 * L / h), rhs);
          (cx.mut[e.id] || []).forEach((mm) => {
            const k2 = cx.br[mm.other];
            if (k2 === undefined) return;
            A[k][k2] -= 2 * mm.M / h;
            b[k] -= (2 * mm.M / h) * num((st[mm.other] || {}).iPrev, 0);
          });
          break;
        }
        case 'V':
          branch(cx.br[e.id], a, p, -num(e.r, 0), srcValue(e, mode, tNow));
          break;
        case 'I':
          Isrc(a, p, srcValue(e, mode, tNow));
          break;
        case 'MOTOR': {
          // якорь: V(a) − V(b) = Ra·i + La·di/dt + ke·ω
          // механика: J·dω/dt = ke·i − B·ω − Tн
          const k = cx.br[e.id], kw = cx.mw[e.id];
          const Ra = Math.max(num(e.Ra, 1), 1e-4);
          const ke = num(e.ke, 0.05);
          const B = Math.max(num(e.B, 1e-4), 1e-7);
          const La = num(e.La, 0);
          const coef = (mode === 'tran' && La > 0) ? -(Ra + 2 * La / h) : -Ra;
          let rhs = 0;
          if (mode === 'tran' && La > 0) rhs += -(2 * La / h) * num(s.iPrev, 0) - num(s.vL, 0);
          branch(k, a, p, coef, rhs);
          A[k][kw] -= ke;
          A[kw][k] += ke;
          if (mode === 'tran') {
            const J = Math.max(num(e.J, 1e-3), 1e-7);
            A[kw][kw] -= B + J / h;
            b[kw] += num(e.Tload, 0) - (J / h) * num(s.wPrev, 0);
          } else {
            A[kw][kw] -= B;
            b[kw] += num(e.Tload, 0);
          }
          break;
        }
        default: break;
      }
    });

    return { A, b, N };
  }

  /* Разложить решение по элементам и обновить состояние реактивных. */
  function readState(cx, x, st, mode, h) {
    const cur = (id) => (cx.br[id] !== undefined ? x[cx.br[id]] : 0);
    cx.els.forEach((e) => {
      if (!hasNodes(e)) return;
      const a = cx.nodeIdx(e.nodes[0]), p = cx.nodeIdx(e.nodes[1]);
      const u = (a >= 0 ? x[a] : 0) - (p >= 0 ? x[p] : 0);
      const s = st[e.id] || (st[e.id] = {});
      s.u = u;
      switch (e.type) {
        case 'R': s.i = u / Math.max(num(e.R, 1), 1e-9); break;
        case 'LAMP': s.i = u / lampR(e, u); break;
        case 'D': {
          const vt = VT * num(e.N, 1);
          s.v = u;
          s.i = num(e.Is, 1e-13) * (Math.exp(Math.min(u / vt, 80)) - 1);
          break;
        }
        case 'C': {
          if (mode === 'tran') {
            const geq = 2 * Math.max(num(e.C, 1e-6), 1e-15) / h;
            s.i = geq * (u - num(s.uPrev, 0)) - num(s.iPrev, 0);
          } else s.i = 0;
          break;
        }
        case 'L': {
          const i = cur(e.id);
          if (mode === 'tran') {
            const L = Math.max(num(e.L, 1e-3), 1e-12);
            let v = (2 * L / h) * (i - num(s.iPrev, 0));
            (cx.mut[e.id] || []).forEach((mm) => {
              v += (2 * mm.M / h) * (cur(mm.other) - num((st[mm.other] || {}).iPrev, 0));
            });
            s.vL = v - num(s.vL, 0);
          }
          s.i = i;
          break;
        }
        case 'MOTOR': {
          const i = cur(e.id);
          const La = num(e.La, 0);
          if (mode === 'tran' && La > 0) s.vL = (2 * La / h) * (i - num(s.iPrev, 0)) - num(s.vL, 0);
          s.i = i;
          s.w = cx.mw[e.id] !== undefined ? x[cx.mw[e.id]] : 0;
          s.M = num(e.ke, 0.05) * i;
          s.n = s.w * 60 / (2 * Math.PI);           // об/мин
          break;
        }
        case 'V': s.i = cur(e.id); break;
        case 'I': s.i = srcValue(e, mode, 0); break;
        default: s.i = 0; break;
      }
      s.p = s.u * s.i;
    });
  }

  /* Метод Ньютона по нелинейным элементам. */
  function newton(cx, st, mode, h, tNow, opts) {
    const maxIt = (opts && opts.maxIter) || 300;
    const hasNL = cx.els.some((e) => e.type === 'D' || e.type === 'LAMP');
    let x = null, prev = null, it = 0, conv = !hasNL, fail = null;
    for (it = 1; it <= (hasNL ? maxIt : 1); it++) {
      const built = assembleReal(cx, st, mode, h, tNow);
      const f = luReal(built.A, built.N);
      if (!f) { fail = 'вырожденная матрица'; break; }
      x = luSolveReal(f, built.b);
      let dmax = 0;
      cx.els.forEach((e) => {
        if (!hasNodes(e)) return;
        const a = cx.nodeIdx(e.nodes[0]), p = cx.nodeIdx(e.nodes[1]);
        const u = (a >= 0 ? x[a] : 0) - (p >= 0 ? x[p] : 0);
        const s = st[e.id] || (st[e.id] = {});
        if (e.type === 'D') {
          const vt = VT * num(e.N, 1);
          const vn = diodeLim(u, num(s.v, 0), vt);
          dmax = Math.max(dmax, Math.abs(vn - num(s.v, 0)));
          s.v = vn;
        } else if (e.type === 'LAMP') {
          const un = num(s.u, 0) + 0.6 * (u - num(s.u, 0));   // демпфирование
          dmax = Math.max(dmax, Math.abs(un - num(s.u, 0)));
          s.u = un;
        }
      });
      if (prev) {
        let d = 0;
        for (let i = 0; i < x.length; i++) d = Math.max(d, Math.abs(x[i] - prev[i]));
        if (d < 1e-8 && dmax < 1e-7) { conv = true; break; }
      }
      prev = Float64Array.from(x);
    }
    return { x, iterations: it, converged: conv, fail };
  }

  /* Проверка режима: перегрев ламп, перегрузка предохранителей, КЗ.
     Возвращает список id, которые «сгорели» и должны быть разомкнуты. */
  function audit(els, get, warnings) {
    const dead = [];
    els.forEach((e) => {
      const r = get(e.id);
      if (!r) return;
      const i = Math.abs(num(r.i, 0)), p = Math.abs(num(r.p, num(r.u, 0) * num(r.i, 0)));
      if (e.type === 'LAMP') {
        const lim = num(e.Pnom, 5) * num(e.burnRatio, 1.7);
        if (p > lim) {
          dead.push(e.id);
          warnings.push({ id: e.id, kind: 'burn', text: 'Лампа ' + (e.label || e.id) + ' перегорела: на ней '
            + p.toFixed(1) + ' Вт при номинале ' + num(e.Pnom, 5) + ' Вт. Нить не успевает отдавать тепло — вольфрам плавится.' });
        }
      }
      if (e.role === 'fuse' && i > num(e.inom, 5)) {
        dead.push(e.id);
        warnings.push({ id: e.id, kind: 'fuse', text: 'Предохранитель ' + (e.label || e.id) + ' сработал: ток '
          + i.toFixed(2) + ' А при номинале ' + num(e.inom, 5) + ' А. Цепь разомкнута — это и есть его работа.' });
      }
      if (e.type === 'V' && !e.role && num(e.imax, 0) > 0 && i > num(e.imax, 0)) {
        warnings.push({ id: e.id, kind: 'short', text: 'Через источник ' + (e.label || e.id) + ' идёт '
          + i.toFixed(1) + ' А — это короткое замыкание: сопротивление нагрузки почти нулевое.' });
      }
    });
    return dead;
  }

  /* ══════════════════ 5. Постоянный ток ══════════════════ */

  function solveDC(net, opts) {
    opts = opts || {};
    const res = { mode: 'dc', ok: false, warnings: [], node: {}, elem: {}, dead: {}, iterations: 0 };
    const all = (net.elements || []).filter(Boolean);
    const dead = Object.assign({}, opts.dead || {});
    for (let pass = 0; pass < 4; pass++) {
      const els = all.filter((e) => !dead[e.id]);
      const cx = compile({ elements: els, ground: net.ground });
      const st = {};
      if (!cx.size) { res.ok = true; res.dead = dead; return res; }
      const r = newton(cx, st, 'dc', 0, 0, opts);
      res.iterations = r.iterations;
      if (!r.x) {
        res.warnings.push({ kind: 'singular', text: 'Схема не решается: ' + (r.fail || 'нет решения')
          + '. Обычно так выглядит идеальный источник, замкнутый накоротко идеальным проводом — добавьте хоть какое-нибудь сопротивление.' });
        res.dead = dead;
        return res;
      }
      readState(cx, r.x, st, 'dc', 0);
      res.node = {};
      Object.keys(cx.nodeMap).forEach((k) => { res.node[k] = cx.nodeMap[k] >= 0 ? r.x[cx.nodeMap[k]] : 0; });
      res.elem = {};
      cx.els.forEach((e) => {
        if (e.aux || !hasNodes(e)) return;
        const s = st[e.id] || {};
        res.elem[e.id] = { u: num(s.u, 0), i: num(s.i, 0), p: num(s.u, 0) * num(s.i, 0),
                           w: s.w, n: s.n, M: s.M };
      });
      all.forEach((e) => { if (dead[e.id]) res.elem[e.id] = { u: 0, i: 0, p: 0, dead: true }; });
      res.converged = r.converged;
      const w0 = res.warnings.length;
      const blown = audit(els, (id) => res.elem[id], res.warnings);
      blown.forEach((id) => { dead[id] = true; });
      res.ok = true;
      if (!blown.length) {
        if (!r.converged) res.warnings.push({ kind: 'converge', text: 'Расчёт не сошёлся за отведённое число итераций — проверьте параметры нелинейных элементов.' });
        break;
      }
      // сгоревшее убираем и считаем заново; предупреждения от прошлого прохода
      // о коротком замыкании больше не актуальны
      res.warnings = res.warnings.slice(0, w0).concat(res.warnings.slice(w0).filter((x) => x.kind !== 'short'));
    }
    res.dead = dead;
    return res;
  }

  /* ══════════════════ 6. Переменный ток: комплексный МНА ══════════════════ */

  function solveAC(net, opts) {
    opts = opts || {};
    const f = num(opts.f, 0) || (function () {
      const s = (net.elements || []).find((e) => e && (e.type === 'V' || e.type === 'I') && num(e.mag, 0));
      return s ? num(s.f, 50) : 50;
    }());
    const w = 2 * Math.PI * f;
    const dead = opts.dead || {};
    const cx = compile({ elements: (net.elements || []).filter((e) => e && !dead[e.id]), ground: net.ground });
    const res = { mode: 'ac', ok: false, f, w, warnings: [], node: {}, elem: {} };
    if (!cx.size) { res.ok = true; return res; }
    if (cx.els.some((e) => e.type === 'D')) {
      res.warnings.push({ kind: 'nonlinear', text: 'В схеме есть диод: комплексный расчёт установившегося режима для него не годится — ток получается несинусоидальным. Включите осциллограф, там считается переходный процесс.' });
    }
    const N = cx.size;
    const Ar = [], Ai = [];
    for (let i = 0; i < N; i++) { Ar.push(new Float64Array(N)); Ai.push(new Float64Array(N)); }
    const br = new Float64Array(N), bi = new Float64Array(N);

    const Y = (a, p, gr, gi) => {
      if (a >= 0) { Ar[a][a] += gr; Ai[a][a] += gi; }
      if (p >= 0) { Ar[p][p] += gr; Ai[p][p] += gi; }
      if (a >= 0 && p >= 0) {
        Ar[a][p] -= gr; Ai[a][p] -= gi;
        Ar[p][a] -= gr; Ai[p][a] -= gi;
      }
    };
    const branch = (k, a, p, cr, ci, vr, vi) => {
      if (a >= 0) { Ar[k][a] += 1; Ar[a][k] += 1; }
      if (p >= 0) { Ar[k][p] -= 1; Ar[p][k] -= 1; }
      Ar[k][k] += cr; Ai[k][k] += ci;
      br[k] += vr; bi[k] += vi;
    };
    for (let i = 0; i < cx.n; i++) Ar[i][i] += GMIN;

    cx.els.forEach((e) => {
      if (!hasNodes(e)) return;
      const a = cx.nodeIdx(e.nodes[0]), p = cx.nodeIdx(e.nodes[1]);
      switch (e.type) {
        case 'R': Y(a, p, 1 / Math.max(num(e.R, 1), 1e-9), 0); break;
        case 'LAMP': Y(a, p, 1 / lampR(e, num(e.Unom, 12)), 0); break;
        case 'C': Y(a, p, 0, w * Math.max(num(e.C, 1e-6), 1e-15)); break;
        case 'D': Y(a, p, 1 / Math.max(num(e.Rs, 0.05), 1e-3), 0); break;
        case 'L': {
          const k = cx.br[e.id];
          branch(k, a, p, -num(e.r, 0), -w * num(e.L, 1e-3), 0, 0);
          (cx.mut[e.id] || []).forEach((mm) => {
            const k2 = cx.br[mm.other];
            if (k2 !== undefined) Ai[k][k2] -= w * mm.M;
          });
          break;
        }
        case 'MOTOR':
          // на переменном токе машину постоянного тока считаем просто
          // сопротивлением якоря с индуктивностью; механику не решаем
          branch(cx.br[e.id], a, p, -num(e.Ra, 1), -w * num(e.La, 0), 0, 0);
          if (cx.mw[e.id] !== undefined) Ar[cx.mw[e.id]][cx.mw[e.id]] += 1;
          break;
        case 'V': {
          const m = num(e.mag, 0), ph = num(e.ph, 0) * Math.PI / 180;
          branch(cx.br[e.id], a, p, -num(e.r, 0), 0, m * Math.cos(ph), m * Math.sin(ph));
          break;
        }
        case 'I': {
          const m = num(e.mag, 0), ph = num(e.ph, 0) * Math.PI / 180;
          const ir = m * Math.cos(ph), ii = m * Math.sin(ph);
          if (a >= 0) { br[a] -= ir; bi[a] -= ii; }
          if (p >= 0) { br[p] += ir; bi[p] += ii; }
          break;
        }
        default: break;
      }
    });

    const fac = luCplx(Ar, Ai, N);
    if (!fac) {
      res.warnings.push({ kind: 'singular', text: 'Схема не решается в комплексной форме — вероятно, идеальный источник замкнут накоротко.' });
      return res;
    }
    const x = luSolveCplx(fac, br, bi);
    res.ok = true;
    Object.keys(cx.nodeMap).forEach((k) => {
      const i = cx.nodeMap[k];
      res.node[k] = i >= 0 ? { re: x.re[i], im: x.im[i] } : { re: 0, im: 0 };
    });
    cx.els.forEach((e) => {
      if (e.aux || !hasNodes(e)) return;
      const a = cx.nodeIdx(e.nodes[0]), p = cx.nodeIdx(e.nodes[1]);
      const ur = (a >= 0 ? x.re[a] : 0) - (p >= 0 ? x.re[p] : 0);
      const ui = (a >= 0 ? x.im[a] : 0) - (p >= 0 ? x.im[p] : 0);
      let ir = 0, ii = 0;
      if (cx.br[e.id] !== undefined) { ir = x.re[cx.br[e.id]]; ii = x.im[cx.br[e.id]]; }
      else if (e.type === 'R') { const g = 1 / Math.max(num(e.R, 1), 1e-9); ir = ur * g; ii = ui * g; }
      else if (e.type === 'LAMP') { const g = 1 / lampR(e, num(e.Unom, 12)); ir = ur * g; ii = ui * g; }
      else if (e.type === 'C') { const bC = w * Math.max(num(e.C, 1e-6), 1e-15); ir = -ui * bC; ii = ur * bC; }
      else if (e.type === 'D') { const g = 1 / Math.max(num(e.Rs, 0.05), 1e-3); ir = ur * g; ii = ui * g; }
      else if (e.type === 'I') { const m = num(e.mag, 0), ph = num(e.ph, 0) * Math.PI / 180; ir = m * Math.cos(ph); ii = m * Math.sin(ph); }
      const P = ur * ir + ui * ii;              // Re(U · conj(I))
      const Q = ui * ir - ur * ii;              // Im(U · conj(I))
      const U = Math.hypot(ur, ui), I = Math.hypot(ir, ii);
      res.elem[e.id] = {
        U, I, S: U * I, P, Q,
        pf: U * I > 1e-12 ? P / (U * I) : 1,
        phU: Math.atan2(ui, ur) * 180 / Math.PI,
        phI: Math.atan2(ii, ir) * 180 / Math.PI,
        dphi: Math.atan2(ui, ur) * 180 / Math.PI - Math.atan2(ii, ir) * 180 / Math.PI,
        u: { re: ur, im: ui }, i: { re: ir, im: ii },
      };
    });
    audit(cx.els, (id) => {
      const r = res.elem[id];
      return r ? { i: r.I, u: r.U, p: Math.abs(r.P) } : null;
    }, res.warnings);
    return res;
  }

  /* ══════════════════ 7. Переходный процесс ══════════════════ */

  /* Постоянные времени схемы — по ним выбирается шаг. Оценка грубая
     (RC и L/R по «характерному» сопротивлению), её задача — не дать шагу
     проскочить фронт заряда. */
  function timeScale(net) {
    const els = (net.elements || []).filter(Boolean);
    const Rs = els.filter((e) => e.type === 'R').map((e) => num(e.R, 1)).filter((r) => r > 0);
    const Rtyp = Rs.length ? Rs.reduce((a, b) => a + b, 0) / Rs.length : 100;
    let tmin = Infinity, tmax = 0;
    els.forEach((e) => {
      let t = 0;
      if (e.type === 'C') t = Math.max(num(e.C, 1e-6), 1e-15) * Rtyp;
      else if (e.type === 'L') t = Math.max(num(e.L, 1e-3), 1e-12) / Math.max(Rtyp, 1e-3);
      if (t > 0) { tmin = Math.min(tmin, t); tmax = Math.max(tmax, t); }
    });
    if (!isFinite(tmin)) { tmin = 0; tmax = 0; }
    return { tau: tmin, tauMax: tmax, Rtyp };
  }

  /* opts: {tEnd, h, points, ic:'zero'|'dc', dead} */
  function solveTransient(net, opts) {
    opts = opts || {};
    const dead = Object.assign({}, opts.dead || {});
    const all = (net.elements || []).filter(Boolean);
    let res = null;
    for (let pass = 0; pass < 3; pass++) {
      res = runTransient({ elements: all.filter((e) => !dead[e.id]), ground: net.ground }, opts, dead);
      if (!res.ok) break;
      const blown = audit(all.filter((e) => !dead[e.id]),
        (id) => (res.rms[id] ? { i: res.rms[id].I, u: res.rms[id].U, p: Math.abs(res.rms[id].P) } : null),
        res.warnings);
      if (!blown.length) break;
      blown.forEach((id) => { dead[id] = true; });
    }
    res.dead = dead;
    return res;
  }

  function runTransient(net, opts, dead) {
    const cx = compile(net);
    const ts = timeScale(net);
    const freqs = (net.elements || []).filter((e) => (e.type === 'V' || e.type === 'I') && num(e.mag, 0))
      .map((e) => num(e.f, 50)).filter((v) => v > 0);
    const fmax = freqs.length ? Math.max.apply(null, freqs) : 0;
    let tEnd = num(opts.tEnd, 0);
    if (!tEnd) {
      tEnd = ts.tauMax > 0 ? 5 * ts.tauMax : 0.1;
      if (fmax > 0) tEnd = Math.max(tEnd, 4 / fmax);
    }
    let h = num(opts.h, 0);
    if (!h) {
      h = tEnd / 2000;
      if (ts.tau > 0) h = Math.min(h, ts.tau / 50);
      if (fmax > 0) h = Math.min(h, 1 / (fmax * 400));
    }
    let steps = Math.ceil(tEnd / h);
    if (steps > 400000) { steps = 400000; h = tEnd / steps; }

    const res = { mode: 'tran', ok: false, h, tEnd, warnings: [], t: [], node: {}, elem: {}, rms: {} };
    if (!cx.size) { res.ok = true; return res; }

    const st = {};
    if (opts.ic === 'dc') {
      // установившийся режим до коммутации: конденсаторы — разрыв, катушки — провод
      const dcRes = solveDC({ elements: (net.elements || []), ground: net.ground });
      (net.elements || []).forEach((e) => {
        if (e.type === 'L') st[e.id] = { i: num(dcRes.elem[e.id] && dcRes.elem[e.id].i, 0), vL: 0 };
        if (e.type === 'C') st[e.id] = { u: num(dcRes.elem[e.id] && dcRes.elem[e.id].u, 0), i: 0 };
      });
    }
    (net.elements || []).forEach((e) => {
      if (e.type === 'C' && !st[e.id]) st[e.id] = { u: num(e.v0, 0), i: 0 };
      if (e.type === 'L' && !st[e.id]) st[e.id] = { i: num(e.i0, 0), vL: 0 };
      if (e.type === 'MOTOR') st[e.id] = { w: num(e.w0, 0), i: 0, vL: 0 };
    });

    const keep = Math.max(1, Math.ceil(steps / (num(opts.points, 0) || 2000)));
    Object.keys(cx.nodeMap).forEach((k) => { res.node[k] = []; });
    cx.els.forEach((e) => { if (!e.aux && hasNodes(e)) res.elem[e.id] = { u: [], i: [], w: [] }; });

    let fac = null;
    const linear = !cx.els.some((e) => e.type === 'D' || e.type === 'LAMP');

    for (let k = 0; k <= steps; k++) {
      const tNow = k * h;
      cx.els.forEach((e) => {
        const s = st[e.id] || (st[e.id] = {});
        s.uPrev = num(s.u, 0);
        s.iPrev = num(s.i, 0);
        if (e.type === 'MOTOR') s.wPrev = num(s.w, 0);
      });
      let x;
      if (linear) {
        const built = assembleReal(cx, st, 'tran', h, tNow);
        if (!fac) {
          fac = luReal(built.A, built.N);
          if (!fac) {
            res.warnings.push({ kind: 'singular', text: 'Схема не решается: вероятно, идеальный источник замкнут накоротко.' });
            return res;
          }
        }
        x = luSolveReal(fac, built.b);
      } else {
        const r = newton(cx, st, 'tran', h, tNow, opts);
        if (!r.x) {
          res.warnings.push({ kind: 'singular', text: 'Схема не решается на шаге ' + k + ' — проверьте номиналы.' });
          return res;
        }
        x = r.x;
      }
      readState(cx, x, st, 'tran', h);
      if (k % keep === 0) {
        res.t.push(tNow);
        Object.keys(cx.nodeMap).forEach((nk) => {
          const i = cx.nodeMap[nk];
          res.node[nk].push(i >= 0 ? x[i] : 0);
        });
        cx.els.forEach((e) => {
          const o = res.elem[e.id];
          if (!o) return;
          const s = st[e.id] || {};
          o.u.push(num(s.u, 0));
          o.i.push(num(s.i, 0));
          if (e.type === 'MOTOR') o.w.push(num(s.w, 0));
        });
      }
    }
    res.ok = true;
    res.state = st;
    // действующие/средние значения по последнему периоду (или по всему окну)
    const dt = h * keep;
    const span = fmax > 0 ? Math.min(res.t.length, Math.max(2, Math.round((1 / fmax) / dt))) : res.t.length;
    Object.keys(res.elem).forEach((id) => {
      const u = res.elem[id].u, i = res.elem[id].i;
      const from = Math.max(0, u.length - span);
      let su = 0, si = 0, sp = 0, mu = 0, mi = 0, cnt = 0;
      for (let k = from; k < u.length; k++) {
        su += u[k] * u[k]; si += i[k] * i[k]; sp += u[k] * i[k];
        mu += u[k]; mi += i[k]; cnt++;
      }
      const r = cnt ? { U: Math.sqrt(su / cnt), I: Math.sqrt(si / cnt), P: sp / cnt,
                        Uavg: mu / cnt, Iavg: mi / cnt }
                    : { U: 0, I: 0, P: 0, Uavg: 0, Iavg: 0 };
      r.S = r.U * r.I;
      r.pf = r.S > 1e-12 ? r.P / r.S : 1;
      r.Q = Math.sqrt(Math.max(0, r.S * r.S - r.P * r.P));
      res.rms[id] = r;
    });
    return res;
  }

  /* ══════════════════ 8. Вспомогательное ══════════════════ */

  /* Эквивалентное сопротивление между двумя узлами: подключаем источник 1 В
     и смотрим ток. Источники в схеме при этом «выключаются» (ЭДС → провод). */
  function resistanceBetween(net, a, b) {
    const els = (net.elements || []).filter(Boolean).map((e) => (
      e.type === 'V' ? Object.assign({}, e, { dc: 0, mag: 0 }) : e));
    els.push({ id: 'probe', type: 'V', nodes: [a, b], dc: 1, r: 0 });
    const r = solveDC({ elements: els, ground: b });
    const i = r.elem['probe'] ? -r.elem['probe'].i : 0;
    return Math.abs(i) > 1e-15 ? 1 / Math.abs(i) : Infinity;
  }

  /* Резонансная частота контура. */
  const resonance = (L, C) => 1 / (2 * Math.PI * Math.sqrt(L * C));

  return {
    solveDC, solveAC, solveTransient, resistanceBetween, resonance,
    lampR, timeScale, compile,
    _lu: { luReal, luSolveReal, luCplx, luSolveCplx },
    VT,
  };
}));
