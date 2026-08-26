import { parseCanonicalUrl, serializeCanonicalUrl } from "./url-state.mjs";

export function createUrlStateController({ catalog, history, location, eventTarget, onState = () => {} }) {
  let current;

  const applyLocation = () => {
    const parsed = parseCanonicalUrl(location.search, catalog);
    current = parsed.state;
    if (location.search !== parsed.canonicalSearch) history.replaceState(null, "", target(parsed.canonicalSearch));
    onState(structuredClone(current), parsed.issues);
    return parsed;
  };

  const onPopState = () => applyLocation();
  eventTarget.addEventListener("popstate", onPopState);
  const initial = applyLocation();

  return {
    initial,
    navigate(nextState, { replace = false } = {}) {
      const search = serializeCanonicalUrl(nextState, catalog);
      const method = replace ? "replaceState" : "pushState";
      history[method](null, "", target(search));
      current = parseCanonicalUrl(search, catalog).state;
      onState(structuredClone(current), []);
      return structuredClone(current);
    },
    getState: () => structuredClone(current),
    close() { eventTarget.removeEventListener("popstate", onPopState); }
  };

  function target(search) {
    return `${location.pathname}${search}${location.hash ?? ""}`;
  }
}
