#!/usr/bin/env node
/**
 * CC専用 Chrome Bridge Server
 *
 * CC専用Chromeプロファイル（ポート9223）向けのbridge server。
 * 人間用bridge（8765）と完全に独立して動作する。
 * ポート8766で待受。
 *
 * なぜ別サーバーが必要か:
 * chrome-bridgeはChrome拡張を経由するが、CC専用ChromeにはCDP直接接続する。
 * 拡張のインストール不要で動作する。
 */

const WebSocket = require('ws');
const http = require('http');

const PORT = 8766;
const CDP_PORT = 9223;
const HOST = '0.0.0.0';

const wss = new WebSocket.Server({ host: HOST, port: PORT });

console.log(`[CC-Server] WebSocket サーバー起動: ws://localhost:${PORT}`);
console.log(`[CC-Server] CDP接続先: http://localhost:${CDP_PORT}`);

// CDP WebSocket接続を取得
async function getCDPTarget() {
    return new Promise((resolve, reject) => {
        const req = http.get(`http://localhost:${CDP_PORT}/json`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const targets = JSON.parse(data);
                    const page = targets.find(t => t.type === 'page');
                    if (page) resolve(page.webSocketDebuggerUrl);
                    else reject(new Error('No page target found'));
                } catch (e) { reject(e); }
            });
        });
        req.on('error', reject);
    });
}

// CDPコマンド実行
async function executeCDP(method, params = {}) {
    const wsUrl = await getCDPTarget();
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        const id = Date.now();
        ws.on('open', () => {
            ws.send(JSON.stringify({ id, method, params }));
        });
        ws.on('message', (data) => {
            const msg = JSON.parse(data.toString());
            if (msg.id === id) {
                ws.close();
                resolve(msg.result || msg.error);
            }
        });
        ws.on('error', reject);
        setTimeout(() => { ws.close(); reject(new Error('CDP timeout')); }, 30000);
    });
}

wss.on('connection', (ws) => {
    console.log('[CC-Server] クライアント接続');

    ws.on('message', async (data) => {
        try {
            const msg = JSON.parse(data.toString());
            const { command, params } = msg;
            let result;

            switch (command) {
                case 'navigate':
                    result = await executeCDP('Page.navigate', { url: params.url });
                    break;
                case 'evaluate':
                    result = await executeCDP('Runtime.evaluate', {
                        expression: params.expression,
                        returnByValue: true
                    });
                    break;
                case 'screenshot':
                    result = await executeCDP('Page.captureScreenshot', { format: 'png' });
                    break;
                default:
                    result = { error: `Unknown command: ${command}` };
            }

            ws.send(JSON.stringify({ result }));
        } catch (e) {
            ws.send(JSON.stringify({ error: e.message }));
        }
    });
});
