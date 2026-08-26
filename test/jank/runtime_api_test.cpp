#include "runtime_api.hpp"

#include <cassert>
#include <string>

int main()
{
  using namespace eacl_demo_jank_runtime;

  assert(json_to_edn(
    "{\"a\":[1,true,null,\"x\"],\"b\":{\"c\":false}}")
    == "1{\"a\" [1 true nil \"x\"] \"b\" {\"c\" false}}");
  assert(json_to_edn("null") == "1nil");
  assert(json_to_edn("{\"a\":1} trailing") == "0invalid-json");
  assert(json_to_edn("") == "0invalid-json");
  assert(json_quote("line\n\"quoted\"") == "1\"line\\n\\\"quoted\\\"\"");

  assert(decode_base64("aGVsbG8=") == "1hello");
  assert(decode_base64("") == "1");
  assert(decode_base64("YQ==") == "1a");
  assert(decode_base64("YR==") == "0invalid-base64");
  assert(decode_base64("a===") == "0invalid-base64");
  assert(decode_base64("aGVsbG8") == "0invalid-base64");

  assert(safe_runtime_authority("127.0.0.1:9001"));
  assert(safe_runtime_authority("[::1]:9001"));
  assert(!safe_runtime_authority("http://127.0.0.1:9001"));
  assert(!safe_runtime_authority("127.0.0.1:9001/path"));
  assert(safe_request_id("06b8ef0d-8505-4f61-8d6c-example"));
  assert(!safe_request_id("../response"));
  assert(!safe_request_id(""));
  assert(environment_value("NOT_ALLOWED") == "0environment-key");
  assert(maximum_runtime_header_bytes == 65536U);
  auto const timestamp = utc_timestamp();
  assert(timestamp.size() == 25U);
  assert(timestamp.front() == '1');
  assert(timestamp[5] == '-' && timestamp[8] == '-');
  assert(timestamp[11] == 'T' && timestamp[24] == 'Z');

  assert(edn_string("line\n\"quoted\"\\slash")
    == "\"line\\n\\\"quoted\\\"\\\\slash\"");
}
