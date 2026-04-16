// Multi-tenant isolation tests for socket emit functions.
//
// Regression guard for the bug where `emitirNovoPedido` iterated every connected
// socket and broadcast `novo-pedido` globally, leaking orders from company A to
// any dashboard logged into company B on the same backend.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  setIo,
  emitirNovoPedido,
  emitirPedidoAtualizado,
  emitirPosicaoEntregador,
  emitirEntregadorOffline,
  emitirIfoodChat,
  _clearRecentEmitsForTest,
} from '../src/socketEmitters.js';

// ---- fake io --------------------------------------------------------------

function makeFakeSocket(id, opts = {}) {
  const received = [];
  const s = {
    id,
    agent: opts.agent || null,
    extension: opts.extension || null,
    received,
    emit(event, ...args) {
      // strip ack callback if present (last arg function)
      const payload = args[0];
      received.push({ event, payload });
    },
    // agents use s.timeout(ms).emit(...) for ack delivery; mirror that shape
    timeout() {
      return { emit: (event, payload, cb) => { received.push({ event, payload }); if (typeof cb === 'function') setImmediate(() => cb(null, { ok: true })); } };
    },
  };
  return s;
}

function makeFakeIo() {
  const socketsMap = new Map();           // socketId -> socket
  const rooms = new Map();                 // roomName -> Set<socketId>
  const toRoomEmits = [];                  // record of io.to(...).emit(...) calls

  const api = {
    sockets: {
      sockets: socketsMap,
      adapter: { rooms },
    },
    to(roomName) {
      return {
        emit(event, payload) {
          toRoomEmits.push({ roomName, event, payload });
          const ids = rooms.get(roomName);
          if (!ids) return;
          for (const sid of ids) {
            const s = socketsMap.get(sid);
            if (s) s.emit(event, payload);
          }
        },
      };
    },
    emit(event, payload) {
      // global broadcast — used by nothing after the fix; if called, every socket receives
      for (const s of socketsMap.values()) s.emit(event, payload);
    },
    _addSocket(socket, roomNames = []) {
      socketsMap.set(socket.id, socket);
      for (const r of roomNames) {
        if (!rooms.has(r)) rooms.set(r, new Set());
        rooms.get(r).add(socket.id);
      }
    },
    _toRoomEmits: toRoomEmits,
  };
  return api;
}

function freshIo() {
  const io = makeFakeIo();
  setIo(io);
  _clearRecentEmitsForTest();
  return io;
}

// ---- tests ----------------------------------------------------------------

test('emitirNovoPedido: order from company A reaches only company A sockets', () => {
  const io = freshIo();
  const panelA = makeFakeSocket('panelA');
  const panelB = makeFakeSocket('panelB');
  io._addSocket(panelA, ['company_AAA']);
  io._addSocket(panelB, ['company_BBB']);

  emitirNovoPedido({ id: 'ord-1', companyId: 'AAA', displayId: '#001' });

  assert.equal(panelA.received.length, 1, 'company A panel should receive novo-pedido');
  assert.equal(panelA.received[0].event, 'novo-pedido');
  assert.equal(panelA.received[0].payload.id, 'ord-1');
  assert.equal(panelB.received.length, 0, 'company B panel must NOT receive company A order');
});

test('emitirNovoPedido: pedido without companyId is refused (security default)', () => {
  const io = freshIo();
  const panelA = makeFakeSocket('panelA');
  io._addSocket(panelA, ['company_AAA']);

  emitirNovoPedido({ id: 'ord-x', displayId: '#999' }); // no companyId

  assert.equal(panelA.received.length, 0, 'no socket should receive when companyId missing');
});

test('emitirNovoPedido: two sockets in same company both receive', () => {
  const io = freshIo();
  const panel1 = makeFakeSocket('panel1');
  const panel2 = makeFakeSocket('panel2');
  const panelOther = makeFakeSocket('panelOther');
  io._addSocket(panel1, ['company_AAA']);
  io._addSocket(panel2, ['company_AAA']);
  io._addSocket(panelOther, ['company_BBB']);

  emitirNovoPedido({ id: 'ord-2', companyId: 'AAA', displayId: '#002' });

  assert.equal(panel1.received.length, 1);
  assert.equal(panel2.received.length, 1);
  assert.equal(panelOther.received.length, 0);
});

test('emitirPedidoAtualizado: order-updated stays within company room', () => {
  const io = freshIo();
  const panelA = makeFakeSocket('panelA');
  const panelB = makeFakeSocket('panelB');
  io._addSocket(panelA, ['company_AAA']);
  io._addSocket(panelB, ['company_BBB']);

  emitirPedidoAtualizado({ id: 'ord-1', companyId: 'AAA', displayId: '#001', status: 'EM_PREPARO' });

  assert.equal(panelA.received.length, 1);
  assert.equal(panelA.received[0].event, 'order-updated');
  assert.equal(panelA.received[0].payload.status, 'EM_PREPARO');
  assert.equal(panelB.received.length, 0, 'company B must not see order-updated for company A');
});

test('emitirPedidoAtualizado: payload without companyId is refused', () => {
  const io = freshIo();
  const panelA = makeFakeSocket('panelA');
  io._addSocket(panelA, ['company_AAA']);

  emitirPedidoAtualizado({ id: 'ord-x', status: 'EM_PREPARO' });

  assert.equal(panelA.received.length, 0);
});

test('emitirPosicaoEntregador: rider-position stays within company room', () => {
  const io = freshIo();
  const panelA = makeFakeSocket('panelA');
  const panelB = makeFakeSocket('panelB');
  io._addSocket(panelA, ['company_AAA']);
  io._addSocket(panelB, ['company_BBB']);

  emitirPosicaoEntregador('AAA', { riderId: 'r1', lat: 0, lng: 0 });

  assert.equal(panelA.received.length, 1);
  assert.equal(panelA.received[0].event, 'rider-position');
  assert.equal(panelB.received.length, 0);
});

test('emitirEntregadorOffline: rider-offline stays within company room', () => {
  const io = freshIo();
  const panelA = makeFakeSocket('panelA');
  const panelB = makeFakeSocket('panelB');
  io._addSocket(panelA, ['company_AAA']);
  io._addSocket(panelB, ['company_BBB']);

  emitirEntregadorOffline('AAA', 'r1');

  assert.equal(panelA.received.length, 1);
  assert.equal(panelA.received[0].event, 'rider-offline');
  assert.equal(panelB.received.length, 0);
});

test('emitirIfoodChat: only extension sockets of matching company receive', () => {
  const io = freshIo();
  const extA = makeFakeSocket('extA', { extension: { companyId: 'AAA' } });
  const extB = makeFakeSocket('extB', { extension: { companyId: 'BBB' } });
  const panelA = makeFakeSocket('panelA'); // non-extension, should be ignored
  io._addSocket(extA, ['company_AAA']);
  io._addSocket(extB, ['company_BBB']);
  io._addSocket(panelA, ['company_AAA']);

  emitirIfoodChat({ orderNumber: 'N-1', message: 'hi', storeId: 's1', companyId: 'AAA' });

  assert.equal(extA.received.length, 1);
  assert.equal(extA.received[0].event, 'ifood:chat');
  assert.equal(extB.received.length, 0, 'other-company extension must not receive');
  assert.equal(panelA.received.length, 0, 'non-extension socket must not receive ifood:chat');
});
