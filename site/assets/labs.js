/* labs.js — лабораторные работы курса: таблица опыта с автопроверкой.
 *
 * Как это устроено. У каждой строки таблицы есть эталонная схема — та самая,
 * которую студент собирает в конструкторе. Страница прогоняет её через
 * решатель и получает «истинные» показания приборов. Дальше:
 *   * измеренные значения, введённые студентом, сверяются с показаниями
 *     приборов (допуск задаётся таблицей, обычно 5 %);
 *   * вычисленные значения (z, R_k, x_L, L, C …) сверяются с тем, что даёт
 *     формула от ЭТИХ ЖЕ введённых измерений — то есть проверяется арифметика,
 *     а не совпадение с «правильным ответом»;
 *   * сводная таблица собирается из средних по опытам.
 * Введённое сохраняется в localStorage, чтобы отчёт не терялся.
 *
 * Описание работы (см. lab1.html и соседние):
 *   ElecLab.render({
 *     key: 'lab1',
 *     tables: [{
 *       id, title, note,
 *       meas: [{k:'U', label:'U, В', digits:2}, …],   // что измеряется
 *       calc: [{k:'z', label:'z, Ом', f:(m)=>m.U/m.I, digits:2, note}], // что считается
 *       tol: 0.05,
 *       rows: [{cond:'R_min', schema: () => ({…}), }, …],
 *     }],
 *     summary: (data) => html,
 *   });
 */
