// Claude Code Bridge - Background Service Worker
// CDP (Chrome DevTools Protocol) を使用してページのメインワールドでJS実行
// Claude in Chrome と同等のブラウザ操作を実現する

let offscreenCreated = false;

// --- CDP デバッガー管理 ---
// タブごとにデバッガーのアタッチ状態を管理
// CDPの Runtime.evaluate はCSPを完全にバイパスし、
// ページのメインワールドで実行されるため、Selectize/Redactor等のAPIに直接アクセス可能
const attachedTabs = new Set();
const consoleMessages = new Map(); // tabId -> messages[]
const networkRequests = new Map(); // tabId -> requests[]

async function ensureDebuggerAttached(tabId) {
  if (attachedTabs.has(tabId)) return;

  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    attachedTabs.add(tabId);

    // Runtime domain有効化: コンソールメッセージ・例外をキャプチャ
    await cdpSend(tabId, 'Runtime.enable');
    // Network domain有効化: リクエスト/レスポンスをキャプチャ
    await cdpSend(tabId, 'Network.enable', { maxPostDataSize: 65536 });

    // コンソール・ネットワークのバッファ初期化
    if (!consoleMessages.has(tabId)) consoleMessages.set(tabId, []);
    if (!networkRequests.has(tabId)) networkRequests.set(tabId, []);
  } catch (error) {
    // 既にアタッチ済みの場合はエラーを無視
    if (error.message?.includes('Already attached')) {
      attachedTabs.add(tabId);
      return;
    }
    throw new Error(`Debugger attach failed: ${error.message}`);
  }
}

async function detachDebugger(tabId) {
  if (!attachedTabs.has(tabId)) return;
  try {
    await chrome.debugger.detach({ tabId });
  } catch (_) {
    // タブが閉じられた等の場合は無視
  }
  attachedTabs.delete(tabId);
  consoleMessages.delete(tabId);
  networkRequests.delete(tabId);
}

function cdpSend(tabId, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(result);
      }
    });
  });
}

// デバッガーイベントハンドラ（コンソール・ネットワーク収集）
chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId;

  if (method === 'Runtime.consoleAPICalled') {
    const msgs = consoleMessages.get(tabId) || [];
    msgs.push({
      type: params.type,
      text: params.args?.map(a => a.value ?? a.description ?? '').join(' '),
      timestamp: params.timestamp
    });
    // 最新500件に制限
    if (msgs.length > 500) msgs.splice(0, msgs.length - 500);
    consoleMessages.set(tabId, msgs);
  }

  if (method === 'Runtime.exceptionThrown') {
    const msgs = consoleMessages.get(tabId) || [];
    msgs.push({
      type: 'error',
      text: params.exceptionDetails?.text + ': ' +
            (params.exceptionDetails?.exception?.description || ''),
      timestamp: params.timestamp
    });
    consoleMessages.set(tabId, msgs);
  }

  if (method === 'Network.responseReceived') {
    const reqs = networkRequests.get(tabId) || [];
    reqs.push({
      url: params.response?.url,
      status: params.response?.status,
      mimeType: params.response?.mimeType,
      requestId: params.requestId
    });
    if (reqs.length > 200) reqs.splice(0, reqs.length - 200);
    networkRequests.set(tabId, reqs);
  }
});

// タブ閉鎖時にデバッガーをクリーンアップ
chrome.debugger.onDetach.addListener((source, reason) => {
  attachedTabs.delete(source.tabId);
  consoleMessages.delete(source.tabId);
  networkRequests.delete(source.tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  detachDebugger(tabId);
});

// --- Offscreen Document ---
async function setupOffscreen() {
  if (offscreenCreated) return;

  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['WORKERS'],
      justification: 'WebSocket connection for Claude Code Bridge'
    });
    offscreenCreated = true;
    console.log('[Background] Offscreen document 作成完了');
  } catch (error) {
    if (error.message.includes('already exists')) {
      offscreenCreated = true;
    } else {
      console.error('[Background] Offscreen 作成エラー:', error);
    }
  }
}

setupOffscreen();

// --- メッセージハンドラ ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'command') {
    handleCommand(message.data)
      .then(sendResponse)
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }

  if (message.type === 'getStatus') {
    sendResponse({ connected: offscreenCreated });
    return;
  }
});

