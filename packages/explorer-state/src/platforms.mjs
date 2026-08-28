const DEFAULT_LAMBDA = "lambda-1024";
const DATOMIC_PLATFORMS = new Set([DEFAULT_LAMBDA, "lambda-4096", "ec2"]);
const BROWSER_PLATFORM = "browser";
const DATOMIC_ORIGINS = Object.freeze({
  "lambda-4096": "https://7um6u6hb6wq6yfl46ukjkxcpuy0gexer.lambda-url.us-east-1.on.aws",
  ec2: "https://datomic.demo.eacl.dev"
});
const SERVER_OPTIONS = Object.freeze([
  Object.freeze({ id: DEFAULT_LAMBDA, label: "1 GiB Lambda" }),
  Object.freeze({ id: "lambda-4096", label: "4 GiB Lambda" }),
  Object.freeze({ id: "ec2", label: "EC2" })
]);

export function defaultPlatform(selection) {
  return selection?.backend === "datascript" ? BROWSER_PLATFORM : DEFAULT_LAMBDA;
}

export function normalizePlatform(selection, requested) {
  return supportedPlatform(selection, requested)
    ? requested
    : defaultPlatform(selection);
}

export function platformOptions(selection) {
  if (selection?.backend === "datascript") {
    return [{ id: BROWSER_PLATFORM, label: "Browser", selectable: true, reason: null }];
  }
  const datomic = isDatomicDynamo(selection);
  return SERVER_OPTIONS.map((option) => ({
    ...option,
    selectable: option.id === DEFAULT_LAMBDA || datomic,
    reason: option.id === DEFAULT_LAMBDA || datomic
      ? null
      : "This platform is currently deployed only for Datomic with DynamoDB."
  }));
}

export function profileForPlatform(profile, platform) {
  const selected = normalizePlatform(profile, platform);
  if (!supportedPlatform(profile, selected)) throw new Error("profile platform is not supported");
  if (selected === BROWSER_PLATFORM || ("state" in profile && profile.state !== "enabled")) return { ...profile };
  const apiOrigin = selected === DEFAULT_LAMBDA
    ? profile.apiOrigin
    : DATOMIC_ORIGINS[selected];
  if (typeof apiOrigin !== "string" || apiOrigin.length === 0) {
    throw new Error("profile platform has no deployed API origin");
  }
  return { ...profile, apiOrigin };
}

export function executionForPlatform(platform) {
  if (platform === "ec2") return "ec2";
  if (platform === BROWSER_PLATFORM) return "browser";
  return "lambda";
}

function supportedPlatform(selection, platform) {
  if (selection?.backend === "datascript") return platform === BROWSER_PLATFORM;
  if (isDatomicDynamo(selection)) return DATOMIC_PLATFORMS.has(platform);
  return platform === DEFAULT_LAMBDA;
}

function isDatomicDynamo(selection) {
  return selection?.backend === "datomic" && selection?.storage === "dynamodb";
}
