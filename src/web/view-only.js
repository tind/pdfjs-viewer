// Loaded by pdf_viewer_view_only.html only. Turns off PDF.js's download and
// print support rather than just hiding their buttons: with the options off,
// PDF.js hides those controls itself and also ignores Ctrl/Cmd+S and
// Ctrl/Cmd+P, which hidden buttons alone never covered.
//
// Inline style attributes can't do the hiding: viewer.html ships a
// Content-Security-Policy whose style-src has no 'unsafe-inline' (PDF.js 6.x),
// so the browser drops them and the buttons stay visible.
//
// Block-scoped because classic scripts share one global scope and
// override-pdf-viewer-application-open.js already declares similar names.
{
  const registeredViewOnlyDocuments = new WeakSet();

  const disableDownloadAndPrint = (evt) => {
    const sourceWindow = evt?.detail?.source;
    if (sourceWindow && sourceWindow !== window) {
      // Ignore events emitted by sibling iframe viewers sharing parent.document.
      return;
    }

    (sourceWindow || window).PDFViewerApplicationOptions.setAll({
      supportsDownloading: false,
      supportsPrinting: false,
      // Stored preferences are applied after this hook and may set these
      // options back, so ignore them in the view-only viewer.
      disablePreferences: true,
    });
  };

  const addViewOnlyListener = (targetDocument) => {
    if (!targetDocument || registeredViewOnlyDocuments.has(targetDocument)) {
      return;
    }

    targetDocument.addEventListener("webviewerloaded", disableDownloadAndPrint);
    registeredViewOnlyDocuments.add(targetDocument);
  };

  addViewOnlyListener(document);

  try {
    addViewOnlyListener(window.parent?.document);
  } catch {
    // Cross-origin or sandboxed iframe: parent.document is inaccessible.
  }
}
