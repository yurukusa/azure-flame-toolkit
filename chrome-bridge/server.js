#!/usr/bin/env node
/**
 * Claude Code Chrome Bridge Server
 *
 * Claude Code と Chrome 拡張機能の間で通信を仲介する WebSocket サーバー
 *
 * 使い方:
 *   node server.js
 *
 * Claude Code から使用:
 *   node client.js navigate "https://example.com"
 *   node client.js click "#submit-button"
 *   node client.js type "#search-input" "検索テキスト"
 */

const WebSocket = require('ws');

const PORT = 8765;
const HOST = '0.0.0.0';
const wss = new WebSocket.Server({ host: HOST, port: PORT });

let chromeExtension = null;
const pendingRequests = new Map();
let requestId = 0;

console.log(`[Server] WebSocket サーバー起動: ws://localhost:${PORT}`);

wss.on('connection', (ws, req) => {
  console.log('[Server] 新しい接続');

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());

      // Chrome 拡張機能からの接続通知
      if (message.type === 'connected') {
        chromeExtension = ws;
        console.log('[Server] Chrome 拡張機能が接続されました');
        return;
      }

      // Chrome 拡張機能からのレスポンス
      if (message.id && pendingRequests.has(message.id)) {
        const { resolve } = pendingRequests.get(message.id);
        pendingRequests.delete(message.id);
        resolve(message);
        return;
      }

      // CLI からのコマンド
      if (message.command) {
        handleCommand(ws, message);
      }
    } catch (error) {
      console.error('[Server] メッセージ処理エラー:', error);
      ws.send(JSON.stringify({ error: error.message }));
    }
  });

  ws.on('close', () => {
    if (ws === chromeExtension) {
      chromeExtension = null;
      console.log('[Server] Chrome 拡張機能が切断されました');
    }
  });

  ws.on('error', (error) => {
    console.error('[Server] WebSocket エラー:', error);
  });
});

async function handleCommand(clientWs, message) {
  if (!chromeExtension) {
    clientWs.send(JSON.stringify({
      id: message.id,
      error: 'Chrome 拡張機能が接続されていません'
    }));
    return;
  }

  const id = ++requestId;
  const commandMessage = { ...message, id };

  // レスポンスを待つ Promise を作成
  const responsePromise = new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });

    // タイムアウト
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error('Request timeout'));
      }
    }, 30000);
  });

  // Chrome 拡張機能にコマンドを送信
  chromeExtension.send(JSON.stringify(commandMessage));

  try {
    const response = await responsePromise;
    clientWs.send(JSON.stringify(response));
  } catch (error) {
    clientWs.send(JSON.stringify({ id: message.id, error: error.message }));
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Server] シャットダウン中...');
  wss.close(() => {
    console.log('[Server] サーバー停止');
    process.exit(0);
  });
});
