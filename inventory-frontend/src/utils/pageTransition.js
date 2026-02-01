// src/utils/pageTransition.js
export function startPageExit({ ms = 450, key = "pageExit", className = "page-exit" } = {}) {
  try {
    document.documentElement.classList.add(className);
    sessionStorage.setItem(key, String(ms));
  } catch {
    // ignore
  }
}

export function consumePageExit({ key = "pageExit", className = "page-exit" } = {}) {
  try {
    const v = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    document.documentElement.classList.remove(className);
    return v ? Number(v) : 0;
  } catch {
    return 0;
  }
}
