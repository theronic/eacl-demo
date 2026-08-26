import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

export function createRuntimeValidators(schemas) {
  const ajv = createAjv(schemas);
  const ids = {
    client: "https://demo.eacl.dev/schemas/explorer-client-request.v1.schema.json",
    server: "https://demo.eacl.dev/schemas/explorer-response.v1.schema.json",
    worker: "https://demo.eacl.dev/schemas/explorer-worker-message.v1.schema.json",
    workerEvent: "https://demo.eacl.dev/schemas/explorer-worker-event.v1.schema.json",
    fixture: "https://demo.eacl.dev/schemas/fixture-manifest-boundary.v1.schema.json",
    descriptor: "https://demo.eacl.dev/schemas/explorer-descriptor.v1.schema.json",
    registry: "https://demo.eacl.dev/schemas/profile-registry.v1.schema.json",
    profilePublication: "https://demo.eacl.dev/schemas/profile-publication.v1.schema.json",
    benchmarkIndex: "https://demo.eacl.dev/schemas/benchmark-evidence-index.v1.schema.json",
    fastestEvidence: "https://demo.eacl.dev/schemas/fastest-storage-evidence.v1.schema.json",
    release: "https://demo.eacl.dev/schemas/release-manifest.v1.schema.json"
  };
  return Object.freeze(Object.fromEntries(Object.entries(ids).map(([name, id]) => [name, checkedValidator(ajv.getSchema(id) ?? ajv.compile({ $ref: id }), name)])));
}

export function createRuntimeBoundaryValidator(schemas, id, boundary) {
  if (typeof id !== "string" || typeof boundary !== "string") throw new TypeError("schema id and boundary are required");
  const ajv = createAjv(schemas);
  return checkedValidator(ajv.getSchema(id) ?? ajv.compile({ $ref: id }), boundary);
}

function createAjv(schemas) {
  const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: true, allowUnionTypes: true });
  addFormats(ajv);
  for (const schema of Object.values(schemas)) ajv.addSchema(schema);
  return ajv;
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
