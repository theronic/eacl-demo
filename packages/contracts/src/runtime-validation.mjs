import * as generatedValidators from "./generated/runtime-validators.mjs";

const validatorIds = Object.freeze({
  client: "https://demo.eacl.dev/schemas/explorer-client-request.v1.schema.json",
  server: "https://demo.eacl.dev/schemas/explorer-response.v1.schema.json",
  fixture: "https://demo.eacl.dev/schemas/fixture-manifest-boundary.v1.schema.json",
  descriptor: "https://demo.eacl.dev/schemas/explorer-descriptor.v1.schema.json",
  registry: "https://demo.eacl.dev/schemas/profile-registry.v1.schema.json",
  profilePublication: "https://demo.eacl.dev/schemas/profile-publication.v1.schema.json",
  benchmarkIndex: "https://demo.eacl.dev/schemas/benchmark-evidence-index.v1.schema.json",
  fastestEvidence: "https://demo.eacl.dev/schemas/fastest-storage-evidence.v1.schema.json",
  release: "https://demo.eacl.dev/schemas/release-manifest.v1.schema.json"
});

const validatorsById = new Map(Object.entries(validatorIds).map(([name, id]) => [id, generatedValidators[name]]));

export function createRuntimeValidators(schemas) {
  assertSchemasAvailable(schemas, Object.values(validatorIds));
  return Object.freeze(Object.fromEntries(Object.entries(validatorIds).map(([name, id]) => [name, checkedValidator(validatorsById.get(id), name)])));
}

export function createRuntimeBoundaryValidator(schemas, id, boundary) {
  if (typeof id !== "string" || typeof boundary !== "string") throw new TypeError("schema id and boundary are required");
  assertSchemasAvailable(schemas, [id]);
  const validate = validatorsById.get(id);
  if (typeof validate !== "function") throw new RangeError(`no precompiled runtime validator for schema id: ${id}`);
  return checkedValidator(validate, boundary);
}

function assertSchemasAvailable(schemas, requiredIds) {
  if (schemas === null || typeof schemas !== "object" || Array.isArray(schemas)) throw new TypeError("schemas must be an object");
  const available = new Set(Object.values(schemas).map((schema) => schema?.$id).filter((id) => typeof id === "string"));
  for (const id of requiredIds) {
    if (!available.has(id)) throw new RangeError(`required runtime schema is unavailable: ${id}`);
  }
}

function checkedValidator(validate, name) {
  return (value) => {
    if (validate(value)) return value;
    const errors = (validate.errors ?? []).slice(0, 16).map(({ instancePath, schemaPath, keyword }) => ({ instancePath, schemaPath, keyword }));
    const error = new Error(`${name} boundary validation failed`);
    error.code = "validation-error";
    error.boundary = name;
    error.validationErrors = errors;
    throw error;
  };
}
