<#
.SYNOPSIS
    为 plan-gantt（Windows 共享盘部署包）启用 MPP 导入能力。

.DESCRIPTION
    默认部署包是「零依赖」的：不含 server/mpxj/，导入按钮返回 501。
    本脚本按需补齐运行时，装完重启服务即可使用 .mpp/.mpx/.xml 导入。

    为什么 JRE 装在本地盘而不是共享盘：
      公司共享盘可能屏蔽/拦截 .exe，且从网络盘加载 37MB jar 会显著拖慢首次导入。

    为什么不需要 JDK（javac）：
      MppImport.class 是平台无关的 Java 字节码，已在开发机编译好并随包分发，
      Windows 端只需要 JRE 来「运行」它。

.PARAMETER LocalLibs
    把 MPXJ 依赖 jar 也装到本地盘（%LOCALAPPDATA%\plan-gantt\mpxj）而非共享盘
    server\mpxj\lib。共享盘加载 jar 慢时可用此开关；脚本会自动设置
    PLAN_GANTT_MPXJ_DIR 用户级环境变量指向它。

.PARAMETER Force
    已存在同名产物时仍重新下载覆盖。

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\enable-mpp-import.ps1
#>
[CmdletBinding()]
param(
    [switch]$LocalLibs,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
# 老版本 PowerShell 5.1 默认 TLS 1.0，GitHub/Maven 要求 TLS 1.2
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

# 脚本位于 <项目根>\server\mpxj\，项目根是上两级
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $ProjectRoot 'server\mpxj\MppImport.java'))) {
    # 兜底：脚本被单独拷贝到别处时，退化为「脚本所在目录即项目根」
    if (Test-Path (Join-Path $PSScriptRoot 'server\mpxj\MppImport.java')) {
        $ProjectRoot = $PSScriptRoot
    } else {
        Write-Warning "未能定位项目根（当前推导：$ProjectRoot）。请从部署包内的 server\mpxj 目录运行本脚本。"
    }
}
$MpxjSrc = Join-Path $ProjectRoot 'server\mpxj'

$MvnBase   = 'https://repo1.maven.org/maven2'
$JreDir    = Join-Path $env:LOCALAPPDATA 'plan-gantt\jre'
$LocalMpxj = Join-Path $env:LOCALAPPDATA 'plan-gantt\mpxj'
$Offline   = Join-Path $ProjectRoot 'offline-mpp-runtime'

