import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createFoodApiMiddleware } from "./food-db.js";

const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, "..", "dist");
const port = Number(process.env.PORT ?? 4173);
const host = process.env.HOST ?? "0.0.0.0";
const apiMiddleware = createFoodApiMiddleware();

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
]);

function sendStaticFile(response, filePath) {
  const extension = extname(filePath);
  const isCacheableAsset = filePath.includes("/assets/") || filePath.includes("/icons/");
  response.writeHead(200, {
    "Content-Type": mimeTypes.get(extension) ?? "application/octet-stream",
    "Cache-Control": isCacheableAsset ? "public, max-age=31536000, immutable" : "no-cache",
  });
  createReadStream(filePath).pipe(response);
}

function resolveStaticPath(urlPathname) {
  const decodedPath = decodeURIComponent(urlPathname);
  const safePath = normalize(decodedPath).replace(/^(\.\.[/\\])+/, "");
  const requestedPath = join(distDir, safePath);

  if (requestedPath.startsWith(distDir) && existsSync(requestedPath) && statSync(requestedPath).isFile()) {
    return requestedPath;
  }

  return join(distDir, "index.html");
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");

  if (url.pathname === "/healthz") {
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  apiMiddleware(request, response, () => {
    try {
      sendStaticFile(response, resolveStaticPath(url.pathname));
    } catch {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
    }
  });
});

server.listen(port, host, () => {
  console.log(`Food Tracker listening on http://${host}:${port}`);
});
