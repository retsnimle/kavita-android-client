# Kavita Android 客戶端一鍵編譯腳本
$ErrorActionPreference = "Stop"

Write-Host "=== 1. 編譯 Web 前端資產 ===" -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Error "前端 TypeScript/Vite 編譯失敗，中止打包。"
    exit 1
}

Write-Host "`n=== 2. 同步資產至 Android 原生工程 ===" -ForegroundColor Cyan
npx cap sync android
if ($LASTEXITCODE -ne 0) {
    Write-Error "cap sync 失敗，中止打包。"
    exit 1
}

Write-Host "`n=== 3. 透過 Docker 容器執行 Gradle 編譯 (使用永久快取卷) ===" -ForegroundColor Cyan
# 使用 Docker Named Volume (kavita-gradle-cache) 永久儲存 Gradle 與依賴，下次 0 秒載入
wsl -d Ubuntu-24.04 docker run --rm `
  -v kavita-gradle-cache:/root/.gradle `
  -v /mnt/g/CODE/kavita-android-client:/workspace `
  -w /workspace/android `
  ghcr.io/cirruslabs/android-sdk:34 `
  bash -c "chmod +x ./gradlew && ./gradlew clean assembleDebug --no-daemon"

$sourceApk = "G:\CODE\kavita-android-client\android\app\build\outputs\apk\debug\app-debug.apk"
$targetDir = "E:\PERSONAL\code"
$targetApk = Join-Path $targetDir "kavita-reader-app.apk"

if (Test-Path $sourceApk) {
    if (-not (Test-Path $targetDir)) {
        New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
    }
    if (Test-Path $targetApk) {
        Remove-Item -Path $targetApk -Force -ErrorAction SilentlyContinue
    }
    Copy-Item -Path $sourceApk -Destination $targetApk -Force
    $size = (Get-Item $targetApk).Length / 1MB
    Write-Host "`n[SUCCESS] APK 編譯成功！" -ForegroundColor Green
    Write-Host "輸出檔案: $targetApk" -ForegroundColor Green
    Write-Host "檔案大小: $([Math]::Round($size, 2)) MB" -ForegroundColor Green
} else {
    Write-Error "找不到編譯產出的 APK！"
}
