import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "dist", "static-site");
const port = Number.parseInt(process.argv[2] ?? "4176", 10);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new RangeError("preview port must be 1024..65535");

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname);
    const relative = pathname === "/" ? "index.html" : pathname === "/datascript/" ? "datascript/index.html" : pathname.slice(1);
    const candidate = path.resolve(root, relative);
    if (!candidate.startsWith(`${root}${path.sep}`)) throw new Error("path escapes static root");
    if (!(await stat(candidate)).isFile()) throw new Error("not a file");
    const bytes = await readFile(candidate);
    response.writeHead(200, { "content-type": contentType(candidate), "cache-control": "no-store" });
    response.end(bytes);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found\n");
  }
});
server.listen(port, "127.0.0.1", () => console.log(`Static-site preview: http://127.0.0.1:${port}/`));

function contentType(candidate) {
  if (candidate.endsWith(".html")) return "text/html; charset=utf-8";
  if (candidate.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (candidate.endsWith(".css")) return "text/css; charset=utf-8";
  if (candidate.endsWith(".json") || candidate.endsWith(".map")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}
