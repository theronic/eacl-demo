import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { readBoundedBytes } from "./static-publication.mjs";

const ACCOUNT = /^[0-9]{12}$/u;
const REGION = /^[a-z]{2}(?:-gov)?-[a-z]+-[1-9][0-9]?$/u;
const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u;
const DISTRIBUTION = /^[A-Z0-9]{8,32}$/u;
const VERSION = /^.{1,1024}$/us;

export function createStaticS3Storage({ accountId, region, bucket, distributionId, origin, artifactSha256, runAws = defaultRunAws, fetchImpl = globalThis.fetch }) {
  if (!ACCOUNT.test(accountId)) throw new Error("static AWS account ID is invalid");
  if (!REGION.test(region)) throw new Error("static AWS region is invalid");
  if (!BUCKET.test(bucket)) throw new Error("static bucket name is invalid");
  if (!DISTRIBUTION.test(distributionId)) throw new Error("static CloudFront distribution ID is invalid");
  if (!/^[0-9a-f]{64}$/u.test(artifactSha256)) throw new Error("static artifact digest is invalid");
  const trustedOrigin = new URL(origin);
  if (trustedOrigin.protocol !== "https:" || trustedOrigin.pathname !== "/" || trustedOrigin.search || trustedOrigin.hash || trustedOrigin.username || trustedOrigin.password) throw new Error("static production origin is invalid");
  const restored = new Map();
  const base = ["--region", region, "--no-cli-pager"];

  const adapter = {
    async assertFoundation() {
      const caller = awsJson(["sts", "get-caller-identity", ...base], "AWS caller identity");
      if (caller.Account !== accountId || caller.Arn?.includes(":root")) throw new Error("static deployment assumed the wrong or root AWS identity");
      const versioning = awsJson(["s3api", "get-bucket-versioning", "--bucket", bucket, "--expected-bucket-owner", accountId, ...base], "static bucket versioning");
      if (versioning.Status !== "Enabled") throw new Error("static bucket versioning is not enabled");
      const access = awsJson(["s3api", "get-public-access-block", "--bucket", bucket, "--expected-bucket-owner", accountId, ...base], "static public-access block").PublicAccessBlockConfiguration;
      if (!access || ["BlockPublicAcls", "IgnorePublicAcls", "BlockPublicPolicy", "RestrictPublicBuckets"].some((key) => access[key] !== true)) throw new Error("static bucket public-access block is incomplete");
      const ownership = awsJson(["s3api", "get-bucket-ownership-controls", "--bucket", bucket, "--expected-bucket-owner", accountId, ...base], "static bucket ownership controls");
      if (JSON.stringify(ownership.OwnershipControls?.Rules) !== JSON.stringify([{ ObjectOwnership: "BucketOwnerEnforced" }])) throw new Error("static bucket ownership controls are invalid");
      const encryption = awsJson(["s3api", "get-bucket-encryption", "--bucket", bucket, "--expected-bucket-owner", accountId, ...base], "static bucket encryption");
      const algorithms = encryption.ServerSideEncryptionConfiguration?.Rules?.map((rule) => rule.ApplyServerSideEncryptionByDefault?.SSEAlgorithm);
      if (JSON.stringify(algorithms) !== JSON.stringify(["AES256"])) throw new Error("static bucket must use only SSE-S3 encryption");
      const tags = Object.fromEntries((awsJson(["s3api", "get-bucket-tagging", "--bucket", bucket, "--expected-bucket-owner", accountId, ...base], "static bucket tags").TagSet ?? []).map(({ Key, Value }) => [Key, Value]));
      if (tags.Project !== "eacl-demo" || tags.Component !== "static") throw new Error("static bucket identity tags are invalid");
      const distribution = awsJson(["cloudfront", "get-distribution", "--id", distributionId, "--no-cli-pager"], "static CloudFront distribution").Distribution;
      const domains = new Set([distribution?.DomainName, ...(distribution?.DistributionConfig?.Aliases?.Items ?? [])]);
      if (distribution?.Id !== distributionId || distribution.Status !== "Deployed" || !domains.has(trustedOrigin.hostname) || distribution.DistributionConfig?.Enabled !== true) throw new Error("static CloudFront distribution identity is invalid");
      const staticOrigin = distribution.DistributionConfig?.Origins?.Items?.find(({ DomainName }) => DomainName === `${bucket}.s3.${region}.amazonaws.com`);
      if (!staticOrigin?.Id || typeof staticOrigin.OriginAccessControlId !== "string" || staticOrigin.OriginAccessControlId.length < 1 || distribution.DistributionConfig?.DefaultCacheBehavior?.TargetOriginId !== staticOrigin.Id || distribution.DistributionConfig?.DefaultCacheBehavior?.ViewerProtocolPolicy !== "redirect-to-https") throw new Error("static CloudFront origin is not the exact private bucket origin");
    },

    async currentVersion(key) {
      return head(key).VersionId;
    },

    async putImmutable(item) {
      const result = awsResult(putArgs(item, { ifNoneMatch: true }), "append-only static object");
      if (result.ok) {
        const output = parseJson(result.stdout, "append-only static object");
        validatePutOutput(output);
      }
      const current = head(item.key);
      validateHead(current, item);
      return current.VersionId;
    },

    async putVersioned(item) {
      const output = awsJson(putArgs(item), `versioned static object ${item.key}`);
      validatePutOutput(output);
      const current = head(item.key);
      validateHead(current, item);
      if (current.VersionId !== output.VersionId) throw new Error(`static object version changed during publication: ${item.key}`);
      return output.VersionId;
    },

    async putStatus(status) {
      const bytes = Buffer.from(`${JSON.stringify(status, null, 2)}\n`);
      const temporary = await mkdtemp(path.join(os.tmpdir(), "eacl-static-status-"));
      const source = path.join(temporary, "static.json");
      try {
        await writeFile(source, bytes, { mode: 0o600, flag: "wx" });
        return await adapter.putVersioned({
          key: "registry/static.json",
          source,
          bytes: bytes.length,
          sha256: sha256(bytes),
          cacheClass: "no-cache",
          cacheControl: "no-cache,max-age=0,must-revalidate",
          publicationMode: "versioned-replace",
          contentType: "application/json; charset=utf-8"
        });
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
    },

    async restoreVersion(key, versionId) {
      if (!VERSION.test(versionId)) throw new Error("static rollback version is invalid");
      const source = head(key, versionId);
      const copySource = `${bucket}/${key.split("/").map(encodeURIComponent).join("/")}?versionId=${encodeURIComponent(versionId)}`;
      const output = awsJson([
        "s3api", "copy-object", "--bucket", bucket, "--key", key,
        "--copy-source", copySource, "--copy-source-if-match", source.ETag,
        "--metadata-directive", "COPY", "--tagging-directive", "COPY",
        "--server-side-encryption", "AES256", "--expected-bucket-owner", accountId, ...base
      ], `static rollback copy ${key}`);
      validatePutOutput(output);
      const current = head(key);
      compareHead(current, source, key);
      restored.set(key, current);
      return current.VersionId;
    },

    async invalidate(paths) {
      if (!Array.isArray(paths) || paths.length < 1 || paths.length > 1000 || paths.some((value) => !/^\/[A-Za-z0-9._/-]+$/u.test(value))) throw new Error("static invalidation path set is invalid");
      const unique = [...new Set(paths)].sort();
      const output = awsJson(["cloudfront", "create-invalidation", "--distribution-id", distributionId, "--paths", ...unique, "--no-cli-pager"], "static CloudFront invalidation");
      const invalidationId = output.Invalidation?.Id;
      if (!/^I[A-Z0-9]{6,32}$/u.test(invalidationId ?? "")) throw new Error("static CloudFront invalidation identity is invalid");
      awsJson(["cloudfront", "wait", "invalidation-completed", "--distribution-id", distributionId, "--id", invalidationId, "--no-cli-pager"], "static CloudFront invalidation wait", { allowEmpty: true });
    },

    async verifyStatus(status) {
      const response = await fetchImpl(new URL("/registry/static.json", trustedOrigin), { method: "GET", redirect: "error", cache: "no-store", credentials: "omit" });
      if (!response?.ok || response.status !== 200 || response.redirected === true) throw new Error("static deployment status smoke failed");
      if ((response.headers?.get?.("content-type") ?? "").toLowerCase() !== "application/json; charset=utf-8" || (response.headers?.get?.("cache-control") ?? "").toLowerCase() !== "no-cache,max-age=0,must-revalidate") throw new Error("static deployment status headers are invalid");
      const declared = response.headers?.get?.("content-length");
      if (declared !== null && declared !== undefined && declared !== "" && (!/^[0-9]{1,5}$/u.test(declared) || Number(declared) > 65_536)) throw new Error("static deployment status exceeded its byte bound");
      const bytes = await readBoundedBytes(response, 65_536);
      if (JSON.stringify(JSON.parse(bytes.toString("utf8"))) !== JSON.stringify(status)) throw new Error("static deployment status identity mismatch");
    },

    async verifyRollback(priorVersions) {
      for (const key of Object.keys(priorVersions)) {
        const expected = restored.get(key);
        if (expected) compareHead(head(key), expected, key);
      }
    }
  };
  return Object.freeze(adapter);

  function head(key, versionId = null) {
    if (!/^[A-Za-z0-9._/-]+$/u.test(key) || key.startsWith("/") || key.split("/").includes("..")) throw new Error("static object key is invalid");
    const args = ["s3api", "head-object", "--bucket", bucket, "--key", key, "--checksum-mode", "ENABLED", "--expected-bucket-owner", accountId];
    if (versionId !== null) args.push("--version-id", versionId);
    return awsJson([...args, ...base], `static object head ${key}`);
  }

  function putArgs(item, { ifNoneMatch = false } = {}) {
    validateItem(item);
    const args = [
      "s3api", "put-object", "--bucket", bucket, "--key", item.key, "--body", item.source,
      "--content-type", item.contentType, "--cache-control", item.cacheControl,
      "--metadata", `eacl-demo-sha256=${item.sha256},eacl-demo-artifact-sha256=${artifactSha256}`,
      "--checksum-algorithm", "SHA256", "--checksum-sha256", Buffer.from(item.sha256, "hex").toString("base64"),
      "--server-side-encryption", "AES256", "--expected-bucket-owner", accountId
    ];
    if (ifNoneMatch) args.push("--if-none-match", "*");
    return [...args, ...base];
  }

  function awsResult(args, label) {
    if (!Array.isArray(args) || args.some((value) => typeof value !== "string" || value.includes("\0"))) throw new Error("AWS argument closure is invalid");
    const result = runAws(args);
    if (!result || typeof result.ok !== "boolean" || typeof result.stdout !== "string") throw new Error(`${label} runner returned an invalid result`);
    return result;
  }

  function awsJson(args, label, { allowEmpty = false } = {}) {
    const result = awsResult(args, label);
    if (!result.ok) throw new Error(`${label} failed`);
    if (allowEmpty && result.stdout.trim() === "") return {};
    return parseJson(result.stdout, label);
  }
}

function defaultRunAws(args) {
  const result = spawnSync("aws", args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  return { ok: result.status === 0 && result.signal === null, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function parseJson(source, label) {
  try {
    return JSON.parse(source);
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}

function validateItem(item) {
  if (!item || !/^[A-Za-z0-9._/-]+$/u.test(item.key) || item.key.startsWith("/") || item.key.split("/").includes("..") || typeof item.source !== "string" || !Number.isSafeInteger(item.bytes) || item.bytes < 1 || !/^[0-9a-f]{64}$/u.test(item.sha256) || typeof item.contentType !== "string" || typeof item.cacheControl !== "string") throw new Error("static publication item is invalid");
}

function validatePutOutput(output) {
  if (!VERSION.test(output?.VersionId ?? "") || output.ServerSideEncryption !== "AES256") throw new Error("static S3 write did not return a versioned SSE-S3 object");
}

function validateHead(head, item) {
  if (!VERSION.test(head?.VersionId ?? "") || head.ContentLength !== item.bytes || head.Metadata?.["eacl-demo-sha256"] !== item.sha256 || head.Metadata?.["eacl-demo-artifact-sha256"] === undefined || head.ServerSideEncryption !== "AES256" || head.ContentType?.toLowerCase() !== item.contentType.toLowerCase() || head.CacheControl?.toLowerCase() !== item.cacheControl.toLowerCase() || head.ChecksumSHA256 !== Buffer.from(item.sha256, "hex").toString("base64")) throw new Error(`static S3 object identity mismatch: ${item.key}`);
}

function compareHead(current, source, key) {
  for (const field of ["ContentLength", "ChecksumSHA256", "ContentType", "CacheControl", "ETag", "ServerSideEncryption"]) if (current?.[field] !== source?.[field]) throw new Error(`static rollback object differs from its exact prior version: ${key}`);
  if (JSON.stringify(current.Metadata ?? {}) !== JSON.stringify(source.Metadata ?? {})) throw new Error(`static rollback metadata differs from its exact prior version: ${key}`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
