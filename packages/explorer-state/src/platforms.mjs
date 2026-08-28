const DEFAULT_LAMBDA = "lambda-1024";
const LARGE_LAMBDA = "lambda-4096";
const DATOMIC_PLATFORMS = new Set([DEFAULT_LAMBDA, LARGE_LAMBDA, "ec2"]);
const DATAHIKE_PLATFORMS = new Set([DEFAULT_LAMBDA, LARGE_LAMBDA]);
const DATALEVIN_PLATFORMS = new Set([DEFAULT_LAMBDA, "ec2"]);
const BROWSER_PLATFORM = "browser";
const DATOMIC_ORIGINS = Object.freeze({
  [LARGE_LAMBDA]: "https://7um6u6hb6wq6yfl46ukjkxcpuy0gexer.lambda-url.us-east-1.on.aws",
  ec2: "https://datomic.demo.eacl.dev"
});
const DATALEVIN_ORIGINS = Object.freeze({
  ec2: "https://datalevin.demo.eacl.dev"
});
const DATAHIKE_ORIGINS = Object.freeze({
  "datahike-s3": Object.freeze({
    [LARGE_LAMBDA]: "https://y66owmoqebrcmzyfw6uturkaue0exoqe.lambda-url.us-east-1.on.aws"
  }),
  "datahike-dynamodb": Object.freeze({
    [LARGE_LAMBDA]: "https://ammics5svacgyu5eopgicnzz3y0lsryk.lambda-url.us-east-1.on.aws"
  })
});
const SERVER_OPTIONS = Object.freeze([
  Object.freeze({ id: DEFAULT_LAMBDA, label: "1 GiB Lambda" }),
  Object.freeze({ id: LARGE_LAMBDA, label: "4 GiB Lambda" }),
  Object.freeze({ id: "ec2", label: "EC2 t3.micro (1 GiB)" })
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
  const datahike = selection?.backend === "datahike";
  const datalevin = isDatalevinEmbedded(selection);
  return SERVER_OPTIONS.map((option) => ({
    ...option,
    selectable: option.id === DEFAULT_LAMBDA || datomic ||
      (datahike && option.id === LARGE_LAMBDA) || (datalevin && option.id === "ec2"),
    reason: option.id === DEFAULT_LAMBDA || datomic ||
      (datahike && option.id === LARGE_LAMBDA) || (datalevin && option.id === "ec2")
      ? null
      : option.id === "ec2"
        ? "EC2 is currently deployed only for Datomic/DynamoDB and Datalevin/Embedded disk."
        : "This platform is not deployed for this backend."
  }));
}

export function profileForPlatform(profile, platform) {
  const selected = normalizePlatform(profile, platform);
  if (!supportedPlatform(profile, selected)) throw new Error("profile platform is not supported");
  if (selected === BROWSER_PLATFORM || ("state" in profile && profile.state !== "enabled")) return { ...profile };
  const apiOrigin = selected === DEFAULT_LAMBDA
    ? profile.apiOrigin
    : isDatomicDynamo(profile)
      ? DATOMIC_ORIGINS[selected]
      : isDatalevinEmbedded(profile)
        ? DATALEVIN_ORIGINS[selected]
      : DATAHIKE_ORIGINS[profile.id]?.[selected];
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
  if (selection?.backend === "datahike") return DATAHIKE_PLATFORMS.has(platform);
  if (isDatalevinEmbedded(selection)) return DATALEVIN_PLATFORMS.has(platform);
  return platform === DEFAULT_LAMBDA;
}

function isDatomicDynamo(selection) {
  return selection?.backend === "datomic" && selection?.storage === "dynamodb";
}

function isDatalevinEmbedded(selection) {
  return selection?.backend === "datalevin" && selection?.storage === "embedded";
}
