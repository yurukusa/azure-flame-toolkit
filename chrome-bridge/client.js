#!/usr/bin/env node
/**
 * Claude Code Chrome Bridge Client
 *
 * コマンドラインから Chrome を操作するクライアント
 * v2.0: CDP (Chrome DevTools Protocol) 経由のコマンド追加
 *
 * 使用例:
 *   node client.js navigate "https://google.com"
 *   node client.js evaluate "document.title"           # CDP: メインワールド実行
 *   node client.js cdpClick "#button"                  # CDP: ネイティブクリック
 *   node client.js cdpType "#input" "text"             # CDP: ネイティブ入力
 *   node client.js readConsole                         # コンソールログ取得
 *   node client.js readNetwork                         # ネットワークログ取得
 */

const WebSocket = require('ws');

// CC_BRIDGE_PORT環境変数で接続先を切り替え可能（CC専用Chrome: 8766）
const WS_URL = `ws://localhost:${process.env.CC_BRIDGE_PORT || 8765}`;

async function sendCommand(command, params = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    let resolved = false;

    ws.on('open', () => {
      ws.send(JSON.stringify({ command, params }));
    });

    ws.on('message', (data) => {
      if (!resolved) {
        resolved = true;
        const response = JSON.parse(data.toString());
        ws.close();

        if (response.error) {
          reject(new Error(response.error));
        } else {
          resolve(response.result);
        }
      }
    });

    ws.on('error', (error) => {
      if (!resolved) {
        resolved = true;
        reject(error);
      }
    });

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        ws.close();
        reject(new Error('Connection timeout'));
      }
    }, 30000);
  });
}

// コマンドライン引数をパース
function parseArgs() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    printUsage();
    process.exit(1);
  }

  const command = args[0];
  const params = {};

  switch (command) {
    case 'navigate':
    case 'newTab':
      params.url = args[1];
      break;

    case 'click':
      params.selector = args[1];
      if (args[2] && args[3]) {
        params.x = parseInt(args[2]);
        params.y = parseInt(args[3]);
      }
      break;

    case 'type':
      params.selector = args[1];
      params.text = args[2];
      params.clear = args[3] !== 'false';
      params.pressEnter = args[4] === 'true';
      break;

    // CDP: ネイティブクリック
    case 'cdpClick':
      params.selector = args[1];
      if (args[2] && args[3]) {
        params.x = parseInt(args[2]);
        params.y = parseInt(args[3]);
      }
      break;

    // CDP: ネイティブ入力
    case 'cdpType':
      params.selector = args[1];
      params.text = args[2];
      params.clear = args[3] !== 'false';
      params.pressEnter = args[4] === 'true';
      break;

    // CDP: スクロール
    case 'cdpScroll':
      if (args[1]?.startsWith('#') || args[1]?.startsWith('.') || args[1]?.startsWith('//')) {
        params.selector = args[1];
      } else {
        params.deltaX = parseInt(args[1]) || 0;
        params.deltaY = parseInt(args[2]) || 300;
      }
      break;

    case 'scroll':
      if (args[1]?.startsWith('#') || args[1]?.startsWith('.') || args[1]?.startsWith('//')) {
        params.selector = args[1];
      } else {
        params.x = parseInt(args[1]) || 0;
        params.y = parseInt(args[2]) || 0;
      }
      break;

    case 'getElement':
    case 'getText':
    case 'waitForElement':
      params.selector = args[1];
      if (args[2]) params.timeout = parseInt(args[2]);
      break;

    case 'getElements':
      params.selector = args[1];
      params.limit = parseInt(args[2]) || 100;
      break;

    case 'getHtml':
      params.selector = args[1];
      params.outer = args[2] === 'true';
      break;

    case 'getAttribute':
      params.selector = args[1];
      params.attribute = args[2];
      break;

    case 'switchTab':
    case 'closeTab':
      params.tabId = args[1] ? parseInt(args[1]) : undefined;
      break;

    case 'screenshot':
    case 'cdpScreenshot':
      params.format = args[1] || 'png';
      params.quality = parseInt(args[2]) || 100;
      break;

    // CDP: メインワールドJS実行（CSPバイパス）
    case 'evaluate':
      params.script = args.slice(1).join(' ');
      break;

    // コンソール・ネットワーク取得
    case 'readConsole':
      params.limit = parseInt(args[1]) || 100;
      params.clear = args[2] === 'true';
      break;

    case 'readNetwork':
      params.limit = parseInt(args[1]) || 50;
      params.clear = args[2] === 'true';
      break;

    case 'uploadFile':
      // uploadFile <filePath> [selector]
      {
        const filePath = args[1];
        const fs = require('fs');
        const path = require('path');

        if (!filePath) {
          console.error('Usage: uploadFile <filePath> [selector]');
          process.exit(1);
        }

        if (!fs.existsSync(filePath)) {
          console.error(`File not found: ${filePath}`);
          process.exit(1);
        }

        const fileBuffer = fs.readFileSync(filePath);
        params.data = fileBuffer.toString('base64');
        params.filename = path.basename(filePath);
        params.selector = args[2];

        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes = {
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.gif': 'image/gif',
          '.webp': 'image/webp',
          '.pdf': 'application/pdf',
          '.zip': 'application/zip',
        };
        params.mimeType = mimeTypes[ext] || 'application/octet-stream';
      }
      break;

    case 'setHtml':
      // setHtml <selector> <htmlFile>
      {
        const fs = require('fs');
        params.selector = args[1];
        const htmlFile = args[2];
        if (htmlFile && fs.existsSync(htmlFile)) {
          params.html = fs.readFileSync(htmlFile, 'utf-8');
        } else {
          params.html = args.slice(2).join(' ');
        }
      }
      break;

    case 'getTabs':
    case 'getPageInfo':
    case 'goBack':
    case 'goForward':
    case 'reload':
    case 'debuggerAttach':
    case 'debuggerDetach':
      // パラメータなし
      break;

    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }

  return { command, params };
}

