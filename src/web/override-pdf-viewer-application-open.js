function patchPDFViewerApplicationOpen(evt) {
  const win = evt?.detail?.source || window;
  const app = win.PDFViewerApplication;
  if (!app) {
    return;
  }

  const params = new URLSearchParams(win.location.search);
  const rangeChunkSize = Number(params.get("rangeChunkSize"));
  if (!Number.isInteger(rangeChunkSize) || rangeChunkSize <= 0) {
    return;
  }

  const disableStream = true;

  const originalOpen = app.open.bind(app);
  app.open = (args) => originalOpen({ ...args, rangeChunkSize, disableStream });
}

document.addEventListener("webviewerloaded", patchPDFViewerApplicationOpen);
