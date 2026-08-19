/* Прогон книжки опытов под node: для каждого опыта проверяем, что
 * «правильная» схема (solution) проходит автопроверку, а «неправильная»
 * (wrong) — не проходит. Работают ровно те же файлы, что и на странице.
 *
 * Запуск: node tests/exp_harness.js  → JSON с результатом по каждому опыту.
 */
'use strict';
const Elec = require('../site/assets/solver.js');
const Parts = require('../site/assets/parts.js');
const EXPS = require('../site/assets/experiments-data.js');

function verdict(exp, schema) {
  const a = Parts.analyse(schema, Elec, {});
  const ctx = Parts.makeCtx(schema, a.kind, a.res);
  const list = exp.check(ctx) || [];
  return { all: list.length > 0 && list.every((x) => x.ok), list, kind: a.kind };
}

const out = [];
EXPS.forEach((exp) => {
  const rec = { id: exp.id, sec: exp.sec, title: exp.title,
    hasSolution: typeof exp.solution === 'function',
    hasWrong: typeof exp.wrong === 'function' };
  try {
    if (rec.hasSolution) {
      const v = verdict(exp, exp.solution());
      rec.solutionOk = v.all;
      rec.kind = v.kind;
      rec.fails = v.list.filter((x) => !x.ok).map((x) => x.text);
      rec.checks = v.list.length;
    }
    if (rec.hasWrong) rec.wrongRejected = !verdict(exp, exp.wrong()).all;
    if (typeof exp.preset === 'function') {
      exp.preset();                       // не должен падать
      rec.presetOk = true;
    }
  } catch (e) {
    rec.error = String(e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e);
  }
  out.push(rec);
});
process.stdout.write(JSON.stringify(out, null, 1));
