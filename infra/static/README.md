# Static infrastructure

Private versioned S3 origin and atomic publication of main plus DataScript
entries. Content-hashed assets are immutable; HTML/registry revalidate quickly.
CloudFront serves only static content. The browser calls each enabled server
profile's alias-qualified Lambda Function URL directly; the Function URL owns
CORS and the read-only runtime owns request validation.
