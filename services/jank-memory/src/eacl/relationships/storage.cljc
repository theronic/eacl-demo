(ns eacl.relationships.storage
  "Persisted paired endpoint tuple attribute identities from EACL PR #145.")

(def forward-attribute
  :eacl.v7.relationship/subject-type+relation+resource-type+resource)

(def reverse-attribute
  :eacl.v7.relationship/resource-type+relation+subject-type+subject)

(def attributes #{forward-attribute reverse-attribute})
