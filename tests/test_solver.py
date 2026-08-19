# -*- coding: utf-8 -*-
"""Проверка расчётного ядра конструктора на схемах с известным ответом.

Схемы и «ручные» ответы лежат в tests/solver_cases.js: каждая схема считается
дважды — решателем site/assets/solver.js (МНА + Гаусс) и замкнутой формулой из
учебника (закон Ома, делитель, формула двух узлов, преобразование
треугольник→звезда, e^(−t/τ), условие резонанса, симметричная трёхфазная
система). Здесь мы гоняем этот файл в node и сверяем: расхождение не хуже
0,5 % (у отдельных проверок допуск указан свой — например, у нуля тока в
диагонали уравновешенного моста он абсолютный).

pytest параметризует по каждой отдельной сверке, поэтому в отчёте видно, какая
именно величина в какой схеме разошлась.
"""
import json
import os
import shutil
import subprocess

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CASES_JS = os.path.join(ROOT, 'tests', 'solver_cases.js')
SOLVER_JS = os.path.join(ROOT, 'site', 'assets', 'solver.js')

NODE = shutil.which('node') or shutil.which('nodejs')
needs_node = pytest.mark.skipif(NODE is None, reason='node не найден в PATH')


def _run_cases():
    out = subprocess.run([NODE, CASES_JS], cwd=ROOT, capture_output=True, timeout=600)
    assert out.returncode == 0, out.stderr.decode('utf-8', 'replace')[-3000:]
    return json.loads(out.stdout.decode('utf-8'))


_CACHE = {}


def cases():
    if NODE is None:
        return []
    if 'v' not in _CACHE:
        _CACHE['v'] = _run_cases()
    return _CACHE['v']


def _ids():
    """Список (схема, проверка) для параметризации. Собирается лениво: если
    node недоступен, набор пустой и все тесты пропускаются."""
    try:
        return [(c['name'], i, k['label']) for c in cases()
                for i, k in enumerate(c['checks'])]
    except Exception:
        return []


PARAMS = _ids()


def test_solver_file_exists():
    assert os.path.isfile(SOLVER_JS), 'нет site/assets/solver.js'
    assert os.path.isfile(CASES_JS), 'нет tests/solver_cases.js'


@needs_node
def test_solver_syntax():
    out = subprocess.run([NODE, '--check', SOLVER_JS], capture_output=True)
    assert out.returncode == 0, out.stderr.decode('utf-8', 'replace')


@needs_node
def test_enough_control_circuits():
    """Требование к работе: не меньше 15 контрольных схем."""
    assert len(cases()) >= 15, 'контрольных схем всего %d' % len(cases())


@needs_node
@pytest.mark.parametrize('name,i,label', PARAMS,
                         ids=[f'{n} :: {l}' for n, _i, l in PARAMS])
def test_case(name, i, label):
    c = [x for x in cases() if x['name'] == name][0]
    k = c['checks'][i]
    got, want, tol = float(k['got']), float(k['want']), float(k['tol'])
    scale = max(abs(want), abs(got))
    ok = abs(got - want) <= tol * scale or abs(got - want) <= tol
    assert ok, ('%s\n  %s: решатель %.8g, ручной счёт %.8g, расхождение %.3g %% '
                '(допуск %.3g %%)\n  %s'
                % (name, label, got, want,
                   100 * abs(got - want) / (scale or 1), 100 * tol, c['note']))
