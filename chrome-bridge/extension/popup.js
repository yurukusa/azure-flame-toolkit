// ステータス表示更新
async function updateStatus() {
  const statusEl = document.getElementById('status');
  const statusText = document.getElementById('statusText');

  // Background Service Worker に接続状態を確認
  try {
    const response = await chrome.runtime.sendMessage({ type: 'getStatus' });
    if (response?.connected) {
      statusEl.className = 'status connected';
      statusText.textContent = '接続中';
    } else {
      statusEl.className = 'status disconnected';
      statusText.textContent = '未接続 - サーバー起動が必要';
    }
  } catch (error) {
    statusEl.className = 'status disconnected';
    statusText.textContent = '未接続';
  }
}

updateStatus();
setInterval(updateStatus, 2000);

// WS URL 設定の読み書き
async function loadWsUrl() {
  try {
    const data = await chrome.storage.local.get(['ws_url']);
    const input = document.getElementById('wsUrl');
    if (input) input.value = data.ws_url || '';
  } catch (_) {}
}

async function saveWsUrl() {
  const input = document.getElementById('wsUrl');
  if (!input) return;
  const value = input.value.trim();
  try {
    if (value) {
      await chrome.storage.local.set({ ws_url: value });
    } else {
      await chrome.storage.local.remove(['ws_url']);
    }
    // 画面上は即反映
    input.blur();
  } catch (_) {}
}

document.getElementById('saveWsUrl')?.addEventListener('click', saveWsUrl);
loadWsUrl();
