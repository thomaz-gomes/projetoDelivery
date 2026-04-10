const backendUrlInput = document.getElementById('backendUrl');
const tokenInput = document.getElementById('extensionToken');
const companyIdInput = document.getElementById('companyId');
const debugModeInput = document.getElementById('debugMode');
const saveBtn = document.getElementById('saveBtn');
const activateBtn = document.getElementById('activateBtn');
const deactivateBtn = document.getElementById('deactivateBtn');
const activeTabInfo = document.getElementById('activeTabInfo');
const statusIndicator = document.getElementById('statusIndicator');
const queueInfo = document.getElementById('queueInfo');

// Load saved config
chrome.storage.local.get(['backendUrl', 'extensionToken', 'companyId', 'debugMode'], (data) => {
  if (data.backendUrl) backendUrlInput.value = data.backendUrl;
  if (data.extensionToken) tokenInput.value = data.extensionToken;
  if (data.companyId) companyIdInput.value = data.companyId;
  debugModeInput.checked = !!data.debugMode;
});

// Check status + active tab
function refreshStatus() {
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
    if (!response) return;
    if (response.connected) {
      statusIndicator.textContent = 'Conectado ao backend';
      statusIndicator.className = 'status connected';
    } else {
      statusIndicator.textContent = 'Desconectado';
      statusIndicator.className = 'status disconnected';
    }
    if (response.queueLength > 0) {
      queueInfo.textContent = `${response.queueLength} mensagem(ns) na fila`;
    } else {
      queueInfo.textContent = '';
    }

    // Active tab info
    if (response.activeTabId) {
      activeTabInfo.className = 'active-tab';
      activeTabInfo.innerHTML = `
        <div class="tab-label">Aba #${response.activeTabId} ativada</div>
        <div class="tab-url">${response.activeTabUrl || ''}</div>
      `;
      activateBtn.style.display = 'none';
      deactivateBtn.style.display = 'block';
    } else {
      activeTabInfo.className = 'no-tab';
      activeTabInfo.textContent = 'Nenhuma aba ativada';
      activateBtn.style.display = 'block';
      deactivateBtn.style.display = 'none';
    }
  });
}
refreshStatus();

// Activate current tab
activateBtn.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  if (!tab.url || !tab.url.includes('gestordepedidos.ifood.com.br')) {
    activeTabInfo.className = 'no-tab';
    activeTabInfo.textContent = 'Abra o Gestor de Pedidos do iFood primeiro!';
    return;
  }

  chrome.runtime.sendMessage({ type: 'SET_ACTIVE_TAB', tabId: tab.id, tabUrl: tab.url }, () => {
    refreshStatus();
  });
});

// Deactivate tab
deactivateBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'CLEAR_ACTIVE_TAB' }, () => {
    refreshStatus();
  });
});

// Debug mode toggle
debugModeInput.addEventListener('change', () => {
  chrome.storage.local.set({ debugMode: debugModeInput.checked });
});

// Save config
saveBtn.addEventListener('click', () => {
  const config = {
    backendUrl: backendUrlInput.value.trim().replace(/\/+$/, ''),
    extensionToken: tokenInput.value.trim(),
    companyId: companyIdInput.value.trim(),
    debugMode: debugModeInput.checked,
  };
  chrome.storage.local.set(config, () => {
    chrome.runtime.sendMessage({ type: 'RECONNECT', config });
    saveBtn.textContent = 'Salvo!';
    setTimeout(() => { saveBtn.textContent = 'Salvar e Conectar'; }, 1500);
  });
});
