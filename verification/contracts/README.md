# Cross-runtime transport fixtures

`function-url-v2.cases.json` is the reusable AWS Lambda Function URL payload-v2 suite. Every managed JVM adapter and the Jank custom-runtime adapter must read these exact cases and emit the exact normalized result before its artifact can qualify. Runtime-specific tests may add cases but cannot weaken or reinterpret these.

Responses use JSON UTF-8, `no-store`, `nosniff`, stable status mapping, and no base64 encoding. The same fixture suite covers read-only success routes and pre-dispatch rejection of query, mutation route, and unknown event fields.
