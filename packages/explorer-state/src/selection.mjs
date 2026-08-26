export function initialSelection(catalog, parameters) {
  const defaultBackend = findBackend(catalog, catalog.defaultBackend);
  if (!defaultBackend) throw new Error("catalog defaultBackend is not declared");

  const requestedBackend = parameters.get("backend");
  const backend = findBackend(catalog, requestedBackend) ?? defaultBackend;
  const requestedStorage = parameters.get("storage");
  const storage = backend.storages.includes(requestedStorage) ? requestedStorage : backend.storages[0];
  if (!storage) throw new Error(`backend ${backend.id} has no storage choices`);
  return { backend: backend.id, storage };
}

export function selectBackend(catalog, current, backendId, defaultStorage = null) {
  const backend = findBackend(catalog, backendId);
  if (!backend) return current;
  return {
    backend: backend.id,
    storage: backend.storages.includes(defaultStorage)
      ? defaultStorage
      : backend.storages.includes(current.storage) ? current.storage : backend.storages[0]
  };
}

export function storageOptions(catalog, backendId) {
  const backend = findBackend(catalog, backendId);
  if (!backend) return [];
  const labels = new Map(catalog.storages.map((storage) => [storage.id, storage]));
  return backend.storages.map((id) => labels.get(id)).filter(Boolean);
}

function findBackend(catalog, id) {
  return catalog.backends.find((backend) => backend.id === id);
}
