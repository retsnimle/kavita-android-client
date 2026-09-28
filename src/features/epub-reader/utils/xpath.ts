/**
 * 依據元素在 DOM 中的結構路徑生成標準 XPath (與 Kavita 官方 Web 閱讀器完全互通，例如 /body/p[14])
 * 自動穿透並忽略自定義分頁容器 #kavita-book-wrapper，確保與原書 DOM 結構完全對齊
 */
export const getXPathForElement = (el: Element | null): string => {
  if (!el || el.nodeType !== 1) return '';
  const tag = el.tagName.toLowerCase();
  if (tag === 'body' || el.id === 'kavita-book-wrapper') return '/body';
  if (tag === 'html') return '/html';

  // 取得父節點，穿透自定義注入的 kavita-book-wrapper 虛擬容器
  let parent = el.parentElement;
  while (parent && parent.id === 'kavita-book-wrapper') {
    parent = parent.parentElement;
  }

  let index = 1;
  let sibling = el.previousElementSibling;
  while (sibling) {
    if (sibling.id !== 'kavita-book-wrapper' && sibling.tagName.toLowerCase() === tag) {
      index++;
    }
    sibling = sibling.previousElementSibling;
  }

  if (!parent || parent.tagName.toLowerCase() === 'html' || parent.tagName.toLowerCase() === 'body') {
    return `/body/${tag}[${index}]`;
  }
  const parentXPath = getXPathForElement(parent);
  return `${parentXPath}/${tag}[${index}]`;
};

/**
 * 依據 XPath 在 iframe document 中查找元素節點
 * 支援全相容標準 DOM (自動轉換 /body 為 //body)、Kavita 官方 Web XPath 與正則索引容錯
 */
export const getElementByXPath = (doc: Document, xpath: string): Element | null => {
  if (!xpath || !doc) return null;
  try {
    let cleanXpath = xpath.trim();
    // 根節點為 <html>，單斜線 /body 在標準 DOM evaluate 下永遠找不到節點，正規化轉為 //body
    if (cleanXpath.startsWith('/body')) {
      cleanXpath = `/${cleanXpath}`;
    } else if (!cleanXpath.startsWith('/') && !cleanXpath.startsWith('id(')) {
      cleanXpath = `//${cleanXpath}`;
    }

    const result = doc.evaluate(
      cleanXpath,
      doc,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    );
    if (result.singleNodeValue && (result.singleNodeValue as Element).nodeType === 1) {
      return result.singleNodeValue as Element;
    }
  } catch (err) {
    console.warn('XPath evaluate 解析失敗，將嘗試正則與 fallback:', xpath, err);
  }

  // 容錯 Fallback 1：正則提取最後的標籤與索引（例如 .../p[14] -> 第 14 個 p 標籤）
  const tagMatch = xpath.match(/\/([a-z0-9]+)\[(\d+)\]$/i);
  if (tagMatch) {
    const tagName = tagMatch[1].toLowerCase();
    const idx = parseInt(tagMatch[2], 10) - 1;
    const elements = doc.querySelectorAll(tagName);
    if (elements[idx]) return elements[idx];
  }

  // 容錯 Fallback 2：如果是 id("...")
  const idMatch = xpath.match(/id\(["']([^"']+)["']\)/i);
  if (idMatch) {
    const el = doc.getElementById(idMatch[1]);
    if (el) return el;
  }

  return null;
};
