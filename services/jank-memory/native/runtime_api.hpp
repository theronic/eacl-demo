#pragma once

#include <curl/curl.h>
#include <json-c/json.h>

#include <algorithm>
#include <cctype>
#include <chrono>
#include <cstdio>
#include <cstdint>
#include <cstdlib>
#include <ctime>
#include <limits>
#include <map>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace eacl_demo_jank_runtime
{
  inline constexpr std::size_t maximum_event_bytes{ 7U * 1024U * 1024U };
  inline constexpr std::size_t maximum_response_bytes{ 1024U * 1024U };
  inline constexpr std::size_t maximum_runtime_header_bytes{ 64U * 1024U };

  struct body_sink
  {
    std::string value;
    std::size_t maximum{};
    bool overflow{};
  };

  struct http_result
  {
    CURLcode transport_status{ CURLE_OK };
    long status{};
    std::string body;
    std::map<std::string, std::string> headers;
    std::string error;
    bool overflow{};
  };

  struct header_sink
  {
    std::map<std::string, std::string> value;
    std::size_t bytes{};
    bool overflow{};
  };

  inline std::string trim(std::string value)
  {
    auto const not_space = [](unsigned char value)
    {
      return std::isspace(value) == 0;
    };
    auto const start = std::find_if(value.begin(), value.end(), not_space);
    auto const finish = std::find_if(value.rbegin(), value.rend(), not_space).base();
    if(start >= finish) return {};
    return std::string{ start, finish };
  }

  inline std::string lower(std::string value)
  {
    std::transform(
      value.begin(), value.end(), value.begin(),
      [](unsigned char character)
      {
        return static_cast<char>(std::tolower(character));
      });
    return value;
  }

  inline std::size_t receive_body(
    char* contents, std::size_t size, std::size_t count, void* user_data)
  {
    auto& sink = *static_cast<body_sink*>(user_data);
    if(count != 0U && size > std::numeric_limits<std::size_t>::max() / count)
    {
      sink.overflow = true;
      return 0;
    }
    auto const bytes = size * count;
    if(bytes > sink.maximum || sink.value.size() > sink.maximum - bytes)
    {
      sink.overflow = true;
      return 0;
    }
    sink.value.append(contents, bytes);
    return bytes;
  }

  inline std::size_t receive_header(
    char* contents, std::size_t size, std::size_t count, void* user_data)
  {
    auto& sink = *static_cast<header_sink*>(user_data);
    if(count != 0U && size > std::numeric_limits<std::size_t>::max() / count)
    {
      sink.overflow = true;
      return 0;
    }
    auto const bytes = size * count;
    if(bytes > maximum_runtime_header_bytes
       || sink.bytes > maximum_runtime_header_bytes - bytes)
    {
      sink.overflow = true;
      return 0;
    }
    sink.bytes += bytes;
    std::string line{ contents, bytes };
    auto const separator = line.find(':');
    if(separator != std::string::npos)
    {
      auto name = lower(trim(line.substr(0, separator)));
      auto value = trim(line.substr(separator + 1));
      if(!name.empty())
        sink.value.insert_or_assign(std::move(name), std::move(value));
    }
    return bytes;
  }

  inline bool safe_runtime_authority(std::string_view value)
  {
    if(value.empty() || value.size() > 512U) return false;
    return std::all_of(
      value.begin(), value.end(),
      [](unsigned char character)
      {
        return std::isalnum(character) != 0
          || character == '.' || character == ':' || character == '-'
          || character == '[' || character == ']';
      });
  }

  inline bool safe_request_id(std::string_view value)
  {
    if(value.empty() || value.size() > 256U) return false;
    return std::all_of(
      value.begin(), value.end(),
      [](unsigned char character)
      {
        return std::isalnum(character) != 0 || character == '-';
      });
  }

  inline http_result request(
    std::string const& url,
    bool post,
    std::string const& payload,
    std::vector<std::string> const& headers,
    std::size_t maximum_body,
    long timeout_millis)
  {
    static auto const global_status = curl_global_init(CURL_GLOBAL_DEFAULT);
    http_result result;
    if(global_status != CURLE_OK)
    {
      result.transport_status = CURLE_FAILED_INIT;
      result.error = "curl-global-init";
      return result;
    }

    auto* handle = curl_easy_init();
    if(handle == nullptr)
    {
      result.transport_status = CURLE_FAILED_INIT;
      result.error = "curl-easy-init";
      return result;
    }

    body_sink sink{ {}, maximum_body, false };
    header_sink response_headers;
    char error_buffer[CURL_ERROR_SIZE]{};
    curl_slist* request_headers{};
    for(auto const& header : headers)
    {
      auto* appended = curl_slist_append(request_headers, header.c_str());
      if(appended == nullptr)
      {
        curl_slist_free_all(request_headers);
        curl_easy_cleanup(handle);
        result.transport_status = CURLE_OUT_OF_MEMORY;
        result.error = "curl-header-allocation";
        return result;
      }
      request_headers = appended;
    }

    curl_easy_setopt(handle, CURLOPT_URL, url.c_str());
    curl_easy_setopt(handle, CURLOPT_NOSIGNAL, 1L);
    curl_easy_setopt(handle, CURLOPT_NOPROXY, "*");
    curl_easy_setopt(handle, CURLOPT_FOLLOWLOCATION, 0L);
    curl_easy_setopt(handle, CURLOPT_CONNECTTIMEOUT_MS, 1000L);
    curl_easy_setopt(handle, CURLOPT_TIMEOUT_MS, timeout_millis);
    curl_easy_setopt(handle, CURLOPT_WRITEFUNCTION, receive_body);
    curl_easy_setopt(handle, CURLOPT_WRITEDATA, &sink);
    curl_easy_setopt(handle, CURLOPT_HEADERFUNCTION, receive_header);
    curl_easy_setopt(handle, CURLOPT_HEADERDATA, &response_headers);
    curl_easy_setopt(handle, CURLOPT_HTTPHEADER, request_headers);
    curl_easy_setopt(handle, CURLOPT_ERRORBUFFER, error_buffer);
    curl_easy_setopt(handle, CURLOPT_USERAGENT, "eacl-demo-jank-memory/1");
    if(post)
    {
      curl_easy_setopt(handle, CURLOPT_POST, 1L);
      curl_easy_setopt(handle, CURLOPT_POSTFIELDS, payload.data());
      curl_easy_setopt(
        handle, CURLOPT_POSTFIELDSIZE_LARGE,
        static_cast<curl_off_t>(payload.size()));
    }
    else
    {
      curl_easy_setopt(handle, CURLOPT_HTTPGET, 1L);
    }

    result.transport_status = curl_easy_perform(handle);
    result.overflow = sink.overflow || response_headers.overflow;
    result.body = std::move(sink.value);
    result.headers = std::move(response_headers.value);
    if(result.transport_status != CURLE_OK)
      result.error = error_buffer[0] == '\0'
        ? curl_easy_strerror(result.transport_status)
        : error_buffer;
    curl_easy_getinfo(handle, CURLINFO_RESPONSE_CODE, &result.status);
    curl_slist_free_all(request_headers);
    curl_easy_cleanup(handle);
    return result;
  }

  inline std::string edn_string(std::string_view value)
  {
    static constexpr char hex[]{ "0123456789abcdef" };
    std::string result;
    result.reserve(value.size() + 2U);
    result.push_back('"');
    for(unsigned char const character : value)
    {
      switch(character)
      {
        case '"': result += "\\\""; break;
        case '\\': result += "\\\\"; break;
        case '\b': result += "\\b"; break;
        case '\f': result += "\\f"; break;
        case '\n': result += "\\n"; break;
        case '\r': result += "\\r"; break;
        case '\t': result += "\\t"; break;
        default:
          if(character < 0x20U)
          {
            result += "\\u00";
            result.push_back(hex[(character >> 4U) & 0x0fU]);
            result.push_back(hex[character & 0x0fU]);
          }
          else result.push_back(static_cast<char>(character));
      }
    }
    result.push_back('"');
    return result;
  }

  inline std::string json_to_edn_value(json_object* value)
  {
    if(value == nullptr) return "nil";
    switch(json_object_get_type(value))
    {
      case json_type_null:
        return "nil";
      case json_type_boolean:
        return json_object_get_boolean(value) ? "true" : "false";
      case json_type_double:
        return json_object_get_string(value);
      case json_type_int:
        return std::to_string(json_object_get_int64(value));
      case json_type_string:
        return edn_string(json_object_get_string(value));
      case json_type_array:
      {
        std::string result{ "[" };
        auto const length = json_object_array_length(value);
        for(std::size_t index{}; index < length; ++index)
        {
          if(index != 0U) result.push_back(' ');
          result += json_to_edn_value(json_object_array_get_idx(value, index));
        }
        result.push_back(']');
        return result;
      }
      case json_type_object:
      {
        std::string result{ "{" };
        bool first{ true };
        json_object_object_foreach(value, key, entry)
        {
          if(!first) result.push_back(' ');
          first = false;
          result += edn_string(key);
          result.push_back(' ');
          result += json_to_edn_value(entry);
        }
        result.push_back('}');
        return result;
      }
    }
    return "nil";
  }

  inline std::string json_to_edn(std::string const& input)
  {
    if(input.size() > maximum_event_bytes) return "0json-too-large";
    auto* parser = json_tokener_new();
    if(parser == nullptr) return "0json-parser-init";
    auto* value = json_tokener_parse_ex(
      parser, input.c_str(), static_cast<int>(input.size() + 1U));
    auto const status = json_tokener_get_error(parser);
    auto consumed = static_cast<std::size_t>(json_tokener_get_parse_end(parser));
    while(consumed < input.size()
          && std::isspace(static_cast<unsigned char>(input[consumed])) != 0)
      ++consumed;
    if(status != json_tokener_success || consumed != input.size())
    {
      if(value != nullptr) json_object_put(value);
      json_tokener_free(parser);
      return "0invalid-json";
    }
    auto result = std::string{ "1" } + json_to_edn_value(value);
    if(value != nullptr) json_object_put(value);
    json_tokener_free(parser);
    return result;
  }

  inline std::string json_quote(std::string const& input)
  {
    auto* value = json_object_new_string_len(
      input.data(), static_cast<int>(input.size()));
    if(value == nullptr) return "0json-string-allocation";
    auto const* encoded =
      json_object_to_json_string_ext(value, JSON_C_TO_STRING_PLAIN);
    auto result = encoded == nullptr
      ? std::string{ "0json-string-encoding" }
      : std::string{ "1" } + encoded;
    json_object_put(value);
    return result;
  }

  inline int base64_value(unsigned char character)
  {
    if(character >= 'A' && character <= 'Z') return character - 'A';
    if(character >= 'a' && character <= 'z') return character - 'a' + 26;
    if(character >= '0' && character <= '9') return character - '0' + 52;
    if(character == '+') return 62;
    if(character == '/') return 63;
    return -1;
  }

  inline std::string decode_base64(std::string const& input)
  {
    if(input.size() > maximum_event_bytes || input.size() % 4U != 0U)
      return "0invalid-base64";
    std::string output;
    output.reserve((input.size() / 4U) * 3U);
    for(std::size_t index{}; index < input.size(); index += 4U)
    {
      auto const final_group = index + 4U == input.size();
      auto const pad2 = input[index + 2U] == '=';
      auto const pad3 = input[index + 3U] == '=';
      if(pad2 && !pad3) return "0invalid-base64";
      if((pad2 || pad3) && !final_group) return "0invalid-base64";
      auto const a = base64_value(input[index]);
      auto const b = base64_value(input[index + 1U]);
      auto const c = pad2 ? 0 : base64_value(input[index + 2U]);
      auto const d = pad3 ? 0 : base64_value(input[index + 3U]);
      if(a < 0 || b < 0 || c < 0 || d < 0) return "0invalid-base64";
      if((pad2 && (b & 0x0f) != 0) || (pad3 && !pad2 && (c & 0x03) != 0))
        return "0invalid-base64";
      auto const bits = (static_cast<std::uint32_t>(a) << 18U)
        | (static_cast<std::uint32_t>(b) << 12U)
        | (static_cast<std::uint32_t>(c) << 6U)
        | static_cast<std::uint32_t>(d);
      output.push_back(static_cast<char>((bits >> 16U) & 0xffU));
      if(!pad2) output.push_back(static_cast<char>((bits >> 8U) & 0xffU));
      if(!pad3) output.push_back(static_cast<char>(bits & 0xffU));
    }
    return std::string{ "1" } + output;
  }

  inline std::string runtime_root()
  {
    auto const* authority = std::getenv("AWS_LAMBDA_RUNTIME_API");
    if(authority == nullptr || !safe_runtime_authority(authority)) return {};
    return std::string{ "http://" } + authority + "/2018-06-01/runtime";
  }

  inline std::string environment_value(std::string const& name)
  {
    static std::vector<std::string> const allowed{
      "LAMBDA_TASK_ROOT",
      "EACL_DEMO_SHA",
      "EACL_CORE_SHA",
      "EACL_ARTIFACT_SHA256",
      "EACL_DEPLOYMENT_ID",
      "EACL_DATA_MANIFEST_SHA256",
      "AWS_LAMBDA_FUNCTION_MEMORY_SIZE",
      "EACL_JANK_FIXTURE_PATH",
      "EACL_JANK_MODE"
    };
    if(std::find(allowed.begin(), allowed.end(), name) == allowed.end())
      return "0environment-key";
    auto const* value = std::getenv(name.c_str());
    if(value == nullptr) return "2";
    if(std::string_view{ value }.size() > 4096U)
      return "0environment-value";
    return std::string{ "1" } + value;
  }

  inline std::string utc_timestamp()
  {
    auto const now = std::chrono::system_clock::now();
    auto const total_millis = std::chrono::duration_cast<std::chrono::milliseconds>(
      now.time_since_epoch()).count();
    auto const seconds = static_cast<std::time_t>(total_millis / 1000LL);
    auto const milliseconds = static_cast<int>(total_millis % 1000LL);
    std::tm value{};
    if(gmtime_r(&seconds, &value) == nullptr) return "0clock";
    char output[32]{};
    auto const written = std::snprintf(
      output, sizeof(output), "%04d-%02d-%02dT%02d:%02d:%02d.%03dZ",
      value.tm_year + 1900, value.tm_mon + 1, value.tm_mday,
      value.tm_hour, value.tm_min, value.tm_sec, milliseconds);
    if(written != 24) return "0clock";
    return std::string{ "1" } + output;
  }

  inline std::string next_invocation()
  {
    auto const root = runtime_root();
    if(root.empty()) return "0runtime-api-unavailable";
    auto response = request(
      root + "/invocation/next", false, {}, {}, maximum_event_bytes, 0L);
    if(response.overflow) return "0event-too-large";
    if(response.transport_status != CURLE_OK) return "0runtime-api-transport";
    if(response.status != 200L) return "0runtime-api-status";

    auto const request_id_entry =
      response.headers.find("lambda-runtime-aws-request-id");
    auto const deadline_entry =
      response.headers.find("lambda-runtime-deadline-ms");
    if(request_id_entry == response.headers.end()
       || !safe_request_id(request_id_entry->second)
       || deadline_entry == response.headers.end()
       || deadline_entry->second.empty()
       || !std::all_of(
         deadline_entry->second.begin(), deadline_entry->second.end(),
         [](unsigned char character) { return std::isdigit(character) != 0; }))
      return "0runtime-api-headers";

    auto const parsed = json_to_edn(response.body);
    if(parsed.empty() || parsed.front() != '1') return "0invalid-event-json";
    if(auto const trace = response.headers.find("lambda-runtime-trace-id");
       trace != response.headers.end() && trace->second.size() <= 4096U)
      setenv("_X_AMZN_TRACE_ID", trace->second.c_str(), 1);

    std::string result{ "1{" };
    result += edn_string("requestId") + " "
      + edn_string(request_id_entry->second) + " ";
    result += edn_string("deadlineMs") + " " + deadline_entry->second + " ";
    result += edn_string("event") + " " + parsed.substr(1U) + "}";
    return result;
  }

  inline std::string post_invocation(
    std::string const& request_id,
    std::string const& endpoint,
    std::string const& payload,
    bool function_error)
  {
    auto const root = runtime_root();
    if(root.empty() || !safe_request_id(request_id))
      return "0runtime-api-target";
    if(payload.size() > maximum_response_bytes) return "0response-too-large";
    std::vector<std::string> headers{
      "Content-Type: application/json; charset=utf-8"
    };
    if(function_error)
      headers.emplace_back(
        "Lambda-Runtime-Function-Error-Type: Runtime.Unhandled");
    auto response = request(
      root + "/invocation/" + request_id + "/" + endpoint,
      true, payload, headers, 4096U, 5000L);
    if(response.transport_status != CURLE_OK) return "0runtime-api-transport";
    if(response.status != 202L) return "0runtime-api-status";
    return "1";
  }

  inline std::string post_response(
    std::string const& request_id, std::string const& payload)
  {
    return post_invocation(request_id, "response", payload, false);
  }

  inline std::string post_error(
    std::string const& request_id, std::string const& payload)
  {
    return post_invocation(request_id, "error", payload, true);
  }

  inline std::string post_init_error(std::string const& payload)
  {
    auto const root = runtime_root();
    if(root.empty() || payload.size() > 65536U) return "0runtime-api-target";
    auto response = request(
      root + "/init/error", true, payload,
      {
        "Content-Type: application/json; charset=utf-8",
        "Lambda-Runtime-Function-Error-Type: Runtime.InitError"
      },
      4096U, 5000L);
    if(response.transport_status != CURLE_OK) return "0runtime-api-transport";
    if(response.status != 202L) return "0runtime-api-status";
    return "1";
  }
}
