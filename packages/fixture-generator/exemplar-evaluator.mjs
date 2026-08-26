import { fixtureBundles } from "./generator.mjs";

export function buildLogicalFixture(cutPoint = 10_000) {
  const objects = new Map();
  const resources = [];
  const subjects = [];
  const relationships = new Map();
  for (const bundle of fixtureBundles(cutPoint)) {
    for (const record of bundle.records) {
      if (record.kind === "object") {
        const key = objectKey(record.object);
        objects.set(key, record);
        (record.role === "subject" ? subjects : resources).push(record.object);
      } else {
        const indexKey = relationshipKey(record.resource, record.relation);
        const values = relationships.get(indexKey) ?? new Set();
        values.add(objectKey(record.subject));
        relationships.set(indexKey, values);
      }
    }
  }
  return { objects, resources, subjects, relationships };
}

export function checkPermission(fixture, subject, permission, resource) {
  const subjectKey = objectKey(subject);
  const resourceKey = objectKey(resource);
  if (!fixture.objects.has(subjectKey) || !fixture.objects.has(resourceKey)) return false;
  return evaluate(fixture, subjectKey, permission, resource, new Set());
}

export function lookupResources(fixture, query) {
  const filtered = fixture.resources.filter((resource) => {
    if (resource.type !== query.resourceType) return false;
    if (query.relationshipFilter) {
      const subjects = related(fixture, resource, query.relationshipFilter.relation);
      if (!subjects.has(objectKey(query.relationshipFilter.subject))) return false;
    }
    return checkPermission(fixture, query.subject, query.permission, resource);
  });
  return filtered.sort(compareObjects);
}

export function lookupSubjects(fixture, query) {
  return fixture.subjects
    .filter((subject) => subject.type === query.subjectType)
    .filter((subject) => checkPermission(fixture, subject, query.permission, query.resource))
    .sort(compareObjects);
}

export function hasRelationship(fixture, relationship) {
  return related(fixture, relationship.resource, relationship.relation).has(objectKey(relationship.subject));
}

function evaluate(fixture, subjectKey, permission, resource, path) {
  const state = `${subjectKey}|${permission}|${objectKey(resource)}`;
  if (path.has(state)) return false;
  const nextPath = new Set(path).add(state);
  const direct = (relation) => related(fixture, resource, relation).has(subjectKey);
  const arrowRelation = (via, targetRelation) => [...related(fixture, resource, via)].some((target) => {
    const targetObject = parseObjectKey(target);
    return related(fixture, targetObject, targetRelation).has(subjectKey);
  });
  const arrowPermission = (via, targetPermission) => [...related(fixture, resource, via)].some((target) => {
    return evaluate(fixture, subjectKey, targetPermission, parseObjectKey(target), nextPath);
  });
  const selfPermission = (targetPermission) => evaluate(fixture, subjectKey, targetPermission, resource, nextPath);

  switch (`${resource.type}:${permission}`) {
    case "platform:view": return direct("super_admin");
    case "account:admin": return direct("owner") || arrowPermission("parent", "admin") || arrowRelation("platform", "super_admin");
    case "account:view": return selfPermission("admin") || arrowPermission("parent", "admin");
    case "team:admin": return arrowPermission("account", "admin") || direct("leader");
    case "team:view": return selfPermission("admin");
    case "vpc:admin": return arrowPermission("account", "admin") || direct("shared_admin");
    case "vpc:view": return selfPermission("admin");
    case "server:admin": return arrowPermission("account", "admin") || direct("shared_admin");
    case "server:view":
      return selfPermission("admin") || arrowPermission("parent", "view") || arrowPermission("account", "view")
        || arrowPermission("team", "view") || arrowPermission("vpc", "view") || direct("shared_admin");
    default: return false;
  }
}

function related(fixture, resource, relation) {
  return fixture.relationships.get(relationshipKey(resource, relation)) ?? new Set();
}

function relationshipKey(resource, relation) {
  return `${objectKey(resource)}#${relation}`;
}

function objectKey(value) {
  return `${value.type}:${value.id}`;
}

function parseObjectKey(value) {
  const separator = value.indexOf(":");
  return { type: value.slice(0, separator), id: value.slice(separator + 1) };
}

function compareObjects(left, right) {
  return left.type.localeCompare(right.type, "en") || left.id.localeCompare(right.id, "en");
}
