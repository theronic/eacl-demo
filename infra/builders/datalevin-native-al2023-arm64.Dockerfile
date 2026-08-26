FROM public.ecr.aws/amazonlinux/amazonlinux@sha256:d114e9857686bd3faa025755505a293f281cbcca7800890baa6db899832a0060 AS build

ARG DTLVNATIVE_COMMIT=5b52192dd81c65edc2a9322a49dd9466e4941772
ARG JAVACPP_VERSION=1.5.13
ARG JAVACPP_SHA256=077f27d663cc928adce43e912a90ec06f97f92f120ca02d414735ae0fb1c743c

RUN dnf install -y \
      binutils-2.41-50.amzn2023.0.5 \
      cmake-3.22.2-1.amzn2023.0.6 \
      findutils-4.8.0-2.amzn2023.0.2 \
      gcc-11.5.0-5.amzn2023.0.5 \
      gcc-c++-11.5.0-5.amzn2023.0.5 \
      git-2.50.1-1.amzn2023.0.1 \
      glibc-devel-2.34-231.amzn2023.0.5 \
      gzip-1.12-1.amzn2023.0.1 \
      java-25-amazon-corretto-devel-25.0.4+7-1.amzn2023.1 \
      libstdc++-static-11.5.0-5.amzn2023.0.5 \
      make-4.3-5.amzn2023.0.2 \
      patch-2.7.6-14.amzn2023.0.2 \
      patchelf-0.17.0-1.amzn2023.0.2 \
      unzip-6.0-68.amzn2023.0.2 \
      which-2.21-26.amzn2023.0.2 \
      zip-3.0-28.amzn2023.0.3 \
    && dnf clean all

RUN curl --fail --location --silent --show-error \
      --output /opt/javacpp.jar \
      "https://repo1.maven.org/maven2/org/bytedeco/javacpp/${JAVACPP_VERSION}/javacpp-${JAVACPP_VERSION}.jar" \
    && echo "${JAVACPP_SHA256}  /opt/javacpp.jar" | sha256sum --check --strict

WORKDIR /opt/source
RUN git init dtlvnative \
    && git -C dtlvnative remote add origin https://github.com/juji-io/dtlvnative.git \
    && git -C dtlvnative fetch --depth=1 origin "${DTLVNATIVE_COMMIT}" \
    && git -C dtlvnative checkout --detach FETCH_HEAD \
    && test "$(git -C dtlvnative rev-parse HEAD)" = "${DTLVNATIVE_COMMIT}" \
    && git -C dtlvnative submodule update --init --recursive \
    && test "$(git -C dtlvnative/src/lmdb rev-parse HEAD)" = d79120e2e8df712aae940325ea4d2a8b800ff17e \
    && test "$(git -C dtlvnative/src/llama.cpp rev-parse HEAD)" = 12127defda4f41b7679cb2477a4b0d65ee6a0c8f \
    && test "$(git -C dtlvnative/src/usearch rev-parse HEAD)" = cc23bbaf21ef52313c5a495adbc40cbd733cdcfb \
    && test "$(git -C dtlvnative/src/usearch/numkong rev-parse HEAD)" = 48cbd21db85c013f0faebdbbe07b0feed1dd9e7c \
    && test "$(git -C dtlvnative/src/usearch/stringzilla rev-parse HEAD)" = 30d3e2129654d8269b3f66726414f9694c834e25

COPY infra/builders/datalevin-native-al2023-rpath.patch /opt/datalevin-native-al2023-rpath.patch
RUN git -C /opt/source/dtlvnative apply --check /opt/datalevin-native-al2023-rpath.patch \
    && git -C /opt/source/dtlvnative apply /opt/datalevin-native-al2023-rpath.patch

WORKDIR /opt/source/dtlvnative
RUN script/build

WORKDIR /opt/source/dtlvnative/src/java
RUN java -jar /opt/javacpp.jar datalevin/dtlvnative/DTLV.java \
    && patchelf --set-rpath '$ORIGIN' datalevin/dtlvnative/linux-arm64/libjniDTLV.so

RUN mkdir -p \
      /opt/package/datalevin/dtlvnative/linux-arm64 \
      /opt/package/META-INF \
      /opt/classes \
      /opt/output \
    && javac --release 21 -cp /opt/javacpp.jar -d /opt/classes \
      datalevin/dtlvnative/DTLVConfig.java \
      datalevin/dtlvnative/DTLV.java \
      datalevin/dtlvnative/Test.java \
    && cp -a /opt/classes/datalevin /opt/package/ \
    && cp datalevin/dtlvnative/linux-arm64/libjniDTLV.so \
      /opt/package/datalevin/dtlvnative/linux-arm64/libjniDTLV.so \
    && cp ../libdtlv.so /opt/package/datalevin/dtlvnative/linux-arm64/libdtlv.so \
    && cp ../libgomp.so /opt/package/datalevin/dtlvnative/linux-arm64/libgomp.so \
    && printf 'Manifest-Version: 1.0\nMain-Class: datalevin.dtlvnative.Test\n\n' \
      > /opt/package/META-INF/MANIFEST.MF \
    && find /opt/package -type f -exec touch -d '2000-01-01T00:00:00Z' {} + \
    && cd /opt/package \
    && find . -type f -print0 | LC_ALL=C sort -z \
      | xargs -0 zip -X -q -9 /opt/output/dtlvnative-linux-arm64-0.18.8-eacl.al2023.1.jar

COPY infra/builders/datalevin-native/NativeInMemorySmoke.java /opt/smoke/NativeInMemorySmoke.java
RUN javac --release 21 \
      -cp /opt/output/dtlvnative-linux-arm64-0.18.8-eacl.al2023.1.jar:/opt/javacpp.jar \
      -d /opt/smoke /opt/smoke/NativeInMemorySmoke.java \
    && java \
      --enable-native-access=ALL-UNNAMED \
      --add-opens=java.base/java.nio=ALL-UNNAMED \
      --add-opens=java.base/sun.nio.ch=ALL-UNNAMED \
      -cp /opt/smoke:/opt/output/dtlvnative-linux-arm64-0.18.8-eacl.al2023.1.jar:/opt/javacpp.jar \
      NativeInMemorySmoke \
      > /opt/output/native-in-memory-smoke.v1.json \
    && test "$(cat /opt/output/native-in-memory-smoke.v1.json)" = \
      '{"nativeLoaded":true,"storageMode":"MDB_INMEMORY","roundTrip":true}' \
    && sha256sum /opt/output/dtlvnative-linux-arm64-0.18.8-eacl.al2023.1.jar \
      > /opt/output/dtlvnative-linux-arm64-0.18.8-eacl.al2023.1.jar.sha256

FROM scratch AS artifact
COPY --from=build /opt/output/ /
