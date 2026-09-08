import plan from "../../infra/data/storage-v8-migration.json" with { type: "json" };

export function storageV8Environment(profileId) {
  const profile = plan.profiles[profileId];
  if (!profile) return {};
  if (profileId === "datahike-s3") {
    return { EACL_DATAHIKE_BUCKET: profile.target, EACL_DATAHIKE_STORE_ID: profile.storeId };
  }
  if (profileId === "datahike-dynamodb") {
    return { EACL_DATAHIKE_TABLE: profile.target, EACL_DATAHIKE_STORE_ID: profile.storeId };
  }
  return { EACL_DATOMIC_TABLE: profile.target, EACL_DATOMIC_DATABASE: profile.database };
}
