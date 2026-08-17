/* Живой расчёт: выбор сечения судового кабеля по нагреву, потере напряжения
   и термической стойкости при коротком замыкании.
   Разворачивается в элементе #cc-root страницы t-shipnet. */
'use strict';
(function () {
  const root = document.getElementById('cc-root');
  if (!root) return;

  /* стандартный ряд сечений, мм² */
  const S_ROW = [1, 1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240];
  /* длительно допустимый ток одножильного судового кабеля с изоляцией на 85 °C
     при температуре окружающего воздуха 45 °C, А (учебная таблица) */
  const I_ROW = [17, 23, 30, 40, 52, 72, 96, 127, 157, 196, 242, 293, 339, 389, 444, 522];

  const RHO = 0.0175;   /* Ом·мм²/м, медь */
  const C_CU = 141;     /* коэффициент термической стойкости медной жилы */
  const T_ISO = 85;     /* предельная температура жилы, °C */
  const T_BASE = 45;    /* температура, для которой составлена таблица, °C */

  /* сечение: целые без десятичного знака, 1,5 и 2,5 — с одним */
  const fs = (x) => (Math.abs(x - Math.round(x)) < 1e-9 ? String(Math.round(x)) : fmt(x, 1));

  root.innerHTML =
    '<div class="controls">' +
      '<label>Род тока <select id="cc-kind">' +
        '<option value="3">Трёхфазный</option>' +
        '<option value="1">Однофазный</option>' +
        '<option value="0">Постоянный</option>' +
      '</select></label>' +
      '<label>Задано <select id="cc-by">' +
        '<option value="p">мощностью</option>' +
        '<option value="i">током</option>' +
      '</select></label>' +
      '<label id="cc-lp">Мощность, кВт <input type="text" inputmode="decimal" id="cc-p" ' +
        'value="90" style="width:70px"></label>' +
      '<label id="cc-li" style="display:none">Ток, А <input type="text" inputmode="decimal" ' +
        'id="cc-i" value="166" style="width:70px"></label>' +
      '<label>Напряжение, В <input type="text" inputmode="decimal" id="cc-u" ' +
        'value="400" style="width:70px"></label>' +
      '<label id="cc-lc">cos φ <input type="text" inputmode="decimal" id="cc-cos" ' +
        'value="0,86" style="width:58px"></label>' +
      '<label id="cc-le">КПД η <input type="text" inputmode="decimal" id="cc-eta" ' +
        'value="0,91" style="width:58px"></label>' +
      '<label>Длина трассы, м <input type="text" inputmode="decimal" id="cc-l" ' +
        'value="55" style="width:64px"></label>' +
      '<label>Температура среды, °C <input type="text" inputmode="decimal" id="cc-t" ' +
        'value="45" style="width:58px"></label>' +
      '<label>Допустимая потеря U, % <input type="text" inputmode="decimal" id="cc-du" ' +
        'value="6" style="width:58px"></label>' +
      '<label>Число жил <select id="cc-cores">' +
        '<option value="1">1 (одножильный)</option>' +
        '<option value="2">2</option>' +
        '<option value="3" selected>3…4</option>' +
      '</select></label>' +
      '<label>Ток КЗ, кА <input type="text" inputmode="decimal" id="cc-ik" ' +
        'value="7" style="width:58px"></label>' +
      '<label>Время отключения, с <input type="text" inputmode="decimal" id="cc-tk" ' +
        'value="0,1" style="width:58px"></label>' +
    '</div>' +
    '<div class="out" id="cc-out"></div>';

  const $ = (id) => root.querySelector(id);
  const out = $('#cc-out');

  function pick(minS) {
    for (let i = 0; i < S_ROW.length; i++) if (S_ROW[i] >= minS - 1e-9) return i;
    return -1;
  }

  function recalc() {
    const kind = $('#cc-kind').value;      /* '3' | '1' | '0' */
    const by = $('#cc-by').value;
    const U = num($('#cc-u').value);
    const P = num($('#cc-p').value) * 1000;
    const Ig = num($('#cc-i').value);
    const dc = (kind === '0');
    const cos = dc ? 1 : Math.min(1, Math.max(0, num($('#cc-cos').value)));
    const eta = num($('#cc-eta').value);
    const L = num($('#cc-l').value);
    const t = num($('#cc-t').value);
    const duP = num($('#cc-du').value);
    const cores = $('#cc-cores').value;
    const Ik = num($('#cc-ik').value) * 1000;
    const tk = num($('#cc-tk').value);

    /* показываем только нужные поля */
    $('#cc-lp').style.display = (by === 'p') ? '' : 'none';
    $('#cc-li').style.display = (by === 'i') ? '' : 'none';
    $('#cc-lc').style.display = dc ? 'none' : '';
    $('#cc-le').style.display = (by === 'p') ? '' : 'none';

    let h = '';

    /* 1. расчётный ток */
    let I = 0, iForm = '', iSub = '';
    if (by === 'i') {
      I = Ig;
      iForm = 'Задан непосредственно';
      iSub = fmt(I, 1) + ' А';
    } else if (U > 0 && eta > 0 && cos > 0) {
      if (kind === '3') {
        I = P / (Math.sqrt(3) * U * cos * eta);
        iForm = 'I = P / (√3 · U · cos φ · η)';
        iSub = fmt(P, 0) + ' / (1,732 · ' + fmt(U, 0) + ' · ' + fmt(cos, 2) + ' · ' + fmt(eta, 2) + ')';
      } else if (kind === '1') {
        I = P / (U * cos * eta);
        iForm = 'I = P / (U · cos φ · η)';
        iSub = fmt(P, 0) + ' / (' + fmt(U, 0) + ' · ' + fmt(cos, 2) + ' · ' + fmt(eta, 2) + ')';
      } else {
        I = P / (U * eta);
        iForm = 'I = P / (U · η)';
        iSub = fmt(P, 0) + ' / (' + fmt(U, 0) + ' · ' + fmt(eta, 2) + ')';
      }
    }
    if (!(I > 0) || !(U > 0)) {
      out.innerHTML = '<div><span class="badge bad">Задайте ненулевые напряжение, ' +
        'мощность (или ток), КПД и коэффициент мощности</span></div>';
      return;
    }
    h += (by === 'i')
      ? '<div><b>1. Расчётный ток.</b> Задан непосредственно: <b>' + fmt(I, 1) + ' А</b></div>'
      : '<div><b>1. Расчётный ток.</b> ' + iForm + ' = ' + gray(iSub) +
        ' = <b>' + fmt(I, 1) + ' А</b></div>';

    /* 2. по нагреву */
    let k1 = 0;
    if (t < T_ISO) k1 = Math.sqrt((T_ISO - t) / (T_ISO - T_BASE));
    const k2 = (cores === '1') ? 1 : (cores === '2' ? 0.85 : 0.70);
    if (!(k1 > 0)) {
      out.innerHTML = h + '<div><span class="badge bad">Температура среды ' + fmt(t, 0) +
        ' °C не ниже предельной температуры жилы 85 °C — кабель с такой изоляцией ' +
        'применять нельзя</span></div>';
      return;
    }
    const Ineed = I / (k1 * k2);
    let iHeat = -1;
    for (let i = 0; i < I_ROW.length; i++) {
      if (I_ROW[i] >= Ineed) { iHeat = i; break; }
    }
    h += '<div><b>2. По нагреву.</b> Поправка на температуру ' +
      'k₁ = √((85 − t) / 40) = ' + gray('√((85 − ' + fmt(t, 0) + ') / 40)') +
      ' = <b>' + fmt(k1, 3) + '</b>; поправка на число жил k₂ = <b>' + fmt(k2, 2) + '</b></div>';
    h += '<div>Требуемый табличный ток: I<sub>доп</sub> ≥ I / (k₁ · k₂) = ' +
      gray(fmt(I, 1) + ' / (' + fmt(k1, 3) + ' · ' + fmt(k2, 2) + ')') +
      ' = <b>' + fmt(Ineed, 1) + ' А</b></div>';
    if (iHeat < 0) {
      h += '<div><span class="badge bad">Ни одно сечение ряда до 240 мм² не проходит ' +
        'по нагреву — линию выполняют двумя и более параллельными кабелями</span></div>';
      out.innerHTML = h;
      return;
    }
    h += '<div>Ближайшее сечение ряда: <b>' + fs(S_ROW[iHeat]) + ' мм²</b> ' +
      '(табличный ток ' + fmt(I_ROW[iHeat], 0) + ' А, с поправками ' +
      fmt(I_ROW[iHeat] * k1 * k2, 1) + ' А)</div>';

    /* 3. по потере напряжения */
    const dUdop = U * duP / 100;
    let Sdu = 0, duForm = '', duNum = '';
    if (kind === '3') {
      duNum = '1,732 · 0,0175 · ' + fmt(L, 0) + ' · ' + fmt(I, 1) + ' · ' + fmt(cos, 2);
      duForm = 'S ≥ √3 · ρ · L · I · cos φ / ΔU';
      if (dUdop > 0) Sdu = Math.sqrt(3) * RHO * L * I * cos / dUdop;
    } else if (kind === '1') {
      duNum = '2 · 0,0175 · ' + fmt(L, 0) + ' · ' + fmt(I, 1) + ' · ' + fmt(cos, 2);
      duForm = 'S ≥ 2 · ρ · L · I · cos φ / ΔU';
      if (dUdop > 0) Sdu = 2 * RHO * L * I * cos / dUdop;
    } else {
      duNum = '2 · 0,0175 · ' + fmt(L, 0) + ' · ' + fmt(I, 1);
      duForm = 'S ≥ 2 · ρ · L · I / ΔU';
      if (dUdop > 0) Sdu = 2 * RHO * L * I / dUdop;
    }
    const duSub = duNum + ' / ' + fmt(dUdop, 1);
    const iDu = Sdu > 0 ? pick(Sdu) : 0;
    h += '<div><b>3. По потере напряжения.</b> Допустимая потеря ΔU = ' +
      gray(fmt(U, 0) + ' · ' + fmt(duP, 1) + ' / 100') + ' = <b>' + fmt(dUdop, 1) + ' В</b>; ' +
      duForm + ' = ' + gray(duSub) + ' = <b>' + fmt(Sdu, 2) + ' мм²</b>' +
      (iDu >= 0 ? ' → ' + fs(S_ROW[iDu]) + ' мм²' : ' → более 240 мм²') + '</div>';

    /* 4. по термической стойкости */
    const Sterm = (Ik > 0 && tk > 0) ? Ik * Math.sqrt(tk) / C_CU : 0;
    const iT = Sterm > 0 ? pick(Sterm) : 0;
    h += '<div><b>4. По термической стойкости при КЗ.</b> ' +
      'S ≥ I<sub>к</sub> · √t<sub>к</sub> / C = ' +
      gray(fmt(Ik, 0) + ' · √' + fmt(tk, 2) + ' / 141') +
      ' = <b>' + fmt(Sterm, 1) + ' мм²</b>' +
      (iT >= 0 ? ' → ' + fs(S_ROW[iT]) + ' мм²' : ' → более 240 мм²') + '</div>';

    /* 5. итог */
    const idx = Math.max(iHeat, iDu, iT);
    if (idx < 0 || idx >= S_ROW.length) {
      h += '<div><span class="badge bad">Требуемое сечение выходит за ряд до 240 мм²: ' +
        'нужны параллельные кабели или более высокое напряжение</span></div>';
      out.innerHTML = h;
      return;
    }
    const S = S_ROW[idx];
    let dU = 0;
    if (kind === '3') dU = Math.sqrt(3) * RHO * L * I * cos / S;
    else if (kind === '1') dU = 2 * RHO * L * I * cos / S;
    else dU = 2 * RHO * L * I / S;
    const dPct = U > 0 ? dU / U * 100 : 0;
    const okI = I_ROW[idx] * k1 * k2 >= I;
    const okU = dPct <= duP + 1e-9;
    const okT = S >= Sterm;
    const who = (idx === iHeat && idx !== iDu && idx !== iT) ? 'нагрев'
      : (idx === iDu && idx !== iHeat && idx !== iT) ? 'потеря напряжения'
        : (idx === iT && idx !== iHeat && idx !== iDu) ? 'термическая стойкость'
          : 'несколько условий сразу';

    h += '<div style="margin-top:8px"><b>Принято: кабель сечением ' + fs(S) + ' мм²</b> ' +
      '(решающее условие — ' + who + '). Допустимый ток жилы с поправками ' +
      fmt(I_ROW[idx] * k1 * k2, 1) + ' А при расчётном ' + fmt(I, 1) + ' А.</div>';
    h += '<div>Фактическая потеря напряжения: ' + gray(duNum + ' / ' + fs(S)) +
      ' = <b>' + fmt(dU, 2) + ' В</b> = <b>' + fmt(dPct, 2) + ' %</b> ' +
      'при допустимых ' + fmt(duP, 1) + ' %</div>';
    const ok = okI && okU && okT;
    h += '<div><span class="badge ' + (ok ? 'ok' : 'bad') + '">' +
      (ok
        ? 'Все три условия выполнены: нагрев, потеря напряжения, термическая стойкость'
        : (!okI ? 'Не проходит по нагреву'
          : (!okU ? 'Потеря напряжения выше допустимой — увеличьте сечение или сократите трассу'
            : 'Не проходит по термической стойкости при коротком замыкании'))) +
      '</span></div>';
    out.innerHTML = h;
  }

  root.addEventListener('input', recalc);
  root.addEventListener('change', recalc);
  recalc();
})();
