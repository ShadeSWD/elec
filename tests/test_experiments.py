# -*- coding: utf-8 -*-
"""Проверка книжки опытов и её автопроверок.

Для каждого опыта в site/assets/experiments-data.js заданы две схемы:
solution() — заведомо правильная сборка, wrong() — заведомо неправильная.
Тест прогоняет обе через тот же код, что работает на странице (решатель,
каталог деталей, контекст автопроверки), и требует, чтобы правильную схему
проверка засчитала, а неправильную — нет. Заодно проверяется, что у каждого
опыта есть задание, вопрос, ответ и объяснение.
"""
import json
import os
import shutil
import subprocess

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HARNESS = os.path.join(ROOT, 'tests', 'exp_harness.js')
DATA = os.path.join(ROOT, 'site', 'assets', 'experiments-data.js')

NODE = shutil.which('node') or shutil.which('nodejs')
needs_node = pytest.mark.skipif(NODE is None, reason='node не найден в PATH')

_CACHE = {}


def result():
    if NODE is None:
        return []
    if 'v' not in _CACHE:
        out = subprocess.run([NODE, HARNESS], cwd=ROOT, capture_output=True, timeout=900)
        assert out.returncode == 0, out.stderr.decode('utf-8', 'replace')[-3000:]
        _CACHE['v'] = json.loads(out.stdout.decode('utf-8'))
    return _CACHE['v']


try:
    IDS = [(r['id'], r['title']) for r in result()]
except Exception:
    IDS = []


def test_data_file_exists():
    assert os.path.isfile(DATA), 'нет site/assets/experiments-data.js'


@needs_node
def test_enough_experiments():
    """Требование к работе: не меньше 40 опытов."""
    assert len(result()) >= 40, 'опытов всего %d' % len(result())


@needs_node
def test_sections_present():
    secs = {r['sec'] for r in result()}
    for need in ('Постоянный ток', 'Ёмкость и индуктивность', 'Переменный ток',
                 'Трансформатор и выпрямление', 'Трёхфазная цепь', 'Судовое приложение'):
        assert need in secs, 'нет раздела «%s»' % need


@needs_node
def test_ids_unique_and_ordered():
    ids = [r['id'] for r in result()]
    assert len(ids) == len(set(ids)), 'номера опытов повторяются'
    assert ids == sorted(ids), 'опыты идут не по возрастанию номера'


@needs_node
@pytest.mark.parametrize('eid,title', IDS, ids=[f'{i} {t}' for i, t in IDS])
def test_experiment(eid, title):
    r = [x for x in result() if x['id'] == eid][0]
    assert 'error' not in r, r.get('error')
    assert r['hasSolution'], 'у опыта нет эталонной схемы solution()'
    assert r['hasWrong'], 'у опыта нет заведомо неверной схемы wrong()'
    assert r.get('checks', 0) >= 2, 'в автопроверке меньше двух пунктов'
    assert r['solutionOk'], ('правильная схема не засчитана; не сошлось: %s'
                             % '; '.join(r.get('fails') or []))
    assert r['wrongRejected'], 'неправильная схема засчитана как верная'
    assert r['presetOk'], 'стартовая схема preset() не строится'
