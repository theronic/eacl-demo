import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { verifyProfilePublication } from "../packages/explorer-state/src/profile-publication.mjs";
import { createServerProfilePublicationPlan } from "./lib/profile-publication-plan.mjs";

const root = path.resolve(import.meta.dirname, "..");
const requestPath = resolveInput(process.argv[2]);
const request = JSON.parse(await readFile(requestPath, "utf8"));
if (!request || request.schema !== "eacl-demo.prepare-profile-publication.v1") throw new Error("publication preparation request schema is invalid");
const definitions = JSON.parse(await readFile(path.join(root, "packages/contracts/profiles.v1.json"), "utf8"));
const registry = JSON.parse(await readFile(path.join(root, "registry/profile-registry.v1.json"), "utf8"));
const profileId = request.publication?.profile?.id;
const definition = definitions.profiles.find(({ id }) => id === profileId);
const expected = registry.profiles.find(({ id }) => id === profileId);
await verifyProfilePublication(request.publication, definition, expected);
const publicationBody = `${JSON.stringify(request.publication, null, 2)}\n`;
const plan = createServerProfilePublicationPlan({ ...request, bodySha256: createHash("sha256").update(publicationBody).digest("hex") });
const output = path.join(root, "dist", "profile-publications", profileId);
await mkdir(output, { recursive: true });
await writeFile(path.join(output, `${profileId}.json`), publicationBody, { flag: "wx" });
await writeFile(path.join(output, "publication-plan.json"), `${JSON.stringify(plan, null, 2)}\n`, { flag: "wx" });
console.log(`${profileId}\t${plan.publicObject.key}\t${request.publication.publicationId}`);

function resolveInput(value) {
  if (!value || path.isAbsolute(value)) throw new Error("usage: node scripts/prepare-profile-publication.mjs <repository-relative-request.json>");
  const candidate = path.resolve(root, value);
  if (!candidate.startsWith(`${root}${path.sep}`) || !candidate.endsWith(".json")) throw new Error("publication request path escapes the repository or is not JSON");
  return candidate;
}