// --- コマンドルーター ---
async function handleCommand(data) {
  const { command, params } = data;

  switch (command) {
    // ナビゲーション
    case 'navigate':
      return await navigateTo(params.url, params.tabId);
    case 'newTab':
      return await createTab(params.url);
    case 'closeTab':
      return await closeTab(params.tabId);
    case 'getTabs':
      return await getAllTabs();
    case 'switchTab':
      return await switchToTab(params.tabId);
    case 'goBack':
      return await goBack();
    case 'goForward':
      return await goForward();
    case 'reload':
      return await reloadPage();

    // CDP経由のページ操作（メインワールド実行）
    case 'evaluate':
      return await cdpEvaluate(params);
    case 'cdpClick':
      return await cdpClick(params);
    case 'cdpType':
      return await cdpType(params);
    case 'cdpScroll':
      return await cdpScroll(params);

    // CDP経由の情報取得
    case 'readConsole':
      return await readConsole(params);
    case 'readNetwork':
      return await readNetwork(params);

    // Content Script経由のページ操作（DOM操作のフォールバック）
    case 'click':
      return await executeInPage('click', params);
    case 'type':
      return await executeInPage('type', params);
    case 'scroll':
      return await executeInPage('scroll', params);
    case 'getElement':
      return await executeInPage('getElement', params);
    case 'getElements':
      return await executeInPage('getElements', params);
    case 'getText':
      return await executeInPage('getText', params);
    case 'getHtml':
      return await executeInPage('getHtml', params);
    case 'getAttribute':
      return await executeInPage('getAttribute', params);
    case 'waitForElement':
      return await executeInPage('waitForElement', params);
    case 'uploadFile':
      return await executeInPage('uploadFile', params);
    case 'setHtml':
      return await executeInPage('setHtml', params);

    // CDP経由のファイルアップロード
    case 'cdpUploadFile':
      return await cdpUploadFile(params);

    // スクリーンショット
    case 'screenshot':
      return await captureScreenshot(params);
    case 'cdpScreenshot':
      return await cdpCaptureScreenshot(params);

    // ページ情報
    case 'getPageInfo':
      return await getPageInfo(params.tabId);

    // デバッガー制御
    case 'debuggerAttach':
      return await debuggerAttach();
    case 'debuggerDetach':
      return await debuggerDetachCommand();

    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

// --- CDP ページ操作 ---

// メインワールドでJS実行（CSPバイパス、Selectize/Redactor等のAPIアクセス可能）
async function cdpEvaluate(params) {
  const { script, awaitPromise = true, timeout = 10000, tabId } = params;
  const tab = await getActiveTab(tabId);
  await ensureDebuggerAttached(tab.id);

  // Claude in Chromeと同じパターン: strict mode IIFEでラップ
  const expression = `(function() {
  'use strict';
  try {
    return eval(${JSON.stringify(script)});
  } catch(e) {
    throw e;
  }
})()`;

  try {
    const result = await cdpSend(tab.id, 'Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise,
      timeout
    });

    if (result.exceptionDetails) {
      return {
        error: result.exceptionDetails.exception?.description ||
               result.exceptionDetails.text || 'Evaluation error'
      };
    }

    return { result: result.result?.value ?? null };
  } catch (error) {
    // デバッガー切断時は再アタッチして再試行
    if (error.message?.includes('not attached')) {
      attachedTabs.delete(tab.id);
      await ensureDebuggerAttached(tab.id);
      return cdpEvaluate(params);
    }
    throw error;
  }
}

// CDP Input.dispatchMouseEvent によるネイティブクリック
// JS dispatchEventと異なり、OS級のイベントとしてページに認識される
async function cdpClick(params) {
  const { x, y, selector, button = 'left', clickCount = 1, tabId } = params;
  const tab = await getActiveTab(tabId);
  await ensureDebuggerAttached(tab.id);

  let clickX = x, clickY = y;

  // セレクタ指定の場合、要素の座標を取得
  if (selector && (clickX === undefined || clickY === undefined)) {
    const coords = await cdpSend(tab.id, 'Runtime.evaluate', {
      expression: `(function() {
        const el = document.querySelector(${JSON.stringify(selector)}) ||
                   (function() {
                     const r = document.evaluate(${JSON.stringify(selector)}, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                     return r.singleNodeValue;
                   })();
        if (!el) return null;
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        const rect = el.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      })()`,
      returnByValue: true
    });

    if (!coords.result?.value) {
      throw new Error(`Element not found: ${selector}`);
    }
    clickX = coords.result.value.x;
    clickY = coords.result.value.y;
  }

  // マウス移動 → プレス → リリース の3段階（ブラウザの実挙動を再現）
  await cdpSend(tab.id, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: clickX, y: clickY
  });
  await cdpSend(tab.id, 'Input.dispatchMouseEvent', {
    type: 'mousePressed', x: clickX, y: clickY,
    button, clickCount
  });
  await cdpSend(tab.id, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: clickX, y: clickY,
    button, clickCount
  });

  return { success: true, clicked: { x: clickX, y: clickY } };
}

