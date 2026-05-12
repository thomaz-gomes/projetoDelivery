import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeForMatch,
  softNormalizeForMatch,
  findNeighborhoodMatch,
} from '../src/utils/neighborhoodMatch.js';

const neighs = [
  { id: '1', name: 'Centro' },
  { id: '2', name: 'Novo Centro' },
  { id: '3', name: 'Jardim das Flores', aliases: ['Flores'] },
  { id: '4', name: 'Cêntro Histórico' },
  { id: '5', name: 'Vila São João' },
];

test('strict equality matches lower/upper case', () => {
  assert.equal(findNeighborhoodMatch(neighs, 'centro')?.id, '1');
  assert.equal(findNeighborhoodMatch(neighs, 'CENTRO')?.id, '1');
  assert.equal(findNeighborhoodMatch(neighs, 'Centro')?.id, '1');
});

test('strict equality ignores trailing whitespace', () => {
  assert.equal(findNeighborhoodMatch(neighs, '  Centro  ')?.id, '1');
});

test('strict equality strips accents', () => {
  assert.equal(findNeighborhoodMatch(neighs, 'centro')?.id, '1');
  assert.equal(findNeighborhoodMatch(neighs, 'Cêntro Historico')?.id, '4');
});

test('strict equality ignores punctuation', () => {
  assert.equal(findNeighborhoodMatch(neighs, 'Centro.')?.id, '1');
  assert.equal(findNeighborhoodMatch(neighs, 'Vila Sao Joao')?.id, '5');
});

test('substring fallback matches geocoded phrases', () => {
  assert.equal(findNeighborhoodMatch(neighs, 'Centro, Eunápolis - BA')?.id, '1');
  assert.equal(findNeighborhoodMatch(neighs, 'Bairro: Jardim das Flores, Eunápolis')?.id, '3');
});

test('substring fallback prefers longest match (Novo Centro over Centro)', () => {
  assert.equal(findNeighborhoodMatch(neighs, 'Novo Centro, Eunápolis - BA')?.id, '2');
});

test('aliases participate in matching', () => {
  assert.equal(findNeighborhoodMatch(neighs, 'Flores')?.id, '3');
  assert.equal(findNeighborhoodMatch(neighs, 'flores')?.id, '3');
});

test('unknown text returns null', () => {
  assert.equal(findNeighborhoodMatch(neighs, 'Bairro Inexistente'), null);
});

test('null/empty input returns null', () => {
  assert.equal(findNeighborhoodMatch(neighs, ''), null);
  assert.equal(findNeighborhoodMatch(neighs, null), null);
  assert.equal(findNeighborhoodMatch(neighs, undefined), null);
});

test('empty neighborhood list returns null', () => {
  assert.equal(findNeighborhoodMatch([], 'Centro'), null);
  assert.equal(findNeighborhoodMatch(null, 'Centro'), null);
});

test('normalizeForMatch direct cases', () => {
  assert.equal(normalizeForMatch('Centro'), 'centro');
  assert.equal(normalizeForMatch('  centro.  '), 'centro');
  assert.equal(normalizeForMatch('São João - Norte'), 'saojoaonorte');
  assert.equal(normalizeForMatch('Cêntro'), 'centro');
});

test('softNormalizeForMatch preserves single spaces', () => {
  assert.equal(softNormalizeForMatch('  Novo  Centro  '), 'novo centro');
  assert.equal(softNormalizeForMatch('Jardim das Flores'), 'jardim das flores');
});
