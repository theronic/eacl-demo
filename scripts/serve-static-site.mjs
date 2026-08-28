import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "dist", "static-site");
const port = Number.parseInt(process.argv[2] ?? "4176", 10);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new RangeError("preview port must be 1024..65535");

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname);
    const relative = ["/", "/datahike", "/datahike/"].includes(pathname)
      ? "index.html"
      : pathname === "/datascript/"
        ? "datascript/index.html"
        : pathname.slice(1);
    const candidate = path.resolve(root, relative);
    if (!candidate.startsWith(`${root}${path.sep}`)) throw new Error("path escapes static root");
    if (!(await stat(candidate)).isFile()) throw new Error("not a file");
    const bytes = await readFile(candidate);
    response.writeHead(200, {
      "content-type": contentType(candidate),
      "cache-control": "no-store",
      "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com https://y66owmoqebrcmzyfw6uturkaue0exoqe.lambda-url.us-east-1.on.aws https://ammics5svacgyu5eopgicnzz3y0lsryk.lambda-url.us-east-1.on.aws https://nkpogjjpx5wyb4imujlrefedqu0qpqwu.lambda-url.us-east-1.on.aws https://cjg7vmjzdhpomcjac3nxgp5ina0iwakt.lambda-url.us-east-1.on.aws https://kfhndav4wq4rtmyugoriekcztm0mjrza.lambda-url.us-east-1.on.aws https://7um6u6hb6wq6yfl46ukjkxcpuy0gexer.lambda-url.us-east-1.on.aws https://datomic.demo.eacl.dev https://n56bfv3ompn6h4cqnxsi5bhavm0gwfrm.lambda-url.us-east-1.on.aws; worker-src 'none'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
    });
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