function printUsage() {
  console.log(`
Claude Code Chrome Bridge Client v2.0

使用方法:
  node client.js <command> [arguments]

コマンド:
  ナビゲーション:
    navigate <url>              URL に移動
    newTab [url]                新しいタブを開く
    closeTab [tabId]            タブを閉じる
    getTabs                     全タブ一覧を取得
    switchTab <tabId>           タブを切り替え
    goBack / goForward / reload 戻る / 進む / リロード

  CDP操作（メインワールド実行、CSPバイパス）:
    evaluate <script>           JavaScriptをページのメインワールドで実行
                                ※ Selectize, Redactor等のAPIにアクセス可能
    cdpClick <selector>         ネイティブマウスクリック
    cdpClick _ <x> <y>          座標クリック
    cdpType <selector> <text> [clear] [pressEnter]
                                ネイティブキーボード入力
    cdpScroll <selector>        要素までスクロール
    cdpScroll <deltaX> <deltaY> マウスホイールスクロール
    cdpScreenshot [format] [quality]
                                CDP経由スクリーンショット

  Content Script操作（DOMベース、フォールバック用）:
    click <selector>            クリック
    type <selector> <text> [clear] [pressEnter]
                                テキスト入力
    scroll <x> <y>              スクロール

  情報取得:
    getElement <selector>       要素情報を取得
    getElements <selector> [limit]
                                複数要素を取得
    getText [selector]          テキストを取得
    getHtml [selector] [outer]  HTML を取得
    getAttribute <selector> <attr>
                                属性を取得
    waitForElement <selector> [timeout]
                                要素を待機
    getPageInfo                 ページ情報を取得

  コンソール・ネットワーク:
    readConsole [limit] [clear] ブラウザコンソールのログを取得
    readNetwork [limit] [clear] ネットワークリクエストを取得

  その他:
    screenshot [format] [quality]
                                スクリーンショット
    uploadFile <path> [selector]
                                ファイルをアップロード
    setHtml <selector> <html>   HTML設定（Redactor対応）
    debuggerAttach              CDPデバッガーを手動アタッチ
    debuggerDetach              CDPデバッガーを手動デタッチ

セレクタ:
  CSS セレクタ: #id, .class, div > span
  XPath: //div[@id="foo"], //button[contains(text(), "送信")]
`);
}

// メイン
async function main() {
  const { command, params } = parseArgs();

  try {
    const result = await sendCommand(command, params);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
