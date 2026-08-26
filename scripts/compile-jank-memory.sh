#!/usr/bin/env bash
set -euo pipefail

workspace_root=/workspace
output_root=/output
source_root="${workspace_root}/services/jank-memory/src"
native_root="${workspace_root}/services/jank-memory/native"
target_root="${output_root}/target"
evidence_root="${output_root}/evidence"
license_output="${output_root}/THIRD-PARTY-LICENSES.txt"

test "$(uname -m)" = x86_64
grep -Eq '^ID="?amzn"?$' /etc/os-release
grep -Eq '^VERSION_ID="?2023"?$' /etc/os-release
test -x /usr/local/bin/jank

mkdir -p "${target_root}" "${evidence_root}"

include_arguments=()
for package_name in libcurl json-c openssl; do
  while IFS= read -r include_token; do
    case "${include_token}" in
      -I*) include_arguments+=("-I" "${include_token#-I}") ;;
      "") ;;
      *) echo "unexpected pkg-config include token: ${include_token}" >&2; exit 65 ;;
    esac
  done < <(pkg-config --cflags-only-I "${package_name}" | tr ' ' '\n')
done

curl_library="$(pkg-config --variable=libdir libcurl)/libcurl.so"
json_library="$(pkg-config --variable=libdir json-c)/libjson-c.so"
crypto_library="$(pkg-config --variable=libdir openssl)/libcrypto.so"
for library_file in "${curl_library}" "${json_library}" "${crypto_library}"; do
  test -f "${library_file}"
done

/usr/local/bin/jank check-health > "${evidence_root}/jank-check-health.txt"
/usr/local/bin/jank print-binary-version > "${evidence_root}/jank-binary-version.txt"
/usr/local/bin/jank compile \
  --module-path "${source_root}" \
  -I "${native_root}" \
  "${include_arguments[@]}" \
  -l "${curl_library}" \
  -l "${json_library}" \
  -l "${crypto_library}" \
  --optimization 3 \
  --runtime static \
  --no-debug \
  --target-dir "${target_root}" \
  --build-dir "${target_root}/_cache" \
  --name bootstrap \
  eacl-demo.jank-memory.main

test -f "${target_root}/bootstrap"
chmod 0755 "${target_root}/bootstrap"
cp "${target_root}/bootstrap" "${output_root}/bootstrap"

readelf -h "${output_root}/bootstrap" > "${evidence_root}/elf-header.txt"
grep -Eq 'Class:[[:space:]]+ELF64' "${evidence_root}/elf-header.txt"
grep -Eq 'Machine:[[:space:]]+Advanced Micro Devices X86-64' "${evidence_root}/elf-header.txt"
readelf -d "${output_root}/bootstrap" > "${evidence_root}/elf-dynamic.txt"
readelf --version-info "${output_root}/bootstrap" > "${evidence_root}/elf-versions.txt"
ldd "${output_root}/bootstrap" > "${evidence_root}/ldd.txt"
if strings "${output_root}/bootstrap" | grep -E '/opt/homebrew|/usr/local/Homebrew|Mach-O'; then
  echo "forbidden macOS/Homebrew marker in bootstrap" >&2
  exit 65
fi

: > "${license_output}"
while IFS= read -r -d '' license_file; do
  case "${license_file}" in
    /opt/source/jank/*)
      license_name="jank/${license_file#/opt/source/jank/}"
      ;;
    /usr/share/licenses/*)
      license_name="al2023/${license_file#/usr/share/licenses/}"
      ;;
    *)
      echo "unexpected license source: ${license_file}" >&2
      exit 65
      ;;
  esac
  printf '\n===== %s =====\n\n' "${license_name}" >> "${license_output}"
  sed 's/\r$//' "${license_file}" >> "${license_output}"
  printf '\n' >> "${license_output}"
done < <(
  {
    find /opt/source/jank -type f \
      \( -iname 'LICENSE*' -o -iname 'LICENCE*' -o -iname 'COPYING*' -o -iname 'NOTICE*' \) \
      -print0
    find /usr/share/licenses -maxdepth 2 -type f \
      \( -path '*/libcurl*/*' -o -path '*/json-c/*' -o \
         -path '*/openssl*/*' -o -path '*/libgcc*/*' -o \
         -path '*/libstdc++*/*' \) \
      -print0
  } | sort -z
)
test -s "${license_output}"
sha256sum "${license_output}" > "${evidence_root}/third-party-licenses.sha256"
