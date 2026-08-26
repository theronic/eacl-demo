#include "fixture_reader.hpp"

#include <cassert>
#include <string>

int main(int argc, char** argv)
{
  assert(argc == 2);
  assert(eacl_demo_jank_fixture::maximum_fixture_records == 48693U);
  assert(eacl_demo_jank_fixture::maximum_semantic_bytes == 6753401U);
  auto opened = eacl_demo_jank_fixture::open(argv[1]);
  assert(!opened.empty() && opened.front() == '1');
  std::size_t records{};
  while(true)
  {
    auto const value = eacl_demo_jank_fixture::next();
    assert(!value.empty());
    if(value.front() == '2') break;
    assert(value.front() == '1');
    ++records;
  }
  assert(records == 48693U);
  auto const evidence = eacl_demo_jank_fixture::finish();
  assert(evidence.find(
    "sha256:ec47ae57973bc7e9c580709410e530a7ac64acd24c01f9e3161489e8ebd58dfd")
    != std::string::npos);
  assert(evidence.find(
    "sha256:3bf7618d9276f6597e529cb064a46f95c97b2db7a4918b4dfde36c318aebd9cb")
    != std::string::npos);
  assert(evidence.find("\"recordCount\" 48693") != std::string::npos);
  assert(evidence.find("\"canonicalBytes\" 6753401") != std::string::npos);
  assert(eacl_demo_jank_fixture::close() == 1);
}
