# TIND PDF.js viewer

This is a PDF.js viewer for TIND. It is based on the PDF.js viewer provided by Mozilla, but it has been modified to work with TIND.

## Local PDF viewer changes

- Registering download stats by intercepting the download button click and sending a `register_download=1` request before file retrieval (`src/web/only-register-download.js`).
- Configurable chunk size by reading `rangeChunkSize` from the viewer URL and injecting it into `PDFViewerApplication.open` (`src/web/override-pdf-viewer-application-open.js`).
- View-only HTML variant by generating `pdf_viewer_view_only.html` and hiding print/download controls during the viewer transform step (`gulpfile.mjs`).

These overlays depend on specific PDF.js hook points (the `webviewerloaded` event, the `PDFViewerApplication.open` options, and the print/download control element IDs). The build verifies those hook points still exist (`verifyViewerHooks` and the `transformViewer` checks in `gulpfile.mjs`) and **fails loudly** if a PDF.js upgrade renames or removes one, so a broken overlay surfaces at build time instead of silently in the browser.

## Building

1. Install the dependencies

    ```shell
    npm clean-install
    ```

2. Download PDF.js source code

    ```shell
    npx gulp pdfJsDownload
    ```

3. Install the PDF.js dependencies

    ```shell
    npx gulp pdfJsInstall
    ```

4. Run the complete build task

    ```shell
    npx gulp completeBuild
    ```

5. (Optional) Clean up built assets

    ```shell
    npx gulp clean
    ```

The output is available in the `build` directory with this structure:

- `build/pdf.js` (downloaded PDF.js source, including `build/` artifacts)
- `build/dist` (distribution assets from PDF.js `generic`, plus override and `package.json`)

## Versioning

The `version` field in `package.json` is the **single source of truth** for the upstream PDF.js version: it is formatted as `<pdfJsVersion>-tind.<revision>`, and `gulpfile.mjs` derives the PDF.js download URL from the `<pdfJsVersion>` part. To upgrade the base, change only `package.json` (e.g. via `npm version`, below) — do **not** hardcode the version anywhere else.

Use the `-tind.N` suffix for publish increments and reset it to `.0` when the upstream base changes.

- First publish for upstream `5.4.624`: `5.4.624-tind.0`
- Next publish: `5.4.624-tind.1`
- After upgrading upstream to `5.4.625`: `5.4.625-tind.0`

Examples:

```shell
# set explicit version
npm version 5.4.624-tind.0 --no-git-tag-version

# bump the tind prerelease number (tind.0 -> tind.1)
npm version prerelease --preid=tind --no-git-tag-version
```

When publishing a prerelease version (`-tind.N`), npm requires an explicit dist-tag:

```shell
npm publish --tag tind
```
