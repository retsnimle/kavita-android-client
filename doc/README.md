# Kavita Android Client 技術文檔索引 (Documentation Index)

本目錄彙整 **Kavita Android Client** 的核心架構設計、API 介面參考與自動化發布指南。

---

## 📚 文檔列表

### 1. [EPUB 雙軌架構規格書 (EPUB Dual-Track Architecture)](epub-dual-track-architecture.md)
- **核心內容**：
  - 線上模式 vs. 離線模式雙軌核心思想
  - 線上模式：按需抓取單章 HTML（零整書下載、毫秒級秒開、省流量）
  - 離線模式：沙盒整本下載、本地 JSZip 解壓、斷網可用
  - 排版效能防禦：廢除阻塞全量 `img.decode()`，採三階段漸進測量機制（50ms / 200ms / 450ms）
  - 進度回報防禦：恢復定位鎖定機制，防止資料庫進度被首頁誤覆寫。

### 2. [APK 編譯與發布指南 (Build Guide)](build-guide.md)
- **核心內容**：
  - 容器化編譯環境架構（WSL 2 + Docker `cirruslabs/android-sdk:34` + Gradle Volume 快取）
  - 一鍵編譯腳本 `build-apk.ps1` 與流程詳解
  - 避免 Gradle 假性成功 `UP-TO-DATE` 之關鍵規範（`clean assembleDebug`）
  - Windows 檔案鎖定釋放與產物拷貝流程
  - 實機無線 ADB 偵錯與 Chrome DevTools WebView 遠端除錯 SOP。

### 3. [Kavita 官方 API 參考手冊 (Kavita API Reference)](kavita-api-reference.md)
- **核心內容**：
  - 認證、書庫、系列、進度同步等全量 REST API 端點詳細規格
  - 官方書籍串流核心端點：`GET /api/book/{chapterId}/chapters` 與 `GET /api/book/{chapterId}/book-page?page={page}`。
