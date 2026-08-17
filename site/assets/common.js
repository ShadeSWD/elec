/* Общие помощники живых расчётов: разбор чисел из полей ввода, форматирование
 * с запятой, экранирование и «серая» подстановка в строке вывода.
 * Подключается первым, до site.js и скриптов конкретных страниц. */
'use strict';

/* Число из строки: запятая как разделитель, пробелы игнорируются. */
const num = (s) => {
  if (s === null || s === undefined) return 0;
  const v = parseFloat(String(s).replace(',', '.').replace(/\s+/g, ''));
  return isFinite(v) ? v : 0;
};

/* Число с запятой; по умолчанию один знак после запятой. */
const fmt = (x, d) => {
  if (!isFinite(x)) return '—';
  return x.toFixed(d === undefined ? 1 : d).replace('.', ',');
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* Подстановка чисел в формулу — серым. */
const gray = (s) => '<span style="color:#6b6b74">' + s + '</span>';

/* Выполнить действие, когда разметка страницы полностью разобрана. */
const onReady = (fn) => (document.readyState === 'loading'
  ? document.addEventListener('DOMContentLoaded', fn) : fn());
