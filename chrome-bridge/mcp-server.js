#!/usr/bin/env node
/**
 * Chrome Bridge MCP Server
 * Claude Code から直接 Chrome を操作できる MCP サーバー
 *
 * CDP (Chrome DevTools Protocol) 経由でページのメインワールドでJS実行可能。
 * CSPをバイパスし、Selectize/Redactor等のページAPIに直接アクセスできる。
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const WebSocket = require('ws');

const WS_URL = 'ws://localhost:8765';

class ChromeBridgeMCP {
  constructor() {
    this.server = new Server(
      { name: 'chrome-bridge', version: '2.0.0' },
      { capabilities: { tools: {} } }
    );
    this.setupTools();
  }

  async sendCommand(command, params = {}) {
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
          reject(new Error('Timeout'));
        }
      }, 30000);
    });
  }

  setupTools() {
    this.server.setRequestHandler('tools/list', async () => ({
      tools: [
        // --- ナビゲーション ---
        {
          name: 'chrome_navigate',
          description: 'URLを開く',
          inputSchema: {
            type: 'object',
            properties: {
              url: { type: 'string', description: '開くURL' }
            },
            required: ['url']
          }
        },
        {
          name: 'chrome_new_tab',
          description: '新しいタブを開く',
          inputSchema: {
            type: 'object',
            properties: {
              url: { type: 'string', description: '開くURL（省略でabout:blank）' }
            }
          }
        },
        {
          name: 'chrome_get_tabs',
          description: '全タブの一覧を取得',
          inputSchema: { type: 'object', properties: {} }
        },
        {
          name: 'chrome_switch_tab',
          description: 'タブを切り替え',
          inputSchema: {
            type: 'object',
            properties: {
              tabId: { type: 'number', description: 'タブID' }
            },
            required: ['tabId']
          }
        },

        // --- CDP経由のページ操作（メインワールド実行） ---
        {
          name: 'chrome_evaluate',
          description: 'ページのメインワールドでJavaScriptを実行（CSPバイパス）。window.selectize等のページAPIに直接アクセス可能。',
          inputSchema: {
            type: 'object',
            properties: {
              script: { type: 'string', description: '実行するJavaScript' },
              awaitPromise: { type: 'boolean', description: 'Promiseをawaitするか（デフォルト: true）' },
              timeout: { type: 'number', description: 'タイムアウトms（デフォルト: 10000）' }
            },
            required: ['script']
          }
        },
        {
          name: 'chrome_cdp_click',
          description: 'CDP経由のネイティブクリック。OS級のマウスイベントを送信する。',
          inputSchema: {
            type: 'object',
            properties: {
              selector: { type: 'string', description: 'CSSセレクタまたはXPath' },
              x: { type: 'number', description: 'X座標（セレクタ省略時）' },
              y: { type: 'number', description: 'Y座標（セレクタ省略時）' }
            }
          }
        },
        {
          name: 'chrome_cdp_type',
          description: 'CDP経由のネイティブテキスト入力。Selectize等のkeydownリスナーが正しく反応する。',
          inputSchema: {
            type: 'object',
            properties: {
              selector: { type: 'string', description: 'CSSセレクタまたはXPath' },
              text: { type: 'string', description: '入力するテキスト' },
              clear: { type: 'boolean', description: '既存テキストをクリアするか（デフォルト: true）' },
              pressEnter: { type: 'boolean', description: 'Enterキーを押すか' }
            },
            required: ['text']
          }
        },

        // --- Content Script経由の操作（フォールバック） ---
        {
          name: 'chrome_click',
          description: 'Content Script経由のクリック（DOM操作）',
          inputSchema: {
            type: 'object',
            properties: {
              selector: { type: 'string', description: 'CSSセレクタまたはXPath' }
            },
            required: ['selector']
          }
        },
        {
          name: 'chrome_type',
          description: 'Content Script経由のテキスト入力（DOM操作）',
          inputSchema: {
            type: 'object',
            properties: {
              selector: { type: 'string', description: 'CSSセレクタまたはXPath' },
              text: { type: 'string', description: '入力するテキスト' },
              pressEnter: { type: 'boolean', description: 'Enterを押すか' }
            },
            required: ['selector', 'text']
          }
        },

        // --- 情報取得 ---
        {
          name: 'chrome_get_text',
          description: 'ページまたは要素のテキストを取得',
          inputSchema: {
            type: 'object',
            properties: {
              selector: { type: 'string', description: 'CSSセレクタ（省略でページ全体）' }
            }
          }
        },
        {
          name: 'chrome_get_element',
          description: '要素の詳細情報を取得（タグ、属性、位置、テキスト）',
          inputSchema: {
            type: 'object',
            properties: {
              selector: { type: 'string', description: 'CSSセレクタまたはXPath' }
            },
            required: ['selector']
          }
        },
        {
          name: 'chrome_get_elements',
          description: '複数要素を取得（一覧表示用）',
          inputSchema: {
            type: 'object',
            properties: {
              selector: { type: 'string', description: 'CSSセレクタまたはXPath' },
              limit: { type: 'number', description: '最大件数（デフォルト: 100）' }
            },
            required: ['selector']
          }
        },
        {
          name: 'chrome_get_html',
          description: '要素のHTMLを取得',
          inputSchema: {
            type: 'object',
            properties: {
              selector: { type: 'string', description: 'CSSセレクタ（省略でページ全体）' },
              outer: { type: 'boolean', description: 'outerHTML（デフォルト: false=innerHTML）' }
            }
          }
        },
        {
          name: 'chrome_wait_for_element',
          description: '要素が出現するまで待機',
          inputSchema: {
            type: 'object',
            properties: {
              selector: { type: 'string', description: 'CSSセレクタまたはXPath' },
              timeout: { type: 'number', description: 'タイムアウトms（デフォルト: 10000）' }
            },
            required: ['selector']
          }
        },

        // --- スクリーンショット ---
        {
          name: 'chrome_screenshot',
          description: 'スクリーンショットを撮る',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },

        // --- ページ情報 ---
        {
          name: 'chrome_get_page_info',
          description: '現在のページ情報を取得',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },

        // --- コンソール・ネットワーク ---
        {
          name: 'chrome_read_console',
          description: 'ブラウザコンソールのログを取得。エラー、警告、info等を確認できる。',
          inputSchema: {
            type: 'object',
            properties: {
              limit: { type: 'number', description: '取得件数（デフォルト: 100）' },
              clear: { type: 'boolean', description: '取得後にクリアするか' }
            }
          }
        },
        {
          name: 'chrome_read_network',
          description: 'ネットワークリクエスト/レスポンスのログを取得',
          inputSchema: {
            type: 'object',
            properties: {
              limit: { type: 'number', description: '取得件数（デフォルト: 50）' },
              clear: { type: 'boolean', description: '取得後にクリアするか' }
            }
          }
        },

        // --- HTML設定・ファイルアップロード ---
        {
          name: 'chrome_set_html',
          description: 'contenteditable要素のHTMLを設定（Redactorエディタ対応）',
          inputSchema: {
            type: 'object',
            properties: {
              selector: { type: 'string', description: 'CSSセレクタ' },
              html: { type: 'string', description: '設定するHTML' }
            },
            required: ['selector', 'html']
          }
        },
        {
          name: 'chrome_upload_file',
          description: 'ファイルをアップロード',
          inputSchema: {
            type: 'object',
            properties: {
              filePath: { type: 'string', description: 'アップロードするファイルのパス' },
              selector: { type: 'string', description: 'file input のセレクタ（省略で自動検出）' }
            },
            required: ['filePath']
          }
        },

        // --- Web検索 ---
        {
          name: 'chrome_search_web',
          description: 'Google検索を実行して結果テキストを取得',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: '検索クエリ' }
            },
            required: ['query']
          }
        }
      ]
    }));

    this.server.setRequestHandler('tools/call', async (request) => {
      const { name, arguments: args } = request.params;

      try {
        let result;
        switch (name) {
          // ナビゲーション
          case 'chrome_navigate':
            result = await this.sendCommand('navigate', { url: args.url });
            break;
          case 'chrome_new_tab':
            result = await this.sendCommand('newTab', { url: args.url });
            break;
          case 'chrome_get_tabs':
            result = await this.sendCommand('getTabs', {});
            break;
          case 'chrome_switch_tab':
            result = await this.sendCommand('switchTab', { tabId: args.tabId });
            break;

          // CDP経由の操作
          case 'chrome_evaluate':
            result = await this.sendCommand('evaluate', {
              script: args.script,
              awaitPromise: args.awaitPromise,
              timeout: args.timeout
            });
            break;
          case 'chrome_cdp_click':
            result = await this.sendCommand('cdpClick', {
              selector: args.selector,
              x: args.x,
              y: args.y
            });
            break;
          case 'chrome_cdp_type':
            result = await this.sendCommand('cdpType', {
              selector: args.selector,
              text: args.text,
              clear: args.clear,
              pressEnter: args.pressEnter
            });
            break;

          // Content Script経由
          case 'chrome_click':
            result = await this.sendCommand('click', { selector: args.selector });
            break;
          case 'chrome_type':
            result = await this.sendCommand('type', {
              selector: args.selector,
              text: args.text,
              pressEnter: args.pressEnter || false
            });
            break;

          // 情報取得
          case 'chrome_get_text':
            result = await this.sendCommand('getText', { selector: args.selector });
            break;
          case 'chrome_get_element':
            result = await this.sendCommand('getElement', { selector: args.selector });
            break;
          case 'chrome_get_elements':
            result = await this.sendCommand('getElements', {
              selector: args.selector,
              limit: args.limit
            });
            break;
          case 'chrome_get_html':
            result = await this.sendCommand('getHtml', {
              selector: args.selector,
              outer: args.outer
            });
            break;
          case 'chrome_wait_for_element':
            result = await this.sendCommand('waitForElement', {
              selector: args.selector,
              timeout: args.timeout
            });
            break;

          // スクリーンショット
          case 'chrome_screenshot':
            result = await this.sendCommand('screenshot', {});
            break;

          // ページ情報
          case 'chrome_get_page_info':
            result = await this.sendCommand('getPageInfo', {});
            break;

          // コンソール・ネットワーク
          case 'chrome_read_console':
            result = await this.sendCommand('readConsole', {
              limit: args.limit,
              clear: args.clear
            });
            break;
          case 'chrome_read_network':
            result = await this.sendCommand('readNetwork', {
              limit: args.limit,
              clear: args.clear
            });
            break;

          // HTML設定
          case 'chrome_set_html':
            result = await this.sendCommand('setHtml', {
              selector: args.selector,
              html: args.html
            });
            break;

          // ファイルアップロード
          case 'chrome_upload_file': {
            const fs = require('fs');
            const path = require('path');
            const filePath = args.filePath;

            if (!fs.existsSync(filePath)) {
              throw new Error(`File not found: ${filePath}`);
            }

            const fileBuffer = fs.readFileSync(filePath);
            const ext = path.extname(filePath).toLowerCase();
            const mimeTypes = {
              '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
              '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf',
              '.zip': 'application/zip', '.csv': 'text/csv', '.txt': 'text/plain'
            };

            result = await this.sendCommand('uploadFile', {
              data: fileBuffer.toString('base64'),
              filename: path.basename(filePath),
              mimeType: mimeTypes[ext] || 'application/octet-stream',
              selector: args.selector
            });
            break;
          }

          // Web検索
          case 'chrome_search_web':
            await this.sendCommand('navigate', {
              url: `https://www.google.com/search?q=${encodeURIComponent(args.query)}`
            });
            await new Promise(r => setTimeout(r, 2000));
            result = await this.sendCommand('getText', {});
            break;

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('[MCP] Chrome Bridge MCP Server v2.0 started (CDP enabled)');
  }
}

const server = new ChromeBridgeMCP();
server.run().catch(console.error);
