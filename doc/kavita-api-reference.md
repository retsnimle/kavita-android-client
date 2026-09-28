# Kavita 官方原生 REST API 端點全景參考與客戶端對齊規範

本文件基於本地運行之 Kavita 伺服器核心二進位組件（`Kavita.Server.dll`）的 .NET Metadata 與 XML 註釋文件進行全量逆向分析與審查，旨在為行動端客戶端（`kavita-android-client`）提供 100% 權威準確的 API 路由、HTTP 動詞及參數對照標準。

---

## 一、 核心 Controller 端點與路由對照表

Kavita 後端採用 ASP.NET Core 架構，統一路由前綴為 `/api/[controller]`。

### 1. `SeriesController`（作品與系列管理）
前綴路由：`/api/Series/`

| 動作方法 | HTTP 動詞 | 官方路由 | 請求參數 / Body | 說明與用途 |
| :--- | :--- | :--- | :--- | :--- |
| `GetAllSeriesV2` | `POST` | `all-v2` | Query: `libraryId`, `pageNumber`, `pageSize`<br>Body: `SeriesFilterV2Dto` | **主要書目獲取端點**。必須帶入 `FilterField.Library = 19` 進行精準書庫隔離。 |
| `GetSeriesForLibraryV2` | `POST` | `v2` | Query: `pageNumber`, `pageSize`<br>Body: `SeriesFilterV2Dto` | 次級備用系列獲取端點。 |
| `GetVolumes` | `GET` | `volumes` | Query: `seriesId` (`int`) | **獲取作品下所有卷冊與章節層級結構**（含章節頁數、檔案資訊）。 |
| `GetSeries` | `GET` | `{seriesId:int}` | Path: `seriesId` (`int`) | 獲取單一作品系列之實體詳情。 |
| `GetSeriesDetailBreakdown` | `GET` | `series-detail` | Query: `seriesId` (`int`) | 獲取系列詳情頁面的綜合統計與標籤資料。 |
| `GetRecentlyAddedV2` | `POST` | `recently-added-v2` | Query: `pageNumber`, `pageSize`<br>Body: `SeriesFilterV2Dto` | 取得近期新增的作品。 |
| `GetOnDeck` | `POST` | `on-deck` | Query: `pageNumber`, `pageSize`<br>Body: `SeriesFilterV2Dto` | 取得正在閱讀/待讀進度的系列。 |

---

### 2. `ReaderController`（閱讀器引擎與進度）
前綴路由：`/api/Reader/`

| 動作方法 | HTTP 動詞 | 官方路由 | 請求參數 / Body | 說明與用途 |
| :--- | :--- | :--- | :--- | :--- |
| `GetImage` | `GET` | `image` | Query: `chapterId` (`int`), `page` (`int`), `apiKey` (`string`), `extractPdf` (`bool`) | **單頁漫畫/圖片串流獲取端點**。 |
| `GetChapterInfo` | `GET` | `chapter-info` | Query: `chapterId` (`int`), `extractPdf` (`bool`), `isRereading` (`bool`) | **章節閱讀資訊**（總頁數、尺寸等）。具有在伺服器端快取該話圖片之副作用。 |
| `GetProgress` | `GET` | `progress` | Query: `chapterId` (`int`) | 取得目前登入使用者在指定章節的已讀頁數。 |
| `SaveProgress` | `POST` | `progress` | Body: `ProgressDto`<br>(`volumeId`, `chapterId`, `pageNum`, `seriesId`, `libraryId`) | **提交閱讀進度**。行動端離線重連時對齊的主要接口。 |
| `GetContinuePoint` | `GET` | `continue-point` | Query: `seriesId` (`int`) | 取得該作品應繼續閱讀的章節錨點。 |
| `GetNextChapter` | `GET` | `next-chapter` | Query: `seriesId`, `volumeId`, `currentChapterId` | 由伺服器計算並回傳下一邏輯章節。 |
| `GetPreviousChapter` | `GET` | `prev-chapter` | Query: `seriesId`, `volumeId`, `currentChapterId` | 由伺服器計算並回傳上一邏輯章節。 |
| `MarkChapterAsRead` | `POST` | `mark-chapter-read` | Body: `MarkChapterReadDto` | 手動標記單一章節為已讀。 |
| `MarkRead` | `POST` | `mark-read` | Body: `MarkReadDto` | 手動標記整部系列為已讀。 |

---

### 3. `ImageController`（封面與圖資）
前綴路由：`/api/Image/`

> ⚠️ **重要參數避坑**：所有封面端點之 ID 參數均為完整駝峰命名（如 `chapterId`），**嚴禁使用通用的 `id`**。

