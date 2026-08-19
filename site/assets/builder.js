/* builder.js — электронный конструктор: поле, детали, расчёт, приборы,
 * осциллограф, векторная диаграмма, проверка задания.
 *
 * Разделение обязанностей:
 *   solver.js — считает цепь (МНА, Гаусс, переходные процессы);
 *   parts.js  — каталог деталей: УГО, параметры, разворачивание в примитивы;
 *   builder.js (этот файл) — всё, что видит и делает пользователь.
 *
 * Схема хранится в простом виде:
 *   { v:1, w, h, parts:[ {id, k, x, y, d:'h'|'v', f:0|1, p:{…}} ] }
 * где (x,y) — узел сетки, с которого деталь начинается, d — вдоль какой оси
 * она лежит, f — перевёрнута ли полярность. Многополюсники (трансформатор,
 * ваттметр, трёхфазные) занимают блок узлов и всегда стоят «как есть».
 * Тот же объект кладётся в localStorage и кодируется в ссылку.
 */
'use strict';
(function (global) {
  const P = global.ElecParts.P;
  const GROUPS = global.ElecParts.GROUPS;
  const values = global.ElecParts.values;
  const si = global.ElecParts.si;
  const fm = global.ElecParts.fm;
  const esc = global.ElecParts.esc;
  const Elec = global.Elec;

  const PITCH = 78;
  const X = (x) => x * PITCH;
  const Y = (y) => y * PITCH;
  /* Геометрия деталей, разворачивание схемы в сеть, показания приборов и
     контекст автопроверки живут в parts.js — так тесты под node работают с той
     же самой схемой, что и страница. */
  const endOf = global.ElecParts.endOf;
  const termNodes = global.ElecParts.termNodes;
  const cellsOf = global.ElecParts.cellsOf;
  const reading = global.ElecParts.reading;

  /* ══════════════ состояние ══════════════ */
  const S = {
    w: 9, h: 6, parts: [], next: 1,
    tool: null, sel: null, cur: { x: 0, y: 0, d: 'h' },
    scope: false, scopeOn: 'auto', drag: null, exp: null,
  };
  let ui = {};             // ссылки на элементы страницы
  let last = null;         // последний результат расчёта

  /* ══════════════ геометрия деталей ══════════════ */
  function fits(p) {
    const d = P[p.k];
    const nw = d.block ? d.block.nw : (d.single ? 1 : (p.d === 'v' ? 1 : 2));
    const nh = d.block ? d.block.nh : (d.single ? 1 : (p.d === 'v' ? 2 : 1));
    return p.x >= 0 && p.y >= 0 && p.x + nw <= S.w && p.y + nh <= S.h;
  }
  /* Занято ли ребро другой деталью-двухполюсником. */
  function edgeKey(p) {
    const e = endOf(p);
    return p.x + ',' + p.y + '-' + e.x + ',' + e.y;
  }
  function edgeBusy(p, skipId) {
    if (P[p.k].block || P[p.k].single) return false;
    const k = edgeKey(p);
    return S.parts.some((q) => q.id !== skipId && !P[q.k].block && !P[q.k].single && edgeKey(q) === k);
  }

  const designators = () => global.ElecParts.designators(S.parts);

  /* ══════════════ схема ↔ строка ══════════════ */
  function dump() {
    return { v: 1, w: S.w, h: S.h,
      parts: S.parts.map((p) => ({ id: p.id, k: p.k, x: p.x, y: p.y, d: p.d, f: p.f, p: p.p })) };
  }
  function load(obj, keepExp) {
    if (!obj || !Array.isArray(obj.parts)) return false;
    S.w = obj.w || 9; S.h = obj.h || 6;
    S.parts = obj.parts.filter((p) => P[p.k]).map((p) => ({
      id: p.id || ('p' + (S.next++)), k: p.k, x: p.x | 0, y: p.y | 0,
      d: p.d === 'v' ? 'v' : 'h', f: p.f ? 1 : 0, p: Object.assign({}, p.p),
    }));
    S.next = S.parts.reduce((m, p) => Math.max(m, (+String(p.id).replace(/\D/g, '') || 0) + 1), 1);
    S.sel = null;
    if (!keepExp) S.exp = S.exp;
    return true;
  }
  function encode(obj) {
    const json = JSON.stringify(obj);
    const bytes = new TextEncoder().encode(json);
    let bin = '';
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decode(s) {
    try {
      const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
      const bytes = new Uint8Array(b.length);
      for (let i = 0; i < b.length; i++) bytes[i] = b.charCodeAt(i);
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) { return null; }
  }

  const LS_KEY = 'elec.builder.v1';
  function save() {
    try { localStorage.setItem(S.exp ? LS_KEY + '.exp' + S.exp.id : LS_KEY, JSON.stringify(dump())); } catch (e) { /* приватный режим */ }
  }
  function restore() {
    try {
      const raw = localStorage.getItem(S.exp ? LS_KEY + '.exp' + S.exp.id : LS_KEY);
      return raw ? load(JSON.parse(raw)) : false;
    } catch (e) { return false; }
  }

  /* ══════════════ netlist и расчёт ══════════════ */
  const netlist = () => global.ElecParts.netlistOf(dump());

  function analyse() {
    return global.ElecParts.analyse(dump(), Elec, {
      scope: S.scope,
      force: S.scopeOn === 'tran' ? 'tran' : null,
    });
  }

  /* ══════════════ отрисовка поля ══════════════ */
  function partSvg(p, map) {
    const d = P[p.k], v = values(p);
    const dead = last && last.res.dead && last.res.dead[p.id];
    const cls = 'part' + (S.sel === p.id ? ' sel' : '') + (dead ? ' dead' : '');
    let body, tr;
    if (d.single) {
      tr = `translate(${X(p.x)},${Y(p.y)})`;
      body = d.draw(0, p, v, 0);
    } else if (d.block) {
      tr = `translate(${X(p.x)},${Y(p.y)})`;
      body = d.drawBlock((d.block.nw - 1) * PITCH, (d.block.nh - 1) * PITCH, p, v);
    } else {
      const ang = p.d === 'v' ? 90 : 0;
      const rot = p.f ? ang + 180 : ang;
      const ox = p.f && p.d === 'h' ? X(p.x) + PITCH : X(p.x);
      const oy = p.f && p.d === 'v' ? Y(p.y) + PITCH : Y(p.y);
      tr = `translate(${ox},${oy})` + (rot ? ` rotate(${rot})` : '');
      body = d.draw(PITCH, p, v, rot);
    }
    // прозрачная площадка: по ней деталь надёжно берётся мышью и с клавиатуры
    let grab;
    if (d.single) grab = `<rect class="grab" x="-16" y="-6" width="32" height="30"/>`;
    else if (d.block) grab = `<rect class="grab" x="-4" y="-14" width="${(d.block.nw - 1) * PITCH + 8}" height="${(d.block.nh - 1) * PITCH + 28}"/>`;
    else grab = `<rect class="grab" x="4" y="-19" width="${PITCH - 8}" height="38"/>`;
    return `<g class="${cls}" data-id="${p.id}" transform="${tr}">${grab}${body}</g>`;
  }

  /* Подписи (обозначение и номинал) рисуются отдельным слоем — без поворота,
     чтобы читались одинаково на вертикальных и горизонтальных деталях. */
  function labelSvg(p, map) {
    const d = P[p.k];
    if (!d.tag) return '';
    const cells = cellsOf(p);
    let cx = 0, cy = 0;
    cells.forEach((c) => { cx += X(c[0]); cy += Y(c[1]); });
    cx /= cells.length; cy /= cells.length;
    // вертикальные детали подписываем слева, горизонтальные — сверху, блочные —
    // над левым верхним углом: так подписи не сталкиваются ни с самой деталью,
    // ни с показаниями приборов (те уходят вправо и вниз)
    const vert = !d.block && !d.single && p.d === 'v';
    const anchor = d.block ? 'start' : (vert ? 'end' : 'middle');
    const lx = d.block ? X(p.x) : cx + (vert ? -24 : 0);
    const ly = d.block ? Y(p.y) - 28 : cy + (vert ? 8 : -26);
    const val = d.val ? d.val(values(p)) : '';
    let s = `<text class="lbl b tag" x="${lx}" y="${ly}" text-anchor="${anchor}">${esc(map[p.id])}</text>`;
    if (val) s += `<text class="lbl val" x="${lx}" y="${ly + 12}" text-anchor="${anchor}">${esc(val)}</text>`;
    return s;
  }

  /* Свечение лампы/светодиода и вращение двигателя. */
  function fxSvg(p, kind, res) {
    const d = P[p.k];
    const e = res.elem && res.elem[p.id];
    if (!e) return '';
    const cells = cellsOf(p);
    let cx = 0, cy = 0;
    cells.forEach((c) => { cx += X(c[0]); cy += Y(c[1]); });
    cx /= cells.length; cy /= cells.length;
    if (d.glow) {
      const v = values(p);
      let pw;
      if (kind === 'ac') pw = Math.abs(e.P || 0);
      else if (kind === 'tran') pw = res.rms && res.rms[p.id] ? Math.abs(res.rms[p.id].P) : 0;
      else pw = Math.abs((e.u || 0) * (e.i || 0));
      const nomP = p.k === 'LED' ? (v.Uf * v.Inom) : v.Pnom;
      const rel = Math.min(1, pw / Math.max(nomP, 1e-9));
      if (res.dead && res.dead[p.id]) return `<text class="lbl warn-x" x="${cx}" y="${cy + 34}" text-anchor="middle">перегорела</text>`;
      if (rel > 0.03) return `<circle class="glow" cx="${cx}" cy="${cy}" r="${16 + 14 * rel}" opacity="${(0.15 + 0.55 * rel).toFixed(2)}"/>`;
    }
    if (d.spin && e.w) {
      const rpm = Math.abs(e.n || 0);
      if (rpm > 1) return `<text class="lbl rpm" x="${cx}" y="${cy + 32}" text-anchor="middle">${fm(rpm, 0)} об/мин</text>`;
    }
    if (d.ring) {
      const v = values(p);
      const cur = kind === 'ac' ? e.I : Math.abs(e.i || 0);
      if (cur > v.ion) return `<text class="lbl ring" x="${cx}" y="${cy + 30}" text-anchor="middle">звонит</text>`;
    }
    return '';
  }

  function draw() {
    const map = designators();
    const vbW = X(S.w - 1) + 96, vbH = Y(S.h - 1) + 96;
    let s = `<svg class="board" viewBox="-48 -48 ${vbW} ${vbH}" role="img" aria-label="Поле конструктора: сетка узлов, на рёбрах стоят детали">`;
    // сетка
    s += '<g class="grid">';
    for (let x = 0; x < S.w; x++) for (let y = 0; y < S.h; y++) {
      s += `<circle cx="${X(x)}" cy="${Y(y)}" r="2.4"/>`;
    }
    s += '</g>';
    // курсор клавиатуры
    if (ui.board && ui.board.dataset.kb === '1') {
      const e = S.cur.d === 'v' ? { x: S.cur.x, y: S.cur.y + 1 } : { x: S.cur.x + 1, y: S.cur.y };
      s += `<path class="cursor" d="M${X(S.cur.x)},${Y(S.cur.y)} L${X(e.x)},${Y(e.y)}"/>`;
    }
    // зоны нажатия по пустым рёбрам — под деталями, чтобы деталь ловила щелчок первой
    s += '<g class="hit">';
    for (let x = 0; x < S.w; x++) for (let y = 0; y < S.h; y++) {
      if (x + 1 < S.w) s += `<line data-e="${x},${y},h" x1="${X(x)}" y1="${Y(y)}" x2="${X(x + 1)}" y2="${Y(y)}"/>`;
      if (y + 1 < S.h) s += `<line data-e="${x},${y},v" x1="${X(x)}" y1="${Y(y)}" x2="${X(x)}" y2="${Y(y + 1)}"/>`;
    }
    s += '</g>';
    // свечение — под деталями, подписи — над
    s += '<g class="fx">' + (last ? S.parts.map((p) => fxSvg(p, last.kind, last.res)).join('') : '') + '</g>';
    s += '<g class="parts">' + S.parts.map((p) => partSvg(p, map)).join('') + '</g>';
    s += '<g class="labels">' + S.parts.map((p) => labelSvg(p, map)).join('') + '</g>';
    // показания приборов прямо на поле
    if (last) {
      s += '<g class="labels">';
      S.parts.forEach((p) => {
        const r = reading(p, last.kind, last.res);
        if (!r) return;
        const cells = cellsOf(p);
        let cx = 0, cy = 0;
        cells.forEach((c) => { cx += X(c[0]); cy += Y(c[1]); });
        cx /= cells.length; cy /= cells.length;
        const vert = !P[p.k].block && !P[p.k].single && p.d === 'v';
        s += `<text class="lbl read" x="${cx + (vert ? 24 : 0)}" y="${cy + (vert ? 18 : 30)}" `
          + `text-anchor="${vert ? 'start' : 'middle'}">${esc(si(r.v, r.u))}</text>`;
      });
      s += '</g>';
    }
    s += '</svg>';
    ui.board.innerHTML = s;
  }

  /* ══════════════ панель свойств ══════════════ */
  function propsHtml() {
    const p = S.parts.find((q) => q.id === S.sel);
    if (!p) {
      return '<p class="muted">Ничего не выбрано. Возьмите деталь в палитре и щёлкните по ребру сетки — '
        + 'или щёлкните по уже стоящей детали, чтобы поменять номинал.</p>';
    }
    const d = P[p.k], v = values(p);
    const map = designators();
    let s = `<h3>${esc(map[p.id] || d.name)} — ${esc(d.name)}</h3>`;
    if (d.gost) s += `<p class="muted">Обозначение по ${esc(d.gost)}</p>`;
    if (d.hint) s += `<p class="hint">${esc(d.hint)}</p>`;
    (d.props || []).forEach((pr) => {
      const id = 'pp_' + pr.k;
      if (pr.type === 'bool') {
        s += `<label class="row"><input type="checkbox" id="${id}" data-p="${pr.k}"${v[pr.k] ? ' checked' : ''}> ${esc(pr.label)}</label>`;
      } else if (pr.type === 'select') {
        s += `<label class="row"><span>${esc(pr.label)}</span><select id="${id}" data-p="${pr.k}">`
          + pr.options.map((o) => `<option value="${esc(o[0])}"${v[pr.k] === o[0] ? ' selected' : ''}>${esc(o[1])}</option>`).join('')
          + '</select></label>';
      } else if (pr.slider) {
        s += `<label class="row"><span>${esc(pr.label)}</span>`
          + `<input type="range" id="${id}" data-p="${pr.k}" min="${pr.min}" max="${pr.max}" step="${pr.step}" value="${v[pr.k]}">`
          + `<output>${fm(v[pr.k], 2)}</output></label>`;
      } else {
        const shown = pr.si ? v[pr.k] : v[pr.k];
        s += `<label class="row"><span>${esc(pr.label)}${pr.unit ? ', ' + esc(pr.unit) : ''}</span>`
          + `<input type="number" id="${id}" data-p="${pr.k}" value="${shown}" step="${pr.step || 'any'}"></label>`;
      }
    });
    s += '<div class="rowbtn">'
      + '<button class="btn" data-act="rot">повернуть</button>'
      + '<button class="btn" data-act="flip">перевернуть</button>'
      + '<button class="btn" data-act="del">удалить</button></div>';
    return s;
  }

  /* ══════════════ таблица показаний ══════════════ */
  function readoutHtml() {
    if (!last) return '';
    const { kind, res } = last;
    const map = designators();
    if (kind === 'empty') return '<p class="muted">Поле пустое. Соберите цепь — расчёт пойдёт сам.</p>';
    let s = '';
    const head = { dc: 'Постоянный ток', ac: 'Переменный ток, установившийся режим (' + fm(res.f, 0) + ' Гц)',
      tran: 'Переходный процесс / несинусоидальный режим' }[kind];
    s += `<p class="mode">${esc(head)}</p>`;
    // приборы
    const meters = S.parts.filter((p) => P[p.k].meter);
    if (meters.length) {
      s += '<table class="el"><thead><tr><th>Прибор</th><th>Что показывает</th><th class="num">Показание</th></tr></thead><tbody>';
      meters.forEach((p) => {
        const r = reading(p, kind, res);
        s += `<tr><td>${esc(map[p.id])}</td><td>${esc(P[p.k].name)}</td>`
          + `<td class="num">${r ? esc(si(r.v, r.u)) : '—'}</td></tr>`;
      });
      s += '</tbody></table>';
    }
    // все детали
    s += '<table class="el"><thead><tr><th>Деталь</th>';
    s += kind === 'ac'
      ? '<th class="num">U, В</th><th class="num">I, А</th><th class="num">P, Вт</th><th class="num">Q, вар</th><th class="num">cos φ</th>'
      : '<th class="num">U, В</th><th class="num">I, А</th><th class="num">P, Вт</th>';
    s += '</tr></thead><tbody>';
    S.parts.forEach((p) => {
      const d = P[p.k];
      if (d.ground || p.k === 'WIRE') return;
      const e = res.elem && res.elem[p.id];
      const rms = res.rms && res.rms[p.id];
      // у источника показываем то, что он ОТДАЁТ: иначе по потребительской
      // системе знаков ток и мощность выходят отрицательными, и cos φ тоже
      const sg = d.source ? -1 : 1;
      let cols;
      if (kind === 'ac' && e) {
        cols = `<td class="num">${fm(e.U, 2)}</td><td class="num">${fm(e.I, 3)}</td>`
          + `<td class="num">${fm(sg * e.P, 2)}</td><td class="num">${fm(sg * e.Q, 2)}</td>`
          + `<td class="num">${fm(sg * e.pf, 3)}</td>`;
      } else if (kind === 'tran' && rms) {
        cols = `<td class="num">${fm(rms.U, 2)}</td><td class="num">${fm(rms.I, 3)}</td><td class="num">${fm(sg * rms.P, 2)}</td>`;
      } else if (e) {
        cols = `<td class="num">${fm(e.u, 3)}</td><td class="num">${fm(sg * e.i, 4)}</td>`
          + `<td class="num">${fm(sg * e.u * e.i, 3)}</td>`;
      } else {
        cols = kind === 'ac' ? '<td class="num">—</td>'.repeat(5) : '<td class="num">—</td>'.repeat(3);
      }
      s += `<tr><td>${esc(map[p.id] || d.name)}</td>${cols}</tr>`;
    });
    s += '</tbody></table>';
    return s;
  }

  function warnHtml() {
    if (!last) return '';
    const w = (last.res.warnings || []);
    if (!w.length) return '';
    return w.map((x) => `<div class="note warn">${esc(x.text)}</div>`).join('');
  }

  /* ══════════════ осциллограф ══════════════ */
  /* Что показывать на осциллографе. Выбранная деталь — если выбрана; иначе
     источник (по нему видна работа всей цепи целиком); иначе первый элемент,
     на котором есть и напряжение, и ток. Приборы в кандидаты не годятся: у
     амперметра напряжение нулевое, у вольтметра — ток. */
  function scopePick() {
    const byId = (id) => S.parts.find((p) => p.id === id);
    const src = (p) => p.k === 'VAC' || p.k === 'VDC' || p.k === 'BAT';
    const useful = (p) => !P[p.k].meter && !P[p.k].ground && p.k !== 'WIRE' && p.k !== 'SW' && p.k !== 'BTN';
    return byId(S.sel) || S.parts.find(src) || S.parts.find(useful) || S.parts[0];
  }

  function scopeSvg() {
    if (!last) return '';
    const { kind, res } = last;
    const p = scopePick();
    const map = designators();
    const W = 640, H = 274, L = 52, R = 16, T = 40, B = 34;
    const pw = W - L - R, ph = H - T - B;
    let tArr = null, uArr = null, iArr = null, Tper = 0;
    // у источника ток показываем тот, что он отдаёт, — иначе сдвиг фаз выходит
    // отсчитанным от «потребительского» направления и читается как 135° вместо 45°
    const sg = p && P[p.k].source ? -1 : 1;
    if (kind === 'ac' && p && res.elem[p.id]) {
      // из комплексов строим точные синусоиды
      const e = res.elem[p.id];
      Tper = 1 / res.f;
      const N = 400;
      tArr = []; uArr = []; iArr = [];
      for (let k = 0; k <= N; k++) {
        const t = 2 * Tper * k / N;
        const wt = 2 * Math.PI * res.f * t;
        tArr.push(t);
        uArr.push(Math.SQRT2 * (e.u.re * Math.cos(wt) - e.u.im * Math.sin(wt)));
        iArr.push(sg * Math.SQRT2 * (e.i.re * Math.cos(wt) - e.i.im * Math.sin(wt)));
      }
    } else if (res.tran && res.tran.elem && p && res.tran.elem[p.id]) {
      tArr = res.tran.t; uArr = res.tran.elem[p.id].u;
      iArr = sg === 1 ? res.tran.elem[p.id].i : res.tran.elem[p.id].i.map((v) => -v);
      Tper = res.f ? 1 / res.f : 0;
    } else if (kind === 'tran' && res.elem && p && res.elem[p.id]) {
      tArr = res.t; uArr = res.elem[p.id].u;
      iArr = sg === 1 ? res.elem[p.id].i : res.elem[p.id].i.map((v) => -v);
      Tper = res.f ? 1 / res.f : 0;
    }
    if (!tArr || !tArr.length) {
      return `<svg class="scope" viewBox="0 0 ${W} ${H}" role="img" aria-label="Осциллограф — нет данных">`
        + `<text class="lbl" x="${W / 2}" y="${H / 2}" text-anchor="middle">Нет сигнала: соберите цепь и выберите деталь</text></svg>`;
    }
    const t0 = tArr[0], t1 = tArr[tArr.length - 1];
    const umax = Math.max(1e-9, ...uArr.map(Math.abs));
    const imax = Math.max(1e-12, ...iArr.map(Math.abs));
    const px = (t) => L + pw * (t - t0) / Math.max(t1 - t0, 1e-12);
    const py = (v, m) => T + ph / 2 - (ph / 2 - 6) * v / m;
    const poly = (arr, m) => arr.map((v, k) => `${px(tArr[k]).toFixed(1)},${py(v, m).toFixed(1)}`).join(' ');

    let s = `<svg class="scope" viewBox="0 0 ${W} ${H}" role="img" aria-label="Осциллограмма напряжения и тока">`;
    s += `<rect class="plot" x="${L}" y="${T}" width="${pw}" height="${ph}"/>`;
    for (let k = 1; k < 4; k++) {
      const y = T + ph * k / 4;
      s += `<path class="gridline" d="M${L},${y} H${L + pw}"/>`;
    }
    s += `<path class="axis" d="M${L},${T + ph / 2} H${L + pw}"/>`;
    for (let k = 0; k <= 4; k++) {
      const x = L + pw * k / 4;
      s += `<path class="gridline" d="M${x},${T} V${T + ph}"/>`;
      s += `<text class="lbl" x="${x}" y="${T + ph + 16}" text-anchor="middle">${fm(1000 * (t0 + (t1 - t0) * k / 4), 1)}</text>`;
    }
    s += `<text class="lbl" x="${L + pw / 2}" y="${H - 6}" text-anchor="middle">t, мс</text>`;
    s += `<polyline class="tr-u" points="${poly(uArr, umax)}"/>`;
    s += `<polyline class="tr-i" points="${poly(iArr, imax)}"/>`;
    // легенда — над полем графика, чтобы не ложиться на кривые
    s += `<text class="lbl u" x="${L}" y="14">u, макс ${esc(si(umax, 'В'))}</text>`;
    s += `<text class="lbl i" x="${L}" y="28">i, макс ${esc(si(imax, 'А'))}</text>`;
    if (p) s += `<text class="lbl b" x="${L + pw}" y="14" text-anchor="end">${esc(map[p.id] || P[p.k].name)}</text>`;
    // подсветка сдвига фаз: расстояние между ближайшими нулями «вверх»
    if (kind === 'ac' && Tper && p && res.elem[p.id]) {
      const e = res.elem[p.id];
      const dphi = ((Math.atan2(e.u.im, e.u.re) - Math.atan2(sg * e.i.im, sg * e.i.re)) * 180 / Math.PI + 540) % 360 - 180;
      if (Math.abs(dphi) > 0.5 && e.I > 1e-9) {
        // момент перехода напряжения через ноль вверх; фазу округляем — иначе
        // «почти ноль» со знаком минус уезжает на целый период вправо
        const phU = Math.round(Math.atan2(e.u.im, e.u.re) * 1800 / Math.PI) / 10;
        let tu = t0 + (-phU / 360) * Tper;
        tu = ((tu % Tper) + Tper) % Tper;
        const dt = (dphi / 360) * Tper;                 // ток отстаёт — dt > 0
        if (tu + dt < 0) tu += Tper;
        const xa = px(tu), xb = px(tu + dt);
        const y = T + ph / 2;
        s += `<path class="phase" d="M${xa.toFixed(1)},${y} H${xb.toFixed(1)}"/>`;
        const lx = Math.min(Math.max((xa + xb) / 2, L + 34), L + pw - 34);
        s += `<text class="lbl p" x="${lx.toFixed(1)}" y="${y - 9}" text-anchor="middle">φ = ${fm(dphi, 1)}°</text>`;
      }
    }
    s += '</svg>';
    return s;
  }

  /* ══════════════ векторная диаграмма ══════════════ */
  function phasorSvg() {
    if (!last || last.kind !== 'ac') {
      return '<p class="muted">Векторная диаграмма строится для установившегося режима переменного тока: '
        + 'поставьте источник переменного напряжения.</p>';
    }
    const res = last.res, map = designators();
    const items = [];
    const seen = {};
    /* Дубли ни к чему: вольтметр показывает то же напряжение, что и деталь, к
       которой он подключён, а амперметр — тот же ток, что и его ветвь. Векторы
       с совпадающими модулем и фазой сливаем в один, перечислив обозначения. */
    const push = (kind, name, re, im, m) => {
      const key = kind + '|' + m.toPrecision(4) + '|' + (Math.atan2(im, re) * 180 / Math.PI).toFixed(1);
      if (seen[key]) { if (seen[key].names.length < 3) seen[key].names.push(name); return; }
      const it = { kind, names: [name], re, im, m };
      seen[key] = it;
      items.push(it);
    };
    S.parts.forEach((p) => {
      const d = P[p.k], e = res.elem[p.id];
      if (!e || d.ground || p.k === 'WIRE' || p.k === 'SW' || p.k === 'BTN' || !e.u) return;
      const nm = map[p.id] || d.name;
      if (p.k !== 'AM' && e.U > 1e-6) push('U', 'U(' + nm + ')', e.u.re, e.u.im, e.U);
      const sg = d.source ? -1 : 1;      // источник показываем отдающим
      if (p.k !== 'VM' && e.I > 1e-9) push('I', 'I(' + nm + ')', sg * e.i.re, sg * e.i.im, e.I);
    });
    if (!items.length) return '<p class="muted">Нет величин для диаграммы.</p>';
    const W = 520, H = 380, cx = W / 2, cy = H / 2, Rmax = 118;
    const umax = Math.max(1e-9, ...items.filter((i) => i.kind === 'U').map((i) => i.m));
    const imax = Math.max(1e-12, ...items.filter((i) => i.kind === 'I').map((i) => i.m));
    let s = `<svg class="phasor" viewBox="0 0 ${W} ${H}" role="img" aria-label="Векторная диаграмма токов и напряжений">`;
    s += `<circle class="gridline" cx="${cx}" cy="${cy}" r="${Rmax}" fill="none"/>`;
    s += `<path class="axis" d="M${cx - Rmax - 12},${cy} H${cx + Rmax + 12} M${cx},${cy - Rmax - 12} V${cy + Rmax + 12}"/>`;
    const placed = [];
    items.slice(0, 8).forEach((it) => {
      const sc = Rmax / (it.kind === 'U' ? umax : imax);
      const x = cx + it.re * sc, y = cy - it.im * sc;
      const cls = it.kind === 'U' ? 'vu' : 'vi';
      s += `<path class="vec ${cls}" d="M${cx},${cy} L${x.toFixed(1)},${y.toFixed(1)}"/>`;
      s += `<path class="vec ${cls}" d="${arrow(cx, cy, x, y)}"/>`;
      // подпись — за остриём, вдоль вектора; если место занято, отодвигаем вниз
      const L = Math.hypot(x - cx, y - cy) || 1;
      let lx = x + (x - cx) / L * 14, ly = y + (y - cy) / L * 12 + 4;
      const anchor = x >= cx ? 'start' : 'end';
      let guard = 0;
      while (placed.some((q) => Math.abs(q.x - lx) < 70 && Math.abs(q.y - ly) < 12) && guard < 10) {
        ly += 13; guard++;
      }
      placed.push({ x: lx, y: ly });
      lx = Math.min(Math.max(lx, 6), W - 6);
      ly = Math.min(Math.max(ly, 30), H - 6);
      s += `<text class="lbl ${it.kind === 'U' ? 'u' : 'i'}" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" `
        + `text-anchor="${anchor}">${esc(it.names.join(' = '))}</text>`;
    });
    s += `<text class="lbl" x="8" y="16">на полный радиус: напряжение ${esc(si(umax, 'В'))}, ток ${esc(si(imax, 'А'))}</text>`;
    s += '</svg>';
    return s;
  }
  function arrow(x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1;
    const ux = dx / L, uy = dy / L, a = 8;
    const bx = x1 - ux * a, by = y1 - uy * a;
    return `M${x1.toFixed(1)},${y1.toFixed(1)} L${(bx - uy * 3.5).toFixed(1)},${(by + ux * 3.5).toFixed(1)} `
      + `L${(bx + uy * 3.5).toFixed(1)},${(by - ux * 3.5).toFixed(1)} Z`;
  }

  /* ══════════════ пересчёт и перерисовка ══════════════ */
  function refresh() {
    last = analyse();
    draw();
    if (ui.readout) ui.readout.innerHTML = warnHtml() + readoutHtml();
    if (ui.props) ui.props.innerHTML = propsHtml();
    if (ui.scope) ui.scope.innerHTML = scopeSvg();
    if (ui.phasor) ui.phasor.innerHTML = phasorSvg();
    if (ui.link) ui.link.value = location.origin + location.pathname + '#s=' + encode(dump());
    save();
  }

  /* ══════════════ действия ══════════════ */
  function place(x, y, d) {
    if (!S.tool) return false;
    const def0 = P[S.tool];
    const p = { id: 'p' + (S.next++), k: S.tool, x, y, d: def0.block || def0.single ? 'h' : d, f: 0, p: {} };
    if (!fits(p) || edgeBusy(p)) { flash('Здесь не помещается: выберите другое место.'); S.next--; return false; }
    S.parts.push(p);
    S.sel = p.id;
    refresh();
    return true;
  }
  function removeSel() {
    if (!S.sel) return;
    S.parts = S.parts.filter((p) => p.id !== S.sel);
    S.sel = null;
    refresh();
  }
  function flash(msg) {
    if (!ui.msg) return;
    ui.msg.textContent = msg;
    ui.msg.hidden = false;
    clearTimeout(flash.t);
    flash.t = setTimeout(() => { ui.msg.hidden = true; }, 2600);
  }

  /* ══════════════ проверка задания ══════════════ */
  function checkCtx() {
    return global.ElecParts.makeCtx(dump(), last ? last.kind : 'empty',
      last ? last.res : { elem: {}, warnings: [] });
  }

  function runCheck() {
    if (!S.exp || !S.exp.check) return;
    const ctx = checkCtx();
    let list;
    try { list = S.exp.check(ctx) || []; } catch (e) { list = [{ ok: false, text: 'Проверка не смогла разобрать схему: ' + e.message }]; }
    const okAll = list.length && list.every((x) => x.ok);
    let s = `<div class="verdict ${okAll ? 'good' : 'bad'}">${okAll ? 'Сходится: схема собрана правильно и показания те, что нужно.' : 'Пока не сходится — смотрите, что именно.'}</div><ul class="checks">`;
    list.forEach((x) => { s += `<li class="${x.ok ? 'ok' : 'no'}">${esc(x.text)}</li>`; });
    s += '</ul>';
    if (okAll && S.exp.why) s += `<div class="note tip"><b>Почему так.</b> ${S.exp.why}</div>`;
    ui.check.innerHTML = s;
    try { localStorage.setItem('elec.exp.done.' + S.exp.id, okAll ? '1' : '0'); } catch (e) { /* нет хранилища */ }
  }

  /* ══════════════ палитра ══════════════ */
  function paletteHtml() {
    let s = '';
    GROUPS.forEach((g) => {
      const keys = Object.keys(P).filter((k) => P[k].group === g);
      if (!keys.length) return;
      s += `<div class="pgroup"><div class="pgname">${esc(g)}</div><div class="pitems">`;
      keys.forEach((k) => {
        const d = P[k];
        s += `<button class="pitem" data-part="${k}" title="${esc(d.name + (d.gost ? ' · ' + d.gost : ''))}">`
          + `<svg viewBox="-6 -26 90 52" aria-hidden="true">${d.block ? d.drawBlock(56, 34, { p: {} }, values({ k, p: {} })) : d.draw(78, { p: {} }, values({ k, p: {} }), 0)}</svg>`
          + `<span>${esc(d.name)}</span></button>`;
      });
      s += '</div></div>';
    });
    return s;
  }

  /* ══════════════ события ══════════════ */
  function bind() {
    ui.palette.innerHTML = paletteHtml();
    ui.palette.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-part]');
      if (!b) return;
      S.tool = S.tool === b.dataset.part ? null : b.dataset.part;
      [...ui.palette.querySelectorAll('.pitem')].forEach((x) => x.classList.toggle('on', x.dataset.part === S.tool));
      ui.hintTool.textContent = S.tool
        ? 'Выбрано: ' + P[S.tool].name + '. Щёлкните по ребру сетки, чтобы поставить.'
        : 'Возьмите деталь из палитры.';
    });

    /* Точка щелчка в координатах поля и ближайшее к ней место для детали.
       Пока в руке деталь, щелчок ставит её в ближайшее ребро (или узел —
       для корпуса и блочных деталей), даже если сверху лежит другая деталь:
       иначе рядом с уже собранным участком некуда попасть. */
    const boardPoint = (ev) => {
      const svg = ui.board.querySelector('svg.board');
      const pt = svg.createSVGPoint();
      pt.x = ev.clientX; pt.y = ev.clientY;
      return pt.matrixTransform(svg.getScreenCTM().inverse());
    };
    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
    function nearestSlot(pt, byNode) {
      const bx = clamp(Math.round(pt.x / PITCH), 0, S.w - 1);
      const by = clamp(Math.round(pt.y / PITCH), 0, S.h - 1);
      if (byNode) return { x: bx, y: by, d: 'h' };
      const dx = pt.x - X(bx), dy = pt.y - Y(by);
      if (Math.abs(dx) >= Math.abs(dy)) {
        return { x: clamp(dx >= 0 ? bx : bx - 1, 0, S.w - 2), y: by, d: 'h' };
      }
      return { x: bx, y: clamp(dy >= 0 ? by : by - 1, 0, S.h - 2), d: 'v' };
    }

    ui.board.addEventListener('click', (ev) => {
      if (S.tool) {
        const d = P[S.tool];
        const slot = nearestSlot(boardPoint(ev), !!(d.single || d.block));
        S.cur = slot;
        place(slot.x, slot.y, slot.d);
        return;
      }
      const g = ev.target.closest('.part');
      if (g) {
        const p = S.parts.find((q) => q.id === g.dataset.id);
        if (p && P[p.k].toggle) {           // выключатель и кнопка щёлкают сразу
          p.p[P[p.k].toggle] = !values(p)[P[p.k].toggle];
          S.sel = p.id; refresh(); return;
        }
        S.sel = g.dataset.id;
        S.tool = null;
        [...ui.palette.querySelectorAll('.pitem')].forEach((x) => x.classList.remove('on'));
        refresh();
        return;
      }
      const line = ev.target.closest('[data-e]');
      if (line) {
        const [x, y, d] = line.dataset.e.split(',');
        S.cur = { x: +x, y: +y, d };
      }
      S.sel = null;
      refresh();
    });

    // перетаскивание уже поставленной детали
    ui.board.addEventListener('pointerdown', (ev) => {
      const g = ev.target.closest('.part');
      if (!g) return;
      const p = S.parts.find((q) => q.id === g.dataset.id);
      if (!p || P[p.k].toggle) return;
      S.drag = { id: p.id, ox: p.x, oy: p.y, moved: false };
    });
    ui.board.addEventListener('pointerup', (ev) => {
      if (!S.drag) return;
      const line = ev.target.closest('[data-e]');
      const p = S.parts.find((q) => q.id === S.drag.id);
      if (line && p) {
        const [x, y, d] = line.dataset.e.split(',');
        const old = { x: p.x, y: p.y, d: p.d };
        p.x = +x; p.y = +y;
        if (!P[p.k].block && !P[p.k].single) p.d = d;
        if (!fits(p) || edgeBusy(p, p.id)) { p.x = old.x; p.y = old.y; p.d = old.d; flash('Туда не помещается.'); }
        S.sel = p.id;
        refresh();
      }
      S.drag = null;
    });

    ui.props.addEventListener('input', (ev) => {
      const t = ev.target;
      if (!t.dataset.p) return;
      const p = S.parts.find((q) => q.id === S.sel);
      if (!p) return;
      if (t.type === 'checkbox') p.p[t.dataset.p] = t.checked;
      else if (t.type === 'number' || t.type === 'range') p.p[t.dataset.p] = parseFloat(String(t.value).replace(',', '.'));
      else p.p[t.dataset.p] = t.value;
      const out = t.parentElement.querySelector('output');
      if (out) out.textContent = fm(p.p[t.dataset.p], 2);
      last = analyse();
      draw();
      if (ui.readout) ui.readout.innerHTML = warnHtml() + readoutHtml();
      if (ui.scope) ui.scope.innerHTML = scopeSvg();
      if (ui.phasor) ui.phasor.innerHTML = phasorSvg();
      if (ui.link) ui.link.value = location.origin + location.pathname + '#s=' + encode(dump());
      save();
    });
    ui.props.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-act]');
      if (!b) return;
      const p = S.parts.find((q) => q.id === S.sel);
      if (!p) return;
      if (b.dataset.act === 'del') removeSel();
      else if (b.dataset.act === 'rot') {
        if (P[p.k].block || P[p.k].single) { flash('Эту деталь поворачивать некуда.'); return; }
        const old = p.d;
        p.d = p.d === 'h' ? 'v' : 'h';
        if (!fits(p) || edgeBusy(p, p.id)) { p.d = old; flash('Повернуть не выйдет: место занято.'); }
        refresh();
      } else if (b.dataset.act === 'flip') { p.f = p.f ? 0 : 1; refresh(); }
    });

    document.addEventListener('keydown', (ev) => {
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(ev.target.tagName)) return;
      const c = S.cur;
      let used = true;
      switch (ev.key) {
        case 'ArrowRight': c.x = Math.min(c.x + 1, S.w - 1); break;
        case 'ArrowLeft': c.x = Math.max(c.x - 1, 0); break;
        case 'ArrowDown': c.y = Math.min(c.y + 1, S.h - 1); break;
        case 'ArrowUp': c.y = Math.max(c.y - 1, 0); break;
        case 'r': case 'R': case 'к': case 'К': c.d = c.d === 'h' ? 'v' : 'h'; break;
        case 'Enter': case ' ':
          if (S.tool) place(c.x, c.y, c.d);
          else {
            const p = S.parts.find((q) => !P[q.k].block && !P[q.k].single && q.x === c.x && q.y === c.y && q.d === c.d);
            if (p) { S.sel = p.id; refresh(); }
          }
          break;
        case 'Delete': case 'Backspace': removeSel(); break;
        case 'Escape': S.tool = null; S.sel = null;
          [...ui.palette.querySelectorAll('.pitem')].forEach((x) => x.classList.remove('on'));
          refresh(); break;
        default: used = false;
      }
      if (used) { ev.preventDefault(); ui.board.dataset.kb = '1'; draw(); }
    });

    ui.bar.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-cmd]');
      if (!b) return;
      const cmd = b.dataset.cmd;
      if (cmd === 'clear') { S.parts = []; S.sel = null; refresh(); }
      else if (cmd === 'check') runCheck();
      else if (cmd === 'preset' && S.exp && S.exp.preset) { load(S.exp.preset()); refresh(); }
      else if (cmd === 'copy') {
        ui.link.select();
        try { document.execCommand('copy'); flash('Ссылка на схему скопирована.'); } catch (e) { flash('Скопируйте ссылку из поля вручную.'); }
      } else if (cmd === 'scope') {
        S.scope = !S.scope;
        b.classList.toggle('primary', S.scope);
        ui.scopeBox.hidden = !S.scope;
        refresh();
      }
    });
  }

  /* ══════════════ запуск ══════════════ */
  function start(opts) {
    ui = {
      palette: document.getElementById('palette'),
      board: document.getElementById('board'),
      props: document.getElementById('props'),
      readout: document.getElementById('readout'),
      scope: document.getElementById('scope'),
      scopeBox: document.getElementById('scopebox'),
      phasor: document.getElementById('phasor'),
      link: document.getElementById('link'),
      bar: document.getElementById('bar'),
      msg: document.getElementById('msg'),
      check: document.getElementById('check'),
      hintTool: document.getElementById('hint-tool'),
      task: document.getElementById('task'),
    };
    bind();

    // задание опыта из адресной строки
    const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
    const expId = hash.get('exp');
    const list = global.ElecExperiments || [];
    if (expId) S.exp = list.find((e) => String(e.id) === String(expId)) || null;
    if (S.exp && ui.task) {
      ui.task.innerHTML = `<h2>Опыт ${esc(String(S.exp.id))}. ${esc(S.exp.title)}</h2>`
        + `<p class="lead">${S.exp.task}</p>`
        + (S.exp.hint ? `<div class="note tip">${S.exp.hint}</div>` : '');
      document.getElementById('exp-tools').hidden = false;
      if (S.exp.question) {
        document.getElementById('question').innerHTML =
          `<h3>Вопрос на понимание</h3><p>${S.exp.question}</p>`
          + `<details class="q"><summary>Показать ответ</summary><p>${S.exp.answer}</p></details>`;
      }
    }
    if (ui.scopeBox) ui.scopeBox.hidden = true;

    const enc = hash.get('s');
    let loaded = false;
    // переход по ссылке вида #exp=12 внутри страницы: перечитываем задание
    window.addEventListener('hashchange', () => location.reload());

    if (enc) loaded = load(decode(enc));
    if (!loaded) loaded = restore();
    if (!loaded && S.exp && S.exp.preset) loaded = load(S.exp.preset());
    if (!loaded && opts && opts.demo) load(opts.demo());
    refresh();
  }

  global.ElecBuilder = { start, S, dump, load, encode, decode, refresh, netlist, analyse, values, designators };
}(window));
