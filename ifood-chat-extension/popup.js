const backendUrlInput = document.getElementById('backendUrl');
const tokenInput = document.getElementById('extensionToken');
const companyIdInput = document.getElementById('companyId');
const saveBtn = document.getElementById('saveBtn');
const statusIndicator = document.getElementById('statusIndicator');
const queueInfo = document.getElementById('queueInfo');

chrome.storage.local.get(['backendUrl', 'extensionToken', 'companyId'], (data) => {
  if (data.backendUrl) backendUrlInput.value = data.backendUrl;
  if (data.extensionToken) tokenInput.value = data.extensionToken;
  if (data.companyId) companyIdInput.value = data.companyId;
});

chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
  if (response && response.connected) {
    statusIndicator.textContent = 'Conectado';
    statusIndicator.className = 'status connected';
  }
  if (response && response.queueLength > 0) {
    queueInfo.textContent = `${response.queueLength} mensagem(ns) na fila`;
  }
});

saveBtn.addEventListener('click', () => {
  const config = {
    backendUrl: backendUrlInput.value.trim().replace(/\/+$/, ''),
    extensionToken: tokenInput.value.trim(),
    companyId: companyIdInput.value.trim(),
  };
  chrome.storage.local.set(config, () => {
    chrome.runtime.sendMessage({ type: 'RECONNECT', config });
    saveBtn.textContent = 'Salvo!';
    setTimeout(() => { saveBtn.textContent = 'Salvar e Conectar'; }, 1500);
  });
});
