import { join } from "node:path";
import { spawn } from "node:child_process";
import { PassThrough, Readable, Transform } from "node:stream";
import { finished, pipeline } from "node:stream/promises";
import { dest, parallel, series, src } from "gulp";
import { rimraf } from "rimraf";
import { JSDOM } from "jsdom";
import * as tar from "tar";
import Vinyl from "vinyl";

const pdfJsDownloadUrl =
  "https://github.com/mozilla/pdf.js/archive/refs/tags/v5.4.624.tar.gz";
const buildDirectory = join(import.meta.dirname, "build");
const pdfJsModuleDirectory = join(buildDirectory, "pdf.js");
const distDirectory = join(buildDirectory, "dist");

/**
 * @param {readonly string[]} args
 * @param {NodeJS.ProcessEnv} [env]
 */
function pdfJsNpmTask(args, env) {
  return spawn("npm", args, {
    cwd: pdfJsModuleDirectory,
    env: {
      ...process.env,
      ...env,
    },
    stdio: "inherit",
  });
}

/**
 * @param {readonly string[]} args
 */
function pdfJsNpxTask(args) {
  return spawn("npx", args, {
    cwd: pdfJsModuleDirectory,
    stdio: "inherit",
  });
}

function pathFromArchiveRoot(path) {
  const segments = path.split("/").filter(Boolean);
  return segments.slice(1).join("/");
}

export async function pdfJsDownload() {
  await rimraf(pdfJsModuleDirectory);

  const response = await fetch(pdfJsDownloadUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to download PDF.js archive (${response.status} ${response.statusText}).`,
    );
  }
  if (!response.body) {
    throw new Error("PDF.js download returned an empty response body.");
  }

  const vinylStream = new PassThrough({ objectMode: true });
  const output = vinylStream.pipe(dest(pdfJsModuleDirectory));
  const parser = tar.t({
    noResume: true,
    onReadEntry(entry) {
      if (entry.type !== "File") {
        entry.resume();
        return;
      }

      const relativePath = pathFromArchiveRoot(entry.path);
      if (!relativePath) {
        entry.resume();
        return;
      }

      vinylStream.write(
        new Vinyl({
          base: pdfJsModuleDirectory,
          cwd: import.meta.dirname,
          contents: entry,
          path: join(pdfJsModuleDirectory, relativePath),
        }),
      );
    },
  });

  parser.once("error", (error) => {
    vinylStream.destroy(error);
  });
  parser.once("end", () => {
    vinylStream.end();
  });

  await Promise.all([
    pipeline(Readable.fromWeb(response.body), parser),
    finished(output),
  ]);
}

export function pdfJsInstall() {
  return pdfJsNpmTask(["clean-install", "--include", "dev"], {
    PUPPETEER_SKIP_DOWNLOAD: "1",
  });
}

export function pdfJsGeneric() {
  return pdfJsNpxTask(["gulp", "generic"]);
}

export function clean() {
  return rimraf(buildDirectory);
}

function distClean() {
  return rimraf(distDirectory);
}

function copyPdfJsGenericAssets() {
  return src(join(pdfJsModuleDirectory, "build/generic/**/*")).pipe(
    dest(distDirectory),
  );
}

const collectAssets = copyPdfJsGenericAssets;

export const build = series(pdfJsGeneric, distClean, collectAssets);

export function transformViewer() {
  return src(join(distDirectory, "web/viewer.html"), {
    base: join(distDirectory, "web"),
  })
    .pipe(
      new Transform({
        objectMode: true,
        transform(file, _encoding, callback) {
          if (file.isDirectory()) {
            callback();
            return;
          }
          if (file.isNull()) {
            callback(null, file);
            return;
          }
          if (file.isStream()) {
            callback(new Error("Streaming Vinyl files are not supported."));
            return;
          }

          const { window } = new JSDOM(file.contents.toString("utf8"));
          const overrideScriptElement = window.document.createElement("script");
          overrideScriptElement.src = "override-pdf-viewer-application-open.js";
          const registerDownloadScriptElement =
            window.document.createElement("script");
          registerDownloadScriptElement.src = "only-register-download.js";

          const title = window.document.head.querySelector("title");
          if (title) {
            title.after(overrideScriptElement);
            title.after(registerDownloadScriptElement);
          } else {
            window.document.head.append(overrideScriptElement);
          }

          this.push(
            Object.assign(file.clone({ contents: false }), {
              path: join(file.base, "pdf_viewer.html"),
              contents: Buffer.from(
                window.document.documentElement.outerHTML,
                "utf8",
              ),
            }),
          );

          const secondaryPrint =
            window.document.getElementById("secondaryPrint");

          if (secondaryPrint) {
            secondaryPrint.style = "display:none !important";
          }

          const secondaryDownload =
            window.document.getElementById("secondaryDownload");

          if (secondaryDownload) {
            secondaryDownload.style = "display:none !important";
          }

          const print = window.document.getElementById("print");

          if (print) {
            print.style = "display:none !important";
          }

          const download = window.document.getElementById("download");

          if (download) {
            download.style = "display:none !important";
          }

          this.push(
            Object.assign(file.clone({ contents: false }), {
              path: join(file.base, "pdf_viewer_view_only.html"),
              contents: Buffer.from(
                window.document.documentElement.outerHTML,
                "utf8",
              ),
            }),
          );

          callback();
        },
      }),
    )
    .pipe(dest(join(distDirectory, "web")));
}

export function copySrcFilesIntoDist() {
  return src(["**/*", "**/.*"], {
    cwd: join(import.meta.dirname, "src"),
    base: join(import.meta.dirname, "src"),
    dot: true,
    nodir: true,
  }).pipe(dest(distDirectory));
}

export function copyPackageJsonIntoDist() {
  return src(join(import.meta.dirname, "package.json"), {
    base: import.meta.dirname,
  }).pipe(dest(distDirectory));
}

function removeDevDependenciesFromDistPackageJson() {
  return spawn("npm", ["pkg", "delete", "devDependencies"], {
    cwd: distDirectory,
    stdio: "inherit",
  });
}

export function packageAsset() {
  return spawn("npm", ["pack"], {
    cwd: distDirectory,
    stdio: "inherit",
  });
}

export function createPackageLockInDist() {
  return spawn("npm", ["install", "--package-lock-only"], {
    cwd: distDirectory,
    stdio: "inherit",
  });
}

export const completeBuild = series(
  build,
  parallel(
    transformViewer,
    series(
      parallel(copySrcFilesIntoDist, copyPackageJsonIntoDist),
      removeDevDependenciesFromDistPackageJson,
      createPackageLockInDist,
    ),
  ),
);
