import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCopyName } from '../src/utils/copyName.js';

test('makeCopyName: first copy', () => {
  assert.equal(makeCopyName('X-Bacon', ['X-Bacon', 'Pizza']), 'X-Bacon (cópia)');
});

test('makeCopyName: second copy', () => {
  assert.equal(makeCopyName('X-Bacon', ['X-Bacon', 'X-Bacon (cópia)']), 'X-Bacon (cópia 2)');
});

test('makeCopyName: many copies', () => {
  const names = ['X', 'X (cópia)', 'X (cópia 2)', 'X (cópia 3)'];
  assert.equal(makeCopyName('X', names), 'X (cópia 4)');
});

test('makeCopyName: no conflicts', () => {
  assert.equal(makeCopyName('Novo', []), 'Novo (cópia)');
});
