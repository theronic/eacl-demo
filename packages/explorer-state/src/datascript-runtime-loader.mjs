// Only the selected DataScript transport calls this loader. Metadata is inert:
// browsers must not preload the runtime or its embedded fixture for server visits.
export function createDataScriptRuntimeLoader({ documentImpl = globalThis.document, globalImpl = globalThis, timeoutMs = 30_000 } = {}) {
  const loads = new Map();
  return function loadRuntime() {
    const path = documentImpl.querySelector('meta[name="eacl-datascript-runtime"]')?.content;
    if (!/^\/datascript\/assets\/datascript-runtime-[a-f0-9]{64}\.js$/u.test(path ?? "")) {
      return Promise.reject(new Error("The DataScript runtime asset is unavailable. Build or refresh the demo site."));
    }
    if (loads.has(path)) return loads.get(path);
    const script = documentImpl.createElement("script");
    script.src = path;
    script.async = true;
    const promise = new Promise((resolve, reject) => {
      const finish = (error) => {
        clearTimeout(timer);
        script.onload = script.onerror = null;
        if (error) {
          script.remove();
          reject(error);
        } else resolve(globalImpl.EaclDataScriptRuntime);
      };
      const timer = setTimeout(() => finish(new Error("Loading DataScript timed out. Please retry.")), timeoutMs);
      script.onload = () => {
        const runtime = globalImpl.EaclDataScriptRuntime;
        finish(runtime && ["initialize", "request", "release"].every((key) => typeof runtime[key] === "function")
          ? null : new Error("The DataScript runtime did not initialize its browser interface."));
      };
      script.onerror = () => finish(new Error("DataScript could not be downloaded. Please retry."));
      documentImpl.head.append(script);
    }).catch((error) => {
      loads.delete(path);
      throw error;
    });
    loads.set(path, promise);
    return promise;
  };
}

let defaultLoader;
export function loadDataScriptRuntime() {
  defaultLoader ??= createDataScriptRuntimeLoader();
  return defaultLoader();
}
