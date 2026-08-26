import { createHash } from "node:crypto";

export function evidenceFileDigest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