'use strict';
(function (global) {
  const Elec = global.Elec;
  const Parts = global.ElecParts;
  const esc = Parts.esc;
  const fm = Parts.fm;

  /* Эталонные показания приборов схемы. По умолчанию столбец U читает первый
     вольтметр, I — первый амперметр, P — первый ваттметр; если приборов
     несколько, столбец задаёт своё правило через ref(m). */
  function reference(schema) {
    const a = Parts.analyse(schema, Elec, {});
    const ctx = Parts.makeCtx(schema, a.kind, a.res);
    return { ctx, kind: a.kind, res: a.res };
  }
  function refOf(col, r) {
    if (typeof col.ref === 'function') return col.ref(r._ref.ctx, r);
    const dflt = { U: ['VM', 0], I: ['AM', 0], P: ['WM', 0] }[col.k];
    return dflt ? r._ref.ctx.meter(dflt[0], dflt[1]) : undefined;
  }

  const num = (s) => {
    const v = parseFloat(String(s === undefined || s === null ? '' : s).replace(',', '.').replace(/\s+/g, ''));
    return isFinite(v) ? v : NaN;
  };

  function render(spec) {
    const mount = document.getElementById(spec.mount || 'lab');
    if (!mount) return;
    const KEY = 'elec.' + spec.key + '.v1';
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { saved = {}; }

    // эталон считаем один раз
    spec.tables.forEach((t) => t.rows.forEach((r) => { r._ref = reference(r.schema()); }));

    let html = '';
    spec.tables.forEach((t, ti) => {
      html += `<h3 id="t${esc(t.id)}">${esc(t.title)}</h3>`;
      if (t.note) html += `<p class="small">${t.note}</p>`;
      html += '<div class="labtable"><table class="el"><thead><tr><th>№</th><th>Условия опыта</th>';
      t.meas.forEach((m) => { html += `<th class="num">${esc(m.label)}</th>`; });
      t.calc.forEach((m) => { html += `<th class="num">${esc(m.label)}</th>`; });
      html += '<th>Схема</th></tr></thead><tbody>';
      t.rows.forEach((r, ri) => {
        html += `<tr data-t="${ti}" data-r="${ri}"><td>${ri + 1}</td><td>${esc(r.cond)}</td>`;
        t.meas.forEach((m) => {
          const v = (saved[t.id] && saved[t.id][ri] && saved[t.id][ri][m.k]) || '';
          html += `<td class="num"><input class="cell" data-t="${ti}" data-r="${ri}" data-k="${m.k}" value="${esc(v)}" inputmode="decimal" aria-label="${esc(m.label)}, опыт ${ri + 1}"></td>`;
        });
        t.calc.forEach((m) => {
          const v = (saved[t.id] && saved[t.id][ri] && saved[t.id][ri][m.k]) || '';
          html += `<td class="num"><input class="cell calc" data-t="${ti}" data-r="${ri}" data-k="${m.k}" value="${esc(v)}" inputmode="decimal" aria-label="${esc(m.label)}, опыт ${ri + 1}"></td>`;
        });
        html += `<td><a class="btn small-btn" target="_blank" rel="noopener" href="builder#s=${schemaLink(r.schema())}">собрать</a></td></tr>`;
      });
      html += '</tbody></table></div>';
      html += `<div class="rowbtn"><button class="btn primary" data-check="${ti}">проверить таблицу</button>`
        + `<button class="btn" data-hint="${ti}">показать эталонные показания</button></div>`;
      html += `<div class="labres" id="labres${ti}"></div>`;
    });
    if (spec.summary) html += '<div id="labsummary"></div>';
    mount.innerHTML = html;

    function collect(ti) {
      const t = spec.tables[ti];
      return t.rows.map((r, ri) => {
        const o = {};
        t.meas.concat(t.calc).forEach((m) => {
          const el = mount.querySelector(`input[data-t="${ti}"][data-r="${ri}"][data-k="${m.k}"]`);
          o[m.k] = el ? el.value : '';
        });
        return o;
      });
    }
    function store() {
      const out = {};
      spec.tables.forEach((t, ti) => { out[t.id] = collect(ti); });
      try { localStorage.setItem(KEY, JSON.stringify(out)); } catch (e) { /* нет хранилища */ }
      return out;
    }

    function check(ti) {
      const t = spec.tables[ti];
      const data = collect(ti);
      const lines = [];
      let bad = 0;
      t.rows.forEach((r, ri) => {
        const m = {};
        t.meas.forEach((q) => { m[q.k] = num(data[ri][q.k]); });
        // 1. измерения против показаний приборов
        t.meas.forEach((q) => {
          const ref = refOf(q, r);
          const cell = mount.querySelector(`input[data-t="${ti}"][data-r="${ri}"][data-k="${q.k}"]`);
          if (ref === undefined || !isFinite(ref)) return;
          const got = m[q.k];
          const tol = Math.max(Math.abs(ref) * (r.tol || t.tol || 0.05), q.abs || 0);
          const ok = isFinite(got) && Math.abs(got - ref) <= tol;
          if (cell) cell.classList.toggle('bad', !ok);
          if (cell) cell.classList.toggle('good', ok);
          if (!ok) {
            bad++;
            lines.push(`Опыт ${ri + 1} (${r.cond}): ${q.label} — у вас ${isFinite(got) ? fm(got, q.digits || 2) : '—'}, `
              + `прибор показывает ${fm(ref, q.digits || 2)}`);
          }
        });
        // 2. вычисленные величины против формулы от введённых измерений
        t.calc.forEach((q) => {
          const cell = mount.querySelector(`input[data-t="${ti}"][data-r="${ri}"][data-k="${q.k}"]`);
          const want = q.f(m, r);
          const got = num(data[ri][q.k]);
          if (!isFinite(want)) { if (cell) cell.classList.remove('bad', 'good'); return; }
          const tol = Math.max(Math.abs(want) * (q.tol || 0.03), q.abs || 0);
          const ok = isFinite(got) && Math.abs(got - want) <= tol;
          if (cell) cell.classList.toggle('bad', !ok);
          if (cell) cell.classList.toggle('good', ok);
          if (!ok) {
            bad++;
            lines.push(`Опыт ${ri + 1} (${r.cond}): ${q.label} — у вас ${isFinite(got) ? fm(got, q.digits || 2) : '—'}, `
              + `по вашим же измерениям выходит ${fm(want, q.digits || 3)}`
              + (q.note ? ' (' + q.note + ')' : ''));
          }
        });
      });
      const box = document.getElementById('labres' + ti);
      box.innerHTML = bad
        ? `<div class="verdict bad">Не сходится в ${bad} ${plural(bad, 'месте', 'местах', 'местах')}.</div>`
          + '<ul class="checks">' + lines.map((l) => `<li class="no">${esc(l)}</li>`).join('') + '</ul>'
        : '<div class="verdict good">Таблица заполнена верно: измерения совпадают с показаниями приборов, '
          + 'а вычисленные величины — с формулами.</div>';
      store();
      if (spec.summary) {
        document.getElementById('labsummary').innerHTML = spec.summary(store(), spec);
      }
    }

    function plural(n, a, b, c) {
      const m = n % 100, k = n % 10;
      if (m > 10 && m < 20) return c;
      if (k === 1) return a;
      if (k >= 2 && k <= 4) return b;
      return c;
    }

    mount.addEventListener('click', (ev) => {
      const c = ev.target.closest('[data-check]');
      if (c) { check(+c.dataset.check); return; }
      const h = ev.target.closest('[data-hint]');
      if (h) {
        const ti = +h.dataset.hint;
        const t = spec.tables[ti];
        let s = '<table class="el"><thead><tr><th>Опыт</th>'
          + t.meas.map((m) => `<th class="num">${esc(m.label)}</th>`).join('') + '</tr></thead><tbody>';
        t.rows.forEach((r, ri) => {
          s += `<tr><td>${esc(r.cond)}</td>`
            + t.meas.map((m) => { const v = refOf(m, r); return `<td class="num">${isFinite(v) ? fm(v, m.digits || 2) : '—'}</td>`; }).join('')
            + '</tr>';
        });
        s += '</tbody></table>';
        document.getElementById('labres' + ti).innerHTML =
          '<div class="note tip"><b>Эталонные показания приборов.</b> Это то, что покажет собранная '
          + 'в конструкторе схема. Сверяйтесь с ними, только если совсем застряли — смысл работы в том, '
          + 'чтобы снять показания самому.</div>' + s;
      }
    });
    mount.addEventListener('input', (ev) => { if (ev.target.classList.contains('cell')) store(); });
  }

  /* Кодирование схемы в ссылку — то же, что в конструкторе. */
  function schemaLink(obj) {
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    let bin = '';
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  global.ElecLab = { render, reference, schemaLink };
}(window));