// CDP Input.dispatchKeyEvent + Input.insertText によるネイティブ入力
// selectize等のkeydownリスナーが正しく反応する
async function cdpType(params) {
  const { selector, text, clear = true, pressEnter = false, tabId } = params;
  const tab = await getActiveTab(tabId);
  await ensureDebuggerAttached(tab.id);

  // セレクタ指定時は要素にフォーカス
  if (selector) {
    await cdpSend(tab.id, 'Runtime.evaluate', {
      expression: `(function() {
        const el = document.querySelector(${JSON.stringify(selector)}) ||
                   (function() {
                     const r = document.evaluate(${JSON.stringify(selector)}, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                     return r.singleNodeValue;
                   })();
        if (!el) throw new Error('Element not found: ${selector}');
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        el.focus();
        if (${clear} && 'value' in el) {
          el.value = '';
          el.dispatchEvent(new Event('input', { bubbles: true }));
        } else if (${clear} && el.isContentEditable) {
          el.innerHTML = '';
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
        return true;
      })()`,
      returnByValue: true,
      awaitPromise: false
    });
  }

  // テキストを1文字ずつ or 一括で入力
  // 短いテキストはinsertTextで一括、長文も一括（パフォーマンス重視）
  await cdpSend(tab.id, 'Input.insertText', { text });

  if (pressEnter) {
    await cdpSend(tab.id, 'Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'Enter', code: 'Enter',
      windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13
    });
    await cdpSend(tab.id, 'Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'Enter', code: 'Enter',
      windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13
    });
  }

  return { success: true, typed: text };
}

// CDP Input.dispatchMouseEvent によるスクロール
async function cdpScroll(params) {
  const { x = 0, y = 0, deltaX = 0, deltaY = 0, selector, tabId } = params;
  const tab = await getActiveTab(tabId);
  await ensureDebuggerAttached(tab.id);

  if (selector) {
    // 要素までスクロール
    await cdpSend(tab.id, 'Runtime.evaluate', {
      expression: `(function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return !!el;
      })()`,
      returnByValue: true
    });
    return { success: true, scrolledTo: selector };
  }

  // マウスホイールイベントでスクロール
  await cdpSend(tab.id, 'Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: x || 100, y: y || 100,
    deltaX: deltaX || 0,
    deltaY: deltaY || 300
  });

  return { success: true, scrolled: { deltaX, deltaY } };
}

// CDP Page.captureScreenshot（デバッガー経由、より高品質）
async function cdpCaptureScreenshot(params = {}) {
  const tab = await getActiveTab(params.tabId);
  await ensureDebuggerAttached(tab.id);

  const result = await cdpSend(tab.id, 'Page.captureScreenshot', {
    format: params.format || 'png',
    quality: params.quality || 100
  });

  return { dataUrl: `data:image/${params.format || 'png'};base64,${result.data}` };
}

