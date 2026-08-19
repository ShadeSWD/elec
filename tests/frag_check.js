/* Проверка «куска» книжки опытов: файл с одними только вызовами add({…}).
 * Разворачивается в тот же контекст, что и experiments-data.js, и прогоняется
 * тем же способом: solution() должна пройти автопроверку, wrong() — не пройти.
 *
 * Запуск: node tests/frag_check.js <файл-фрагмент> [--verbose]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const Elec = require('../site/assets/solver.js');
const Parts = require('../site/assets/parts.js');

const file = process.argv[2];
if (!file) { console.error('укажите файл-фрагмент'); process.exit(2); }
const src = fs.readFileSync(path.resolve(file), 'utf8');

const S = (list, w, h) => ({
  v: 1, w: w || 9, h: h || 6,
  parts: list.filter(Boolean).map((a, i) => ({
    id: 'p' + (i + 1), k: a[0], x: a[1], y: a[2],
    d: a[3] || 'h', f: a[4] || 0, p: a[5] || {},
  })),
});
const W = (x, y, d) => ['WIRE', x, y, d || 'h'];
const row = (x0, x1, y) => { const a = []; for (let x = x0; x < x1; x++) a.push(W(x, y)); return a; };
const col = (x, y0, y1) => { const a = []; for (let y = y0; y < y1; y++) a.push(W(x, y, 'v')); return a; };

const E = [];
const add = (o) => { E.push(o); return o; };
// eslint-disable-next-line no-eval
eval(src);

let bad = 0;
E.forEach((exp) => {
  const line = [];
  const run = (schema) => {
    const a = Parts.analyse(schema, Elec, {});
    const ctx = Parts.makeCtx(schema, a.kind, a.res);
    const list = exp.check(ctx) || [];
    return { all: list.length > 0 && list.every((x) => x.ok), list, kind: a.kind, res: a.res };
  };
  try {
    const v = run(exp.solution());
    if (!v.all) {
      bad++;
      line.push('РЕШЕНИЕ НЕ ПРОХОДИТ [' + v.kind + ']');
      v.list.filter((x) => !x.ok).forEach((x) => line.push('    ✗ ' + x.text));
      (v.res.warnings || []).forEach((x) => line.push('    ! ' + x.text));
    }
    if (typeof exp.wrong === 'function') {
      if (run(exp.wrong()).all) { bad++; line.push('ОШИБОЧНАЯ СХЕМА ЗАСЧИТАНА КАК ВЕРНАЯ'); }
    } else { bad++; line.push('нет wrong()'); }
    exp.preset();
    ['task', 'question', 'answer', 'why'].forEach((k) => {
      if (!exp[k]) { bad++; line.push('нет поля ' + k); }
    });
  } catch (e) {
    bad++; line.push('ОШИБКА: ' + (e && e.stack ? e.stack.split('\n').slice(0, 2).join(' | ') : e));
  }
  if (line.length || process.argv.includes('--verbose')) {
    console.log('#' + exp.id + ' ' + exp.title + (line.length ? '' : ' — ок'));
    line.forEach((l) => console.log('   ' + l));
  }
});
console.log('опытов в файле: ' + E.length + ', замечаний: ' + bad);
process.exit(bad ? 1 : 0);
