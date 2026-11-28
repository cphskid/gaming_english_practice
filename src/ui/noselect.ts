// 樂園介面設計原則：遊戲畫面不能被長按／右鍵反白、選取、叫出系統選單（2026-11-28 Chuck）
// 搭配 noselect.css；跟樂園 js/noselect.js 同一套，改的話兩邊一起改。CSS 擋住大部分；這裡補：電腦右鍵選單、Android 長按選單、圖片拖曳、
// iOS 偶爾還是選得起來的情況（一出現選取就清掉）。輸入框、可編輯區、.can-select 不擋。
import './noselect.css';

export function noSelect(): void {
  const w = window as unknown as { __noSelect?: number };
  if (w.__noSelect) return; w.__noSelect = 1;
  const KEEP = 'input:not([type=button]):not([type=submit]):not([type=range]):not([type=checkbox]):not([type=radio]),textarea,select,[contenteditable]:not([contenteditable=false]),.can-select,.tch,.cr';
  function el(n: Node | null | undefined): Element | null { if (!n) return null; return n.nodeType === 1 ? (n as Element) : n.parentElement; }
  function keep(n: Node | EventTarget | null | undefined): boolean { const e = el(n as Node); return !!(e && e.closest(KEEP)); }
  function stop(e: Event): void { if (!keep(e.target)) e.preventDefault(); }
  document.addEventListener('contextmenu', stop, true);
  document.addEventListener('selectstart', stop, true);
  document.addEventListener('dragstart', function (e) {
    const t = el(e.target as Node);
    if (t && t.closest('[draggable=true]')) return; // 自己做的拖放照常
    stop(e);
  }, true);
  document.addEventListener('selectionchange', function () {
    const s = document.getSelection();
    if (!s || s.isCollapsed || keep(document.activeElement) || keep(s.anchorNode)) return;
    s.removeAllRanges();
  });
}
