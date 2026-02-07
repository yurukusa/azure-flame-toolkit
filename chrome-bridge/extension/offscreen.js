// Offscreen document for maintaining WebSocket connection
const WS_URL = 'ws://172.29.64.143:8765';

let ws = null;
let reconnectInterval = null;

function connect() {
  if (ws && ws.readyState === WebSocket.OPEN) return;

  try {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log('[Offscreen] WebSocket 接続成功');
      if (reconnectInterval) {
        clearInterval(reconnectInterval);
        reconnectInterval = null;
      }
      ws.send(JSON.stringify({ type: 'connected', message: 'Chrome extension connected' }));
    };

    ws.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        // Service Worker にメッセージを転送
        const result = await chrome.runtime.sendMessage({ type: 'command', data });
        ws.send(JSON.stringify({ id: data.id, result }));
      } catch (error) {
        ws.send(JSON.stringify({ id: null, error: error.message }));
      }
    };

    ws.onclose = () => {
      console.log('[Offscreen] WebSocket 切断');
      startReconnect();
    };

    ws.onerror = (error) => {
      console.error('[Offscreen] WebSocket エラー:', error);
    };
  } catch (error) {
    console.error('[Offscreen] 接続エラー:', error);
    startReconnect();
  }
}

function startReconnect() {
  if (!reconnectInterval) {
    reconnectInterval = setInterval(() => {
      console.log('[Offscreen] 再接続試行中...');
      connect();
    }, 3000);
  }
}

connect();
