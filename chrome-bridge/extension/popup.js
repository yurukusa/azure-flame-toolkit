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
