export function negotiateContract(client, profile) {
  validateIdentity(client, "client");
  validateIdentity(profile, "profile");
  if (client.routeMajor !== profile.routeMajor || client.contract !== profile.contract) return { compatible: false, reason: "route-major-mismatch" };
  if (profile.revision > client.revision) return { compatible: false, reason: "profile-newer-than-client" };
  if (profile.revision < client.revision - 1) return { compatible: false, reason: "profile-outside-n-minus-one-window" };
  return { compatible: true, mode: profile.revision === client.revision ? "N" : "N-1" };
}

export function requireCompatibleEvolution({ from, to, semantics }) {
  validateIdentity(from, "from");
  validateIdentity(to, "to");
  if (!new Set(["additive", "incompatible"]).has(semantics)) throw new Error("change semantics must be additive or incompatible");
  if (semantics === "incompatible" && from.routeMajor === to.routeMajor) throw new Error("incompatible changes require a new API route major");
  if (semantics === "additive" && from.routeMajor === to.routeMajor && to.revision !== from.revision + 1) throw new Error("additive same-major changes increment contract revision by one");
  return true;
}

function validateIdentity(value, name) {
  if (!value || value.contract !== `explorer.v${value.routeMajor}` || !Number.isSafeInteger(value.routeMajor) || value.routeMajor < 1 || !Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error(`${name} contract identity is invalid`);
}
