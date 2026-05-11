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
  constructor(channel) {
    super(`Meta 24h messaging window expired for ${channel}`)
    this.code = 'META_WINDOW_EXPIRED'
  }
}

export class MetaNotConfiguredError extends Error {
  constructor() {
    super('Meta App not configured in admin settings')
    this.code = 'META_NOT_CONFIGURED'
  }
}

export class MessagingError extends Error {
  constructor(message, code = 'MESSAGING_ERROR') {
    super(message)
    this.code = code
  }
}

// Helper: shape canônico de mensagem normalizada
export function normalizedMessage({
  externalId, channel, provider, companyId, channelContactId,
  contactName = null, contactProfilePic = null,
  type, body = null, mediaUrl = null, mimeType = null,
  timestamp, raw,
}) {
  return {
    externalId, channel, provider, companyId, channelContactId,
    contactName, contactProfilePic,
    type, body, mediaUrl, mimeType,
    timestamp: timestamp instanceof Date ? timestamp : new Date(timestamp),
    raw,
  }
}
