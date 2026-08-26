#pragma once

#include "runtime_api.hpp"

#include <openssl/evp.h>

#include <array>
#include <cstddef>
#include <fstream>
#include <memory>
#include <string>

namespace eacl_demo_jank_fixture
{
  inline constexpr std::size_t maximum_record_bytes{ 8192U };
  inline constexpr std::size_t maximum_fixture_records{ 48693U };
  inline constexpr std::size_t maximum_semantic_bytes{ 6753401U };

  struct digest_context_deleter
  {
    void operator()(EVP_MD_CTX* value) const
    {
      EVP_MD_CTX_free(value);
    }
  };

  using digest_context =
    std::unique_ptr<EVP_MD_CTX, digest_context_deleter>;

  inline std::string hex(
    unsigned char const* input, std::size_t size)
  {
    static constexpr char digits[]{ "0123456789abcdef" };
    std::string result;
    result.reserve(size * 2U);
    for(std::size_t index{}; index < size; ++index)
    {
      auto const value = input[index];
      result.push_back(digits[(value >> 4U) & 0x0fU]);
      result.push_back(digits[value & 0x0fU]);
    }
    return result;
  }

  class reader
  {
  public:
    std::string open(std::string const& file_name)
    {
      close();
      if(file_name.empty() || file_name.size() > 4096U
         || file_name.front() != '/')
        return "0invalid-fixture-path";
      stream_.open(file_name, std::ios::binary);
      if(!stream_) return "0fixture-open";
      fixture_digest_.reset(EVP_MD_CTX_new());
      records_digest_.reset(EVP_MD_CTX_new());
      if(!fixture_digest_ || !records_digest_
         || EVP_DigestInit_ex(fixture_digest_.get(), EVP_sha256(), nullptr) != 1
         || EVP_DigestInit_ex(records_digest_.get(), EVP_sha256(), nullptr) != 1)
      {
        close();
        return "0fixture-digest-init";
      }
      open_ = true;
      auto header = read_line();
      if(header.first != line_status::value)
      {
        close();
        return "0fixture-header";
      }
      if(EVP_DigestUpdate(
           fixture_digest_.get(), header.second.data(), header.second.size()) != 1)
      {
        close();
        return "0fixture-digest-update";
      }
      auto const parsed =
        eacl_demo_jank_runtime::json_to_edn(
          header.second.substr(0U, header.second.size() - 1U));
      if(parsed.empty() || parsed.front() != '1')
      {
        close();
        return "0fixture-header-json";
      }
      return std::string{ "1" } + parsed.substr(1U);
    }

    std::string next()
    {
      if(!open_ || complete_) return "0fixture-reader-state";
      auto line = read_line();
      if(line.first == line_status::end)
      {
        complete_ = true;
        return "2";
      }
      if(line.first != line_status::value) return "0fixture-record";
      if(record_count_ >= maximum_fixture_records
         || line.second.size() > maximum_semantic_bytes - semantic_bytes_)
        return "0fixture-bounds";
      if(EVP_DigestUpdate(
           fixture_digest_.get(), line.second.data(), line.second.size()) != 1
         || EVP_DigestUpdate(
           records_digest_.get(), line.second.data(), line.second.size()) != 1)
        return "0fixture-digest-update";
      semantic_bytes_ += line.second.size();
      ++record_count_;
      auto const parsed =
        eacl_demo_jank_runtime::json_to_edn(
          line.second.substr(0U, line.second.size() - 1U));
      if(parsed.empty() || parsed.front() != '1')
        return "0fixture-record-json";
      return std::string{ "1" } + parsed.substr(1U);
    }

    std::string finish()
    {
      if(!open_ || !complete_ || finalized_)
        return "0fixture-reader-state";
      std::array<unsigned char, EVP_MAX_MD_SIZE> fixture{};
      std::array<unsigned char, EVP_MAX_MD_SIZE> records{};
      unsigned int fixture_size{};
      unsigned int records_size{};
      if(EVP_DigestFinal_ex(
           fixture_digest_.get(), fixture.data(), &fixture_size) != 1
         || EVP_DigestFinal_ex(
           records_digest_.get(), records.data(), &records_size) != 1)
        return "0fixture-digest-final";
      finalized_ = true;
      std::string result{ "1{" };
      result += eacl_demo_jank_runtime::edn_string("fixtureSha256")
        + " " + eacl_demo_jank_runtime::edn_string(
          std::string{ "sha256:" } + hex(fixture.data(), fixture_size)) + " ";
      result += eacl_demo_jank_runtime::edn_string("semanticRecordsSha256")
        + " " + eacl_demo_jank_runtime::edn_string(
          std::string{ "sha256:" } + hex(records.data(), records_size)) + " ";
      result += eacl_demo_jank_runtime::edn_string("recordCount")
        + " " + std::to_string(record_count_) + " ";
      result += eacl_demo_jank_runtime::edn_string("canonicalBytes")
        + " " + std::to_string(semantic_bytes_) + "}";
      return result;
    }

    void close()
    {
      if(stream_.is_open()) stream_.close();
      fixture_digest_.reset();
      records_digest_.reset();
      open_ = false;
      complete_ = false;
      finalized_ = false;
      record_count_ = 0U;
      semantic_bytes_ = 0U;
    }

  private:
    enum class line_status
    {
      value,
      end,
      invalid
    };

    std::pair<line_status, std::string> read_line()
    {
      std::string line;
      if(!std::getline(stream_, line))
        return stream_.eof()
          ? std::pair{ line_status::end, std::string{} }
          : std::pair{ line_status::invalid, std::string{} };
      if(stream_.eof() || line.empty() || line.back() == '\r'
         || line.size() > maximum_record_bytes)
        return { line_status::invalid, {} };
      line.push_back('\n');
      return { line_status::value, std::move(line) };
    }

    std::ifstream stream_;
    digest_context fixture_digest_;
    digest_context records_digest_;
    bool open_{};
    bool complete_{};
    bool finalized_{};
    std::size_t record_count_{};
    std::size_t semantic_bytes_{};
  };

  inline reader fixture_reader;

  inline std::string open(std::string const& file_name)
  {
    return fixture_reader.open(file_name);
  }

  inline std::string next()
  {
    return fixture_reader.next();
  }

  inline std::string finish()
  {
    return fixture_reader.finish();
  }

  inline long long close()
  {
    fixture_reader.close();
    return 1;
  }
}
