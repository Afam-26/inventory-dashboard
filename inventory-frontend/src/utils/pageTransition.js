// src/utils/pageTransition.js
let inited = false;

function clearLandingExit() {
  // If we ever set html.page-exit, make sure it never "sticks" on Back
  document.documentElement.classList.remove("page-exit");
}

function replayPageEnter() {
  const nodes = document.querySelectorAll(".page-enter");
  nodes.forEach((el) => {
    el.classList.remove("page-enter");
    // force reflow
    // eslint-disable-next-line no-unused-expressions
    el.offsetWidth;
    el.classList.add("page-enter");
  });
}

/**
 * Call this once in main.jsx
 */
export function initPageTransitions() {
  if (inited) return;
  inited = true;

  // Initial load
  clearLandingExit();
  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        clearLandingExit();
        replayPageEnter();
      },
      { once: true }
    );
  } else {
    replayPageEnter();
  }

  // ✅ Key fix: bfcache restore (Back/Forward)
  window.addEventListener("pageshow", () => {
    clearLandingExit();
    requestAnimationFrame(() => requestAnimationFrame(replayPageEnter));
  });

  // Back/forward navigation
  window.addEventListener("popstate", () => {
    clearLandingExit();
    requestAnimationFrame(() => requestAnimationFrame(replayPageEnter));
  });

  // Tab becomes visible again (helps on mobile)
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      clearLandingExit();
      requestAnimationFrame(() => requestAnimationFrame(replayPageEnter));
    }
  });
}

/**
 * Use this before navigating away from Landing if you want the exit animation.
 */
export function playLandingExit() {
  document.documentElement.classList.add("page-exit");
}

/**
 * Optional: if you ever need to cancel it immediately.
 */
export function cancelLandingExit() {
  document.documentElement.classList.remove("page-exit");
}


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
