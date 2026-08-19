/* Данные каркаса страниц. Машинерия — assets/shell.js. */
'use strict';
(function () {
  const me = document.currentScript;
  const root = (me && me.dataset.root) || './';
  buildSiteShell({
    root,
    page: (me && me.dataset.page) || '',
    brand: 'Корабельное электрооборудование',
    logo: `
  <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
    <rect x="1" y="1" width="28" height="28" rx="6" fill="#b45309"/>
    <text x="15" y="22" text-anchor="middle" font-size="17">⚡</text>
  </svg>`,
    nav: [
      { h: '', k: 'index', t: 'Обзор' },
      { t: 'Теория', h: 'theory', drop: [
        { h: 'theory', k: 'theory', t: 'Оглавление курса' },
        { h: 't-dc', k: 'theory', t: '1. Цепи постоянного тока' },
        { h: 't-ac', k: 'theory', t: '2. Однофазные цепи переменного тока' },
        { h: 't-three', k: 'theory', t: '3. Трёхфазные цепи' },
        { h: 't-transformer', k: 'theory', t: '4. Трансформаторы' },
        { h: 't-machines', k: 'theory', t: '5. Электрические машины' },
        { h: 't-shipnet', k: 'theory', t: '6. Судовая электроэнергетическая система' },
        { h: 't-drives', k: 'theory', t: '7. Судовые электроприводы' },
        { h: 't-safety', k: 'theory', t: '8. Электробезопасность и заземление' },
      ] },
      { t: 'Задачи', h: 'tasks', drop: [
        { h: 'tasks', k: 'tasks', t: 'Все разборы' },
        { h: 'p-dc', k: 'tasks', t: 'Цепи постоянного тока' },
        { h: 'p-ac', k: 'tasks', t: 'Цепи переменного тока' },
        { h: 'p-three', k: 'tasks', t: 'Трёхфазные цепи' },
        { h: 'p-machines', k: 'tasks', t: 'Трансформатор и двигатель' },
        { h: 'p-ship', k: 'tasks', t: 'Судовое электрооборудование' },
      ] },
      { h: 'sources', k: 'sources', t: 'Источники' },
    ],
    footer: `<div>Учебный сайт по курсам «Электротехника» и «Электрооборудование и энергоустановки кораблей и судов» · 4-й семестр</div>
    <div><a href="https://shadeswd.duckdns.org/">Ко всем учебным проектам</a></div>`,
  });
})();
