/* Живой расчёт однофазной цепи R–L–C (глава 2).
   Работает по разметке контейнера #ac-calc страницы t-ac.
   Из common.js берёт только esc(); локальные num() и fmt() здесь свои —
   с другими правилами округления и чтением значения прямо из элемента. */
'use strict';
(function () {
  var W = 640, H = 340, PAD = 46, REF = 100;
  var C_INK = '#16161a', C_U = '#155e75', C_I = '#b3382e', C_G = '#6b6b74';

  var root = document.getElementById('ac-calc');
  if (!root) { return; }
  var el = {
    mode: document.getElementById('ac-mode'),
    u: document.getElementById('ac-u'),
    r: document.getElementById('ac-r'),
    l: document.getElementById('ac-l'),
    c: document.getElementById('ac-c'),
    f: document.getElementById('ac-f'),
    frange: document.getElementById('ac-frange'),
    fout: document.getElementById('ac-fout'),
    out: document.getElementById('ac-out'),
    fig: document.getElementById('ac-fig'),
    reset: document.getElementById('ac-reset'),
    res: document.getElementById('ac-res')
  };
  if (!el.out || !el.fig) { return; }

  /* ---------- служебные ---------- */

  function num(node, dflt) {
    if (!node) { return dflt; }
    var v = parseFloat(String(node.value).replace(',', '.'));
    if (!isFinite(v)) { return dflt; }
    return v;
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function minus(s) { return s.charAt(0) === '-' ? '−' + s.slice(1) : s; }

  function fmt(v) {
    if (v === null || v === undefined || !isFinite(v)) { return '—'; }
    var a = Math.abs(v), d;
    if (a >= 1e6) { return minus((v / 1e6).toFixed(2).replace('.', ',')) + '·10⁶'; }
    if (a >= 10) { d = 1; }
    else if (a >= 1) { d = 2; }
    else if (a >= 0.1) { d = 3; }
    else if (a >= 0.01) { d = 4; }
    else if (a >= 0.001) { d = 5; }
    else if (a === 0) { d = 0; }
    else { d = 6; }
    if (a >= 1000) { d = 0; }
    return minus(v.toFixed(d).replace('.', ','));
  }

  /* ---------- расчёт ---------- */

  function compute() {
    var m = el.mode ? el.mode.value : 's';
    var U = clamp(num(el.u, 0), 0, 100000);
    var R = clamp(num(el.r, 0), 0, 1e7);
    var L = clamp(num(el.l, 0), 0, 1e7) / 1000;        // мГн -> Гн
    var Cf = clamp(num(el.c, 0), 0, 1e7) * 1e-6;       // мкФ -> Ф
    var f = clamp(num(el.f, 50), 0.1, 20000);
    var w = 2 * Math.PI * f;
    var xL = L > 0 ? w * L : 0;
    var xC = Cf > 0 ? 1 / (w * Cf) : 0;
    var f0 = (L > 0 && Cf > 0) ? 1 / (2 * Math.PI * Math.sqrt(L * Cf)) : null;

    var d = { mode: m, U: U, R: R, L: L, C: Cf, f: f, w: w, xL: xL, xC: xC, f0: f0, bad: '' };

    if (m === 's') {
      var X = xL - xC;
      var z = Math.sqrt(R * R + X * X);
      d.X = X; d.z = z;
      if (z <= 0) {
        d.bad = 'все элементы отсутствуют: z = 0, ток не ограничен';
        d.I = Infinity; d.phi = 0;
        d.UR = 0; d.UL = 0; d.UC = 0; d.P = Infinity; d.Q = 0; d.S = Infinity; d.cos = 1;
      } else {
        var I = U / z;
        d.I = I;
        d.phi = Math.atan2(X, R);
        d.UR = R * I; d.UL = xL * I; d.UC = xC * I;
        d.P = I * I * R; d.Q = I * I * X; d.S = U * I;
        d.cos = R / z;
      }
      d.reactive = X;
    } else {
      var G = R > 0 ? 1 / R : 0;
      var BL = xL > 0 ? 1 / xL : 0;
      var BC = Cf > 0 ? w * Cf : 0;
      var B = BC - BL;
      var Y = Math.sqrt(G * G + B * B);
      d.G = G; d.BL = BL; d.BC = BC; d.B = B; d.Y = Y;
      d.z = Y > 0 ? 1 / Y : Infinity;
      d.I = U * Y;
      d.IR = U * G; d.IL = U * BL; d.IC = U * BC;
      d.phi = (Y > 0) ? Math.atan2(-B, G) : 0;
      d.P = U * U * G; d.Q = U * U * (BL - BC); d.S = U * d.I;
      d.cos = Y > 0 ? G / Y : 1;
      if (Y <= 0) { d.bad = 'все элементы отсутствуют: ток равен нулю'; }
      d.reactive = -B;
    }
    d.deg = d.phi * 180 / Math.PI;
    var scale = Math.max(Math.abs(d.mode === 's' ? d.z : d.Y), 1e-12);
    d.resonant = Math.abs(d.reactive) < 1e-9 * Math.max(1, scale) ||
      (d.f0 !== null && Math.abs(f - d.f0) / d.f0 < 0.002);
    if (xL === 0 && xC === 0) { d.resonant = false; }
    return d;
  }

  /* ---------- вывод чисел ---------- */

  function character(d) {
    if (d.resonant) { return ['резонанс: ток и напряжение совпадают по фазе', 'ok']; }
    if (Math.abs(d.deg) < 0.5) { return ['практически активная нагрузка', 'ok']; }
    if (d.deg > 0) { return ['активно-индуктивный: ток отстаёт от напряжения', 'bad']; }
    return ['активно-ёмкостный: ток опережает напряжение', 'bad'];
  }

  function renderOut(d) {
    var h = [];
    if (d.mode === 's') {
      h.push('<div><b>Сопротивления.</b> x<sub>L</sub> = ' + fmt(d.xL) + ' Ом · x<sub>C</sub> = ' +
        fmt(d.xC) + ' Ом · X = x<sub>L</sub> − x<sub>C</sub> = ' + fmt(d.X) +
        ' Ом · z = ' + fmt(d.z) + ' Ом</div>');
      h.push('<div><b>Ток и напряжения.</b> I = ' + fmt(d.I) + ' А · U<sub>R</sub> = ' + fmt(d.UR) +
        ' В · U<sub>L</sub> = ' + fmt(d.UL) + ' В · U<sub>C</sub> = ' + fmt(d.UC) + ' В</div>');
    } else {
      h.push('<div><b>Проводимости.</b> G = ' + fmt(d.G) + ' См · B<sub>L</sub> = ' + fmt(d.BL) +
        ' См · B<sub>C</sub> = ' + fmt(d.BC) + ' См · B = B<sub>C</sub> − B<sub>L</sub> = ' +
        fmt(d.B) + ' См · Y = ' + fmt(d.Y) + ' См</div>');
      h.push('<div><b>Токи.</b> I = ' + fmt(d.I) + ' А · I<sub>R</sub> = ' + fmt(d.IR) +
        ' А · I<sub>L</sub> = ' + fmt(d.IL) + ' А · I<sub>C</sub> = ' + fmt(d.IC) +
        ' А · x<sub>L</sub> = ' + fmt(d.xL) + ' Ом · x<sub>C</sub> = ' + fmt(d.xC) + ' Ом</div>');
    }
    h.push('<div><b>Мощности.</b> P = ' + fmt(d.P) + ' Вт · Q = ' + fmt(d.Q) + ' вар · S = ' +
      fmt(d.S) + ' В·А · cos φ = ' + fmt(d.cos) + ' · φ = ' + fmt(d.deg) + '°</div>');
    var ch = character(d);
    h.push('<div><b>Характер нагрузки.</b> <span class="badge ' + ch[1] + '">' + esc(ch[0]) +
      '</span></div>');
    if (d.f0 === null) {
      h.push('<div><b>Резонанс.</b> невозможен: в цепи нет одного из реактивных элементов</div>');
    } else {
      var rel = Math.abs(d.f - d.f0) / d.f0 < 0.002 ? 'частота равна резонансной'
        : (d.f < d.f0 ? 'рабочая частота ниже резонансной' : 'рабочая частота выше резонансной');
      h.push('<div><b>Резонанс.</b> f<sub>0</sub> = 1 / (2π√(LC)) = <b>' + fmt(d.f0) + ' Гц</b> — ' +
        rel + ' (f = ' + fmt(d.f) + ' Гц)</div>');
    }
    if (d.bad) {
      h.push('<div><span class="badge bad">' + esc(d.bad) + '</span></div>');
    }
    el.out.innerHTML = h.join('');
  }

  /* ---------- векторная диаграмма ---------- */

  function svgText(t, x, y, color, anchor, bold) {
    var wid = String(t).length * 6.6;
    var xx = x, an = anchor || 'start';
    if (an === 'start') { xx = clamp(x, 8, W - 8 - wid); }
    else if (an === 'end') { xx = clamp(x, 8 + wid, W - 8); }
    else { xx = clamp(x, 8 + wid / 2, W - 8 - wid / 2); }
    var yy = clamp(y, 18, H - 10);
    return '<text x="' + xx.toFixed(1) + '" y="' + yy.toFixed(1) + '" text-anchor="' + an +
      '" font-family="system-ui, sans-serif" font-size="11"' + (bold ? ' font-weight="700"' : '') +
      ' fill="' + color + '">' + esc(t) + '</text>';
  }

  function arrow(x1, y1, x2, y2, color, mk, width) {
    if (!isFinite(x1) || !isFinite(y1) || !isFinite(x2) || !isFinite(y2)) { return ''; }
    if (Math.abs(x2 - x1) < 0.3 && Math.abs(y2 - y1) < 0.3) { return ''; }
    return '<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) +
      '" y2="' + y2.toFixed(1) + '" stroke="' + color + '" stroke-width="' + (width || 1.8) +
      '" stroke-linecap="round" marker-end="url(#' + mk + ')"/>';
  }

  function dash(x1, y1, x2, y2) {
    return '<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) +
      '" y2="' + y2.toFixed(1) + '" stroke="' + C_G +
      '" stroke-width="1" stroke-dasharray="5 4" fill="none"/>';
  }

  function head() {
    return '<defs>' +
      '<marker id="acv-u" markerWidth="9" markerHeight="7" refX="8.5" refY="3.5" orient="auto">' +
      '<path d="M0,0 L9,3.5 L0,7 z" fill="' + C_U + '"/></marker>' +
      '<marker id="acv-i" markerWidth="9" markerHeight="7" refX="8.5" refY="3.5" orient="auto">' +
      '<path d="M0,0 L9,3.5 L0,7 z" fill="' + C_I + '"/></marker>' +
      '<marker id="acv-g" markerWidth="8" markerHeight="6" refX="7.5" refY="3" orient="auto">' +
      '<path d="M0,0 L8,3 L0,6 z" fill="' + C_G + '"/></marker>' +
      '</defs>';
  }

  function wrapSvg(inner, label) {
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="geo-board" style="max-width:' + W +
      'px" role="img" aria-label="' + esc(label) + '">' + head() + inner + '</svg>';
  }

  function renderFig(d) {
    var inner = '', pts, i;
    var series = (d.mode === 's');
    var refColor = series ? C_I : C_U;
    var vecColor = series ? C_U : C_I;
    var refMk = series ? 'acv-i' : 'acv-u';
    var vecMk = series ? 'acv-u' : 'acv-i';

    if (!isFinite(d.I) || d.I <= 0 || d.U <= 0) {
      inner += svgText(d.bad ? d.bad : 'при заданных данных диаграмма не строится',
        W / 2, H / 2, C_G, 'middle', true);
      el.fig.innerHTML = wrapSvg(inner, 'Векторная диаграмма не строится');
      return;
    }

    // список точек в физических единицах (y вверх положительно)
    var P = [[0, 0]];
    var items = [];   // [x1,y1,x2,y2, подпись, цвет]
    if (series) {
      var A = [d.UR, 0];
      var B = [d.UR, d.UL];
      var Cc = [d.UR, -d.UC];
      var T = [d.UR, d.UL - d.UC];
      P.push(A, B, Cc, T);
      items.push([0, 0, A[0], A[1], 'U R = ' + fmt(d.UR) + ' В', vecColor, vecMk]);
      if (d.UL > 0) { items.push([A[0], A[1], B[0], B[1], 'U L = ' + fmt(d.UL) + ' В', vecColor, vecMk]); }
      if (d.UC > 0) { items.push([A[0], A[1], Cc[0], Cc[1], 'U C = ' + fmt(d.UC) + ' В', vecColor, vecMk]); }
      items.push([0, 0, T[0], T[1], 'U = ' + fmt(d.U) + ' В', vecColor, vecMk]);
      var tip = T;
    } else {
      var Ar = [d.IR, 0];
      var Bl = [0, -d.IL];
      var Cc2 = [0, d.IC];
      var T2 = [d.IR, d.IC - d.IL];
      P.push(Ar, Bl, Cc2, T2);
      if (d.IR > 0) { items.push([0, 0, Ar[0], Ar[1], 'I R = ' + fmt(d.IR) + ' А', vecColor, vecMk]); }
      if (d.IL > 0) { items.push([0, 0, Bl[0], Bl[1], 'I L = ' + fmt(d.IL) + ' А', vecColor, vecMk]); }
      if (d.IC > 0) { items.push([0, 0, Cc2[0], Cc2[1], 'I C = ' + fmt(d.IC) + ' А', vecColor, vecMk]); }
      items.push([0, 0, T2[0], T2[1], 'I = ' + fmt(d.I) + ' А', vecColor, vecMk]);
      var tip = T2;
    }

    var minx = 0, maxx = 0, miny = 0, maxy = 0;
    for (i = 0; i < P.length; i++) {
      if (!isFinite(P[i][0]) || !isFinite(P[i][1])) { continue; }
      if (P[i][0] < minx) { minx = P[i][0]; }
      if (P[i][0] > maxx) { maxx = P[i][0]; }
      if (P[i][1] < miny) { miny = P[i][1]; }
      if (P[i][1] > maxy) { maxy = P[i][1]; }
    }
    var bw = maxx - minx, bh = maxy - miny;
    var availW = W - 2 * PAD, availH = H - 2 * PAD;
    var kx = bw > 0 ? (availW - 34) / bw : Infinity;
    var ky = bh > 0 ? availH / bh : Infinity;
    var k = Math.min(kx, ky);
    if (!isFinite(k) || k <= 0) { k = 1; }
    // опорная ось должна быть длиннее самого длинного вектора
    var refLen = clamp(maxx * k + 26, REF, availW - 6);
    var need = Math.max(bw * k, refLen);
    var ox = PAD + (availW - need) / 2 - minx * k;
    var oy = PAD + (availH - bh * k) / 2 + maxy * k;
    var sx = function (v) { return ox + v * k; };
    var sy = function (v) { return oy - v * k; };

    // опорная ось
    var refTxt = series ? 'I — опорный' : 'U — опорный';
    inner += arrow(ox, oy, ox + refLen, oy, refColor, refMk, 1.8);
    if (ox + refLen + 6 + refTxt.length * 6.6 <= W - 8) {
      inner += svgText(refTxt, ox + refLen + 6, oy + 4, refColor, 'start', false);
    } else {
      inner += svgText(refTxt, ox + refLen - 6, oy - 10, refColor, 'end', false);
    }

    // вспомогательные штриховые линии
    if (!series) {
      inner += dash(sx(tip[0]), sy(0), sx(tip[0]), sy(tip[1]));
      inner += dash(sx(0), sy(tip[1]), sx(tip[0]), sy(tip[1]));
    } else if (Math.abs(tip[1]) > 0) {
      inner += dash(sx(0), sy(tip[1]), sx(tip[0]), sy(tip[1]));
    }

    // векторы и подписи
    for (i = 0; i < items.length; i++) {
      var it = items[i];
      var x1 = sx(it[0]), y1 = sy(it[1]), x2 = sx(it[2]), y2 = sy(it[3]);
      var last = (i === items.length - 1);
      inner += arrow(x1, y1, x2, y2, it[5], it[6], last ? 2.4 : 1.8);
      var mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      var dx = x2 - x1, dy = y2 - y1;
      var lx, ly, an;
      if (last) {                                   // результирующий — в свободном секторе
        lx = x1 + 0.7 * dx - 8;
        ly = y1 + 0.7 * dy + (dy >= 0 ? 17 : -9);
        an = 'end';
      } else if (Math.abs(dy) > Math.abs(dx)) {     // вертикальный — справа
        lx = mx + 9; ly = my + 4; an = 'start';
      } else {                                      // горизонтальный — сверху
        lx = mx; ly = my - 9; an = 'middle';
      }
      inner += svgText(it[4], lx, ly, it[5], an, last);
    }

    // дуга угла сдвига фаз
    var ang = Math.atan2(tip[1] * k, tip[0] * k);   // в экранной системе: y вверх
    if (isFinite(ang) && Math.abs(ang) > 0.03 && (Math.abs(tip[0]) + Math.abs(tip[1])) > 0) {
      var r = 34;
      var ax = ox + r, ay = oy;
      var bx = ox + r * Math.cos(ang), by = oy - r * Math.sin(ang);
      var sweep = ang < 0 ? 1 : 0;
      inner += '<path d="M' + ax.toFixed(1) + ' ' + ay.toFixed(1) + ' A' + r + ' ' + r +
        ' 0 0 ' + sweep + ' ' + bx.toFixed(1) + ' ' + by.toFixed(1) +
        '" fill="none" stroke="' + C_G + '" stroke-width="1"/>';
      var lax = ox + (r + 12) * Math.cos(ang / 2);
      var lay = oy - (r + 12) * Math.sin(ang / 2) + 4;
      inner += svgText('φ = ' + fmt(d.deg) + '°', lax, lay, C_G, 'start', false);
    }

    inner += '<circle cx="' + ox.toFixed(1) + '" cy="' + oy.toFixed(1) +
      '" r="3.2" fill="' + C_INK + '"/>';
    inner += svgText(series
      ? 'последовательная цепь: напряжения при опорном векторе тока'
      : 'параллельная цепь: токи при опорном векторе напряжения', 12, H - 12, C_G, 'start', false);

    el.fig.innerHTML = wrapSvg(inner, series
      ? 'Векторная диаграмма напряжений последовательной цепи'
      : 'Векторная диаграмма токов параллельной цепи');
  }

  /* ---------- связывание ---------- */

  function syncRange(fromRange) {
    if (!el.frange || !el.f) { return; }
    if (fromRange) {
      el.f.value = el.frange.value;
    } else {
      var v = clamp(num(el.f, 50), 1, 200);
      el.frange.value = String(Math.round(v));
    }
    if (el.fout) { el.fout.textContent = fmt(clamp(num(el.f, 50), 0.1, 20000)) + ' Гц'; }
  }

  function update(fromRange) {
    syncRange(fromRange);
    var d = compute();
    renderOut(d);
    renderFig(d);
  }

  var inputs = [el.mode, el.u, el.r, el.l, el.c, el.f];
  for (var i = 0; i < inputs.length; i++) {
    if (!inputs[i]) { continue; }
    inputs[i].addEventListener('input', function () { update(false); });
    inputs[i].addEventListener('change', function () { update(false); });
  }
  if (el.frange) {
    el.frange.addEventListener('input', function () { update(true); });
    el.frange.addEventListener('change', function () { update(true); });
  }
  if (el.reset) {
    el.reset.addEventListener('click', function () {
      if (el.mode) { el.mode.value = 's'; }
      if (el.u) { el.u.value = '36'; }
      if (el.r) { el.r.value = '50'; }
      if (el.l) { el.l.value = '200'; }
      if (el.c) { el.c.value = '30'; }
      if (el.f) { el.f.value = '50'; }
      update(false);
    });
  }
  if (el.res) {
    el.res.addEventListener('click', function () {
      var d = compute();
      if (d.f0 !== null && isFinite(d.f0) && el.f) {
        el.f.value = String(Math.round(d.f0 * 10) / 10);
      }
      update(false);
    });
  }

  update(false);
})();
