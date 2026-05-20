'use strict'

/**
 * Builds a self-contained JavaScript string to be executed inside the iFood
 * Gestor de Pedidos webview via `webview.executeJavaScript(code, true)`.
 *
 * The returned code is an async IIFE that:
 *  - Locates a conversation by orderNumber (virtual-scrolled list) OR opens
 *    a new conversation via the order card details panel.
 *  - Types the provided message into the chat textarea using React's native
 *    setter so the controlled component picks up the value.
 *  - Clicks the send button (falls back to Enter keydown if the button is
 *    missing).
 *  - Resolves to { ok: true, orderNumber, kind } on success, or
 *    { ok: false, orderNumber, kind, error } on failure. It never throws.
 *
 * The script has NO external dependencies — no imports, no chrome.* APIs,
 * no module syntax inside the IIFE. It is intended to run in the page's
 * isolated world via Electron's webview.
 */
export function buildSendScript(payload) {
  const orderNumber = String((payload && payload.orderNumber) || '').trim()
  const kind = (payload && payload.kind) || null
  const message = String((payload && payload.message) || '')

  // Escape all user-controlled values so the template literal we build below
  // cannot be hijacked by backticks or ${...} sequences inside the message.
  const safeOrderNumber = JSON.stringify(orderNumber)
  const safeKind = JSON.stringify(kind)
  const safeMessage = JSON.stringify(message)

  // We build the injected source by string concatenation to keep the parser
  // happy and to make it trivial to reason about escaping. The injected code
  // itself uses regular (non-template) string literals everywhere.
  const src =
    '(async () => {\n' +
    '  var orderNumber = ' + safeOrderNumber + ';\n' +
    '  var kind = ' + safeKind + ';\n' +
    '  var message = ' + safeMessage + ';\n' +
    '\n' +
    '  var SELECTORS = {\n' +
    '    chatToggleButton: \'[data-test-id="CONSUMER_CHAT_REBORN_HEADER_ENTRY_POINT"]\',\n' +
    '    closeChatButton: \'span.ifdl-icon-close\',\n' +
    '    closeConversationButton: \'[data-testid="close-icon"]\',\n' +
    '    conversationListScroll: \'[style*="overflow: auto"]\',\n' +
    '    conversationOrderNumber: \'h2\',\n' +
    '    messageInput: \'textarea[aria-label="Campo de mensagem"]\',\n' +
    '    sendButton: \'button[aria-label="Enviar mensagem"]\',\n' +
    '    orderCard: \'[data-testid="card"]\',\n' +
    '    orderDetailsChatButton: \'[data-test-id="CONSUMER_CHAT_REBORN_MESSAGING_ORDER_DETAILS_ENTRY_POINT"]\'\n' +
    '  };\n' +
    '\n' +
    '  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }\n' +
    '  function $$(sel) { return document.querySelector(sel); }\n' +
    '\n' +
    '  async function waitFor(sel, timeoutMs) {\n' +
    '    var start = Date.now();\n' +
    '    while (Date.now() - start < timeoutMs) {\n' +
    '      var el = document.querySelector(sel);\n' +
    '      if (el) return el;\n' +
    '      await sleep(100);\n' +
    '    }\n' +
    '    return null;\n' +
    '  }\n' +
    '\n' +
    '  function setReactValue(input, value) {\n' +
    '    var proto = window.HTMLTextAreaElement && window.HTMLTextAreaElement.prototype;\n' +
    '    var desc = proto && Object.getOwnPropertyDescriptor(proto, "value");\n' +
    '    var setter = desc && desc.set;\n' +
    '    if (setter) {\n' +
    '      setter.call(input, value);\n' +
    '    } else {\n' +
    '      input.value = value;\n' +
    '    }\n' +
    '    input.dispatchEvent(new Event("input", { bubbles: true }));\n' +
    '    input.dispatchEvent(new Event("change", { bubbles: true }));\n' +
    '  }\n' +
    '\n' +
    '  async function closePanel() {\n' +
    '    try {\n' +
    '      var openTextarea = document.querySelector(SELECTORS.messageInput);\n' +
    '      if (openTextarea) {\n' +
    '        var closeConv = document.querySelector(SELECTORS.closeConversationButton);\n' +
    '        if (closeConv) {\n' +
    '          closeConv.click();\n' +
    '          await sleep(500);\n' +
    '        }\n' +
    '      }\n' +
    '      var listVisible = false;\n' +
    '      var headers = document.querySelectorAll("h2");\n' +
    '      for (var i = 0; i < headers.length; i++) {\n' +
    '        var t = (headers[i].textContent || "").trim();\n' +
    '        if (t === "Conversas") { listVisible = true; break; }\n' +
    '      }\n' +
    '      if (listVisible) {\n' +
    '        var closeChat = document.querySelector(SELECTORS.closeChatButton);\n' +
    '        if (closeChat) {\n' +
    '          closeChat.click();\n' +
    '          await sleep(500);\n' +
    '        }\n' +
    '      }\n' +
    '    } catch (e) { /* ignore close errors */ }\n' +
    '  }\n' +
    '\n' +
    '  function findClickableAncestor(node) {\n' +
    '    var cur = node;\n' +
    '    for (var i = 0; i < 6 && cur && cur.parentElement; i++) {\n' +
    '      var parent = cur.parentElement;\n' +
    '      try {\n' +
    '        var cs = window.getComputedStyle(parent);\n' +
    '        if (cs && cs.position === "absolute") return cur;\n' +
    '      } catch (e) { /* ignore */ }\n' +
    '      cur = parent;\n' +
    '    }\n' +
    '    return node;\n' +
    '  }\n' +
    '\n' +
    '  async function clickConversationByNumber(num) {\n' +
    '    var scroller = document.querySelector(SELECTORS.conversationListScroll);\n' +
    '    if (!scroller) return false;\n' +
    '    try { scroller.scrollTop = 0; } catch (e) {}\n' +
    '    await sleep(200);\n' +
    '    var target = "#" + num;\n' +
    '    for (var step = 0; step < 15; step++) {\n' +
    '      var headers = document.querySelectorAll("h2");\n' +
    '      var found = null;\n' +
    '      for (var i = 0; i < headers.length; i++) {\n' +
    '        var txt = (headers[i].textContent || "").trim();\n' +
    '        if (txt === target || txt === num) { found = headers[i]; break; }\n' +
    '      }\n' +
    '      if (found) {\n' +
    '        var clickable = findClickableAncestor(found);\n' +
    '        try { clickable.click(); } catch (e) { found.click(); }\n' +
    '        return true;\n' +
    '      }\n' +
    '      var prevTop = scroller.scrollTop;\n' +
    '      scroller.scrollTop = prevTop + 250;\n' +
    '      await sleep(400);\n' +
    '      if (scroller.scrollTop === prevTop) break;\n' +
    '    }\n' +
    '    return false;\n' +
    '  }\n' +
    '\n' +
    '  async function clickOrderCard(num) {\n' +
    '    var cards = document.querySelectorAll(SELECTORS.orderCard);\n' +
    '    var target = "#" + num;\n' +
    '    for (var i = 0; i < cards.length; i++) {\n' +
    '      var t = (cards[i].textContent || "");\n' +
    '      if (t.indexOf(target) !== -1 || t.indexOf(num) !== -1) {\n' +
    '        try { cards[i].click(); } catch (e) { return false; }\n' +
    '        return true;\n' +
    '      }\n' +
    '    }\n' +
    '    return false;\n' +
    '  }\n' +
    '\n' +
    '  try {\n' +
    '    if (!orderNumber) {\n' +
    '      return { ok: false, orderNumber: orderNumber, kind: kind, error: "missing orderNumber" };\n' +
    '    }\n' +
    '\n' +
    '    // Step 2 — close any open conversation / chat panel.\n' +
    '    await closePanel();\n' +
    '    await sleep(500);\n' +
    '\n' +
    '    // Step 3 — open the chat panel.\n' +
    '    var toggle = document.querySelector(SELECTORS.chatToggleButton);\n' +
    '    if (toggle) {\n' +
    '      try { toggle.click(); } catch (e) {}\n' +
    '    }\n' +
    '    await sleep(1500);\n' +
    '\n' +
    '    var panelOk = false;\n' +
    '    var hs = document.querySelectorAll("h2");\n' +
    '    if (hs && hs.length > 0) panelOk = true;\n' +
    '\n' +
    '    var opened = false;\n' +
    '\n' +
    '    // Step 4 — FLOW 1: try to find conversation by order number.\n' +
    '    if (panelOk) {\n' +
    '      opened = await clickConversationByNumber(orderNumber);\n' +
    '      if (opened) await sleep(1500);\n' +
    '    }\n' +
    '\n' +
    '    // Step 5 — FLOW 2: open via order card details.\n' +
    '    if (!opened) {\n' +
    '      // Close chat list first if visible.\n' +
    '      var closeChatBtn = document.querySelector(SELECTORS.closeChatButton);\n' +
    '      if (closeChatBtn) {\n' +
    '        try { closeChatBtn.click(); } catch (e) {}\n' +
    '        await sleep(500);\n' +
    '      }\n' +
    '      var cardClicked = await clickOrderCard(orderNumber);\n' +
    '      if (!cardClicked) {\n' +
    '        return { ok: false, orderNumber: orderNumber, kind: kind, error: "order card not found" };\n' +
    '      }\n' +
    '      await sleep(2000);\n' +
    '      var detailsChatBtn = document.querySelector(SELECTORS.orderDetailsChatButton);\n' +
    '      if (!detailsChatBtn) {\n' +
    '        return { ok: false, orderNumber: orderNumber, kind: kind, error: "details chat button not found" };\n' +
    '      }\n' +
    '      try { detailsChatBtn.click(); } catch (e) {}\n' +
    '      await sleep(2000);\n' +
    '      if (!document.querySelector(SELECTORS.messageInput)) {\n' +
    '        return { ok: false, orderNumber: orderNumber, kind: kind, error: "cannot open chat" };\n' +
    '      }\n' +
    '    }\n' +
    '\n' +
    '    // Step 6 — type message.\n' +
    '    var input = await waitFor(SELECTORS.messageInput, 2000);\n' +
    '    if (!input) {\n' +
    '      return { ok: false, orderNumber: orderNumber, kind: kind, error: "textarea not found" };\n' +
    '    }\n' +
    '    setReactValue(input, message);\n' +
    '    await sleep(500);\n' +
    '\n' +
    '    // Step 7 — send.\n' +
    '    var sendBtn = await waitFor(SELECTORS.sendButton, 2000);\n' +
    '    if (sendBtn) {\n' +
    '      try { sendBtn.click(); } catch (e) {}\n' +
    '    } else {\n' +
    '      var initEvt = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true };\n' +
    '      try {\n' +
    '        input.dispatchEvent(new KeyboardEvent("keydown", initEvt));\n' +
    '        input.dispatchEvent(new KeyboardEvent("keypress", initEvt));\n' +
    '        input.dispatchEvent(new KeyboardEvent("keyup", initEvt));\n' +
    '      } catch (e) {}\n' +
    '    }\n' +
    '    await sleep(1000);\n' +
    '\n' +
    '    return { ok: true, orderNumber: orderNumber, kind: kind };\n' +
    '  } catch (err) {\n' +
    '    var msg = (err && err.message) ? err.message : String(err);\n' +
    '    return { ok: false, orderNumber: orderNumber, kind: kind, error: msg };\n' +
    '  }\n' +
    '})()\n'

  return src
}
