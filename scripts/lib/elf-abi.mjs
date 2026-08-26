export function parseGlibcVersions(symbolTable) {
  if (typeof symbolTable !== "string") throw new TypeError("ELF symbol table must be text");
  return [...new Set([...symbolTable.matchAll(/\bGLIBC_(\d+)\.(\d+)\b/gu)]
    .map(([, major, minor]) => `${Number(major)}.${Number(minor)}`))]
    .sort(compareVersions);
}

export function parseNeededLibraries(dynamicTable) {
  if (typeof dynamicTable !== "string") throw new TypeError("ELF dynamic table must be text");
  return [...new Set([...dynamicTable.matchAll(/\bNEEDED\s+(?:\[)?([^\]\s]+)(?:\])?/gu)]
    .map(([, library]) => library))].sort();
}

export function parseRuntimePaths(dynamicTable) {
  if (typeof dynamicTable !== "string") throw new TypeError("ELF dynamic table must be text");
  const paths = [];
  for (const line of dynamicTable.split("\n")) {
    const match = /\b(?:RPATH|RUNPATH)\b\)?(?:\s+Library\s+(?:rpath|runpath):)?\s+(?:\[([^\]]+)\]|(\S+))\s*$/iu.exec(line);
    if (match) paths.push(match[1] ?? match[2]);
  }
  return [...new Set(paths)].sort();
}

export function maximumVersion(versions) {
  if (!Array.isArray(versions) || versions.length === 0) {
    throw new TypeError("at least one ABI version is required");
  }
  for (const version of versions) parseVersion(version);
  return [...versions].sort(compareVersions).at(-1);
}

export function atMost(actual, maximum) {
  parseVersion(actual);
  parseVersion(maximum);
  return compareVersions(actual, maximum) <= 0;
}

function compareVersions(left, right) {
  const [leftMajor, leftMinor] = parseVersion(left);
  const [rightMajor, rightMinor] = parseVersion(right);
  return leftMajor - rightMajor || leftMinor - rightMinor;
}

function parseVersion(value) {
  if (typeof value !== "string" || !/^\d+\.\d+$/u.test(value)) {
    throw new TypeError(`invalid ABI version: ${String(value)}`);
  }
  return value.split(".").map(Number);
}
