// src/messaging/index.js
// Adapter registration entry point. Importing this module (from server.js)
// triggers self-registration of every messaging adapter so router.getAdapter
// can find them at runtime. Adapters added in later tasks (Meta WhatsApp,
// Meta Messenger, Meta Instagram) should register themselves here too.

import { registerAdapter } from './router.js'
import whatsappEvolution from './adapters/whatsappEvolution.adapter.js'
import whatsappMeta from './adapters/whatsappMeta.adapter.js'
import facebook from './adapters/facebook.adapter.js'
import instagram from './adapters/instagram.adapter.js'

registerAdapter(whatsappEvolution.provider, whatsappEvolution)
registerAdapter(whatsappMeta.provider, whatsappMeta)
registerAdapter(facebook.provider, facebook)
registerAdapter(instagram.provider, instagram)

export * from './router.js'