// CDP DOM.setFileInputFiles（ファイルアップロード）
async function cdpUploadFile(params) {
  const { selector, filePaths, tabId } = params;
  const tab = await getActiveTab(tabId);
  await ensureDebuggerAttached(tab.id);

  // セレクタからNodeIdを取得
  const doc = await cdpSend(tab.id, 'DOM.getDocument');
  const node = await cdpSend(tab.id, 'DOM.querySelector', {
    nodeId: doc.root.nodeId,
    selector: selector || 'input[type="file"]'
  });

  if (!node.nodeId) throw new Error(`File input not found: ${selector}`);

  await cdpSend(tab.id, 'DOM.setFileInputFiles', {
    nodeId: node.nodeId,
    files: filePaths
  });

  return { success: true, uploaded: filePaths };
}

// コンソールメッセージ取得
async function readConsole(params = {}) {
  const tab = await getActiveTab(params.tabId);
  const msgs = consoleMessages.get(tab.id) || [];
  const { clear = false, limit = 100 } = params;

  const result = msgs.slice(-limit);
  if (clear) consoleMessages.set(tab.id, []);

  return { messages: result, count: result.length };
}

// ネットワークリクエスト取得
async function readNetwork(params = {}) {
  const tab = await getActiveTab(params.tabId);
  const reqs = networkRequests.get(tab.id) || [];
  const { clear = false, limit = 50 } = params;

  const result = reqs.slice(-limit);
  if (clear) networkRequests.set(tab.id, []);

  return { requests: result, count: result.length };
}

// デバッガー手動アタッチ
async function debuggerAttach() {
  const tab = await getActiveTab();
  await ensureDebuggerAttached(tab.id);
  return { success: true, tabId: tab.id };
}

// デバッガー手動デタッチ
async function debuggerDetachCommand() {
  const tab = await getActiveTab();
  await detachDebugger(tab.id);
  return { success: true, tabId: tab.id };
}

// --- ナビゲーション関数 ---
// tabIdが指定されていればそのタブ、なければアクティブタブを返す
// これにより特定のタブを操作対象にできる（他のウィンドウで作業中でも邪魔しない）
async function getActiveTab(tabId) {
  if (tabId) {
    const tab = await chrome.tabs.get(tabId);
    if (!tab) throw new Error(`Tab not found: ${tabId}`);
    return tab;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error('No active tab found');
  return tab;
}

async function navigateTo(url, tabId) {
  const tab = await getActiveTab(tabId);
  await chrome.tabs.update(tab.id, { url });
  return { success: true, tabId: tab.id };
}

async function createTab(url) {
  const tab = await chrome.tabs.create({ url: url || 'about:blank' });
  return { success: true, tabId: tab.id };
}

async function closeTab(tabId) {
  if (tabId) {
    await chrome.tabs.remove(tabId);
  } else {
    const tab = await getActiveTab();
    await chrome.tabs.remove(tab.id);
  }
  return { success: true };
}

async function getAllTabs() {
  const tabs = await chrome.tabs.query({});
  return tabs.map(t => ({
    id: t.id,
    url: t.url,
    title: t.title,
    active: t.active,
    windowId: t.windowId
  }));
}

async function switchToTab(tabId) {
  await chrome.tabs.update(tabId, { active: true });
  const tab = await chrome.tabs.get(tabId);
  await chrome.windows.update(tab.windowId, { focused: true });
  return { success: true };
}

async function goBack() {
  const tab = await getActiveTab();
  await chrome.tabs.goBack(tab.id);
  return { success: true };
}

async function goForward() {
  const tab = await getActiveTab();
  await chrome.tabs.goForward(tab.id);
  return { success: true };
}

async function reloadPage() {
  const tab = await getActiveTab();
  await chrome.tabs.reload(tab.id);
  return { success: true };
}

// Content Script でコマンド実行（DOMベースの操作用フォールバック）
async function executeInPage(action, params) {
  const tab = await getActiveTab(params?.tabId);
  const results = await chrome.tabs.sendMessage(tab.id, { action, params });
  return results;
}

// スクリーンショット（tabs API経由）
async function captureScreenshot(params = {}) {
  const tab = await getActiveTab(params.tabId);
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
    format: params.format || 'png',
    quality: params.quality || 100
  });
  return { dataUrl };
}

// ページ情報取得
async function getPageInfo(tabId) {
  const tab = await getActiveTab(tabId);
  return {
    tabId: tab.id,
    url: tab.url,
    title: tab.title,
    windowId: tab.windowId
  };
}
