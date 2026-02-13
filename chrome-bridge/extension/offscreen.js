// Offscreen document for maintaining WebSocket connection
// ws_url is configurable via chrome.storage.local or URL query param (?ws=ws://host:port)
const DEFAULT_WS_URL = 'ws://localhost:8765';
// フォールバック候補。環境固有のIPは chrome.storage.local 経由で設定する
// （ポップアップUIまたは chrome.storage.local.set({ws_url: 'ws://YOUR_IP:8765'}) ）
const FALLBACK_WS_URLS = [
  'ws://127.0.0.1:8765'
];

let ws = null;
let reconnectInterval = null;
let candidateIndex = 0;
let candidatesCache = null;

async function resolveWsUrlCandidates() {
  const candidates = [];
  try {
    const qs = new URLSearchParams(location.search);
    const fromQuery = qs.get('ws');
    if (fromQuery) candidates.push(fromQuery);
  } catch (_) {}

  try {
    const data = await chrome.storage.local.get(['ws_url']);
    if (data && typeof data.ws_url === 'string' && data.ws_url.trim()) {
      candidates.push(data.ws_url.trim());
    }
  } catch (_) {}

  candidates.push(DEFAULT_WS_URL);
  for (const u of FALLBACK_WS_URLS) candidates.push(u);

  // de-dup
  return Array.from(new Set(candidates));
}

async function connect() {
  if (ws && ws.readyState === WebSocket.OPEN) return;

  try {
    if (!candidatesCache) {
      candidatesCache = await resolveWsUrlCandidates();
      candidateIndex = 0;
    }
    const wsUrl = candidatesCache[candidateIndex] || DEFAULT_WS_URL;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[Offscreen] WebSocket 接続成功:', wsUrl);
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
      console.log('[Offscreen] WebSocket 切断:', wsUrl);
      startReconnect();
    };

    ws.onerror = (error) => {
      console.error('[Offscreen] WebSocket エラー:', error);
      startReconnect();
    };
  } catch (error) {
    console.error('[Offscreen] 接続エラー:', error);
    startReconnect();
  }
}

function startReconnect() {
  if (reconnectInterval) return;

  reconnectInterval = setInterval(() => {
    // 次の候補へフォールバック
    if (candidatesCache && candidateIndex < candidatesCache.length - 1) {
      candidateIndex += 1;
    } else {
      // 全候補を試したらリセットして繰り返し
      candidatesCache = null;
    }
    console.log('[Offscreen] 再接続試行中...');
    connect();
  }, 3000);
}

connect();
