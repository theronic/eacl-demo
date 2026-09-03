export function stalePublishedVersions(versions, retain = 3) {
  if (!Array.isArray(versions)) throw new TypeError("Lambda versions must be an array");
  if (!Number.isSafeInteger(retain) || retain < 1) {
    throw new TypeError("Lambda retention must be a positive integer");
  }
  const published = versions
    .map(({ Version } = {}) => Version)
    .filter((version) => /^[1-9][0-9]*$/u.test(version))
    .sort((left, right) => Number(right) - Number(left));
  return {
    retained: published.slice(0, retain),
    stale: published.slice(retain)
  };
}
