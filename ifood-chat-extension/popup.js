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

// Activate: find iFood tabs and pick one
activateBtn.addEventListener('click', async () => {
  // Query all iFood tabs
  const tabs = await chrome.tabs.query({ url: 'https://gestordepedidos.ifood.com.br/*' });

  if (tabs.length === 0) {
    activeTabInfo.className = 'no-tab';
    activeTabInfo.textContent = 'Nenhuma aba do Gestor de Pedidos encontrada!';
    return;
  }

  if (tabs.length === 1) {
    // Only one iFood tab — activate it directly
    const tab = tabs[0];
    chrome.runtime.sendMessage({ type: 'SET_ACTIVE_TAB', tabId: tab.id, tabUrl: tab.url }, () => {
      refreshStatus();
    });
    return;
  }

  // Multiple iFood tabs — show selector
  // Replace button with a list of tabs to choose from
  const container = activateBtn.parentElement;
  activateBtn.style.display = 'none';

  const list = document.createElement('div');
  list.style.cssText = 'margin-bottom:8px;';
  list.innerHTML = '<div style="font-size:12px;font-weight:600;margin-bottom:4px;">Escolha a aba:</div>';

  tabs.forEach((tab) => {
    const btn = document.createElement('button');
    btn.className = 'btn-outline';
    btn.style.cssText = 'font-size:12px;text-align:left;padding:6px 10px;margin-bottom:4px;';
    btn.textContent = `Aba #${tab.id} — ${tab.title || tab.url}`;
    btn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'SET_ACTIVE_TAB', tabId: tab.id, tabUrl: tab.url }, () => {
        list.remove();
        refreshStatus();
      });
    });
    list.appendChild(btn);
  });

  container.insertBefore(list, deactivateBtn);
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
