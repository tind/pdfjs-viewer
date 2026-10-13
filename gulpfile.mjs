import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { PassThrough, Readable, Transform } from "node:stream";
import { finished, pipeline } from "node:stream/promises";
import { dest, parallel, series, src } from "gulp";
import { rimraf } from "rimraf";
import { JSDOM } from "jsdom";
import * as tar from "tar";
import Vinyl from "vinyl";

// Single source of truth for the upstream PDF.js version: package.json's
// "version" field, formatted as "<pdfJsVersion>-tind.<revision>" (e.g.
// "6.1.200-tind.0" tracks PDF.js v6.1.200). The download URL is derived from
// it, so the published package and the bundled PDF.js can never drift apart —
// bumping the base is a single edit to package.json's version.
const packageJson = JSON.parse(
  readFileSync(join(import.meta.dirname, "package.json"), "utf8"),
);

function resolvePdfJsVersion() {
  const match = /^(\d+\.\d+\.\d+)-tind\.\d+$/.exec(packageJson.version ?? "");
  if (!match) {
    throw new Error(
      `package.json "version" must be "<pdfJsVersion>-tind.<revision>" ` +
        `(e.g. "6.1.200-tind.0"), but is "${packageJson.version}". ` +
        `The upstream PDF.js version is derived from it.`,
    );
  }
  return match[1];
}

const pdfJsVersion = resolvePdfJsVersion();
const pdfJsDownloadUrl = `https://github.com/mozilla/pdf.js/archive/refs/tags/v${pdfJsVersion}.tar.gz`;
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

          const dom = new JSDOM(file.contents.toString("utf8"));
          const { window } = dom;
          const { document } = window;

          // Inject the TIND override scripts. They must load before PDF.js
          // dispatches "webviewerloaded", so anchor them right after <title>
          // in <head>. PDF.js viewer.html has always shipped a <title>; if it
          // ever stops, fail loudly rather than silently dropping the overrides.
          const title = document.head?.querySelector("title");
          if (!title) {
            callback(
              new Error(
                "viewer.html has no <head><title> to anchor the TIND override " +
                  "scripts after. PDF.js viewer.html structure changed; update " +
                  "the script-injection step in gulpfile.mjs for this version.",
              ),
            );
            return;
          }

          const overrideScripts = [
            "only-register-download.js",
            "override-pdf-viewer-application-open.js",
          ].map((scriptSrc) => {
            const script = document.createElement("script");
            script.src = scriptSrc;
            return script;
          });
          title.after(...overrideScripts);

          this.push(
            Object.assign(file.clone({ contents: false }), {
              path: join(file.base, "pdf_viewer.html"),
              contents: Buffer.from(dom.serialize(), "utf8"),
            }),
          );

          // View-only variant: view-only.js switches off PDF.js's download and
          // print support, which hides these controls and their keyboard
          // shortcuts. Don't hide them with inline style attributes instead:
          // viewer.html's Content-Security-Policy has no 'unsafe-inline' in
          // style-src, so browsers ignore them. The IDs are also relied on by
          // only-register-download.js and/or the view-only screenshot; if
          // PDF.js renames or removes any, fail the build.
          const viewOnlyControlIds = [
            "secondaryPrint",
            "secondaryDownload",
            "printButton",
            "downloadButton",
          ];
          const missingIds = viewOnlyControlIds.filter(
            (id) => !document.getElementById(id),
          );
          if (missingIds.length > 0) {
            callback(
              new Error(
                `viewer.html is missing expected control element(s): ` +
                  `${missingIds.join(", ")}. The view-only overlay can no longer ` +
                  `account for them; update gulpfile.mjs for this PDF.js version.`,
              ),
            );
            return;
          }

          const viewOnlyScript = document.createElement("script");
          viewOnlyScript.src = "view-only.js";
          overrideScripts.at(-1).after(viewOnlyScript);

          this.push(
            Object.assign(file.clone({ contents: false }), {
              path: join(file.base, "pdf_viewer_view_only.html"),
              contents: Buffer.from(dom.serialize(), "utf8"),
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

// Build-time guard for the runtime overlays (src/web/*.js), whose hook points
// are not visible to the DOM transform above: the "webviewerloaded" event and
// the global PDFViewerApplication that override-pdf-viewer-application-open.js
// hooks, plus the open() options it injects. If a PDF.js upgrade renames or
// drops any of these, the overlay silently no-ops in the browser. Assert they
// still exist in the built output so the upgrade fails here, not in production.
const requiredHookTokens = [
  {
    file: join(distDirectory, "web/viewer.mjs"),
    tokens: ["webviewerloaded", "PDFViewerApplication"],
    reason: "override-pdf-viewer-application-open.js hooks these.",
  },
  {
    file: join(distDirectory, "build/pdf.mjs"),
    tokens: ["rangeChunkSize", "disableStream", "disableAutoFetch"],
    reason: "override-pdf-viewer-application-open.js injects these into open().",
  },
  {
    file: join(distDirectory, "web/viewer.mjs"),
    tokens: [
      "PDFViewerApplicationOptions",
      "supportsDownloading",
      "supportsPrinting",
      "disablePreferences",
    ],
    reason: "view-only.js sets these to switch off download and print.",
  },
];

export async function verifyViewerHooks() {
  const problems = [];
  for (const { file, tokens, reason } of requiredHookTokens) {
    let contents;
    try {
      contents = await readFile(file, "utf8");
    } catch (error) {
      problems.push(`cannot read built file ${file}: ${error.message}`);
      continue;
    }
    for (const token of tokens) {
      if (!contents.includes(token)) {
        problems.push(`"${token}" not found in ${file} — ${reason}`);
      }
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `PDF.js ${pdfJsVersion} build is missing TIND overlay hook points:\n` +
        problems.map((problem) => `  - ${problem}`).join("\n") +
        `\nUpdate src/web/*.js and gulpfile.mjs for this PDF.js version.`,
    );
  }
}

// Raise PDF.js's rendered-page cache so revisiting an already-read page is
// instant instead of blanking and re-rendering (its default keeps only 10).
// PDF.js exposes no option for this, so rewrite the constant in the built
// (unminified) viewer.mjs, failing loudly if a future version changes it.
// Bounded to limit canvas memory on high-DPI scanned pages.
const VIEWER_CACHE_SIZE = 30;

export async function patchViewerCacheSize() {
  const file = join(distDirectory, "web/viewer.mjs");
  const find = "const DEFAULT_CACHE_SIZE = 10;";
  const replace = `const DEFAULT_CACHE_SIZE = ${VIEWER_CACHE_SIZE};`;
  const contents = await readFile(file, "utf8");
  if (contents.includes(replace) && !contents.includes(find)) {
    return; // already patched (e.g. re-running the build without a re-download)
  }
  const occurrences = contents.split(find).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `Expected exactly one ${JSON.stringify(find)} in ${file}, found ` +
        `${occurrences}. PDF.js ${pdfJsVersion} changed the rendered-page cache ` +
        `constant; update patchViewerCacheSize in gulpfile.mjs for this version.`,
    );
  }
  await writeFile(file, contents.replace(find, replace));
}

export const completeBuild = series(
  build,
  verifyViewerHooks,
  parallel(
    transformViewer,
    patchViewerCacheSize,
    series(
      parallel(copySrcFilesIntoDist, copyPackageJsonIntoDist),
      removeDevDependenciesFromDistPackageJson,
      createPackageLockInDist,
    ),
  ),
);
