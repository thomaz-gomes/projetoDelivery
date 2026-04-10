// selectors.js — iFood Gestor de Pedidos DOM selectors
// Update these when iFood changes their HTML structure
// Last verified: 2026-04-10

window.IFOOD_SELECTORS = {
  // Botão que abre o painel de conversas (header do iFood)
  chatToggleButton: '[data-test-id="CONSUMER_CHAT_REBORN_HEADER_ENTRY_POINT"]',

  // Botão fechar/X do painel de conversas (ícone genérico)
  closeChatButton: 'span.ifdl-icon-close',

  // Botão fechar/voltar dentro de uma conversa aberta (tem data-testid)
  closeConversationButton: '[data-testid="close-icon"]',

  // Container scrollável da lista de conversas (virtual scroll)
  conversationListScroll: '[style*="overflow: auto"]',

  // Número do pedido dentro de cada conversa (h2 contém "#XXXX")
  conversationOrderNumber: 'h2',

  // Campo de input de mensagem (textarea dentro da conversa aberta)
  messageInput: 'textarea[aria-label="Campo de mensagem"]',

  // Botão enviar mensagem (ícone ifdl-icon-send-message)
  sendButton: 'button[aria-label="Enviar mensagem"]',
};
