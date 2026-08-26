export const ordinaryTargetOrder = Object.freeze([
  "static",
  "datahike-s3",
  "datahike-dynamodb",
  "datomic-dynamodb",
  "datalevin-memory"
]);

export const ordinaryTargetDefinitions = Object.freeze({
  static: target({
    units: ["explorer-main", "datascript-entry", "datascript-worker", "fixtures"],
    environment: "demo-production-static",
    authorityId: "deploy-static",
    roleVariable: "AWS_STATIC_DEPLOY_ROLE_ARN",
    deployVariables: {
      AWS_ACCOUNT_ID: "AWS_ACCOUNT_ID",
      AWS_REGION: "AWS_REGION",
      STATIC_BUCKET: "STATIC_BUCKET",
      CLOUDFRONT_DISTRIBUTION_ID: "CLOUDFRONT_DISTRIBUTION_ID",
      PRODUCTION_CLOUDFRONT_ORIGIN: "PRODUCTION_CLOUDFRONT_ORIGIN"
    },
    payloadPath: "dist/static-site",
    deploymentImplemented: true,
    buildKind: "static",
    buildCommands: [
      "npm install --global npm@11.17.0",
      "npm ci",
      "npm run build:static-site",
      "node scripts/audit-datascript-bundle-isolation.mjs",
      "node scripts/audit-static-routing.mjs",
      "node scripts/scan-secrets.mjs"
    ]
  }),
  "datahike-s3": target({
    units: ["datahike-s3"],
    environment: "demo-production-datahike-s3",
    authorityId: "deploy-datahike-s3",
    roleVariable: "AWS_DATAHIKE_S3_DEPLOY_ROLE_ARN",
    deployVariables: serverDeployVariables("DATAHIKE_S3_FUNCTION_NAME"),
    payloadPath: "dist/datahike-s3/function.jar",
    deploymentImplemented: true,
    buildKind: "jvm",
    buildCommands: ["clojure -T:build datahike-s3-lambda", "node scripts/audit-datahike-s3-lambda-artifact.mjs", "node scripts/scan-secrets.mjs"]
  }),
  "datahike-dynamodb": target({
    units: ["datahike-dynamodb"],
    environment: "demo-production-datahike-dynamodb",
    authorityId: "deploy-datahike-dynamodb",
    roleVariable: "AWS_DATAHIKE_DYNAMODB_DEPLOY_ROLE_ARN",
    deployVariables: serverDeployVariables("DATAHIKE_DYNAMODB_FUNCTION_NAME"),
    payloadPath: "dist/datahike-dynamodb/function.jar",
    deploymentImplemented: true,
    buildKind: "jvm",
    buildCommands: ["clojure -T:build datahike-dynamodb-lambda", "node scripts/audit-datahike-dynamodb-lambda-artifact.mjs", "node scripts/scan-secrets.mjs"]
  }),
  "datomic-dynamodb": target({
    units: ["datomic-dynamodb"],
    environment: "demo-production-datomic-dynamodb",
    authorityId: "deploy-datomic-dynamodb",
    roleVariable: "AWS_DATOMIC_DYNAMODB_DEPLOY_ROLE_ARN",
    deployVariables: serverDeployVariables("DATOMIC_DYNAMODB_FUNCTION_NAME"),
    payloadPath: "dist/datomic-dynamodb/function.jar",
    deploymentImplemented: true,
    buildKind: "jvm",
    buildCommands: ["clojure -T:build datomic-lambda", "node scripts/audit-datomic-lambda-artifact.mjs", "node scripts/scan-secrets.mjs"]
  }),
  "datalevin-memory": target({
    units: ["datalevin-memory"],
    environment: "demo-production-datalevin-memory",
    authorityId: "deploy-datalevin-memory",
    roleVariable: "AWS_DATALEVIN_MEMORY_DEPLOY_ROLE_ARN",
    deployVariables: serverDeployVariables("DATALEVIN_MEMORY_FUNCTION_NAME"),
    payloadPath: "dist/datalevin-memory/function.jar",
    deploymentImplemented: false,
    buildKind: "jvm",
    buildCommands: []
  })
});

const pins = Object.freeze({
  checkout: "11d5960a326750d5838078e36cf38b85af677262",
  setupNode: "49933ea5288caeca8642d1e84afbd3f7d6820020",
  setupJava: "b6effb05e454b25005698d916606bdc6ffcbf961",
  setupClojure: "3fe9b3ae632c6758d0b7757b0838606ef4287b08",
  uploadArtifact: "ea165f8d65b6e75b540449e92b4886f43607fa02",
  downloadArtifact: "d3f86a106a0bac45b974a628896c90dbdf5c8093",
  configureAws: "7474bc4690e29a8392af63c5b98e7449536d5c3a"
});

