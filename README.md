# TIND PDF.js viewer

This is a PDF.js viewer for TIND. It is based on the PDF.js viewer provided by Mozilla, but it has been modified to work with TIND.

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
