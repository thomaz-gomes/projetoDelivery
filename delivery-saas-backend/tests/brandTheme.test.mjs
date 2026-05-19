import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveTheme, buildThemeBlock, buildLessonsBlock } from '../src/utils/brandTheme.js'

test('resolveTheme: themeId explícito tem prioridade', () => {
  const themes = [
    { id: 't1', isDefault: true, menuId: null },
    { id: 't2', isDefault: false, menuId: 'm1' },
    { id: 't3', isDefault: false, menuId: null },
  ]
  assert.equal(resolveTheme(themes, 't3', 'm1')?.id, 't3')
})

test('resolveTheme: usa tema do cardápio quando não há themeId', () => {
  const themes = [
    { id: 't1', isDefault: true, menuId: null },
    { id: 't2', isDefault: false, menuId: 'm1' },
  ]
  assert.equal(resolveTheme(themes, null, 'm1')?.id, 't2')
})

test('resolveTheme: usa default da empresa quando cardápio sem tema', () => {
  const themes = [{ id: 't1', isDefault: true, menuId: null }]
  assert.equal(resolveTheme(themes, null, 'mX')?.id, 't1')
})

test('resolveTheme: null quando sem temas', () => {
  assert.equal(resolveTheme([], null, 'm1'), null)
})

test('buildThemeBlock: omite linhas vazias', () => {
  const out = buildThemeBlock({ palette: 'warm tones', mood: '', props: 'kraft paper', surface: null, lighting: undefined })
  assert.ok(out.includes('Palette: warm tones'))
  assert.ok(out.includes('Props to consider: kraft paper'))
  assert.ok(!out.includes('Mood:'))
  assert.ok(!out.includes('Surface:'))
})

test('buildThemeBlock: retorna string vazia quando tudo vazio', () => {
  assert.equal(buildThemeBlock(null), '')
  assert.equal(buildThemeBlock({}), '')
})

test('buildLessonsBlock: retorna bloco quando tem texto', () => {
  const out = buildLessonsBlock('Avoid dark wood.\nPrefer marble.')
  assert.ok(out.includes('LESSONS LEARNED'))
  assert.ok(out.includes('Avoid dark wood'))
})

test('buildLessonsBlock: string vazia retorna vazia', () => {
  assert.equal(buildLessonsBlock(''), '')
  assert.equal(buildLessonsBlock(null), '')
})
