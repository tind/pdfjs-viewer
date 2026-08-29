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
  const requestedChunkSize = Number(params.get("chunksize"));
  if (!Number.isInteger(requestedChunkSize) || requestedChunkSize <= 0) {
    return;
  }

  // Cap the range chunk size. The backend currently requests 8MB chunks, but on
  // a non-linearized PDF every scattered object read during first paint then
  // drags a full 8MB — slow on poor connections. A smaller cap keeps first-paint
  // fetches close to the bytes the visible page actually needs.
  const MAX_RANGE_CHUNK_SIZE = 512 * 1024;
  const rangeChunkSize = Math.min(requestedChunkSize, MAX_RANGE_CHUNK_SIZE);

  // Fetch on demand only: streaming the whole file is disabled (disableStream),
  // and so is PDF.js's background "fetch every remaining chunk" sweep
  // (disableAutoFetch). Together they make the viewer spend the connection on
  // the page being read instead of pulling the entire document up front, so the
  // first page becomes readable as soon as possible — the priority on slow links.
  const disableStream = true;
  const disableAutoFetch = true;

  const originalOpen = app.open.bind(app);
  app.open = (args) =>
    originalOpen({ ...args, rangeChunkSize, disableStream, disableAutoFetch });
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
