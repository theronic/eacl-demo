import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { scanTree } from "./lib/secret-scan.mjs";

const root = path.resolve(import.meta.dirname, "..");
const report = await scanTree(root);
await mkdir(path.join(root, "dist"), { recursive: true });
await writeFile(path.join(root, "dist/secret-scan-report.json"), `${JSON.stringify(report, null, 2)}\n`);
if (report.findings.length > 0) {
  for (const finding of report.findings) console.error(`${finding.rule}\t${finding.file}\t${finding.offset}\t${finding.fingerprint}`);
  throw new Error(`secret scan found ${report.findings.length} potential credential(s); values are fingerprinted, never printed`);
}
console.log(`secret scan passed: ${report.filesScanned} files, ${report.bytesScanned} bytes`);