export function eligibleOrdinaryTargets(buildUnits) {
  if (buildUnits?.schemaVersion !== 1 || !buildUnits.units || typeof buildUnits.units !== "object") throw new Error("build-unit registry is invalid");
  const members = new Map(ordinaryTargetOrder.map((name) => [name, []]));
  for (const [unitName, unit] of Object.entries(buildUnits.units)) {
    if (unit.deploymentTrack === "parked") continue;
    if (unit.deploymentTrack !== "active") throw new Error(`build unit has an invalid deployment track: ${unitName}`);
    if (unit.ordinaryDeploymentTarget === null) continue;
    if (!members.has(unit.ordinaryDeploymentTarget)) throw new Error(`active build unit names an unknown ordinary target: ${unitName}`);
    members.get(unit.ordinaryDeploymentTarget).push(unitName);
  }
  const eligible = [];
  for (const name of ordinaryTargetOrder) {
    const definition = ordinaryTargetDefinitions[name];
    const actual = members.get(name).sort();
    const expected = [...definition.units].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`ordinary target membership drifted: ${name}`);
    if (expected.every((unitName) => buildUnits.units[unitName].deploymentEligible === true)) eligible.push(name);
  }
  return eligible;
}

export function renderOrdinaryWorkflow(buildUnits, { deployEntrypointAvailable = true, implementedTargets = null } = {}) {
  const eligible = eligibleOrdinaryTargets(buildUnits);
  if (eligible.length === 0) return null;
  if (!deployEntrypointAvailable) throw new Error("an eligible ordinary target has no checked-in deployment entrypoint");
  for (const name of eligible) {
    if (ordinaryTargetDefinitions[name].buildCommands.length === 0) throw new Error(`eligible ordinary target has no deployable build: ${name}`);
    const implemented = implementedTargets === null ? ordinaryTargetDefinitions[name].deploymentImplemented : implementedTargets.has(name);
    if (!implemented) throw new Error(`ordinary target deployment transaction is not implemented: ${name}`);
  }
  return [
    "# Generated by scripts/render-demos-workflow.mjs. Do not edit by hand.",
    "name: Deploy EACL demos",
    "",
    "on:",
    "  push:",
    "    branches:",
    "      - demos",
    "",
    "permissions:",
    "  contents: read",
    "",
    "jobs:",
    ...eligible.flatMap((name) => [...renderBuildJob(name), ...renderDeployJob(name)]),
    ""
  ].join("\n");
}

function renderBuildJob(name) {
  const definition = ordinaryTargetDefinitions[name];
  const lines = [
    `  build-${name}:`,
    "    runs-on: ubuntu-24.04",
    "    timeout-minutes: 30",
    "    permissions:",
    "      contents: read",
    "    outputs:",
    "      artifact_name: ${{ steps.package.outputs.artifact_name }}",
    "      artifact_sha256: ${{ steps.package.outputs.artifact_sha256 }}",
    "    steps:",
    `      - uses: actions/checkout@${pins.checkout}`,
    "        with:",
    "          ref: ${{ github.sha }}",
    "          persist-credentials: false",
    `      - uses: actions/setup-node@${pins.setupNode}`,
    "        with:",
    "          node-version-file: .node-version"
  ];
  if (definition.buildKind === "static") lines.push("          cache: npm");
  if (definition.buildKind === "jvm") lines.push(
    `      - uses: actions/setup-java@${pins.setupJava}`,
    "        with:",
    "          distribution: temurin",
    "          java-version: 25.0.4+101",
    `      - uses: DeLaGuardo/setup-clojure@${pins.setupClojure}`,
    "        with:",
    "          cli: 1.12.5.1664"
  );
  for (const command of definition.buildCommands) lines.push("      - run: " + command);
  lines.push(
    "      - id: package",
    `        run: node scripts/package-ordinary-artifact.mjs ${name}`,
    `      - uses: actions/upload-artifact@${pins.uploadArtifact}`,
    "        with:",
    "          name: ${{ steps.package.outputs.artifact_name }}",
    `          path: dist/ordinary-artifacts/${name}`,
    "          if-no-files-found: error",
    "          retention-days: 1",
    "          include-hidden-files: true"
  );
  return lines;
}

