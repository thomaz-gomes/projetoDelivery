// Contrato comum. Não é classe; cada adapter exporta um objeto com este shape.

export const ADAPTER_INTERFACE = {
  provider: null,            // 'EVOLUTION_WA' | 'META_WA' | 'META_FB' | 'META_IG'
  channel: null,             // 'WHATSAPP' | 'FACEBOOK' | 'INSTAGRAM'

  async verifyWebhook(req, res) { throw new Error('not implemented') },
  async parseInbound(payload, account) { throw new Error('not implemented') },
  async sendMessage(account, to, content) { throw new Error('not implemented') },
  async sendMedia(account, to, mediaUrl, type, caption) { throw new Error('not implemented') },
  async resolveAccount(externalId, prisma) { throw new Error('not implemented') },
  async downloadMedia(mediaId, account) { throw new Error('not implemented') },
}

// Erros tipados que adapters podem lançar
export class MetaWindowExpiredError extends Error {
  constructor(channel, { channelContactId = null, accountId = null } = {}) {
    super(`Meta 24h messaging window expired for ${channel}`)
    this.name = 'MetaWindowExpiredError'
    this.code = 'META_WINDOW_EXPIRED'
    this.channel = channel
    this.channelContactId = channelContactId
    this.accountId = accountId
  }
}

export class MetaNotConfiguredError extends Error {
  constructor() {
    super('Meta App not configured in admin settings')
    this.name = 'MetaNotConfiguredError'
    this.code = 'META_NOT_CONFIGURED'
  }
}

export class MessagingError extends Error {
  constructor(message, code = 'MESSAGING_ERROR') {
    super(message)
    this.name = 'MessagingError'
    this.code = code
  }
}

// Helper: shape canônico de mensagem normalizada.
//
// Optional fields (left null/undefined when the adapter doesn't surface them):
//   - providerAccountId: the account row id (WhatsAppInstance.id /
//     MetaMessagingAccount.id) the message arrived on. Used by the inbound
//     pipeline to seed Conversation.providerAccountId / menuId / storeId.
//   - instanceName: legacy Conversation.instanceName field (Evolution only).
//   - menuId / storeId: pre-resolved menu/store linkage from the account row.
//   - latitude / longitude: location-message coordinates.
//   - mediaFileName: original filename for DOCUMENT-type media.
//   - reorderButton: { orderId } — set when an inbound button reply was
//     identified as a "Repetir pedido" tap. The pipeline routes these
//     through buttonReplies.js before running the regular automations.
export function normalizedMessage({
  externalId, channel, provider, companyId, channelContactId,
  providerAccountId = null, instanceName = null,
  menuId = null, storeId = null,
  contactName = null, contactProfilePic = null,
  type, body = null, mediaUrl = null, mimeType = null, mediaFileName = null,
  latitude = null, longitude = null,
  reorderButton = null,
  timestamp, raw,
}) {
  return {
    externalId, channel, provider, companyId, channelContactId,
    providerAccountId, instanceName,
    menuId, storeId,
    contactName, contactProfilePic,
    type, body, mediaUrl, mimeType, mediaFileName,
    latitude, longitude,
    reorderButton,
    timestamp: timestamp instanceof Date ? timestamp : new Date(timestamp),
    raw,
  }
}
