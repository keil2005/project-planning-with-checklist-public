#!/usr/bin/env bash
# fetch-mpxj.sh —— 拉取 MPXJ 依赖并编译 MPP 导入桥接（仅本机 Mac/Linux + Java）。
#
# 背景：MPP 导入采用「Java 桥接」方案（见 docs/LESSON_LEARN.md）。
#       server/mppImport.ts 通过 java -cp "server/mpxj:server/mpxj/lib/*" MppImport <file>
#       调用本目录编译产物；缺本目录时 isMppImportAvailable() 返回 false → 路由 501。
#       Windows 零配置共享包不含本目录，故自动禁用导入，无需代码分支。
#
# 用法：bash server/mpxj/fetch-mpxj.sh
# 产物：server/mpxj/lib/*.jar  +  server/mpxj/MppImport.class
set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB="$DIR/lib"
MVN="https://repo1.maven.org/maven2"
mkdir -p "$LIB"

# 清理历史错版本：POI 5.3.0 需 commons-io >= 2.16.1，旧包会导致 .mpp 读取 NoSuchMethodError。
# 若 class 与 jar 版本不一致，也一并清除，强制重新编译。
for stale in "$LIB"/commons-io-2.15.1.jar; do
  if [ -f "$stale" ]; then
    echo "== 移除过时依赖 $(basename "$stale") =="
    rm -f "$stale"
  fi
done

# MPXJ 13.5.0 运行时依赖（含 POI / JAXB / Jackcess 的传递依赖；junit 为 test 作用域，不拉）
JARS=(
  "net/sf/mpxj/mpxj/13.5.0/mpxj-13.5.0.jar"
  "org/apache/poi/poi/5.3.0/poi-5.3.0.jar"
  "org/apache/poi/poi-ooxml/5.3.0/poi-ooxml-5.3.0.jar"
  "org/apache/poi/poi-ooxml-lite/5.3.0/poi-ooxml-lite-5.3.0.jar"
  "org/xerial/sqlite-jdbc/3.42.0.0/sqlite-jdbc-3.42.0.0.jar"
  "com/jgoodies/jgoodies-binding/2.13.0/jgoodies-binding-2.13.0.jar"
  # 注意 groupId 是 com.github.joniles（不是 com.rtfparserkit）。
  # .mpp 的任务备注是 RTF，MPXJ 靠它解析；缺则 NoClassDefFoundError: IRtfSource。
  "com/github/joniles/rtfparserkit/1.16.0/rtfparserkit-1.16.0.jar"
  "jakarta/xml/bind/jakarta.xml.bind-api/3.0.1/jakarta.xml.bind-api-3.0.1.jar"
  # 运行时必需：JAXB 反序列化时 jakarta.activation.DataSource，缺则 NoClassDefFoundError
  "jakarta/activation/jakarta.activation-api/2.1.2/jakarta.activation-api-2.1.2.jar"
  "org/glassfish/jaxb/jaxb-runtime/3.0.2/jaxb-runtime-3.0.2.jar"
  "com/healthmarketscience/jackcess/jackcess/4.0.1/jackcess-4.0.1.jar"
  "org/jsoup/jsoup/1.15.3/jsoup-1.15.3.jar"
  "commons-codec/commons-codec/1.16.0/commons-codec-1.16.0.jar"
  "org/apache/commons/commons-collections4/4.4/commons-collections4-4.4.jar"
  # 注意：必须是 2.16.1。POI 5.3.0 的 POM 声明 commons-io:2.16.1，
  # 低版本（2.15.1）缺 BoundedInputStream.builder() → 读 .mpp 时 NoSuchMethodError。
  "commons-io/commons-io/2.16.1/commons-io-2.16.1.jar"
  "org/apache/commons/commons-math3/3.6.1/commons-math3-3.6.1.jar"
  "org/apache/commons/commons-compress/1.24.0/commons-compress-1.24.0.jar"
  "org/apache/logging/log4j/log4j-api/2.22.0/log4j-api-2.22.0.jar"
  # 必需：只有 log4j-api 而无 log4j-core 时，Log4j2 回退 SimpleLogger 并刷 StatusLogger 告警。
  # 补上 core 后，配合同目录 log4j2.xml（status="OFF" / root level="off"）彻底静音，
  # 保证 stdout 只有中间 JSON（server/mppImport.ts 直接 JSON.parse stdout）。
  "org/apache/logging/log4j/log4j-core/2.22.0/log4j-core-2.22.0.jar"
  "com/zaxxer/SparseBitSet/1.3/SparseBitSet-1.3.jar"
  "com/github/virtuald/curvesapi/1.07/curvesapi-1.07.jar"
  "org/glassfish/jaxb/jaxb-core/3.0.2/jaxb-core-3.0.2.jar"
  "org/glassfish/jaxb/txw2/3.0.2/txw2-3.0.2.jar"
  "com/sun/istack/istack-commons-runtime/4.1.1/istack-commons-runtime-4.1.1.jar"
  "org/eclipse/angus/angus-activation/1.0.0/angus-activation-1.0.0.jar"
  "jakarta/annotation/jakarta.annotation-api/2.1.1/jakarta.annotation-api-2.1.1.jar"
  "jakarta/inject/jakarta.inject-api/2.0.1/jakarta.inject-api-2.0.1.jar"
  "org/apache/commons/commons-lang3/3.14.0/commons-lang3-3.14.0.jar"
  "commons-logging/commons-logging/1.2/commons-logging-1.2.jar"
  "org/slf4j/slf4j-api/2.0.9/slf4j-api-2.0.9.jar"
)

echo "== 下载 MPXJ 依赖到 $LIB =="
fail=0
for p in "${JARS[@]}"; do
  name="$(basename "$p")"
  if [ -s "$LIB/$name" ]; then
    echo "  skip  $name"
    continue
  fi
  if curl -sfL --max-time 90 "$MVN/$p" -o "$LIB/$name.part"; then
    mv "$LIB/$name.part" "$LIB/$name"
    echo "  ok    $name"
  else
    rm -f "$LIB/$name.part"
    echo "  FAIL  $name"
    fail=$((fail + 1))
  fi
done

if [ "$fail" -gt 0 ]; then
  echo "!! $fail 个 jar 下载失败（多为可选依赖，可重试本脚本）"
fi

echo "== 编译 MppImport.java =="
if ! command -v javac >/dev/null 2>&1; then
  echo "!! 未找到 javac，请先安装 JDK（>=11）。导入功能将保持禁用（路由返回 501）。"
  exit 1
fi

CP="$DIR:$LIB/*"
if javac -encoding UTF-8 -nowarn -cp "$CP" -d "$DIR" "$DIR/MppImport.java"; then
  echo "== 完成 =="
  echo "  产物: $DIR/MppImport.class"
  echo "  自检: java -cp \"$CP\" MppImport <file.mpp>"
else
  echo "!! 编译失败，导入功能将保持禁用（路由返回 501）。"
  exit 1
fi
