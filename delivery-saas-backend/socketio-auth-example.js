/*
  Example Socket.IO server middleware that validates a token sent by the print agent
  Place this next to your existing Socket.IO initialization and adapt the validation
  function to check a DB, an env var list, or call your auth service.

  Usage (quick test):
    node socketio-auth-example.js

  This example listens on port 3001 and will accept connections where the client
  sends an `auth` payload containing `{ token }` and optionally `storeId`.
*/

const http = require('http');
const { Server } = require('socket.io');

const PORT = process.env.EXAMPLE_SOCKET_PORT || 3001;

// A simple allowlist for example purposes. Replace with secure lookup.
const ALLOWED_TOKENS = new Set([
  // add tokens you issued to agents here for testing
  'replace-with-secure-token',
]);

function validateAgentToken(token, storeId) {
  // In production, you should verify token signature, lookup DB records, or
  // call your central auth service. Keep this quick/async-friendly.
  if (!token) return false;
  return ALLOWED_TOKENS.has(token);
}

const server = http.createServer();
const io = new Server(server, {
  // optional config
});

// Middleware for connection authentication
io.use(async (socket, next) => {
  try {
    const auth = socket.handshake.auth || {};
    const token = auth.token || auth.PRINT_AGENT_TOKEN || auth.tokenBearer;
    const storeId = auth.storeId;

    if (!validateAgentToken(token, storeId)) {
      const err = new Error('Unauthorized: invalid agent token');
      err.data = { reason: 'invalid_token' };
      return next(err);
    }

    // optionally attach agent info to socket for later use
    socket.agent = { storeId, token };
    return next();
  } catch (e) {
    return next(new Error('Auth failure'));
  }
});

io.on('connection', (socket) => {
  console.log('Agent connected', socket.id, 'agent=', socket.agent);

  socket.on('pedido-impresso', (payload) => {
    console.log('Pedido impresso ack from agent:', payload);
  });

  socket.on('pedido-erro-impressao', (payload) => {
    console.warn('Agent reported print error:', payload);
  });

  // Example: send a test print event to the connected agent
  socket.on('request-test-print', () => {
    const fake = { id: `test-${Date.now()}`, items: [{ name: 'Produto A', quantity: 1, price: 9.9 }], total: 9.9 };
    socket.emit('novo-pedido', fake);
  });
});

server.listen(PORT, () => console.log(`Socket.IO auth example listening on http://localhost:${PORT}`));
