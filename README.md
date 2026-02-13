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

## Versioning

Keep the upstream PDF.js version as the base and use a `-tind.N` suffix for publish increments.

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