function renderDeployJob(name) {
  const definition = ordinaryTargetDefinitions[name];
  return [
    `  deploy-${name}:`,
    `    needs: build-${name}`,
    "    runs-on: ubuntu-24.04",
    "    timeout-minutes: 20",
    `    environment: ${definition.environment}`,
    "    permissions:",
    "      contents: read",
    "      id-token: write",
    ...Object.entries(definition.deployVariables ?? {}).flatMap(([environmentName, variableName], index) => index === 0
      ? ["    env:", `      ${environmentName}: \${{ vars.${variableName} }}`]
      : [`      ${environmentName}: \${{ vars.${variableName} }}`]),
    "    steps:",
    `      - uses: actions/checkout@${pins.checkout}`,
    "        with:",
    "          ref: ${{ github.sha }}",
    "          persist-credentials: false",
    `      - uses: actions/setup-node@${pins.setupNode}`,
    "        with:",
    "          node-version-file: .node-version",
    `      - uses: actions/download-artifact@${pins.downloadArtifact}`,
    "        with:",
    `          name: \${{ needs['build-${name}'].outputs.artifact_name }}`,
    `          path: dist/downloaded/${name}`,
    "      - name: Verify the exact same-target artifact before requesting AWS credentials",
    `        run: node scripts/verify-ordinary-artifact.mjs ${name} dist/downloaded/${name}`,
    "        env:",
    `          EACL_EXPECTED_ARTIFACT_SHA256: \${{ needs['build-${name}'].outputs.artifact_sha256 }}`,
    "      - name: Capture signature-verified allowlisted OIDC claims without retaining the token",
    "        env:",
    `          EACL_OIDC_AUTHORITY_ID: ${definition.authorityId}`,
    "          EACL_OIDC_EXPECTED_SUBJECT_MODE: custom",
    "          EACL_OIDC_CLAIMS_OUTPUT: ${{ runner.temp }}/github-oidc-claims.json",
    "        run: node scripts/capture-github-oidc-claims.mjs",
    `      - uses: actions/upload-artifact@${pins.uploadArtifact}`,
    "        with:",
    `          name: oidc-claims-${definition.authorityId}-\${{ github.run_id }}-\${{ github.run_attempt }}`,
    "          path: ${{ runner.temp }}/github-oidc-claims.json",
    "          if-no-files-found: error",
    "          retention-days: 1",
    `      - uses: aws-actions/configure-aws-credentials@${pins.configureAws}`,
    "        with:",
    `          role-to-assume: \${{ vars.${definition.roleVariable} }}`,
    `          role-session-name: eacl-demo-${name}-\${{ github.run_id }}-\${{ github.run_attempt }}`,
    "          aws-region: ${{ vars.AWS_REGION }}",
    "      - name: Deploy, smoke, and promote only this target",
    `        run: node scripts/deploy-ordinary-target.mjs ${name} dist/downloaded/${name}`,
    "        env:",
    `          EACL_EXPECTED_ARTIFACT_SHA256: \${{ needs['build-${name}'].outputs.artifact_sha256 }}`
  ];
}

function target(value) {
  return Object.freeze({ ...value, units: Object.freeze(value.units), buildCommands: Object.freeze(value.buildCommands), deployVariables: Object.freeze(value.deployVariables ?? {}) });
}

function serverDeployVariables(functionVariable) {
  return {
    AWS_ACCOUNT_ID: "AWS_ACCOUNT_ID",
    AWS_REGION: "AWS_REGION",
    PROFILE_FUNCTION_NAME: functionVariable,
    ARTIFACT_BUCKET: "ARTIFACT_BUCKET",
    STATIC_BUCKET: "STATIC_BUCKET",
    STAGED_CLOUDFRONT_DISTRIBUTION_ID: "STAGED_CLOUDFRONT_DISTRIBUTION_ID",
    PRODUCTION_CLOUDFRONT_DISTRIBUTION_ID: "CLOUDFRONT_DISTRIBUTION_ID",
    STAGED_API_CACHE_POLICY_ID: "STAGED_API_CACHE_POLICY_ID",
    PRODUCTION_API_CACHE_POLICY_ID: "PRODUCTION_API_CACHE_POLICY_ID",
    STAGED_API_ORIGIN_REQUEST_POLICY_ID: "STAGED_API_ORIGIN_REQUEST_POLICY_ID",
    PRODUCTION_API_ORIGIN_REQUEST_POLICY_ID: "PRODUCTION_API_ORIGIN_REQUEST_POLICY_ID",
    STAGED_API_VIEWER_REQUEST_FUNCTION_ARN: "STAGED_API_VIEWER_REQUEST_FUNCTION_ARN",
    PRODUCTION_API_VIEWER_REQUEST_FUNCTION_ARN: "PRODUCTION_API_VIEWER_REQUEST_FUNCTION_ARN",
    STAGED_LAMBDA_ORIGIN_ACCESS_CONTROL_ID: "STAGED_LAMBDA_ORIGIN_ACCESS_CONTROL_ID",
    PRODUCTION_LAMBDA_ORIGIN_ACCESS_CONTROL_ID: "PRODUCTION_LAMBDA_ORIGIN_ACCESS_CONTROL_ID",
    STAGED_SECURITY_HEADERS_POLICY_ID: "STAGED_SECURITY_HEADERS_POLICY_ID",
    PRODUCTION_SECURITY_HEADERS_POLICY_ID: "PRODUCTION_SECURITY_HEADERS_POLICY_ID",
    STAGED_CLOUDFRONT_ORIGIN: "STAGED_CLOUDFRONT_ORIGIN",
    PRODUCTION_CLOUDFRONT_ORIGIN: "PRODUCTION_CLOUDFRONT_ORIGIN"
  };
}
