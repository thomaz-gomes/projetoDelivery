const { io } = require('socket.io-client');

const url = process.env.BACKEND_SOCKET_URL || 'http://localhost:3000';
console.log('Emit client connecting to', url);

const socket = io(url, { transports: ['websocket'] });

socket.on('connect', () => {
  console.log('Emit client connected with id', socket.id);
  const pedido = {
    id: `test-${Date.now()}`,
    customerName: 'Cliente Teste',
    items: [{ name: 'Produto Teste', quantity: 1, price: 9.9 }],
    total: 9.9,
  };
  console.log('Emitting novo-pedido', pedido.id);
  socket.emit('novo-pedido', pedido);
  // keep the connection open and listen for ack from agent
  socket.on('pedido-impresso', (payload) => {
    console.log('Received pedido-impresso ack from agent:', payload);
  });
  socket.on('pedido-erro-impressao', (payload) => {
    console.warn('Received pedido-erro-impressao from agent:', payload);
  });
  console.log('Emitter will keep connection open for 20s to wait for ack...');
  setTimeout(() => {
    console.log('Emitter closing after wait');
    socket.close();
    process.exit(0);
  }, 20000);
});

socket.on('connect_error', (err) => {
  console.error('connect_error', err && err.message ? err.message : err);
  process.exit(1);
});

socket.on('error', (e) => console.error('socket error', e));
