import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { createServerAliasPromotionPlan } from "./lib/profile-publication-plan.mjs";

const root = path.resolve(import.meta.dirname, "..");
const requestPath = resolveInput(process.argv[2]);
const request = JSON.parse(await readFile(requestPath, "utf8"));
if (!request || request.schema !== "eacl-demo.prepare-alias-promotion.v1") throw new Error("alias promotion request schema is invalid");
const definitions = JSON.parse(await readFile(path.join(root, "packages/contracts/profiles.v1.json"), "utf8"));
const definition = definitions.profiles.find(({ id }) => id === request.profileId);
if (!definition) throw new Error("alias promotion profile is unknown");
const profile = { id: definition.id, route: "/" };
const plan = createServerAliasPromotionPlan({ profile, deployment: request.deployment, smoke: request.smoke, currentAlias: request.currentAlias });
const output = path.join(root, "dist", "profile-promotions", request.profileId);
await mkdir(output, { recursive: true });
await writeFile(path.join(output, "alias-promotion-plan.json"), `${JSON.stringify(plan, null, 2)}\n`, { flag: "wx" });
console.log(`${request.profileId}\t${plan.promotion.alias.fromVersion}->${plan.promotion.alias.toVersion}\t${plan.evidenceId}`);

function resolveInput(value) {
  if (!value || path.isAbsolute(value)) throw new Error("usage: node scripts/prepare-alias-promotion.mjs <repository-relative-request.json>");
  const candidate = path.resolve(root, value);
  if (!candidate.startsWith(`${root}${path.sep}`) || !candidate.endsWith(".json")) throw new Error("alias promotion request path escapes the repository or is not JSON");
  return candidate;
}
