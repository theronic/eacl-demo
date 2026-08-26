import assert from "node:assert/strict";
import test from "node:test";

import {
  atMost,
  maximumVersion,
  parseGlibcVersions,
  parseNeededLibraries,
  parseRuntimePaths
} from "./lib/elf-abi.mjs";

test("ELF ABI parsing is deterministic and rejects a glibc 2.38 AL2023 candidate", () => {
  const versions = parseGlibcVersions(`
    0000 DF *UND* 0000 (GLIBC_2.17) memcpy
    0000 DF *UND* 0000 GLIBC_2.38 strlcpy
    0000 DF *UND* 0000 GLIBC_2.34 dlopen
    0000 DF *UND* 0000 GLIBC_2.38 strlcpy
  `);
  assert.deepEqual(versions, ["2.17", "2.34", "2.38"]);
  assert.equal(maximumVersion(versions), "2.38");
  assert.equal(atMost("2.38", "2.34"), false);
  assert.equal(atMost("2.34", "2.34"), true);
});

test("ELF dependency parsing accepts bracketed and plain objdump output", () => {
  assert.deepEqual(parseNeededLibraries(`
    NEEDED              libm.so.6
    NEEDED              [libc.so.6]
    NEEDED              libm.so.6
  `), ["libc.so.6", "libm.so.6"]);
});

test("ELF runtime-path parsing accepts objdump and bracketed readelf output", () => {
  assert.deepEqual(parseRuntimePaths(`
    RUNPATH              $ORIGIN
    0x000000000000001d (RUNPATH) Library runpath: [$ORIGIN]
    RPATH                /opt/build
  `), ["$ORIGIN", "/opt/build"]);
});

test("empty or malformed ABI evidence fails closed", () => {
  assert.throws(() => maximumVersion([]), /at least one/u);
  assert.throws(() => atMost("2", "2.34"), /invalid ABI version/u);
  assert.throws(() => parseGlibcVersions(null), /must be text/u);
  assert.throws(() => parseRuntimePaths(null), /must be text/u);
});
