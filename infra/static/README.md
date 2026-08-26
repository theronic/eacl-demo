# Static infrastructure

Private versioned S3 origin and atomic publication of main plus DataScript
entries. Content-hashed assets are immutable; HTML/registry revalidate quickly.
The distribution defines one ordered, zero-TTL behavior per registered server
profile. An enabled Lambda origin must provide an alias-qualified function name
and an IAM Function URL domain; an unqualified function or `$LATEST` cannot be
configured as a profile origin.
