import path from "node:path";

import { prepareLockedEaclCore } from "./lib/prepare-eacl-core.mjs";

const root = path.resolve(import.meta.dirname, "..");
const prepared = await prepareLockedEaclCore(root);

console.log(`Prepared EACL Core ${prepared.lock.sha}`);
