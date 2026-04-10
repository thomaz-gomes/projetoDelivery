// selectors.js — iFood Gestor de Pedidos DOM selectors
// Update these when iFood changes their HTML structure
// IMPORTANT: Verify these selectors against the live iFood page using Chrome DevTools
window.IFOOD_SELECTORS = {
  // Chat panel toggle
  chatToggleButton: '[data-testid="chat-toggle"], .chat-button, [aria-label="Chat"], [aria-label="Conversas"]',

  // Conversation list
  conversationList: '[data-testid="conversation-list"], .conversations-list, [role="list"]',
  conversationItem: '[data-testid="conversation-item"], .conversation-item, [role="listitem"]',

  // Inside a conversation
  messageInput: '[data-testid="message-input"], textarea[placeholder], input[placeholder*="mensagem"], input[placeholder*="Digite"]',
  sendButton: '[data-testid="send-button"], button[aria-label="Enviar"], button[type="submit"]',

  // Close/back button
  closeChatButton: '[data-testid="close-chat"], .close-chat, [aria-label="Fechar"], [aria-label="Voltar"]',
};
