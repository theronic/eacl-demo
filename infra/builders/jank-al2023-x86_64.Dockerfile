FROM public.ecr.aws/amazonlinux/amazonlinux@sha256:26b860d6ace0e868b1dd786be29b2a6b32a213b72f43074043090512871e9532 AS build

ARG JANK_COMMIT=489760dc927cd22900a4ab150dbab947ec25ad00

RUN dnf install -y \
      binutils-2.41-50.amzn2023.0.5 \
      boost-devel-1.75.0-4.amzn2023.0.4 \
      clang-15.0.7-3.amzn2023.0.4 \
      cmake-3.22.2-1.amzn2023.0.6 \
      curl-8.17.0-1.amzn2023.0.3 \
      diffutils-3.8-1.amzn2023.0.2 \
      findutils-4.8.0-2.amzn2023.0.2 \
      gcc-11.5.0-5.amzn2023.0.5 \
      gcc-c++-11.5.0-5.amzn2023.0.5 \
      git-2.50.1-1.amzn2023.0.1 \
      glibc-devel-2.34-231.amzn2023.0.5 \
      gzip-1.12-1.amzn2023.0.1 \
      json-c-devel-0.14-8.amzn2023.0.2 \
      libedit-devel-3.1-38.20210714cvs.amzn2023.0.2 \
      libffi-devel-3.4.4-1.amzn2023.0.1 \
      libcurl-devel-8.17.0-1.amzn2023.0.3 \
      libxml2-devel-2.10.4-1.amzn2023.0.20 \
      make-4.3-5.amzn2023.0.2 \
      ninja-build-1.10.2-2.amzn2023.0.3 \
      openssl-devel-3.5.7-2.amzn2023.0.1 \
      patch-2.7.6-14.amzn2023.0.2 \
      perl-5.32.1-477.amzn2023.0.9 \
      perl-Data-Dumper-2.191-522.amzn2023.0.3 \
      pkgconf-pkg-config-1.8.0-4.amzn2023.0.2 \
      tar-1.34-1.amzn2023.0.4 \
      which-2.21-26.amzn2023.0.2 \
      zlib-devel-1.2.11-33.amzn2023.0.6 \
    && dnf clean all

WORKDIR /opt/source
RUN git init jank \
    && git -C jank remote add origin https://github.com/jank-lang/jank.git \
    && git -C jank fetch --depth=1 origin "${JANK_COMMIT}" \
    && git -C jank checkout --detach FETCH_HEAD \
    && test "$(git -C jank rev-parse HEAD)" = "${JANK_COMMIT}" \
    && git -C jank submodule update --init --recursive --depth=1

WORKDIR /opt/source/jank/compiler+runtime
RUN ./bin/build-clang -j2
ENV CC=/opt/source/jank/compiler+runtime/build/llvm-install/usr/local/bin/clang
ENV CXX=/opt/source/jank/compiler+runtime/build/llvm-install/usr/local/bin/clang++
RUN ./bin/configure \
      -GNinja \
      -DCMAKE_BUILD_TYPE=Release \
      -Djank_local_clang=on \
      -Djank_install_local_clang=on \
      -Djank_test=off \
      -Djank_unity_build=on \
    && ./bin/compile \
    && DESTDIR=/opt/jank-install ./bin/install

FROM build AS runtime
RUN cp -a /opt/jank-install/usr/local/. /usr/local/
RUN /usr/local/bin/jank check-health
ENV PATH=/usr/local/bin:${PATH}
WORKDIR /workspace
