# Fixture semantic-prefix proof

The 10,000-resource fixture is an exact semantic record prefix of the
1,000,000-resource fixture for `eacl-demo-fixture-v1`.

The NDJSON header is intentionally excluded from this statement because it
binds a different cut-point value in each artifact. Every logical object and
relationship record after that header is included.

The proof has three checked parts:

1. `fixtureBundles(10000)` and the first 10,000 bundles of
   `fixtureBundles(1000000)` are compared byte-for-byte after canonical JSON
   serialization.
2. The 48,693 compared records hash to
   `sha256:3bf7618d9276f6597e529cb064a46f95c97b2db7a4918b4dfde36c318aebd9cb`.
3. That digest and record count equal both the small manifest's complete
   semantic-record identity and the large manifest's 10,000-resource prefix
   proof.

This result follows from the generator's bundle boundary: the cut-point test is
made only after all dependent subject and relationship records for the selected
resource have been emitted. No record in the prefix refers to an object first
introduced after the cut point.

Run the executable proof with:

```sh
npm run verify:fixture-prefix
```
