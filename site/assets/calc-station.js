/* Живой расчёт: нагрузка судовой электростанции табличным методом.
   Разворачивается в элементе #cs-root страницы t-shipnet. */
'use strict';
(function () {
  const root = document.getElementById('cs-root');
  if (!root) return;

  /* ---------- режимы работы судна ---------- */
  const MODES = [
    { k: 'sea', t: 'Ходовой' },
    { k: 'port', t: 'Стоянка' },
    { k: 'cargo', t: 'Грузовые операции' },
    { k: 'emg', t: 'Аварийный' }
  ];

  /* ---------- исходное наполнение: танкер-продуктовоз ----------
     n — наименование, p — установленная мощность, кВт, e — КПД,
     c — коэффициент мощности, m — [kз, kо] по режимам. */
  const START = [
    { n: 'Рулевая машина (2 × 15)', p: 30, e: 0.84, c: 0.78,
      m: { sea: [0.35, 0.50], port: [0, 0], cargo: [0, 0], emg: [0.35, 0.50] } },
    { n: 'Брашпиль и швартовные лебёдки', p: 45, e: 0.85, c: 0.75,
      m: { sea: [0, 0], port: [0.60, 0.50], cargo: [0, 0], emg: [0, 0] } },
    { n: 'Грузовые насосы (2 × 90)', p: 180, e: 0.91, c: 0.86,
      m: { sea: [0, 0], port: [0, 0], cargo: [0.85, 1.00], emg: [0, 0] } },
    { n: 'Зачистной насос', p: 30, e: 0.88, c: 0.84,
      m: { sea: [0, 0], port: [0, 0], cargo: [0.70, 0.50], emg: [0, 0] } },
    { n: 'Балластные насосы (2 × 55)', p: 110, e: 0.90, c: 0.85,
      m: { sea: [0, 0], port: [0.60, 0.50], cargo: [0.80, 0.50], emg: [0, 0] } },
    { n: 'Насосы охлаждения главного двигателя', p: 40, e: 0.86, c: 0.84,
      m: { sea: [0.80, 0.75], port: [0, 0], cargo: [0, 0], emg: [0, 0] } },
    { n: 'Топливные, масляные насосы и сепараторы', p: 26, e: 0.82, c: 0.80,
      m: { sea: [0.70, 0.80], port: [0.50, 0.50], cargo: [0.70, 0.80], emg: [0, 0] } },
    { n: 'Компрессоры пускового воздуха (2 × 15)', p: 30, e: 0.87, c: 0.82,
      m: { sea: [0.65, 0.50], port: [0.50, 0.50], cargo: [0.50, 0.50], emg: [0, 0] } },
    { n: 'Вентиляторы машинного отделения (2 × 18,5)', p: 37, e: 0.88, c: 0.83,
      m: { sea: [0.80, 1.00], port: [0.60, 0.50], cargo: [0.80, 1.00], emg: [0, 0] } },
    { n: 'Вентиляция грузовой зоны, газоанализ', p: 22, e: 0.86, c: 0.80,
      m: { sea: [0.40, 0.50], port: [0.50, 0.50], cargo: [0.90, 1.00], emg: [0, 0] } },
    { n: 'Насосы мойки танков и подогрева груза', p: 35, e: 0.89, c: 0.85,
      m: { sea: [0, 0], port: [0, 0], cargo: [0.70, 0.50], emg: [0, 0] } },
    { n: 'Пожарные и осушительные насосы', p: 40, e: 0.88, c: 0.85,
      m: { sea: [0.30, 0.50], port: [0.30, 0.50], cargo: [0.50, 0.50], emg: [0.80, 0.50] } },
    { n: 'Кондиционирование и вентиляция жилых помещений', p: 45, e: 0.87, c: 0.82,
      m: { sea: [0.70, 0.80], port: [0.70, 0.80], cargo: [0.70, 0.80], emg: [0, 0] } },
    { n: 'Гидрофоры, опреснитель, санитарные насосы', p: 18, e: 0.84, c: 0.82,
      m: { sea: [0.60, 0.50], port: [0.60, 0.50], cargo: [0.60, 0.50], emg: [0, 0] } },
    { n: 'Камбуз и бытовое оборудование', p: 35, e: 1.00, c: 1.00,
      m: { sea: [0.60, 0.50], port: [0.60, 0.50], cargo: [0.50, 0.50], emg: [0, 0] } },
    { n: 'Освещение общесудовое', p: 24, e: 1.00, c: 0.95,
      m: { sea: [0.90, 0.90], port: [0.90, 0.90], cargo: [0.90, 1.00], emg: [0, 0] } },
    { n: 'Аварийное освещение и сигнализация', p: 8, e: 1.00, c: 0.95,
      m: { sea: [0.30, 1.00], port: [0.30, 1.00], cargo: [0.30, 1.00], emg: [1.00, 1.00] } },
    { n: 'Навигация, радиосвязь, автоматика', p: 12, e: 0.90, c: 0.85,
      m: { sea: [0.80, 1.00], port: [0.50, 1.00], cargo: [0.60, 1.00], emg: [0.80, 1.00] } }
  ];

  /* ---------- утилиты ---------- */
  const clone = (r) => ({
    n: r.n, p: r.p, e: r.e, c: r.c,
    m: {
      sea: r.m.sea.slice(), port: r.m.port.slice(),
      cargo: r.m.cargo.slice(), emg: r.m.emg.slice()
    }
  });

  let rows = START.map(clone);
  let mode = 'sea';

  /* ---------- расчёт одной строки ---------- */
  function calcRow(r, mk) {
    const kk = r.m[mk] || [0, 0];
    const p = num(r.p), e = num(r.e), c = num(r.c);
    const kz = num(kk[0]), ko = num(kk[1]);
    const P = (e > 0 && p > 0) ? p * kz * ko / e : 0;
    let tg = 0;
    if (c > 0 && c < 1) tg = Math.sqrt(1 - c * c) / c;
    return { P: P, Q: P * tg };
  }

  /* ---------- разметка ---------- */
  root.innerHTML =
    '<div class="controls">' +
      '<label>Режим работы судна ' +
        '<select id="cs-mode">' +
          MODES.map((m) => '<option value="' + m.k + '">' + m.t + '</option>').join('') +
        '</select></label>' +
      '<label>Напряжение сети, В <input type="text" inputmode="decimal" id="cs-u" ' +
        'value="400" style="width:70px"></label>' +
      '<label>Потери в сети, % <input type="text" inputmode="decimal" id="cs-d" ' +
        'value="4" style="width:60px"></label>' +
      '<label>Мощность одного ДГ, кВт <input type="text" inputmode="decimal" id="cs-pg" ' +
        'value="250" style="width:70px"></label>' +
      '<label>Мощность АДГ, кВт <input type="text" inputmode="decimal" id="cs-pa" ' +
        'value="60" style="width:70px"></label>' +
      '<button type="button" class="btn" id="cs-add">+ строка</button>' +
      '<button type="button" class="btn" id="cs-reset">Сброс</button>' +
    '</div>' +
    '<div id="cs-tw"></div>' +
    '<div class="out" id="cs-out"></div>';

  const tw = root.querySelector('#cs-tw');
  const out = root.querySelector('#cs-out');
  const selMode = root.querySelector('#cs-mode');

  function inp(cls, val, w) {
    return '<input type="text" inputmode="decimal" class="' + cls + '" value="' +
      esc(val) + '" style="width:' + w + 'px">';
  }

  function buildTable() {
    let h = '<table class="el" id="cs-tab"><thead><tr>' +
      '<th>Потребитель</th>' +
      '<th class="num">P<sub>уст</sub>, кВт</th>' +
      '<th class="num">η</th>' +
      '<th class="num">cos φ</th>' +
      '<th class="num">k<sub>з</sub></th>' +
      '<th class="num">k<sub>о</sub></th>' +
      '<th class="num">P, кВт</th>' +
      '<th class="num">Q, квар</th>' +
      '<th></th></tr></thead><tbody>';
    rows.forEach((r, i) => {
      const kk = r.m[mode] || [0, 0];
      h += '<tr data-i="' + i + '">' +
        '<td><input type="text" class="cs-n" value="' + esc(r.n) + '" style="width:210px"></td>' +
        '<td class="num">' + inp('cs-p', r.p, 62) + '</td>' +
        '<td class="num">' + inp('cs-e', r.e, 52) + '</td>' +
        '<td class="num">' + inp('cs-c', r.c, 52) + '</td>' +
        '<td class="num">' + inp('cs-kz', kk[0], 52) + '</td>' +
        '<td class="num">' + inp('cs-ko', kk[1], 52) + '</td>' +
        '<td class="num"><b class="cs-rp">0</b></td>' +
        '<td class="num"><span class="cs-rq">0</span></td>' +
        '<td><button type="button" class="btn cs-del" title="удалить строку" ' +
          'style="padding:2px 8px">×</button></td>' +
        '</tr>';
    });
    h += '</tbody><tfoot><tr>' +
      '<th>Итого по потребителям</th><th class="num" id="cs-sp">0</th>' +
      '<th></th><th></th><th></th><th></th>' +
      '<th class="num" id="cs-sP">0</th><th class="num" id="cs-sQ">0</th><th></th>' +
      '</tr></tfoot></table>';
    tw.innerHTML = h;
    recalc();
  }

  /* ---------- пересчёт ---------- */
  function recalc() {
    const U = num(root.querySelector('#cs-u').value);
    const d = num(root.querySelector('#cs-d').value) / 100;
    const Pg = num(root.querySelector('#cs-pg').value);
    const Pa = num(root.querySelector('#cs-pa').value);
    let sP = 0, sQ = 0, sInst = 0;
    const trs = tw.querySelectorAll('tbody tr');
    rows.forEach((r, i) => {
      const v = calcRow(r, mode);
      sP += v.P; sQ += v.Q; sInst += num(r.p);
      const tr = trs[i];
      if (!tr) return;
      tr.querySelector('.cs-rp').textContent = fmt(v.P, 1);
      tr.querySelector('.cs-rq').textContent = fmt(v.Q, 1);
    });
    const eInst = tw.querySelector('#cs-sp');
    if (eInst) eInst.textContent = fmt(sInst, 0);
    const eP = tw.querySelector('#cs-sP');
    if (eP) eP.textContent = fmt(sP, 1);
    const eQ = tw.querySelector('#cs-sQ');
    if (eQ) eQ.textContent = fmt(sQ, 1);

    const kd = 1 + (d > 0 ? d : 0);
    const Pr = sP * kd, Qr = sQ * kd;
    const Sr = Math.sqrt(Pr * Pr + Qr * Qr);
    const cosr = Sr > 0 ? Pr / Sr : 0;
    const Ir = (U > 0 && Sr > 0) ? Sr * 1000 / (Math.sqrt(3) * U) : 0;

    const emg = mode === 'emg';
    const Pun = emg ? Pa : Pg;
    let n = 0, load = 0;
    if (Pun > 0 && Pr > 0) {
      n = Math.ceil(Pr / (0.9 * Pun));
      if (n < 1) n = 1;
      load = Pr / (n * Pun) * 100;
    }
    const okLoad = (load >= 70 && load <= 90);
    const src = emg ? 'аварийный дизель-генератор' : 'основной дизель-генератор';

    let h = '';
    h += '<div>Установленная мощность потребителей режима: <b>' + fmt(sInst, 0) +
      ' кВт</b>; сумма потребляемых мощностей: <b>' + fmt(sP, 1) + ' кВт</b></div>';
    h += '<div>Расчётная активная мощность с учётом потерь в сети: ' +
      gray(fmt(sP, 1) + ' · ' + fmt(kd, 2)) + ' = <b>' + fmt(Pr, 1) + ' кВт</b></div>';
    h += '<div>Расчётная реактивная мощность: <b>' + fmt(Qr, 1) + ' квар</b>; ' +
      'полная мощность ' + gray('√(' + fmt(Pr, 1) + '² + ' + fmt(Qr, 1) + '²)') + ' = <b>' + fmt(Sr, 1) + ' кВ·А</b></div>';
    h += '<div>Средневзвешенный коэффициент мощности: ' +
      gray(fmt(Pr, 1) + ' / ' + fmt(Sr, 1)) + ' = <b>' + fmt(cosr, 3) + '</b>; ток шин при ' + fmt(U, 0) + ' В — <b>' +
      fmt(Ir, 0) + ' А</b></div>';
    if (n > 0) {
      h += '<div>Требуется генераторов (' + src + ' по ' + fmt(Pun, 0) + ' кВт): <b>' +
        n + '</b>; загрузка каждого ' +
        gray(fmt(Pr, 1) + ' / (' + n + ' · ' + fmt(Pun, 0) + ')') + ' = <b>' + fmt(load, 1) + ' %</b></div>';
      h += '<div><span class="badge ' + (okLoad ? 'ok' : 'bad') + '">' +
        (okLoad
          ? 'Загрузка в рекомендуемом диапазоне 70…90 %'
          : (load < 70
            ? 'Загрузка ниже 70 % — дизель работает неэкономично, требуется генератор меньшей мощности или иное число агрегатов'
            : 'Загрузка выше 90 % — нет запаса на пуск крупного двигателя и наброс нагрузки')) +
        '</span></div>';
    } else {
      h += '<div><span class="badge bad">Нагрузка режима нулевая: задайте мощности ' +
        'потребителей и коэффициенты</span></div>';
    }
    out.innerHTML = h;
  }

  /* ---------- события ---------- */
  tw.addEventListener('input', (ev) => {
    const tr = ev.target.closest ? ev.target.closest('tr') : null;
    if (!tr) return;
    const i = parseInt(tr.getAttribute('data-i'), 10);
    const r = rows[i];
    if (!r) return;
    const cl = ev.target.className;
    const v = ev.target.value;
    if (cl === 'cs-n') r.n = v;
    else if (cl === 'cs-p') r.p = num(v);
    else if (cl === 'cs-e') r.e = num(v);
    else if (cl === 'cs-c') r.c = num(v);
    else if (cl === 'cs-kz') r.m[mode][0] = num(v);
    else if (cl === 'cs-ko') r.m[mode][1] = num(v);
    recalc();
  });

  tw.addEventListener('click', (ev) => {
    const b = ev.target;
    if (!b.classList || !b.classList.contains('cs-del')) return;
    const tr = b.closest('tr');
    const i = parseInt(tr.getAttribute('data-i'), 10);
    if (i >= 0 && i < rows.length) {
      rows.splice(i, 1);
      buildTable();
    }
  });

  root.querySelector('#cs-add').addEventListener('click', () => {
    rows.push({
      n: 'Новый потребитель', p: 10, e: 0.85, c: 0.80,
      m: { sea: [0.5, 1], port: [0.5, 1], cargo: [0.5, 1], emg: [0, 0] }
    });
    buildTable();
  });

  root.querySelector('#cs-reset').addEventListener('click', () => {
    rows = START.map(clone);
    mode = 'sea';
    selMode.value = 'sea';
    root.querySelector('#cs-u').value = '400';
    root.querySelector('#cs-d').value = '4';
    root.querySelector('#cs-pg').value = '250';
    root.querySelector('#cs-pa').value = '60';
    buildTable();
  });

  selMode.addEventListener('change', () => {
    mode = selMode.value;
    buildTable();
  });

  ['#cs-u', '#cs-d', '#cs-pg', '#cs-pa'].forEach((id) => {
    root.querySelector(id).addEventListener('input', recalc);
  });

  buildTable();
})();
