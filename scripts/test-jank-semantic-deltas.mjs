import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const includeDirectories = [
  path.join(root, "services/jank-memory/native"),
  ...pkgConfigTokens(["--cflags-only-I", "libcurl", "json-c", "openssl"])
    .map((value) => value.replace(/^-I/u, ""))
];
const libraries = process.platform === "darwin"
  ? [
      path.join(exec("xcrun", ["--show-sdk-path"]), "usr/lib/libcurl.tbd"),
      path.join(pkgVariable("json-c", "libdir"), "libjson-c.dylib"),
      path.join(pkgVariable("openssl", "libdir"), "libcrypto.dylib")
    ]
  : [
      path.join(pkgVariable("libcurl", "libdir"), "libcurl.so"),
      path.join(pkgVariable("json-c", "libdir"), "libjson-c.so"),
      path.join(pkgVariable("openssl", "libdir"), "libcrypto.so")
    ];

execFileSync("jank", argumentsFor("cache_controls_test.jank"), {
  cwd: root,
  stdio: "inherit"
});

execFileSync("jank", argumentsFor("handler_cursor_test.jank"), {
  cwd: root,
  stdio: "inherit"
});

execFileSync("jank", argumentsFor("lineage_counters_test.jank"), {
  cwd: root,
  stdio: "inherit"
});

execFileSync("jank", argumentsFor("consistency_lifecycle_test.jank"), {
  cwd: root,
  stdio: "inherit"
});

execFileSync("jank", argumentsFor("basis_cache_binding_test.jank"), {
  cwd: root,
  stdio: "inherit"
});

execFileSync("jank", argumentsFor("pagination_delta_test.jank"), {
  cwd: root,
  stdio: "inherit"
});

execFileSync("jank", argumentsFor("permission_tree_delta_test.jank"), {
  cwd: root,
  stdio: "inherit"
});

expectRejection("plan_scope_rejection_test.jank", [
  /:type :eacl\.plan\/compile-error/u,
  /:reason :relation-outside-dependency-closure/u,
  /:outside-relation-ids \[2\]/u,
  /:dependency-relation-ids \[1\]/u
]);
expectRejection("execution_contract_rejection_test.jank", [
  /:type :eacl\.execution\/invalid-contract/u,
  /:eacl\/error :eacl\.execution\/invalid-contract/u,
  /:reason :invalid-timeout/u
]);
expectRejection("cancellation_contract_rejection_test.jank", [
  /:type :eacl\.execution\/invalid-contract/u,
  /:eacl\/error :eacl\.execution\/invalid-contract/u
]);
expectRejection("permission_tree_request_rejection_test.jank", [
  /:type :eacl\.permission-tree\/invalid-request/u,
  /:eacl\/error :eacl\.permission-tree\/invalid-request/u,
  /:reason :invalid-resource/u
]);
expectRejection("consistency_rejection_test.jank", [
  /:type :eacl\/unsupported-consistency/u,
  /:eacl\/error :eacl\/unsupported-consistency/u,
  /:reason :invalid-consistency-descriptor/u
]);

console.log("Jank locked-Core semantic delta tests passed");

function argumentsFor(testFile) {
  return [
    "run",
    "--module-path", [
      path.join(root, "services/jank-memory/src"),
      path.join(root, "test/jank-modules")
    ].join(path.delimiter),
    ...includeDirectories.flatMap((directory) => ["-I", directory]),
    ...libraries.flatMap((library) => ["-l", library]),
    path.join(root, "test/jank", testFile)
  ];
}

function expectRejection(testFile, patterns) {
  const rejection = spawnSync(
    "jank",
    argumentsFor(testFile),
    { cwd: root, encoding: "utf8" }
  );
  assert.equal(rejection.signal, null, `${testFile} must not crash`);
  assert.equal(rejection.status, 1, `${testFile} must be rejected`);
  const output = `${rejection.stdout ?? ""}\n${rejection.stderr ?? ""}`;
  for (const pattern of patterns) assert.match(output, pattern, testFile);
}

function pkgVariable(pkg, variable) {
  return exec("pkg-config", ["--variable=" + variable, pkg]);
}

function pkgConfigTokens(args) {
  return exec("pkg-config", args).split(/\s+/u).filter(Boolean);
}

function exec(command, args) {
  return execFileSync(command, args, { encoding: "utf8" }).trim();
}
