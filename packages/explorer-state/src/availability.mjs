const STATES = new Set(["enabled", "disabled", "qualifying", "unavailable"]);

export function availabilityByProfile(profileDefinitions, availability) {
  const definitions = new Map(profileDefinitions.profiles.map((profile) => [profile.id, profile]));
  const result = new Map();
  for (const entry of availability.profiles) {
    if (!definitions.has(entry.id)) throw new Error(`availability names unknown profile: ${entry.id}`);
    if (!STATES.has(entry.state)) throw new Error(`unknown profile state: ${entry.state}`);
    if (entry.state === "enabled" && entry.reason !== null) throw new Error(`enabled profile ${entry.id} must not have a reason`);
    if (entry.state !== "enabled" && (typeof entry.reason !== "string" || entry.reason.trim().length === 0)) {
      throw new Error(`non-selectable profile ${entry.id} requires a reason`);
    }
    result.set(entry.id, { ...definitions.get(entry.id), ...entry, selectable: entry.state === "enabled" });
  }
  if (result.size !== definitions.size) throw new Error("every profile requires an availability entry");
  return result;
}

export function choicesForBackend(catalog, profileDefinitions, availability, backendId) {
  const profiles = availabilityByProfile(profileDefinitions, availability);
  const storageLabels = new Map(catalog.storages.map((storage) => [storage.id, storage.label]));
  return profileDefinitions.profiles
    .filter((profile) => profile.backend === backendId)
    .map((profile) => ({ ...profiles.get(profile.id), label: storageLabels.get(profile.storage) }));
}

export function selectableProfile(profile) {
  if (!profile?.selectable) throw new Error(profile?.reason ?? "profile is not selectable");
  return profile;
}
