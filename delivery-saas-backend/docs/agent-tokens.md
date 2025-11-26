# Agent Tokens (delivery-print-agent)

This document describes the API and process to generate and rotate per-company agent tokens used by the local `delivery-print-agent` to authenticate to the SaaS backend via Socket.IO.

## Overview
- Tokens are issued per company and stored as a SHA256 hash in the `PrinterSetting` table (field `agentTokenHash`).
- The frontend admin (role `ADMIN`) can generate/rotate tokens.
- The plaintext token is returned once by the API call — store it securely.
- The agent must present the token on Socket.IO connect using `auth.token`.

## Endpoints

### GET /agent-setup
- Auth: Requires Bearer JWT (any authenticated user).
- Returns: `{ socketUrl, storeIds, tokenHint }` where `tokenHint` is e.g. `issued:2025-11-24T...` when a token exists.

Example:
```
GET /agent-setup
Authorization: Bearer <JWT>

200 OK
{
  "socketUrl": "http://localhost:3000",
  "storeIds": ["store-1","store-2"],
  "tokenHint": "issued:2025-11-24T10:00:00.000Z"
}
```

### POST /agent-setup/token
- Auth: Requires Bearer JWT and `role: ADMIN`.
- Purpose: Generate a new token for the company (rotates any existing token).
- Returns: `{ token: "<PLAINTEXT_TOKEN>" }` (store this value immediately; it will not be returned again).

Example:
```
POST /agent-setup/token
Authorization: Bearer <ADMIN_JWT>

200 OK
{ "token": "s3cr3t-value-xxxxx" }
```

## Agent connection example
The agent should connect to the backend Socket.IO endpoint providing the token and the store IDs it handles in `handshake.auth`:

```js
import { io } from 'socket.io-client'
const socket = io('http://your-backend:3000', {
  auth: {
    token: '<PLAINTEXT_TOKEN>',
    storeIds: ['store-1']
  }
})

socket.on('connect', () => console.log('connected', socket.id))
socket.on('connect_error', (err) => console.error('connect_error', err))
```

If token is invalid or missing for an agent connection, the server rejects the socket with an error.

## Rotation notes
- Generating a new token invalidates the previous token immediately.
- Plan a rotation procedure: generate token, update agent machines, restart agent processes.

## Security
- The server stores only SHA256(token); the exact plaintext is not persisted.
- Treat the plaintext token like a secret — do not log or share it.

## Troubleshooting
- If a connected agent reports `invalid-agent-token`, rotate the token from the admin UI and update the agent's `PRINT_AGENT_TOKEN`.
- If you lose the token, rotate to get a new one; old agents will be disconnected.

*** End of document ***