| 動作方法 | HTTP 動詞 | 官方路由 | 請求參數 | 說明與用途 |
| :--- | :--- | :--- | :--- | :--- |
| `GetSeriesCoverImage` | `GET` | `series-cover` | Query: `seriesId` (`int`), `apiKey` (`string`) | 作品系列封面圖。 |
| `GetVolumeCoverImage` | `GET` | `volume-cover` | Query: `volumeId` (`int`), `apiKey` (`string`) | 單卷封面圖。 |
| `GetChapterCoverImage` | `GET` | `chapter-cover` | Query: `chapterId` (`int`), `apiKey` (`string`) | 單話封面圖（**參數為 `chapterId`**）。 |
| `GetLibraryCoverImage` | `GET` | `library-cover` | Query: `libraryId` (`int`), `apiKey` (`string`) | 書庫圖示/封面。 |

---

### 4. `DownloadController`（檔案下載與沙盒快取）
前綴路由：`/api/Download/`

> ⚠️ **重要參數避坑**：下載章節（`DownloadChapter`）之參數為 `chapterId`，傳入錯誤的 `id` 將導致 ASP.NET Core 模型綁定失敗。

| 動作方法 | HTTP 動詞 | 官方路由 | 請求參數 | 說明與用途 |
| :--- | :--- | :--- | :--- | :--- |
| `DownloadChapter` | `GET` | `chapter` | Query: `chapterId` (`int`), `correlationId` (`string`) | **下載單話檔案**（EPUB 原檔或 CBZ/ZIP 壓縮檔）。 |
| `DownloadVolume` | `GET` | `volume` | Query: `volumeId` (`int`), `correlationId` (`string`) | 下載整卷漫畫壓縮包。 |
| `GetChapterSize` | `GET` | `chapter-size` | Query: `chapterId` (`int`) | 預先查詢該話實體檔案大小（位元組）。 |
| `GetVolumeSize` | `GET` | `volume-size` | Query: `volumeId` (`int`) | 預先查詢整卷實體檔案大小。 |

---

### 5. `LibraryController`（書庫與系統管理）
前綴路由：`/api/Library/`

| 動作方法 | HTTP 動詞 | 官方路由 | 請求參數 / Body | 說明與用途 |
| :--- | :--- | :--- | :--- | :--- |
| `GetLibraries` | `GET` | `libraries` | 無 | 取得伺服器上所有可訪問之書庫清單（含類型：0: Manga, 1: Comic, 2: Book）。 |
| `Scan` | `POST` | `scan` | Query: `libraryId` (`int`), `force` (`bool`) | 觸發指定書庫的目錄掃描與重新索引。 |
| `ScanAll` | `POST` | `scan-all` | Query: `force` (`bool`) | 觸發伺服器全量書庫掃描。 |

---

### 6. `AccountController` & `PluginController`（身分驗證）
前綴路由：`/api/Account/` 與 `/api/Plugin/`

| 動作方法 | HTTP 動詞 | 官方路由 | 請求參數 / Body | 說明與用途 |
| :--- | :--- | :--- | :--- | :--- |
| `Login` | `POST` | `/api/Account/login` | Body: `{ username, password }` | 傳統帳號密碼登入，回傳 JWT Token 與使用者喜好設定。 |
| `Authenticate` | `POST` | `/api/Plugin/authenticate` | Query: `apiKey` (`string`), `pluginName` (`string`) | **API Key 免密驗證**，專為外掛與行動獨立客戶端設計。 |

---

## 二、 客戶端修復記錄與規範檢查表

在本次對齊審查中，我們定位並消除了以下不符合官方規範的實作隱患：

| 模組 | 原有寫法 | 修正後標準官方寫法 | 影響性 |
| :--- | :--- | :--- | :--- |
| `kavitaClient.getSeriesVolumes` | `/api/Series/series-detail` (未提供卷冊陣列) | `GET /api/Series/volumes?seriesId={id}` | **高**：點入作品後無法取得各卷各話。 |
| `kavitaClient.getSeriesForLibrary` | `statements: []` (空過濾條件) | `statements: [{ comparison: 0, field: 19, value: libraryId }]` | **高**：各書庫（自烤漫畫 vs 電子書）作品混在一起。 |
| `kavitaClient.getChapterCoverUrl` | `/api/Image/chapter-cover?id={chapterId}` | `/api/Image/chapter-cover?chapterId={chapterId}` | **中**：章節封面請求無法被後端識別。 |
| `kavitaClient.fetchChapterEpubBlob` | `/api/Download/chapter?id={chapterId}` | `/api/Download/chapter?chapterId={chapterId}` | **中**：EPUB 下載至 Android 沙盒時失敗。 |

本文件歸檔於 `G:\CODE\kavita-android-client\doc\kavita-api-reference.md`，作為後續功能擴充之權威規範。
