const OPEN_PATCHED_FLAG = Symbol("tindPdfViewerApplicationOpenPatched");
const THEME_PATCHED_FLAG = Symbol("tindPdfViewerApplicationThemePatched");
const registeredDocuments = new WeakSet();

function patchPDFViewerApplicationTheme(win, app) {
  if (app[THEME_PATCHED_FLAG]) {
    return;
  }

  const applyDarkThemeOverride = () => {
    // Override the viewer theme before initialization so PDF.js applies dark
    // mode regardless of `prefers-color-scheme`.
    win.PDFViewerApplicationOptions?.set?.("viewerCssTheme", 2);
    // Apply a direct fallback in case the upstream option API changes.
    win.document?.documentElement?.style?.setProperty("color-scheme", "dark");
  };
  const preferencesInitializedPromise = app.preferences?.initializedPromise;

  if (typeof preferencesInitializedPromise?.then === "function") {
    // Queue the override to run after preferences load, which avoids the
    // upstream warning about manual `AppOptions` values being overridden.
    preferencesInitializedPromise.then(
      applyDarkThemeOverride,
      applyDarkThemeOverride,
    );
    // Keep the document in dark mode in case the upstream option API changes.
    win.document?.documentElement?.style?.setProperty("color-scheme", "dark");
  } else {
    applyDarkThemeOverride();
  }
  app[THEME_PATCHED_FLAG] = true;
}

function patchPDFViewerApplicationOpenOverride(win, app) {
  if (app[OPEN_PATCHED_FLAG]) {
    return;
  }

  const params = new URLSearchParams(win.location.search);
  const rangeChunkSize = Number(params.get("chunksize"));
  if (!Number.isInteger(rangeChunkSize) || rangeChunkSize <= 0) {
    return;
  }

  const disableStream = true;

  const originalOpen = app.open.bind(app);
  app.open = (args) => originalOpen({ ...args, rangeChunkSize, disableStream });
  app[OPEN_PATCHED_FLAG] = true;
}

function patchPDFViewerApplicationOpen(evt) {
  const sourceWindow = evt?.detail?.source;
  if (sourceWindow && sourceWindow !== window) {
    // Ignore events emitted by sibling iframe viewers sharing parent.document.
    return;
  }

  const win = sourceWindow || window;
  const app = win.PDFViewerApplication;
  if (!app) {
    return;
  }

  patchPDFViewerApplicationTheme(win, app);
  patchPDFViewerApplicationOpenOverride(win, app);
}

function addWebViewerLoadedListener(targetDocument) {
  if (!targetDocument || registeredDocuments.has(targetDocument)) {
    return;
  }

  targetDocument.addEventListener(
    "webviewerloaded",
    patchPDFViewerApplicationOpen,
  );
  registeredDocuments.add(targetDocument);
}

addWebViewerLoadedListener(document);

try {
  addWebViewerLoadedListener(window.parent?.document);
} catch {
  // Cross-origin or sandboxed iframe: parent.document is inaccessible.
}
