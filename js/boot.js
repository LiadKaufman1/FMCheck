// Runs first on every page: www moves to fmcheck.org, and the backup addresses get a note.
// (A file rather than inline code, so the site's security policy can block all inline scripts.)
if (location.hostname === "www.fmcheck.org") location.replace("https://fmcheck.org" + location.pathname + location.search + location.hash);
if (/(\.github\.io|\.workers\.dev)$/.test(location.hostname)) document.documentElement.classList.add("old-address");
