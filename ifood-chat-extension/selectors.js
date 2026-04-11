// selectors.js — iFood Gestor de Pedidos DOM selectors
// Update these when iFood changes their HTML structure
// Last verified: 2026-04-11

window.IFOOD_SELECTORS = {
  // ── Painel de conversas (header) ──
  chatToggleButton: '[data-test-id="CONSUMER_CHAT_REBORN_HEADER_ENTRY_POINT"]',
  closeChatButton: 'span.ifdl-icon-close',
  closeConversationButton: '[data-testid="close-icon"]',

  // ── Lista de conversas (virtual scroll) ──
  conversationListScroll: '[style*="overflow: auto"]',
  conversationOrderNumber: 'h2',

  // ── Dentro de uma conversa ──
  messageInput: 'textarea[aria-label="Campo de mensagem"]',
  sendButton: 'button[aria-label="Enviar mensagem"]',

  // ── Cards de pedido (tela de expedição) ──
  orderCard: '[data-testid="card"]',

  // ── Botão de chat nos detalhes do pedido (cria conversa se não existir) ──
  orderDetailsChatButton: '[data-test-id="CONSUMER_CHAT_REBORN_MESSAGING_ORDER_DETAILS_ENTRY_POINT"]',
};
