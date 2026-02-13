async function onlyRegisterDownload() {
  // get the current url of iframe
  const url = new URL(window.location.href);
  const fileUrlEncoded = url.searchParams.get("file");
  const fileUrl = new URL(decodeURIComponent(fileUrlEncoded));

  // Clear the search params
  fileUrl.search = "";

  fileUrl.searchParams.append("register_download", "1");
  fileUrl.searchParams.append("no_download", "1");

  const response = await fetch(fileUrl, { cache: "no-store" });
  const HTTP_NO_CONTENT = 204;
  if (response.status !== HTTP_NO_CONTENT) {
    console.log(`Error registering download at URL '${fileUrl.toString()}'
    Expected status ${HTTP_NO_CONTENT}, got ${response.status}
    `);
  }
}

document.addEventListener("click", (evt) => {
  // Only fire when user clicked on button with id "download"
  const target = evt.target;
  if (target instanceof HTMLElement && target.id === "downloadButton") {
    onlyRegisterDownload();
  }
});