function Write-Step { param($msg) Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok   { param($msg) Write-Host "    $msg" -ForegroundColor Green }
function Write-Warn2{ param($msg) Write-Host "    $msg" -ForegroundColor Yellow }

# ---------------------------------------------------------------- 1. Java
Write-Step '检查 Java 运行环境'

function Get-JavaExe {
    $cmd = Get-Command java -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $portable = Join-Path $JreDir 'bin\java.exe'
    if (Test-Path $portable) { return $portable }
    return $null
}

function Test-JavaVersionOk {
    param($javaExe)
    try {
        $out = & $javaExe -version 2>&1 | Out-String
        # "openjdk version \"17.0.x\"" / "java version \"1.8.0_xxx\""
        if ($out -match 'version "(\d+)') {
            $major = [int]$Matches[1]
            if ($major -eq 1) {
                return $out -match '1\.8'   # 旧式版本号：仅 1.8 可用
            }
            return $major -ge 11
        }
        return $false
    } catch { return $false }
}

$java = Get-JavaExe
if ($java -and (Test-JavaVersionOk $java)) {
    Write-Ok "已存在可用 Java（>=11）：$java"
    $skipJre = $true
} else {
    if ($java) { Write-Warn2 "检测到 Java 但版本过低（需 >=11）：$java" }
    Write-Warn2 '未找到可用 Java，将安装便携 JRE'
    $skipJre = $false
}

if (-not $skipJre) {
    Write-Step '安装便携 JRE 到本地盘'

    if ((Test-Path (Join-Path $JreDir 'bin\java.exe')) -and -not $Force) {
        Write-Ok "便携 JRE 已存在：$JreDir"
    } else {
        $jreZip = Join-Path $Offline 'OpenJDK17U-jre_x64_windows_hotspot.zip'
        $tempZip = Join-Path $env:TEMP 'plan-gantt-jre.zip'

        if (Test-Path $jreZip) {
            Write-Ok "使用离线包：$jreZip"
            Copy-Item $jreZip $tempZip -Force
        } else {
            # 优先从 Adoptium API 解析最新版本，失败则回退到固定版本 URL
            $url = 'https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.20.1%2B1/OpenJDK17U-jre_x64_windows_hotspot_17.0.20.1_1.zip'
            try {
                $api = 'https://api.adoptium.net/v3/assets/latest/17/hotspot?architecture=x64&image_type=jre&os=windows&vendor=eclipse'
                $resp = Invoke-RestMethod -Uri $api -TimeoutSec 30
                $link = $resp[0].binary.package.link
                if ($link) { $url = $link }
            } catch {
                Write-Warn2 "版本解析失败，回退到固定版本：$($_.Exception.Message)"
            }
            Write-Host "    下载 JRE（约 42MB，首次较慢）..." -ForegroundColor Gray
            Write-Host "    $url" -ForegroundColor DarkGray
            Invoke-WebRequest -Uri $url -OutFile $tempZip -TimeoutSec 900
        }

        $extractRoot = Join-Path $env:TEMP 'plan-gantt-jre-extract'
        if (Test-Path $extractRoot) { Remove-Item $extractRoot -Recurse -Force }
        Expand-Archive -Path $tempZip -DestinationPath $extractRoot -Force

        # Adoptium zip 内是一层 jdk-17.x.x+x-jre 目录，取里面的内容作为 JRE 根
        $inner = Get-ChildItem $extractRoot -Directory | Select-Object -First 1
        if (-not $inner) { throw 'JRE 压缩包结构异常：未找到内层目录' }

        if (Test-Path $JreDir) { Remove-Item $JreDir -Recurse -Force }
        New-Item -ItemType Directory -Path (Split-Path $JreDir -Parent) -Force | Out-Null
        Move-Item $inner.FullName $JreDir -Force

        Remove-Item $tempZip -Force -ErrorAction SilentlyContinue
        Remove-Item $extractRoot -Recurse -Force -ErrorAction SilentlyContinue
        Write-Ok "便携 JRE 已安装到：$JreDir"
    }

    $java = Join-Path $JreDir 'bin\java.exe'
    if (-not (Test-JavaVersionOk $java)) { throw "便携 JRE 安装后仍不可用：$java" }
}

# ---------------------------------------------------------- 2. MPXJ 依赖
Write-Step '准备 MPXJ 依赖（jar）'

if ($LocalLibs) {
    $mpxjDir = $LocalMpxj
    Write-Host "    依赖落点（本地盘）：$mpxjDir" -ForegroundColor Gray
} else {
    $mpxjDir = Join-Path $ProjectRoot 'server\mpxj'
    Write-Host "    依赖落点（共享盘）：$mpxjDir" -ForegroundColor Gray
}
$libDir = Join-Path $mpxjDir 'lib'
New-Item -ItemType Directory -Path $libDir -Force | Out-Null

# 与 server/mpxj/fetch-mpxj.sh 保持一致的清单（顺序无关）
$Jars = @(
    'net/sf/mpxj/mpxj/13.5.0/mpxj-13.5.0.jar'
    'org/apache/poi/poi/5.3.0/poi-5.3.0.jar'
    'org/apache/poi/poi-ooxml/5.3.0/poi-ooxml-5.3.0.jar'
    'org/apache/poi/poi-ooxml-lite/5.3.0/poi-ooxml-lite-5.3.0.jar'
    'org/xerial/sqlite-jdbc/3.42.0.0/sqlite-jdbc-3.42.0.0.jar'
    'com/jgoodies/jgoodies-binding/2.13.0/jgoodies-binding-2.13.0.jar'
    # groupId 必须是 com.github.joniles；.mpp 的任务备注是 RTF，靠它解析
    'com/github/joniles/rtfparserkit/1.16.0/rtfparserkit-1.16.0.jar'
    'jakarta/xml/bind/jakarta.xml.bind-api/3.0.1/jakarta.xml.bind-api-3.0.1.jar'
    'jakarta/activation/jakarta.activation-api/2.1.2/jakarta.activation-api-2.1.2.jar'
    'org/glassfish/jaxb/jaxb-runtime/3.0.2/jaxb-runtime-3.0.2.jar'
    'com/healthmarketscience/jackcess/jackcess/4.0.1/jackcess-4.0.1.jar'
    'org/jsoup/jsoup/1.15.3/jsoup-1.15.3.jar'
    'commons-codec/commons-codec/1.16.0/commons-codec-1.16.0.jar'
    'org/apache/commons/commons-collections4/4.4/commons-collections4-4.4.jar'
    # 必须是 2.16.1：POI 5.3.0 的 POM 声明此版本，低版本缺 BoundedInputStream.builder()
    'commons-io/commons-io/2.16.1/commons-io-2.16.1.jar'
    'org/apache/commons/commons-math3/3.6.1/commons-math3-3.6.1.jar'
    'org/apache/commons/commons-compress/1.24.0/commons-compress-1.24.0.jar'
    'org/apache/logging/log4j/log4j-api/2.22.0/log4j-api-2.22.0.jar'
    # 必须有 core：只有 api 时 Log4j2 会向控制台刷 StatusLogger，污染 stdout 破坏 JSON 解析
    'org/apache/logging/log4j/log4j-core/2.22.0/log4j-core-2.22.0.jar'
    'com/zaxxer/SparseBitSet/1.3/SparseBitSet-1.3.jar'
    'com/github/virtuald/curvesapi/1.07/curvesapi-1.07.jar'
    'org/glassfish/jaxb/jaxb-core/3.0.2/jaxb-core-3.0.2.jar'
    'org/glassfish/jaxb/txw2/3.0.2/txw2-3.0.2.jar'
    'com/sun/istack/istack-commons-runtime/4.1.1/istack-commons-runtime-4.1.1.jar'
    'org/eclipse/angus/angus-activation/1.0.0/angus-activation-1.0.0.jar'
    'jakarta/annotation/jakarta.annotation-api/2.1.1/jakarta.annotation-api-2.1.1.jar'
    'jakarta/inject/jakarta.inject-api/2.0.1/jakarta.inject-api-2.0.1.jar'
    'org/apache/commons/commons-lang3/3.14.0/commons-lang3-3.14.0.jar'
    'commons-logging/commons-logging/1.2/commons-logging-1.2.jar'
    'org/slf4j/slf4j-api/2.0.9/slf4j-api-2.0.9.jar'
)

# 过时版本会让新旧两版共存于 classpath，行为随机 —— 先清掉已知的历史错版
Get-ChildItem $libDir -Filter 'commons-io-2.15.1.jar' -ErrorAction SilentlyContinue |
    ForEach-Object { Write-Warn2 "移除过时依赖 $($_.Name)"; Remove-Item $_.FullName -Force }

$offlineLibs = Join-Path $Offline 'mpxj-libs.zip'
if (Test-Path $offlineLibs) {
    Write-Ok "使用离线包：$offlineLibs"
    $tmpExtract = Join-Path $env:TEMP 'plan-gantt-mpxj-libs'
    if (Test-Path $tmpExtract) { Remove-Item $tmpExtract -Recurse -Force }
    Expand-Archive -Path $offlineLibs -DestinationPath $tmpExtract -Force
    Copy-Item (Join-Path $tmpExtract '*') $libDir -Recurse -Force
    Remove-Item $tmpExtract -Recurse -Force -ErrorAction SilentlyContinue
} else {
    $i = 0
    foreach ($rel in $Jars) {
        $i++
        $name = Split-Path $rel -Leaf
        $dest = Join-Path $libDir $name
        if ((Test-Path $dest) -and -not $Force) {
            Write-Host "    [$i/$($Jars.Count)] skip  $name" -ForegroundColor DarkGray
            continue
        }
        Write-Host "    [$i/$($Jars.Count)] 下载 $name"
        try {
            Invoke-WebRequest -Uri "$MvnBase/$rel" -OutFile $dest -TimeoutSec 300
        } catch {
            Write-Warn2 "下载失败：$name —— $($_.Exception.Message)"
        }
    }
}

# ------------------------------------------------- 3. 桥接产物（预编译）
Write-Step '部署桥接产物（预编译的 .class，无需 javac）'

foreach ($f in @('MppImport.class', 'MppImport.java', 'log4j2.xml')) {
    $src = Join-Path $MpxjSrc $f
    $dst = Join-Path $mpxjDir $f
    if (-not (Test-Path $src)) {
        Write-Warn2 "未找到 $src（$f 缺失，导入将不可用）"
        continue
    }
    # 非 -LocalLibs 时源目录就是目标目录，源=目标的 Copy-Item 会报错，直接视为已就位
    if ($src -eq $dst) {
        Write-Ok "已就位 $f"
        continue
    }
    try {
        Copy-Item $src $dst -Force -ErrorAction Stop
        Write-Ok "已部署 $f"
    } catch {
        Write-Warn2 "部署 $f 失败：$($_.Exception.Message)"
    }
}

$classFile = Join-Path $mpxjDir 'MppImport.class'
if (-not (Test-Path $classFile)) {
    throw "桥接产物缺失：$classFile。请确认部署包中包含该文件。"
}

# --------------------------------------------------- 4. 本地库时的环境变量
if ($LocalLibs) {
    Write-Step '写入用户级环境变量 PLAN_GANTT_MPXJ_DIR'
    [Environment]::SetEnvironmentVariable('PLAN_GANTT_MPXJ_DIR', $mpxjDir, 'User')
    $env:PLAN_GANTT_MPXJ_DIR = $mpxjDir
    Write-Ok "已设置 PLAN_GANTT_MPXJ_DIR = $mpxjDir"
}

# ------------------------------------------------------------- 5. 自检
Write-Step '自检：调用桥接读取测试计划'

# 一个最小 MSPDI XML，用于验证 Java 桥接 → JSON 输出全链路
$sampleXml = Join-Path $env:TEMP 'plan-gantt-mpp-selftest.xml'
@'
<?xml version="1.0" encoding="UTF-8"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <Title>plan-gantt 自检</Title>
  <Tasks>
    <Task><UID>1</UID><Name>自检任务 A</Name><Start>2026-01-01T00:00:00</Start><Finish>2026-01-03T00:00:00</Finish></Task>
    <Task><UID>2</UID><Name>自检任务 B</Name><Start>2026-01-06T00:00:00</Start><Finish>2026-01-10T00:00:00</Finish><PredecessorLink><PredecessorUID>1</PredecessorUID><Type>1</Type></PredecessorLink></Task>
  </Tasks>
</Project>
'@ | Set-Content -Path $sampleXml -Encoding UTF8

$cp = "$mpxjDir;$libDir\*"
# stderr 落到临时文件（不能丢 $null——自检失败时它是唯一线索），只在失败时回显
$errFile = Join-Path $env:TEMP 'plan-gantt-mpp-selftest.err'
$raw = & $java -cp $cp MppImport $sampleXml 2>$errFile
Remove-Item $sampleXml -Force -ErrorAction SilentlyContinue

if ($LASTEXITCODE -eq 0 -and $raw) {
    $json = ($raw | Out-String).Trim()
    if ($json -match '自检任务 A' -and $json -match '自检任务 B') {
        Write-Ok '桥接自检通过（Java → 中间 JSON 正常）'
    } else {
        $preview = $json.Substring(0, [Math]::Min(200, $json.Length))
        Write-Warn2 "桥接有输出但内容异常：$preview"
    }
} else {
    Write-Warn2 "桥接自检未通过（退出码 $LASTEXITCODE）。stderr 如下："
    if (Test-Path $errFile) {
        $errText = (Get-Content $errFile -Raw -ErrorAction SilentlyContinue)
        if ($errText) { Write-Host $errText -ForegroundColor DarkGray }
    }
    Remove-Item $errFile -Force -ErrorAction SilentlyContinue
}

Write-Host @"

================================================================
 MPP 导入运行时已就绪

   Java    : $java
   桥接目录: $mpxjDir

 下一步：重启 plan-gantt 服务（关掉原窗口，重新双击 start-plan-gantt.bat
 或 start-windows.bat），导入按钮即可使用。
 若仍提示「未启用」，请确认启动服务的终端能读到 PLAN_GANTT_MPXJ_DIR。
================================================================
"@ -ForegroundColor Green
