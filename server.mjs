import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL(".", import.meta.url)));
const useDist = process.argv.includes("--dist");
const root = resolve(projectRoot, useDist ? "dist" : ".");
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 4173);
const types = new Map([
  [".html", "text/html; charset=utf-8"], [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"], [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"], [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"], [".ico", "image/x-icon"], [".png", "image/png"]
]);

const server = createServer(async (request, response) => {
  const headers = {
    "Content-Security-Policy": "default-src 'self'; script-src 'self' https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/; style-src 'self'; img-src 'self' data:; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firebaseappcheck.googleapis.com https://firebaseinstallations.googleapis.com https://*.cloudfunctions.net https://www.google.com/recaptcha/ https://www.recaptcha.net/recaptcha/ http://localhost:* http://127.0.0.1:*; frame-src https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/ https://www.recaptcha.net/recaptcha/; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY", "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cache-Control": "no-store"
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { ...headers, Allow: "GET, HEAD" }).end("Method not allowed");
    return;
  }
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname); }
  catch { response.writeHead(400, headers).end("Bad request"); return; }
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  let target = resolve(root, relative);
  if (!useDist && target !== resolve(projectRoot, "index.html")) {
    try { await stat(target); }
    catch { target = resolve(projectRoot, "public", relative); }
  }
  const allowedRoots = useDist ? [root] : [projectRoot, resolve(projectRoot, "public")];
  if (!allowedRoots.some((allowed) => target === allowed || target.startsWith(allowed + sep))) {
    response.writeHead(403, headers).end("Forbidden");
    return;
  }
  try {
    const info = await stat(target);
    if (!info.isFile()) throw new Error("Not a file");
    const body = await readFile(target);
    response.writeHead(200, { ...headers, "Content-Type": types.get(extname(target)) || "application/octet-stream", "Content-Length": body.length });
    response.end(request.method === "HEAD" ? undefined : body);
  } catch {
    response.writeHead(404, { ...headers, "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
  }
});

server.listen(port, host, () => console.log(`Supreme Canine Academy local review at http://${host}:${port}${useDist ? " (dist)" : ""}`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
