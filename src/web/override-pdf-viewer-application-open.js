const OPEN_PATCHED_FLAG = Symbol("tindPdfViewerApplicationOpenPatched");
const registeredDocuments = new WeakSet();
const SIDEBAR_VIEW_NONE = 0;

function patchPDFViewerApplicationOpen(evt) {
  const sourceWindow = evt?.detail?.source;
  if (sourceWindow && sourceWindow !== window) {
    // Ignore events emitted by sibling iframe viewers sharing parent.document.
    return;
  }

  const win = sourceWindow || window;
  const app = win.PDFViewerApplication;
  const appOptions = win.PDFViewerApplicationOptions;
  if (!app || !appOptions || app[OPEN_PATCHED_FLAG]) {
    return;
  }

  // Force the initial sidebar state to "closed" and ignore stored view history.
  appOptions.set("sidebarViewOnLoad", SIDEBAR_VIEW_NONE);

  const params = new URLSearchParams(win.location.search);
  const rangeChunkSize = Number(params.get("chunksize"));
  if (!Number.isInteger(rangeChunkSize) || rangeChunkSize <= 0) {
    app[OPEN_PATCHED_FLAG] = true;
    return;
  }

  const disableStream = true;

  const originalOpen = app.open.bind(app);
  app.open = (args) => originalOpen({ ...args, rangeChunkSize, disableStream });
  app[OPEN_PATCHED_FLAG] = true;
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
