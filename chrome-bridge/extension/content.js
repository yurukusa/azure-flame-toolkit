// Claude Code Bridge - Content Script
// ページ内の DOM 操作を行う

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleAction(message.action, message.params)
    .then(sendResponse)
    .catch(error => sendResponse({ error: error.message }));
  return true; // 非同期レスポンスを有効化
});

async function handleAction(action, params) {
  switch (action) {
    case 'click':
      return clickElement(params);

    case 'type':
      return typeText(params);

    case 'scroll':
      return scrollPage(params);

    case 'getElement':
      return getElement(params);

    case 'getElements':
      return getElements(params);

    case 'getText':
      return getText(params);

    case 'getHtml':
      return getHtml(params);

    case 'getAttribute':
      return getAttribute(params);

    case 'waitForElement':
      return waitForElement(params);

    case 'evaluate':
      return evaluateScript(params);

    case 'uploadFile':
      return uploadFile(params);

    case 'setHtml':
      return setHtml(params);

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

// 要素を見つける
function findElement(selector) {
  // XPath の場合
  if (selector.startsWith('//') || selector.startsWith('(//')) {
    const result = document.evaluate(
      selector,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    );
    return result.singleNodeValue;
  }
  // CSS セレクタの場合
  return document.querySelector(selector);
}

function findElements(selector) {
  if (selector.startsWith('//') || selector.startsWith('(//')) {
    const result = document.evaluate(
      selector,
      document,
      null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null
    );
    const elements = [];
    for (let i = 0; i < result.snapshotLength; i++) {
      elements.push(result.snapshotItem(i));
    }
    return elements;
  }
  return Array.from(document.querySelectorAll(selector));
}

// クリック
function clickElement(params) {
  const { selector, x, y } = params;

  if (x !== undefined && y !== undefined) {
    // 座標クリック
    const element = document.elementFromPoint(x, y);
    if (element) {
      element.click();
      return { success: true, clicked: 'coordinate' };
    }
    throw new Error(`No element at (${x}, ${y})`);
  }

  const element = findElement(selector);
  if (!element) throw new Error(`Element not found: ${selector}`);

  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  element.click();
  return { success: true, clicked: selector };
}

// テキスト入力
// contenteditable要素（Redactorエディタ等）にも対応
function typeText(params) {
  const { selector, text, clear = true, pressEnter = false, append = false } = params;

  const element = findElement(selector);
  if (!element) throw new Error(`Element not found: ${selector}`);

  element.focus();

  // contenteditable要素の判定
  const isContentEditable = element.isContentEditable || element.contentEditable === 'true';

  if (isContentEditable) {
    // contenteditable要素の場合
    if (clear) {
      element.innerHTML = '';
    }

    if (append) {
      // 追記モード: 既存コンテンツの後に追加
      element.innerHTML += text;
    } else if (!clear) {
      // clearもappendもfalseなら、末尾に追加
      element.innerHTML += text;
    } else {
      element.innerHTML = text;
    }

    // 入力イベントを発火してRedactor等の内部状態を更新
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    // keyupも発火（一部エディタはこれで状態更新）
    element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));

    return { success: true, typed: text, contentEditable: true };
  }

  // 通常のinput要素の場合
  if (clear) {
    element.value = '';
  }

  // 入力イベントをシミュレート
  element.value += text;
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));

  if (pressEnter) {
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));

    // フォーム送信も試行
    const form = element.closest('form');
    if (form) {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    }
  }

  return { success: true, typed: text };
}

// スクロール
function scrollPage(params) {
  const { x = 0, y = 0, selector, behavior = 'smooth' } = params;

  if (selector) {
    const element = findElement(selector);
    if (!element) throw new Error(`Element not found: ${selector}`);
    element.scrollIntoView({ behavior, block: 'center' });
    return { success: true, scrolledTo: selector };
  }

  window.scrollBy({ left: x, top: y, behavior });
  return { success: true, scrolled: { x, y } };
}

// 要素情報取得
function getElement(params) {
  const { selector } = params;
  const element = findElement(selector);

  if (!element) return { found: false };

  const rect = element.getBoundingClientRect();
  return {
    found: true,
    tagName: element.tagName,
    id: element.id,
    className: element.className,
    text: element.innerText?.substring(0, 1000),
    value: element.value,
    href: element.href,
    src: element.src,
    rect: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height
    },
    visible: rect.width > 0 && rect.height > 0,
    attributes: getElementAttributes(element)
  };
}

function getElements(params) {
  const { selector, limit = 100 } = params;
  const elements = findElements(selector).slice(0, limit);

  return elements.map((element, index) => {
    const rect = element.getBoundingClientRect();
    return {
      index,
      tagName: element.tagName,
      id: element.id,
      className: element.className,
      text: element.innerText?.substring(0, 200),
      value: element.value,
      href: element.href,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    };
  });
}

function getElementAttributes(element) {
  const attrs = {};
  for (const attr of element.attributes) {
    attrs[attr.name] = attr.value;
  }
  return attrs;
}

// テキスト取得
function getText(params) {
  const { selector } = params;

  if (!selector) {
    return { text: document.body.innerText };
  }

  const element = findElement(selector);
  if (!element) throw new Error(`Element not found: ${selector}`);

  return { text: element.innerText };
}

// HTML 取得
function getHtml(params) {
  const { selector, outer = false } = params;

  if (!selector) {
    return { html: document.documentElement.outerHTML };
  }

  const element = findElement(selector);
  if (!element) throw new Error(`Element not found: ${selector}`);

  return { html: outer ? element.outerHTML : element.innerHTML };
}

// 属性取得
function getAttribute(params) {
  const { selector, attribute } = params;

  const element = findElement(selector);
  if (!element) throw new Error(`Element not found: ${selector}`);

  return { value: element.getAttribute(attribute) };
}

// 要素を待機
async function waitForElement(params) {
  const { selector, timeout = 10000 } = params;

  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const element = findElement(selector);
    if (element) {
      return { found: true };
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return { found: false, timeout: true };
}

// JavaScript 実行
function evaluateScript(params) {
  const { script } = params;

  try {
    const result = eval(script);
    return { result: JSON.parse(JSON.stringify(result)) };
  } catch (error) {
    return { error: error.message };
  }
}

// ファイルアップロード（base64データをinput[type="file"]に設定）
// params: { selector, data (base64), filename, mimeType }
async function uploadFile(params) {
  const { selector, data, filename, mimeType = 'application/octet-stream' } = params;

  // input[type="file"] 要素を見つける
  let fileInput = selector ? findElement(selector) : document.querySelector('input[type="file"]');

  if (!fileInput) {
    throw new Error(`File input not found: ${selector || 'input[type="file"]'}`);
  }

  // base64をBlobに変換
  const byteString = atob(data);
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  const blob = new Blob([ab], { type: mimeType });

  // FileオブジェクトとDataTransferを作成
  const file = new File([blob], filename, { type: mimeType });
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);

  // input.filesに設定
  fileInput.files = dataTransfer.files;

  // changeイベントを発火
  fileInput.dispatchEvent(new Event('change', { bubbles: true }));

  return { success: true, uploaded: filename, size: file.size };
}

// HTML設定（contenteditable要素用）
// Redactorエディタなどの内部状態を更新するためにイベントを発火
function setHtml(params) {
  const { selector, html } = params;

  const element = findElement(selector);
  if (!element) throw new Error(`Element not found: ${selector}`);

  element.focus();
  element.innerHTML = html;

  // 入力イベントを発火してエディタの内部状態を更新
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));

  return { success: true, selector, htmlLength: html.length };
}

console.log('[Claude Bridge] Content script loaded');
