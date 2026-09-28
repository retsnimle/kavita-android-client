# Kavita 官方原生 REST API 全景手冊與整合規範

> **規格版本**：Kavita `0.9.1.6` (官方 OpenAPI 3.0 規範深度審查)
> **生成時間**：2026-09-28
> **適用對象**：`kavita-android-client` 行動客戶端開發、外掛模組與伺服器聯調

---

## 一、 全局架構與通信約定 (Architecture & Conventions)

Kavita 後端採用 **ASP.NET Core** 架構，對外暴露標準 RESTful JSON 與二進位串流 API。

### 1. 基礎路徑與端點前綴
- 伺服器端點統一前綴為：`http(s)://<host>:<port>/api/[Controller]/[Action]`
- 大多數 Controller 採用方法名直接作為路由，例如 `/api/Reader/get-progress`、`/api/Series/volumes`。

### 2. 雙軌身分認證 (Authentication)
Kavita 支援兩種認證機制：
1. **API Key（Auth Key）模式**：
   - 在使用者設定頁面生成 API Key。
   - 在 HTTP 標頭帶入：`x-api-key: <your_api_key>`。
   - 或者透過 `/api/Plugin/authenticate?apiKey=<key>&pluginName=<name>` 交換短期 JWT Token。
2. **JWT Bearer Token 模式**：
   - 登入（`/api/Account/login`）或 Plugin 認證後獲取 Token。
   - 於所有後續請求標頭帶入：`Authorization: Bearer <jwt_token>`。

### 3. 關鍵避坑規範（必讀）
- **進度讀取與儲存端點不同**：
  - **讀取進度**：`GET /api/Reader/get-progress?chapterId={id}`（回傳 `ProgressDto`）。注意是 `get-progress`，若調用 `progress` 會收到 **404**！
  - **提交進度**：`POST /api/Reader/progress`（Body 為 `ProgressDto`）。
- **UTC 時間戳時區問題**：
  - 伺服器回傳的 `lastModifiedUtc`（如 `"2026-09-24T10:34:59.7695774"`）未附帶 `Z` 標記。在 JavaScript / TypeScript 中使用 `new Date()` 解析時，若未手動補上 `Z`，會被瀏覽器當成本地時區處理（在 UTC+8 區相當於時間倒退 8 小時），造成客戶端誤判伺服器進度過舊！
- **參數名稱命名陷阱**：
  - 封面端點必須使用嚴格的 `chapterId` / `volumeId` / `seriesId`（例如 `/api/Image/chapter-cover?chapterId=123`），使用通用的 `id` 會導致伺服器無法綁定參數而回傳空圖或預設圖。
  - 下載端點亦同：`/api/Download/chapter?chapterId=123`。

---

## 二、 客戶端核心 Controller 詳解 (Core Client Controllers)

### AccountController (帳號與偏好管理)
使用者登入、註冊、個人閱讀偏好（年齡分級、直排/橫排偏好）、API Key 管理。

**端點總數**：28 個 | **前綴**：`/api/Account/`

| HTTP | 路由端點 | 請求參數 (Query / Path) | Request Body | 回傳結構 (200) | 功能說明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/Account` | 無 | 無 | `UserDto` | Returns the current user, as it would from login |
| `DELETE` | `/api/Account/auth-key` | `authKeyId` (query: integer (int32)) | 無 | void | Delete the Auth Key |
| `GET` | `/api/Account/auth-keys` | 無 | 無 | `array` | Returns all Auth Keys with the account |
| `POST` | `/api/Account/clear-oidc-link` | 無 | 無 | void | Remove the OIDC link for the authenticated user. This action will also remove the authentication cookie. The caller should take note and redirect to login if no other authentication is currently present (I.e. JWT) |
| `POST` | `/api/Account/confirm-email` | 無 | `ConfirmEmailDto` | `UserDto` | Last step in authentication flow, confirms the email token for email |
| `POST` | `/api/Account/confirm-email-update` | 無 | `ConfirmEmailUpdateDto` | void | Final step in email update change. Given a confirmation token and the email, this will finish the email change. |
| `POST` | `/api/Account/confirm-migration-email` | 無 | `ConfirmMigrationEmailDto` | `UserDto` | - |
| `POST` | `/api/Account/confirm-password-reset` | 無 | `ConfirmPasswordResetDto` | `string` | - |
| `POST` | `/api/Account/create-auth-key` | 無 | `RotateAuthKeyRequestDto` | `AuthKeyDto` | Creates a new Auth Key for a user. |
| `GET` | `/api/Account/email-confirmed` | 無 | 無 | `boolean` | - |
| `POST` | `/api/Account/forgot-password` | `email` (query: string) | 無 | `string` | Will send user a link to update their password to their email or prompt them if not accessible |
| `POST` | `/api/Account/invite` | 無 | `InviteUserDto` | `string` | Invites a user to the server. Will generate a setup link for continuing setup. If email is not setup, a link will be presented to user to continue setup. |
| `GET` | `/api/Account/invite-url` | `userId` (query: integer (int32))<br>`withBaseUrl` (query: boolean) | 無 | `string` | Requests the Invite Url for the AppUserId. Will return error if user is already validated. |
| `GET` | `/api/Account/is-email-valid` | 無 | 無 | `boolean` | Is the user's current email valid or not |
| `POST` | `/api/Account/login` | 無 | `LoginDto` | `UserDto` | Perform a login. Will send JWT Token of the logged in user back. |
| `GET` | `/api/Account/oidc-authenticated` | 無 | 無 | `boolean` | Returns true if OIDC authentication cookies are present and the Kavita.Server.Extensions.IdentityServiceExtensions.OpenIdConnect scheme has been registered |
| `GET` | `/api/Account/opds-url` | `authKeyName` (query: string) | 無 | `string` | Returns the OPDS url for this user |
| `GET` | `/api/Account/refresh-account` | 無 | 無 | `UserDto` | Returns an up-to-date user account |
| `POST` | `/api/Account/refresh-token` | 無 | `TokenRequestDto` | `TokenRequestDto` | Refreshes the user's JWT token |
| `POST` | `/api/Account/register` | 無 | `RegisterDto` | `UserDto` | Register the first user (admin) on the server. Will not do anything if an admin is already confirmed |
| `POST` | `/api/Account/resend-confirmation-email` | `userId` (query: integer (int32)) | 無 | `InviteUserResponse` | Resend an invite to a user already invited |
| `POST` | `/api/Account/reset-password` | 無 | `ResetPasswordDto` | void | Update a user's password |
| `GET` | `/api/Account/roles` | 無 | 無 | `array` | Get All Roles back. See Kavita.Models.Constants.PolicyConstants |
| `POST` | `/api/Account/rotate-auth-key` | `authKeyId` (query: integer (int32)) | `RotateAuthKeyRequestDto` | `AuthKeyDto` | Rotate the Auth Key |
| `POST` | `/api/Account/update` | 無 | `UpdateUserDto` | void | Update the user account. This can only affect Username, Email (will require confirming), Roles, and Library access. |
| `POST` | `/api/Account/update/age-restriction` | 無 | `UpdateAgeRestrictionDto` | void | Change the Age Rating restriction for the user |
| `POST` | `/api/Account/update/email` | 無 | `UpdateEmailDto` | `InviteUserResponse` | Initiates the flow to update a user's email address.              If email is not setup, then the email address is not changed in this API. A confirmation link is sent/dumped which will validate the email. It must be confirmed for the email to update. |
| `POST` | `/api/Account/update/username` | 無 | `UpdateUsernameRequestDto` | `InviteUserResponse` | Initiates the flow to update a user's username. |

---

### PluginController (外掛免密認證)
專為第三方客戶端與自動化代理提供之 API Key 免密驗證通道。

**端點總數**：5 個 | **前綴**：`/api/Plugin/`

| HTTP | 路由端點 | 請求參數 (Query / Path) | Request Body | 回傳結構 (200) | 功能說明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/Plugin/authenticate` | `apiKey*` (query: string)<br>`pluginName*` (query: string) | 無 | `UserDto` | Authenticate with the Server given an auth key. This will log you in by returning the user object and the JWT token. |
| `GET` | `/api/Plugin/authkey-expires` | 無 | 無 | `AuthKeyExpiresAtDto` | Returns the expiration (UTC) of the authenticated Auth key (or null if none set) |
| `GET` | `/api/Plugin/parse` | `name` (query: string)<br>`libraryType` (query: LibraryType) | 無 | `ParseResultDto` | Parse a string and return Parsed information from it. Does not support any directory fallback parsing |
| `POST` | `/api/Plugin/parse-bulk` | 無 | `ParseBulkRequestDto` | `ParseBulkResponseDto` | - |
| `GET` | `/api/Plugin/version` | `apiKey*` (query: string) | 無 | `string` | Returns the version of the Kavita install |

---

### LibraryController (書庫管理與索引)
獲取使用者可見書庫列表、觸發目錄掃描（scan/scan-all）。

**端點總數**：23 個 | **前綴**：`/api/Library/`

| HTTP | 路由端點 | 請求參數 (Query / Path) | Request Body | 回傳結構 (200) | 功能說明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/Library` | `libraryId` (query: integer (int32)) | 無 | `LibraryDto` | Return a specific library |
| `POST` | `/api/Library/copy-settings-from` | 無 | `CopySettingsFromLibraryDto` | void | Copy the library settings (adv tab + optional type) to a set of other libraries. |
| `POST` | `/api/Library/create` | 無 | `UpdateLibraryDto` | `LibraryDto` | Creates a new Library. Upon library creation, adds new library to all Admin accounts. |
| `DELETE` | `/api/Library/delete` | `libraryId` (query: integer (int32)) | 無 | `boolean` | Deletes the library and all series within it. |
| `DELETE` | `/api/Library/delete-multiple` | 無 | `array` | void | Deletes multiple libraries and all series within it. |
| `POST` | `/api/Library/grant-access` | 無 | `UpdateLibraryForUserDto` | `MemberDto` | Grants a user account access to a Library |
| `POST` | `/api/Library/has-files-at-root` | 無 | `CheckForFilesInFolderRootsDto` | `array` | For each root, checks if there are any supported files at root to warn the user during library creation about an invalid setup |
| `GET` | `/api/Library/jump-bar` | `libraryId` (query: integer (int32)) | 無 | `array` | For a given library, generate the jump bar information |
| `GET` | `/api/Library/libraries` | 無 | 無 | `array` | Return all libraries in the Server |
| `GET` | `/api/Library/list` | `path` (query: string) | 無 | `array` | Returns a list of directories for a given path. If path is empty, returns root drives. |
| `GET` | `/api/Library/metadata-enabled-libraries` | 無 | 無 | `array` | Kavita.Models.Entities.Enums.LibraryType with KavitaPlus metadata support |
| `GET` | `/api/Library/metadata-providers` | `libraryType` (query: LibraryType) | 無 | `array` | Return all Kavita.Models.Entities.Enums.MetadataProviders that are supported by the given Kavita.Models.Entities.Enums.LibraryType"/> |
| `GET` | `/api/Library/name-exists` | `name` (query: string) | 無 | `boolean` | Checks if the library name exists or not |
| `POST` | `/api/Library/refresh-metadata` | `libraryId` (query: integer (int32))<br>`force` (query: boolean)<br>`forceColorscape` (query: boolean) | 無 | void | - |
| `POST` | `/api/Library/refresh-metadata-multiple` | `forceColorscape` (query: boolean) | `BulkActionDto` | void | - |
| `POST` | `/api/Library/scan` | `libraryId` (query: integer (int32))<br>`force` (query: boolean) | 無 | void | Scans a given library for file changes. |
| `POST` | `/api/Library/scan-all` | `force` (query: boolean) | 無 | void | Scans a given library for file changes. If another scan task is in progress, will reschedule the invocation for 3 hours in future. |
| `POST` | `/api/Library/scan-folder` | 無 | `ScanFolderDto` | void | Given a valid path, will invoke either a Scan Series or Scan Library. If the folder does not exist within Kavita, the request will be ignored |
| `POST` | `/api/Library/scan-multiple` | 無 | `BulkActionDto` | void | Enqueues a bunch of library scans |
| `GET` | `/api/Library/scrobble-enabled-libraries` | 無 | 無 | `array` | Kavita.Models.Entities.Enums.LibraryType with KavitaPlus scrobble support |
| `GET` | `/api/Library/type` | `libraryId` (query: integer (int32)) | 無 | `LibraryType` | Returns the type of the underlying library |
| `POST` | `/api/Library/update` | 無 | `UpdateLibraryDto` | void | Updates an existing Library with new name, folders, and/or type. |
| `GET` | `/api/Library/user-libraries` | `userId` (query: integer (int32)) | 無 | `array` | Gets libraries for the given user that you also have access to |

---

### SeriesController (作品與系列管理)
負責書目列表獲取（all-v2）、卷冊階層獲取（volumes）、系列詳情與篩選。

**端點總數**：33 個 | **前綴**：`/api/Series/`

| HTTP | 路由端點 | 請求參數 (Query / Path) | Request Body | 回傳結構 (200) | 功能說明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/Series/age-rating` | `ageRating` (query: integer (int32)) | 無 | `string` | Get the age rating for the Kavita.Models.Entities.Enums.AgeRating enum value |
| `GET` | `/api/Series/all-related` | `seriesId` (query: integer (int32)) | 無 | `RelatedSeriesDto` | Returns all related series against the passed series Id |
| `POST` | `/api/Series/all-v2` | `PageNumber` (query: integer (int32))<br>`PageSize` (query: integer (int32))<br>`userId` (query: integer (int32))<br>`context` (query: QueryContext) | `SeriesFilterV2Dto` | `array` | Returns all series for the library |
| `POST` | `/api/Series/analyze` | 無 | `RefreshSeriesDto` | void | Run a file analysis on the series. |
| `GET` | `/api/Series/chapter` | `chapterId` (query: integer (int32)) | 無 | `ChapterDto` | Returns a single Chapter with progress information |
| `GET` | `/api/Series/currently-reading` | `PageNumber` (query: integer (int32))<br>`PageSize` (query: integer (int32))<br>`userId` (query: integer (int32)) | 無 | `array` | Get series a user is currently reading, requires the user to share their profile |
| `POST` | `/api/Series/delete-multiple` | 無 | `DeleteSeriesDto` | void | Deletes multiple series from Kavita at once |
| `POST` | `/api/Series/dont-match` | `seriesId` (query: integer (int32))<br>`dontMatch` (query: boolean) | 無 | void | When true, will not perform a match and will prevent Kavita from attempting to match/scrobble against this series |
| `GET` | `/api/Series/external-series-detail` | `seriesId` (query: integer (int32))<br>`aniListId` (query: integer (int32))<br>`malId` (query: integer (int64))<br>`mangaBakaId` (query: integer (int32))<br>`hardcoverId` (query: integer (int32))<br>`recommendedSeriesId` (query: integer (int32)) | 無 | `ExternalSeriesDetailDto` | Returns external series metadata around a Given External Series |
| `POST` | `/api/Series/match` | 無 | `MatchSeriesDto` | `MatchSeriesResultDto` | Sends a request to Kavita+ API for all potential matches, sorted by relevance |
| `GET` | `/api/Series/match-info` | `seriesId` (query: integer (int32)) | 無 | `MatchSeriesInfoDto` | Returns extra information around an existing match (and series) to display on the Match Screen. |
| `GET` | `/api/Series/metadata` | `seriesId` (query: integer (int32)) | 無 | `SeriesMetadataDto` | Returns metadata for a given series |
| `POST` | `/api/Series/metadata` | 無 | `UpdateSeriesMetadataDto` | void | Update series metadata |
| `GET` | `/api/Series/next-expected` | `seriesId` (query: integer (int32)) | 無 | `NextExpectedChapterDto` | Based on the delta times between when chapters are added, for series that are not Completed/Cancelled/Hiatus, forecast the next date when it will be available. |
| `POST` | `/api/Series/on-deck` | `PageNumber` (query: integer (int32))<br>`PageSize` (query: integer (int32))<br>`libraryId` (query: integer (int32)) | 無 | `array` | Fetches series that are on deck aka have progress on them. |
| `POST` | `/api/Series/recently-added-v2` | `PageNumber` (query: integer (int32))<br>`PageSize` (query: integer (int32)) | `SeriesFilterV2Dto` | `array` | Gets all recently added series |
| `POST` | `/api/Series/recently-updated-series` | `PageNumber` (query: integer (int32))<br>`PageSize` (query: integer (int32)) | 無 | `array` | Returns series that were recently updated, like adding or removing a chapter |
| `POST` | `/api/Series/refresh-metadata` | 無 | `RefreshSeriesDto` | void | Runs a Cover Image Generation task |
| `GET` | `/api/Series/related` | `seriesId` (query: integer (int32))<br>`relation` (query: RelationKind) | 無 | `array` | Fetches the related series for a given series |
| `POST` | `/api/Series/remove-from-on-deck` | `seriesId` (query: integer (int32)) | 無 | void | Removes a series from displaying on deck until the next read event on that series |
| `POST` | `/api/Series/scan` | 無 | `RefreshSeriesDto` | void | Scan a series and force each file to be updated. This should be invoked via the User, hence why we force. |
| `GET` | `/api/Series/series-by-collection` | `collectionId` (query: integer (int32))<br>`PageNumber` (query: integer (int32))<br>`PageSize` (query: integer (int32)) | 無 | `array` | Returns all Series grouped by the passed Collection Id with Pagination. |
| `POST` | `/api/Series/series-by-ids` | 無 | `SeriesByIdsDto` | `array` | Fetches Series for a set of Ids. This will check User for permission access and filter out any Ids that don't exist or the user does not have access to. |
| `GET` | `/api/Series/series-detail` | `seriesId` (query: integer (int32)) | 無 | `SeriesDetailDto` | Get a special DTO for Series Detail page. |
| `GET` | `/api/Series/series-with-annotations` | 無 | 無 | `array` | Returns all Series that a user has access to |
| `POST` | `/api/Series/update` | 無 | `UpdateSeriesDto` | `SeriesDto` | Updates the Series |
| `POST` | `/api/Series/update-match` | `seriesId` (query: integer (int32))<br>`provider` (query: MetadataProvider) | `ExternalMetadataIdsDto` | void | This will perform the fix match |
| `POST` | `/api/Series/update-related` | 無 | `UpdateRelatedSeriesDto` | void | Update the relations attached to the Series. Does not generate associated Sequel/Prequel pairs on target series. |
| `POST` | `/api/Series/v2` | `PageNumber` (query: integer (int32))<br>`PageSize` (query: integer (int32)) | `SeriesFilterV2Dto` | `array` | Gets series with the applied Filter |
| `GET` | `/api/Series/volume` | `volumeId` (query: integer (int32)) | 無 | `VolumeDto` | Returns a single Volume with progress information and Chapters |
| `GET` | `/api/Series/volumes` | `seriesId` (query: integer (int32)) | 無 | `array` | Returns All volumes for a series with progress information and Chapters |
| `DELETE` | `/api/Series/{seriesId}` | `seriesId*` (path: integer (int32)) | 無 | `boolean` | Deletes a series from Kavita |
| `GET` | `/api/Series/{seriesId}` | `seriesId*` (path: integer (int32)) | 無 | `SeriesDto` | Fetches a Series for a given Id |

---

### VolumeController (卷冊管理)
卷冊層級之元資料、閱讀進度狀態與卷冊操作。

**端點總數**：4 個 | **前綴**：`/api/Volume/`

| HTTP | 路由端點 | 請求參數 (Query / Path) | Request Body | 回傳結構 (200) | 功能說明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `DELETE` | `/api/Volume` | `volumeId` (query: integer (int32)) | 無 | `boolean` | Delete the Volume from the DB |
| `GET` | `/api/Volume` | `volumeId` (query: integer (int32)) | 無 | `VolumeDto` | Returns the appropriate Volume |
| `POST` | `/api/Volume/multiple` | 無 | `array` | `boolean` | Delete multiple Volumes from the DB |
| `POST` | `/api/Volume/update` | 無 | `UpdateVolumeDto` | `VolumeDto` | Updates the information on the Volume |

---

### ChapterController (章節管理)
單一章節實體資訊與操作。

**端點總數**：5 個 | **前綴**：`/api/Chapter/`

| HTTP | 路由端點 | 請求參數 (Query / Path) | Request Body | 回傳結構 (200) | 功能說明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `DELETE` | `/api/Chapter` | `chapterId` (query: integer (int32)) | 無 | `boolean` | Removes a Chapter |
| `GET` | `/api/Chapter` | `chapterId` (query: integer (int32)) | 無 | `ChapterDto` | Gets a single chapter |
| `GET` | `/api/Chapter/chapter-detail-plus` | `chapterId` (query: integer (int32)) | 無 | `ChapterDetailPlusDto` | Returns Ratings and Reviews for an individual Chapter |
| `POST` | `/api/Chapter/delete-multiple` | `seriesId` (query: integer (int32)) | `DeleteChaptersDto` | `boolean` | Deletes multiple chapters and any volumes with no leftover chapters |
| `POST` | `/api/Chapter/update` | 無 | `UpdateChapterDto` | `ChapterDto` | Update chapter metadata |

---

### ReaderController (閱讀器核心與進度對齊)
負責漫畫/圖檔串流讀取、EPUB 分頁與進度對齊（get-progress/progress）、書籤管理與章節導航。

**端點總數**：39 個 | **前綴**：`/api/Reader/`

| HTTP | 路由端點 | 請求參數 (Query / Path) | Request Body | 回傳結構 (200) | 功能說明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/Reader/all-bookmarks` | 無 | `SeriesFilterV2Dto` | `array` | Returns a list of all bookmarked pages for a User |
| `POST` | `/api/Reader/bookmark` | 無 | `BookmarkDto` | void | Bookmarks a page against a Chapter |
| `GET` | `/api/Reader/bookmark-image` | `seriesId` (query: integer (int32))<br>`apiKey` (query: string)<br>`page` (query: integer (int32)) | 無 | void | Returns an image for a given bookmark series. Side effect: This will cache the bookmark images for reading. |
| `GET` | `/api/Reader/bookmark-info` | `seriesId` (query: integer (int32))<br>`includeDimensions` (query: boolean) | 無 | `BookmarkInfoDto` | Returns various information about all bookmark files for a Series. Side effect: This will cache the bookmark images for reading. |
| `POST` | `/api/Reader/bulk-remove-bookmarks` | 無 | `BulkRemoveBookmarkForSeriesDto` | void | Removes all bookmarks for all chapters linked to a Series |
| `GET` | `/api/Reader/chapter-bookmarks` | `chapterId` (query: integer (int32)) | 無 | `array` | Returns a list of bookmarked pages for a given Chapter |
| `GET` | `/api/Reader/chapter-info` | `chapterId` (query: integer (int32))<br>`extractPdf` (query: boolean)<br>`includeDimensions` (query: boolean) | 無 | `ChapterInfoDto` | Returns various information about a Chapter. Side effect: This will cache the chapter images for reading. |
| `GET` | `/api/Reader/continue-point` | `seriesId` (query: integer (int32)) | 無 | `ChapterDto` | Continue point is the chapter which you should start reading again from. If there is no progress on a series, then the first chapter will be returned (non-special unless only specials). Otherwise, loop through the chapters and volumes in order to find the next chapter which has progress. |
| `POST` | `/api/Reader/create-ptoc` | 無 | `CreatePersonalToCDto` | void | Create a new personal table of content entry for a given chapter |
| `GET` | `/api/Reader/file-dimensions` | `chapterId` (query: integer (int32))<br>`extractPdf` (query: boolean) | 無 | `array` | Returns the file dimensions for all pages in a chapter. If the underlying chapter is PDF, use extractPDF to unpack as images. |
| `GET` | `/api/Reader/first-progress-date` | `userId` (query: integer (int32)) | 無 | `string (date-time)` | - |
| `GET` | `/api/Reader/get-progress` | `chapterId` (query: integer (int32)) | 無 | `ProgressDto` | Returns Progress (page number) for a chapter for the logged in user |
| `GET` | `/api/Reader/has-progress` | `seriesId` (query: integer (int32)) | 無 | `boolean` | Returns if the user has reading progress on the Series |
| `GET` | `/api/Reader/image` | `chapterId` (query: integer (int32))<br>`page` (query: integer (int32))<br>`apiKey` (query: string)<br>`extractPdf` (query: boolean) | 無 | void | Returns an image for a given chapter. Will perform bounding checks |
| `POST` | `/api/Reader/mark-chapter-read` | 無 | `MarkChapterReadDto` | void | Mark a single chapter as read |
| `POST` | `/api/Reader/mark-multiple-read` | 無 | `MarkVolumesReadDto` | void | Marks all chapters within a list of volumes as Read. All volumes must belong to the same Series. |
| `POST` | `/api/Reader/mark-multiple-series-read` | 無 | `MarkMultipleSeriesAsReadDto` | void | Marks all chapters within a list of series as Read. |
| `POST` | `/api/Reader/mark-multiple-series-unread` | 無 | `MarkMultipleSeriesAsReadDto` | void | Marks all chapters within a list of series as Unread. |
| `POST` | `/api/Reader/mark-multiple-unread` | 無 | `MarkVolumesReadDto` | void | Marks all chapters within a list of volumes as Unread. All volumes must belong to the same Series. |
| `POST` | `/api/Reader/mark-read` | 無 | `MarkReadDto` | void | Marks a Series as read. All volumes and chapters will be marked as read during this process. |
| `POST` | `/api/Reader/mark-unread` | 無 | `MarkReadDto` | void | Marks a Series as Unread. All volumes and chapters will be marked as unread during this process. |
| `POST` | `/api/Reader/mark-volume-read` | 無 | `MarkVolumeReadDto` | void | Marks all chapters within a volume as Read |
| `POST` | `/api/Reader/mark-volume-unread` | 無 | `MarkVolumeReadDto` | void | Marks all chapters within a volume as unread |
| `GET` | `/api/Reader/next-chapter` | `seriesId` (query: integer (int32))<br>`volumeId` (query: integer (int32))<br>`currentChapterId` (query: integer (int32)) | 無 | `integer (int32)` | Returns the next logical chapter from the series. |
| `GET` | `/api/Reader/pdf` | `chapterId` (query: integer (int32))<br>`apiKey` (query: string)<br>`extractPdf` (query: boolean) | 無 | void | Returns the PDF for the chapterId. |
| `GET` | `/api/Reader/prev-chapter` | `seriesId` (query: integer (int32))<br>`volumeId` (query: integer (int32))<br>`currentChapterId` (query: integer (int32)) | 無 | `integer (int32)` | Returns the previous logical chapter from the series. |
| `POST` | `/api/Reader/progress` | 無 | `ProgressDto` | void | Save page against Chapter for authenticated user |
| `GET` | `/api/Reader/prompt-reread/chapter` | `libraryId` (query: integer (int32))<br>`seriesId` (query: integer (int32))<br>`chapterId` (query: integer (int32)) | 無 | `RereadDto` | Check if we should prompt the user for rereads for the given chapter |
| `GET` | `/api/Reader/prompt-reread/series` | `seriesId` (query: integer (int32))<br>`libraryId` (query: integer (int32)) | 無 | `RereadDto` | Check if we should prompt the user for rereads for the given series |
| `GET` | `/api/Reader/prompt-reread/volume` | `libraryId` (query: integer (int32))<br>`seriesId` (query: integer (int32))<br>`volumeId` (query: integer (int32)) | 無 | `RereadDto` | Check if we should prompt the user for rereads for the given volume |
| `DELETE` | `/api/Reader/ptoc` | `chapterId` (query: integer (int32))<br>`pageNum` (query: integer (int32))<br>`title` (query: string) | 無 | void | Deletes the user's personal table of content for the given chapter |
| `GET` | `/api/Reader/ptoc` | `chapterId` (query: integer (int32)) | 無 | `array` | Returns the user's personal table of contents for the given chapter |
| `POST` | `/api/Reader/remove-bookmarks` | 無 | `RemoveBookmarkForSeriesDto` | void | Removes all bookmarks for all chapters linked to a Series |
| `GET` | `/api/Reader/series-bookmarks` | `seriesId` (query: integer (int32)) | 無 | `array` | Returns all bookmarked pages for a given series |
| `GET` | `/api/Reader/thumbnail` | `chapterId` (query: integer (int32))<br>`pageNum` (query: integer (int32))<br>`apiKey` (query: string) | 無 | void | Returns a thumbnail for the given page number |
| `GET` | `/api/Reader/time-left` | `seriesId` (query: integer (int32)) | 無 | `HourEstimateRangeDto` | For the current user, returns an estimate on how long it would take to finish reading the series. |
| `GET` | `/api/Reader/time-left-for-chapter` | `seriesId` (query: integer (int32))<br>`chapterId` (query: integer (int32)) | 無 | `HourEstimateRangeDto` | For the current user, returns an estimate on how long it would take to finish reading the chapter. |
| `POST` | `/api/Reader/unbookmark` | 無 | `BookmarkDto` | void | Removes a bookmarked page for a Chapter |
| `GET` | `/api/Reader/volume-bookmarks` | `volumeId` (query: integer (int32)) | 無 | `array` | Returns all bookmarked pages for a given volume |

---

### BookController (電子書/EPUB 專屬擴充)
提供 EPUB 原生目錄架構（TOC）、書籍章節與章節導航。

**端點總數**：4 個 | **前綴**：`/api/Book/`

| HTTP | 路由端點 | 請求參數 (Query / Path) | Request Body | 回傳結構 (200) | 功能說明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/Book/{chapterId}/book-info` | `chapterId*` (path: integer (int32)) | 無 | `BookInfoDto` | Retrieves information for the PDF and Epub reader. This will cache the file. |
| `GET` | `/api/Book/{chapterId}/book-page` | `chapterId*` (path: integer (int32))<br>`page` (query: integer (int32)) | 無 | `string` | This returns a single page within the epub book. All html will be rewritten to be scoped within our reader, all css is scoped, etc. |
| `GET` | `/api/Book/{chapterId}/book-resources` | `chapterId*` (path: integer (int32))<br>`file` (query: string) | 無 | void | This is an entry point to fetch resources from within an epub chapter/book. |
| `GET` | `/api/Book/{chapterId}/chapters` | `chapterId*` (path: integer (int32)) | 無 | `array` | This will return a list of mappings from ID -> page num. ID will be the xhtml key and page num will be the reading order this is used to rewrite anchors in the book text so that we always load properly in our reader. |

---

### ImageController (圖資與封面串流)
負責系列、卷冊、話次、書庫封面圖產出，支援高度與尺寸縮放快取。

**端點總數**：15 個 | **前綴**：`/api/Image/`

| HTTP | 路由端點 | 請求參數 (Query / Path) | Request Body | 回傳結構 (200) | 功能說明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/Image/bookmark` | `chapterId` (query: integer (int32))<br>`pageNum` (query: integer (int32))<br>`imageOffset` (query: integer (int32)) | 無 | void | Returns image for a given bookmark page |
| `GET` | `/api/Image/chapter-cover` | `chapterId` (query: integer (int32)) | 無 | void | Returns cover image for Chapter |
| `GET` | `/api/Image/collection-cover` | `collectionTagId` (query: integer (int32)) | 無 | void | Returns cover image for Collection |
| `GET` | `/api/Image/cover-upload` | `filename` (query: string) | 無 | void | Returns a temp coverupload image |
| `GET` | `/api/Image/external/chapter` | `seriesId` (query: integer (int32))<br>`chapterId` (query: integer (int32)) | 無 | `array` | - |
| `GET` | `/api/Image/external/series` | `seriesId` (query: integer (int32)) | 無 | `array` | - |
| `GET` | `/api/Image/external/volume` | `seriesId` (query: integer (int32))<br>`volumeId` (query: integer (int32)) | 無 | `array` | - |
| `GET` | `/api/Image/library-cover` | `libraryId` (query: integer (int32)) | 無 | void | Returns cover image for Library |
| `GET` | `/api/Image/person-cover` | `personId` (query: integer (int32)) | 無 | void | Returns cover image for Person |
| `GET` | `/api/Image/publisher` | `publisherName` (query: string) | 無 | void | Returns the image associated with a publisher |
| `GET` | `/api/Image/readinglist-cover` | `readingListId` (query: integer (int32)) | 無 | void | Returns cover image for a Reading List |
| `GET` | `/api/Image/series-cover` | `seriesId` (query: integer (int32)) | 無 | void | Returns cover image for Series |
| `GET` | `/api/Image/user-cover` | `userId` (query: integer (int32)) | 無 | void | Returns cover image for User |
| `GET` | `/api/Image/volume-cover` | `volumeId` (query: integer (int32)) | 無 | void | Returns cover image for Volume |
| `GET` | `/api/Image/web-link` | `url` (query: string) | 無 | void | Returns the image associated with a web-link |

---

### DownloadController (檔案下載與沙盒同步)
提供 EPUB、CBZ 原檔下載、整卷壓縮包下載與檔案大小預先查詢。

**端點總數**：12 個 | **前綴**：`/api/Download/`

| HTTP | 路由端點 | 請求參數 (Query / Path) | Request Body | 回傳結構 (200) | 功能說明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/Download/bookmarks` | 無 | `DownloadBookmarkDto` | void | Downloads all bookmarks in a zip for |
| `POST` | `/api/Download/bulk-chapter-size` | 無 | `BulkChapterSizeRequest` | `object` | For a set of chapters, return the size in bytes |
| `POST` | `/api/Download/bulk-readinglist-size` | 無 | `BulkReadingListSizeRequest` | `object` | Returns the mapping of readinglist -> size |
| `POST` | `/api/Download/bulk-series-size` | 無 | `BulkSeriesSizeRequest` | `object` | For a set of series, return the size in bytes |
| `POST` | `/api/Download/bulk-volume-size` | 無 | `BulkVolumeSizeRequest` | `object` | For a set of volumes, return the size in bytes |
| `GET` | `/api/Download/chapter` | `chapterId` (query: integer (int32))<br>`correlationId` (query: string) | 無 | void | Returns the zip for a single chapter. If the chapter contains multiple files, they will be zipped. |
| `GET` | `/api/Download/chapter-size` | `chapterId` (query: integer (int32)) | 無 | `integer (int64)` | For a given chapter, return the size in bytes |
| `GET` | `/api/Download/readinglist-size` | `readingListId` (query: integer (int32)) | 無 | `integer (int64)` | Returns the filesize for all items of a reading list that the requesting user has access to |
| `GET` | `/api/Download/series` | `seriesId` (query: integer (int32))<br>`correlationId` (query: string) | 無 | void | - |
| `GET` | `/api/Download/series-size` | `seriesId` (query: integer (int32)) | 無 | `integer (int64)` | For a series, return the size in bytes |
| `GET` | `/api/Download/volume` | `volumeId` (query: integer (int32))<br>`correlationId` (query: string) | 無 | void | Downloads all chapters within a volume. If the chapters are multiple zips, they will all be zipped up. |
| `GET` | `/api/Download/volume-size` | `volumeId` (query: integer (int32)) | 無 | `integer (int64)` | For a given volume, return the size in bytes |

---

### SearchController (全域搜尋引擎)
支援系列、作者、章節之即時關鍵字模糊檢索。

**端點總數**：4 個 | **前綴**：`/api/Search/`

| HTTP | 路由端點 | 請求參數 (Query / Path) | Request Body | 回傳結構 (200) | 功能說明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/Search/chapters-by-series` | `seriesId` (query: integer (int32)) | 無 | `array` | Returns all chapters for a given series with localized titles. Used for CBL chapter-level matching. |
| `GET` | `/api/Search/search` | `queryString` (query: string)<br>`includeChapterAndFiles` (query: boolean) | 無 | `SearchResultGroupDto` | Searches against different entities in the system against a query string |
| `GET` | `/api/Search/series-for-chapter` | `chapterId` (query: integer (int32)) | 無 | `SeriesDto` | Returns the series for the Chapter id. If the user does not have access (shouldn't happen by the UI), then null is returned |
| `GET` | `/api/Search/series-for-mangafile` | `mangaFileId` (query: integer (int32)) | 無 | `SeriesDto` | Returns the series for the MangaFile id. If the user does not have access (shouldn't happen by the UI), then null is returned |

---

## 三、 擴充功能 Controller 彙整 (Extended Features)

### FilterController (Filter)
**端點總數**：12 個 | **前綴**：`/api/Filter/`

| HTTP | 路由端點 | 請求參數 (Query / Path) | Request Body | 回傳結構 (200) | 功能說明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `DELETE` | `/api/Filter` | `filterId` (query: integer (int32)) | 無 | void | Delete the smart filter for the authenticated user |
| `GET` | `/api/Filter` | 無 | 無 | `array` | All Smart Filters for the authenticated user |
| `POST` | `/api/Filter/decode` | 無 | `DecodeFilterDto` | `IFilterDto` | Decodes the Filter |
| `POST` | `/api/Filter/encode/annotation` | 無 | `AnnotationFilterDto` | `string` | Encode an Annotation Filter |
| `POST` | `/api/Filter/encode/person` | 無 | `PersonFilterDto` | `string` | Encode a Person Filter |
| `POST` | `/api/Filter/encode/reading-list` | 無 | `ReadingListFilterDto` | `string` | Encode a Reading List filter |
| `POST` | `/api/Filter/encode/series` | 無 | `SeriesFilterV2Dto` | `string` | Encode a Series filter |
| `POST` | `/api/Filter/rename` | `filterId` (query: integer (int32))<br>`name*` (query: string) | 無 | void | Rename a Smart Filter given the filterId and new name |
| `POST` | `/api/Filter/update/annotation` | 無 | `AnnotationFilterDto` | void | Creates or Updates the Reading List filter |
| `POST` | `/api/Filter/update/person` | 無 | `PersonFilterDto` | void | Creates or Updates the Person filter |
| `POST` | `/api/Filter/update/reading-list` | 無 | `ReadingListFilterDto` | void | Creates or Updates the Reading List filter |
| `POST` | `/api/Filter/update/series` | 無 | `SeriesFilterV2Dto` | void | Creates or Updates the Series filter |

---

### CollectionController (Collection)
**端點總數**：12 個 | **前綴**：`/api/Collection/`

| HTTP | 路由端點 | 請求參數 (Query / Path) | Request Body | 回傳結構 (200) | 功能說明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `DELETE` | `/api/Collection` | `tagId` (query: integer (int32)) | 無 | void | Removes the collection tag from the user |
| `GET` | `/api/Collection` | `ownedOnly` (query: boolean)<br>`sortByLastModified` (query: boolean) | 無 | `array` | Returns all Collection tags for a given User |
| `GET` | `/api/Collection/all-series` | `seriesId` (query: integer (int32))<br>`ownedOnly` (query: boolean) | 無 | `array` | Returns all collections that contain the Series for the user with the option to allow for promoted collections (non-user owned) |
| `POST` | `/api/Collection/delete-multiple` | 無 | `DeleteCollectionsDto` | void | Delete multiple collections in one go |
| `POST` | `/api/Collection/import-stack` | 無 | `MalStackDto` | void | Imports a MAL Stack into Kavita |
| `GET` | `/api/Collection/mal-stacks` | 無 | 無 | `array` | For the authenticated user, if they have an active Kavita+ subscription and a MAL username on record, fetch their Mal interest stacks (including restacks) |
| `GET` | `/api/Collection/name-exists` | `name` (query: string) | 無 | `boolean` | Checks if a collection exists with the name |
| `POST` | `/api/Collection/promote-multiple` | 無 | `PromoteCollectionsDto` | void | Promote/UnPromote multiple collections in one go. Will only update the authenticated user's collections and will only work if the user has promotion role |
| `GET` | `/api/Collection/single` | `collectionId` (query: integer (int32)) | 無 | `AppUserCollectionDto` | Returns a single Collection tag by Id for a given user |
| `POST` | `/api/Collection/update` | 無 | `AppUserCollectionDto` | `AppUserCollectionDto` | Updates an existing tag with a new title, promotion status, and summary. <remarks>UI does not contain controls to update title</remarks> |
| `POST` | `/api/Collection/update-for-series` | 無 | `CollectionTagBulkAddDto` | void | Adds multiple series to a collection. If tag id is 0, this will create a new tag. |
| `POST` | `/api/Collection/update-series` | 無 | `UpdateSeriesForTagDto` | void | For a given tag, update the summary if summary has changed and remove a set of series from the tag. |

---

### ReadingListController (ReadingList)
**端點總數**：27 個 | **前綴**：`/api/ReadingList/`

| HTTP | 路由端點 | 請求參數 (Query / Path) | Request Body | 回傳結構 (200) | 功能說明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `DELETE` | `/api/ReadingList` | `readingListId` (query: integer (int32)) | 無 | void | Deletes a reading list |
| `GET` | `/api/ReadingList` | `readingListId` (query: integer (int32)) | 無 | `ReadingListDto` | Fetches a single Reading List |
| `POST` | `/api/ReadingList/all` | `PageNumber` (query: integer (int32))<br>`PageSize` (query: integer (int32)) | `ReadingListFilterDto` | `array` | Returns reading lists (paginated) for a given user. |
| `GET` | `/api/ReadingList/all-people` | `readingListId` (query: integer (int32)) | 無 | `array` | Returns all people in given roles for a reading list |
| `POST` | `/api/ReadingList/create` | 無 | `CreateReadingListDto` | `ReadingListDto` | Creates a new List with a unique title. Returns the new ReadingList back |
| `POST` | `/api/ReadingList/delete-item` | 無 | `UpdateReadingListPosition` | void | Deletes a list item from the list. Item orders will update as a result. |
| `POST` | `/api/ReadingList/delete-multiple` | 無 | `DeleteReadingListsDto` | void | Delete multiple reading lists in one go |
| `POST` | `/api/ReadingList/export-as-cbl` | `readingListId` (query: integer (int32))<br>`asV2` (query: boolean) | 無 | void | Export a Reading List to CBL format |
| `GET` | `/api/ReadingList/info` | `readingListId` (query: integer (int32)) | 無 | `ReadingListInfoDto` | Returns random information about a Reading List |
| `GET` | `/api/ReadingList/items` | `readingListId` (query: integer (int32)) | 無 | `array` | Fetches all reading list items for a given list including rich metadata around series, volume, chapters, and progress |
| `POST` | `/api/ReadingList/lists` | `PageNumber` (query: integer (int32))<br>`PageSize` (query: integer (int32))<br>`includePromoted` (query: boolean)<br>`sortByLastModified` (query: boolean) | 無 | `array` | Returns reading lists (paginated) for a given user. |
| `GET` | `/api/ReadingList/lists-for-chapter` | `chapterId` (query: integer (int32)) | 無 | `array` | Returns all Reading Lists the user has access to that has the given chapter within it. |
| `GET` | `/api/ReadingList/lists-for-series` | `seriesId` (query: integer (int32)) | 無 | `array` | Returns all Reading Lists the user has access to that the given series within it. |
| `GET` | `/api/ReadingList/name-exists` | `name` (query: string) | 無 | `boolean` | Checks if a reading list exists with the name |
| `GET` | `/api/ReadingList/next-chapter` | `currentChapterId` (query: integer (int32))<br>`readingListId` (query: integer (int32)) | 無 | `integer (int32)` | Returns the next chapter within the reading list |
| `GET` | `/api/ReadingList/people` | `readingListId` (query: integer (int32))<br>`role` (query: PersonRole) | 無 | `array` | Returns a list of a given role associated with the reading list |
| `GET` | `/api/ReadingList/prev-chapter` | `currentChapterId` (query: integer (int32))<br>`readingListId` (query: integer (int32)) | 無 | `integer (int32)` | Returns the prev chapter within the reading list |
| `POST` | `/api/ReadingList/promote-multiple` | 無 | `PromoteReadingListsDto` | void | Promote/UnPromote multiple reading lists in one go. Will only update the authenticated user's reading lists and will only work if the user has promotion role |
| `POST` | `/api/ReadingList/regenerate-cover` | `readingListId` (query: integer (int32)) | 無 | void | Regenerates the cover image for a reading list, you must own the given reading list to do this |
| `POST` | `/api/ReadingList/remove-read` | `readingListId` (query: integer (int32)) | 無 | void | Removes all entries that are fully read from the reading list |
| `POST` | `/api/ReadingList/update` | 無 | `UpdateReadingListDto` | `ReadingListDto` | Update the properties (title, summary) of a reading list |
| `POST` | `/api/ReadingList/update-by-chapter` | 無 | `UpdateReadingListByChapterDto` | void | - |
| `POST` | `/api/ReadingList/update-by-multiple` | 無 | `UpdateReadingListByMultipleDto` | void | Adds all chapters from a list of volumes and chapters to a reading list |
| `POST` | `/api/ReadingList/update-by-multiple-series` | 無 | `UpdateReadingListByMultipleSeriesDto` | void | Adds all chapters from a list of series to a reading list |
| `POST` | `/api/ReadingList/update-by-series` | 無 | `UpdateReadingListBySeriesDto` | void | Adds all chapters from a Series to a reading list |
| `POST` | `/api/ReadingList/update-by-volume` | 無 | `UpdateReadingListByVolumeDto` | void | - |
| `POST` | `/api/ReadingList/update-position` | 無 | `UpdateReadingListPosition` | void | Updates an items position |

---

### ReadingProfileController (ReadingProfile)
**端點總數**：16 個 | **前綴**：`/api/ReadingProfile/`

| HTTP | 路由端點 | 請求參數 (Query / Path) | Request Body | 回傳結構 (200) | 功能說明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `DELETE` | `/api/reading-profile` | `profileId` (query: integer (int32)) | 無 | void | Deletes the given profile, requires the profile to belong to the logged-in user |
| `POST` | `/api/reading-profile` | 無 | `UserReadingProfileDto` | `UserReadingProfileDto` | Updates the given reading profile, must belong to the current user |
| `GET` | `/api/reading-profile/all` | 無 | 無 | `array` | Gets all non-implicit reading profiles for a user |
| `POST` | `/api/reading-profile/bulk` | 無 | `BulkSetSeriesProfiles` | void | Assigns the reading profile to all passes series, and deletes their implicit profiles |
| `POST` | `/api/reading-profile/create` | 無 | `UserReadingProfileDto` | `UserReadingProfileDto` | Creates a new reading profile for the current user |
| `GET` | `/api/reading-profile/library` | `libraryId` (query: integer (int32)) | 無 | `array` | Returns all the Reading profiles bound to the library |
| `DELETE` | `/api/reading-profile/library/{libraryId}` | `libraryId*` (path: integer (int32)) | 無 | void | Clears the reading profile for the given library for the currently logged-in user |
| `POST` | `/api/reading-profile/library/{libraryId}` | `libraryId*` (path: integer (int32)) | `array` | void | Sets the reading profile for a given library, removes the old one |
| `POST` | `/api/reading-profile/promote` | `profileId` (query: integer (int32))<br>`deviceId` (query: integer (int32)) | 無 | `UserReadingProfileDto` | Promotes the implicit profile to a user profile. Removes the series from other profiles |
| `GET` | `/api/reading-profile/series` | `seriesId` (query: integer (int32)) | 無 | `array` | Returns all Reading Profiles bound to a series |
| `POST` | `/api/reading-profile/series` | `libraryId` (query: integer (int32))<br>`seriesId` (query: integer (int32))<br>`deviceId` (query: integer (int32)) | `UserReadingProfileDto` | `UserReadingProfileDto` | Update the implicit reading profile for a series, creates one if none exists |
| `DELETE` | `/api/reading-profile/series/{seriesId}` | `seriesId*` (path: integer (int32)) | 無 | void | Clears the reading profile for the given series for the currently logged-in user |
| `POST` | `/api/reading-profile/series/{seriesId}` | `seriesId*` (path: integer (int32)) | `array` | void | Sets the reading profile for a given series, removes the old one |
| `POST` | `/api/reading-profile/set-devices` | `profileId` (query: integer (int32)) | `array` | void | Set the assigned devices for a reading profile |
| `POST` | `/api/reading-profile/update-parent` | `libraryId` (query: integer (int32))<br>`seriesId` (query: integer (int32))<br>`deviceId` (query: integer (int32)) | `UserReadingProfileDto` | `UserReadingProfileDto` | Updates the non-implicit reading profile for the given series, and removes implicit profiles |
| `GET` | `/api/reading-profile/{libraryId}/{seriesId}` | `libraryId*` (path: integer (int32))<br>`seriesId*` (path: integer (int32))<br>`skipImplicit` (query: boolean)<br>`deviceId` (query: integer (int32)) | 無 | `UserReadingProfileDto` | Returns the ReadingProfile that should be applied to the given series, walks up the tree. Series -> Library -> Default |

---

### AnnotationController (Annotation)
**端點總數**：12 個 | **前綴**：`/api/Annotation/`

| HTTP | 路由端點 | 請求參數 (Query / Path) | Request Body | 回傳結構 (200) | 功能說明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `DELETE` | `/api/Annotation` | `annotationId` (query: integer (int32)) | 無 | void | Delete the annotation for the user |
| `GET` | `/api/Annotation/all` | `chapterId` (query: integer (int32)) | 無 | `array` | Returns the annotations for the given chapter |
| `POST` | `/api/Annotation/all-filtered` | `PageNumber` (query: integer (int32))<br>`PageSize` (query: integer (int32)) | `AnnotationFilterDto` | `array` | Returns a list of annotations for browsing |
| `GET` | `/api/Annotation/all-for-series` | `seriesId` (query: integer (int32)) | 無 | `AnnotationDto` | Returns all annotations by Series |
| `POST` | `/api/Annotation/bulk-delete` | 無 | `array` | void | Removes annotations in bulk. Requires every annotation to be owned by the authenticated user |
| `POST` | `/api/Annotation/create` | 無 | `AnnotationDto` | `AnnotationDto` | Create a new Annotation for the user against a Chapter |
| `POST` | `/api/Annotation/export` | 無 | `array` | void | Exports Annotations for the User |
| `POST` | `/api/Annotation/export-filter` | `PageNumber` (query: integer (int32))<br>`PageSize` (query: integer (int32)) | `AnnotationFilterDto` | void | Exports annotations for the given users |
| `POST` | `/api/Annotation/like` | 無 | `array` | void | Adds a like for the currently authenticated user if not already from the annotations with given ids |
| `POST` | `/api/Annotation/unlike` | 無 | `array` | void | Removes likes for the currently authenticated user if present from the annotations with given ids |
| `POST` | `/api/Annotation/update` | 無 | `AnnotationDto` | `AnnotationDto` | Update the modifiable fields (Spoiler, highlight slot, and comment) for an annotation |
| `GET` | `/api/Annotation/{annotationId}` | `annotationId*` (path: integer (int32)) | 無 | `AnnotationDto` | Returns the Annotation by Id. User must have access to annotation. |

---

### RatingController (Rating)
**端點總數**：4 個 | **前綴**：`/api/Rating/`

| HTTP | 路由端點 | 請求參數 (Query / Path) | Request Body | 回傳結構 (200) | 功能說明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/Rating/chapter` | 無 | `UpdateRatingDto` | void | Update the users' rating of the given chapter |
| `GET` | `/api/Rating/overall-chapter` | `chapterId` (query: integer (int32)) | 無 | `RatingDto` | Overall rating from all Kavita users for a given Chapter |
| `GET` | `/api/Rating/overall-series` | `seriesId` (query: integer (int32)) | 無 | `RatingDto` | Overall rating from all Kavita users for a given Series |
| `POST` | `/api/Rating/series` | 無 | `UpdateRatingDto` | void | Update the users' rating of the given series |

---

### ReviewController (Review)
**端點總數**：6 個 | **前綴**：`/api/Review/`

| HTTP | 路由端點 | 請求參數 (Query / Path) | Request Body | 回傳結構 (200) | 功能說明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/Review/all` | `userId` (query: integer (int32))<br>`rating` (query: number (float))<br>`filterQuery` (query: string) | 無 | `array` | Returns all reviews for the user. If you are authenticated as the user, will always return data, regardless of ShareReviews setting |
| `DELETE` | `/api/Review/chapter` | `chapterId` (query: integer (int32)) | 無 | void | Deletes the user's review for the given chapter |
| `POST` | `/api/Review/chapter` | 無 | `UpdateUserReviewDto` | `UserReviewDto` | Update the user's review for a given chapter |
| `GET` | `/api/Review/my-series` | `seriesId` (query: integer (int32)) | 無 | `UserRatingAndReviewDto` | - |
| `DELETE` | `/api/Review/series` | `seriesId` (query: integer (int32)) | 無 | void | Deletes the user's review for the given series |
| `POST` | `/api/Review/series` | 無 | `UpdateUserReviewDto` | `UserReviewDto` | Updates the user's review for a given series |

---

### WantToReadController (WantToRead)
**端點總數**：4 個 | **前綴**：`/api/WantToRead/`

| HTTP | 路由端點 | 請求參數 (Query / Path) | Request Body | 回傳結構 (200) | 功能說明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/want-to-read` | `seriesId` (query: integer (int32)) | 無 | `boolean` | - |
| `POST` | `/api/want-to-read/add-series` | 無 | `UpdateWantToReadDto` | void | Given a list of Series Ids, add them to the current logged in user's Want To Read list |
| `POST` | `/api/want-to-read/remove-series` | 無 | `UpdateWantToReadDto` | void | Given a list of Series Ids, remove them from the current logged in user's Want To Read list |
| `POST` | `/api/want-to-read/v2` | `PageNumber` (query: integer (int32))<br>`PageSize` (query: integer (int32))<br>`userId` (query: integer (int32)) | `SeriesFilterV2Dto` | `array` | Return all Series that are in the current logged in user's Want to Read list, filtered |

---

### PersonController (Person)
**端點總數**：11 個 | **前綴**：`/api/Person/`

| HTTP | 路由端點 | 請求參數 (Query / Path) | Request Body | 回傳結構 (200) | 功能說明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/Person` | `name` (query: string) | 無 | `PersonDto` | - |
| `POST` | `/api/Person/all` | `PageNumber` (query: integer (int32))<br>`PageSize` (query: integer (int32)) | `PersonFilterDto` | `array` | Returns a list of authors and artists for browsing |
| `GET` | `/api/Person/chapters-by-role` | `personId` (query: integer (int32))<br>`role` (query: PersonRole) | 無 | `array` | Returns all individual chapters by role. Limited to 20 results. |
| `GET` | `/api/Person/coversdb-image` | `personId` (query: integer (int32)) | 無 | `string` | Returns the CoversDB image url for a Person, if one can be matched. Does not apply the cover. |
| `POST` | `/api/Person/fetch-cover` | `personId` (query: integer (int32)) | 無 | `string` | Attempts to download the cover from CoversDB |
| `POST` | `/api/Person/merge` | 無 | `PersonMergeDto` | `PersonDto` | Merges Persons into one, this action is irreversible |
| `GET` | `/api/Person/roles` | `personId` (query: integer (int32)) | 無 | `array` | Returns all roles for a Person |
| `GET` | `/api/Person/search` | `queryString` (query: string) | 無 | `array` | Find a person by name or alias against a query string |
| `GET` | `/api/Person/series-known-for` | `personId` (query: integer (int32)) | 無 | `array` | Returns the top 20 series that the "person" is known for. This will use Average Rating when applicable (Kavita+ field), else it's a random sort |
| `POST` | `/api/Person/update` | 無 | `UpdatePersonDto` | `PersonDto` | Updates the Person |
| `POST` | `/api/Person/valid-alias` | 無 | `PersonAliasCheckDto` | `boolean` | Ensure the alias is valid to be added. For example, the alias cannot be on another person or be the same as the current person name/alias. |

---

### ColorScapeController (ColorScape)
**端點總數**：3 個 | **前綴**：`/api/ColorScape/`

| HTTP | 路由端點 | 請求參數 (Query / Path) | Request Body | 回傳結構 (200) | 功能說明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/ColorScape/chapter` | `id` (query: integer (int32)) | 無 | `ColorScapeDto` | Returns the color scape for a chapter |
| `GET` | `/api/ColorScape/series` | `id` (query: integer (int32)) | 無 | `ColorScapeDto` | Returns the color scape for a series |
| `GET` | `/api/ColorScape/volume` | `id` (query: integer (int32)) | 無 | `ColorScapeDto` | Returns the color scape for a volume |

---

### ThemeController (Theme)
**端點總數**：7 個 | **前綴**：`/api/Theme/`

| HTTP | 路由端點 | 請求參數 (Query / Path) | Request Body | 回傳結構 (200) | 功能說明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `DELETE` | `/api/Theme` | `themeId` (query: integer (int32)) | 無 | `array` | Attempts to delete a theme. If already in use by users, will not allow |
| `GET` | `/api/Theme` | 無 | 無 | `array` | Returns all Themes |
| `GET` | `/api/Theme/browse` | 無 | 無 | `array` | Browse themes that can be used on this server |
| `GET` | `/api/Theme/download-content` | `themeId` (query: integer (int32)) | 無 | `string` | Returns css content to the UI. UI is expected to escape the content |
| `POST` | `/api/Theme/download-theme` | 無 | `DownloadableSiteThemeDto` | `SiteThemeDto` | Downloads a SiteTheme from upstream |
| `POST` | `/api/Theme/update-default` | 無 | `UpdateDefaultThemeDto` | void | - |
| `POST` | `/api/Theme/upload-theme` | 無 | `object` | `SiteThemeDto` | Uploads a new theme file |

---

### FontController (Font)
**端點總數**：5 個 | **前綴**：`/api/Font/`

| HTTP | 路由端點 | 請求參數 (Query / Path) | Request Body | 回傳結構 (200) | 功能說明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `DELETE` | `/api/Font` | `fontId` (query: integer (int32))<br>`force` (query: boolean) | 無 | `FontDeleteResultDto` | Removes a font family from the system. The family is validated for in-use server side and only removed when it is not selected by a user, or when an admin forces the deletion. |
| `GET` | `/api/Font` | `fontId` (query: integer (int32)) | 無 | void | Returns a font file |
| `GET` | `/api/Font/all` | 無 | 無 | `array` | List out the fonts |
| `POST` | `/api/Font/upload` | 無 | `object` | `EpubFontDto` | Manual upload |
| `POST` | `/api/Font/upload-by-url` | `url` (query: string) | 無 | `array` | - |

---

### LocaleController (Locale)
**端點總數**：1 個 | **前綴**：`/api/Locale/`

| HTTP | 路由端點 | 請求參數 (Query / Path) | Request Body | 回傳結構 (200) | 功能說明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/Locale` | 無 | 無 | `array` | Returns all applicable locales on the server |

---

## 四、 外部協議與整合 Controller (Integration & Protocols)

### OpdsController (Opds)
**端點總數**：22 個 | **前綴**：`/api/Opds/`

| HTTP | 路由端點 | 請求參數 (Query / Path) | Request Body | 回傳結構 (200) | 功能說明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/Opds/{apiKey}` | `apiKey*` (path: string) | 無 | void | Returns the Catalogue for Kavita's OPDS Service |
| `POST` | `/api/Opds/{apiKey}` | `apiKey*` (path: string) | 無 | void | Returns the Catalogue for Kavita's OPDS Service |
| `GET` | `/api/Opds/{apiKey}/collections` | `apiKey*` (path: string)<br>`pageNumber` (query: integer (int32)) | 無 | void | Get all Collections - Supports Pagination |
| `GET` | `/api/Opds/{apiKey}/collections/{collectionId}` | `collectionId*` (path: integer (int32))<br>`apiKey*` (path: string)<br>`pageNumber` (query: integer (int32)) | 無 | void | Get Series for a given Collection - Supports Pagination |
| `GET` | `/api/Opds/{apiKey}/favicon` | `apiKey*` (path: string) | 無 | void | - |
| `GET` | `/api/Opds/{apiKey}/image` | `apiKey*` (path: string)<br>`libraryId` (query: integer (int32))<br>`seriesId` (query: integer (int32))<br>`volumeId` (query: integer (int32))<br>`chapterId` (query: integer (int32))<br>`pageNumber` (query: integer (int32))<br>`saveProgress` (query: boolean) | 無 | void | This returns a streamed image following OPDS-PS v1.2 |
| `GET` | `/api/Opds/{apiKey}/libraries` | `apiKey*` (path: string)<br>`pageNumber` (query: integer (int32)) | 無 | void | Get the User's Libraries - No Pagination Support |
| `GET` | `/api/Opds/{apiKey}/libraries/{libraryId}` | `libraryId*` (path: integer (int32))<br>`apiKey*` (path: string)<br>`pageNumber` (query: integer (int32)) | 無 | void | Returns Series from the Library - Supports Pagination |
| `GET` | `/api/Opds/{apiKey}/on-deck` | `apiKey*` (path: string)<br>`pageNumber` (query: integer (int32)) | 無 | void | Get the On Deck (Dashboard) - Supports Pagination |
| `GET` | `/api/Opds/{apiKey}/reading-list` | `apiKey*` (path: string)<br>`pageNumber` (query: integer (int32)) | 無 | void | Get a User's Reading Lists - Supports Pagination |
| `GET` | `/api/Opds/{apiKey}/reading-list/{readingListId}` | `readingListId*` (path: integer (int32))<br>`apiKey*` (path: string)<br>`pageNumber` (query: integer (int32)) | 無 | void | Returns individual items (chapters) from Reading List by ID - Supports Pagination |
| `GET` | `/api/Opds/{apiKey}/recently-added` | `apiKey*` (path: string)<br>`pageNumber` (query: integer (int32)) | 無 | void | Returns Recently Added (Dashboard Feed) - Supports Pagination |
| `GET` | `/api/Opds/{apiKey}/recently-updated` | `apiKey*` (path: string)<br>`pageNumber` (query: integer (int32)) | 無 | void | Get the Recently Updated Series (Dashboard) - Pagination available, total pages will not be filled due to underlying implementation |
| `GET` | `/api/Opds/{apiKey}/search` | `apiKey*` (path: string) | 無 | void | - |
| `GET` | `/api/Opds/{apiKey}/series` | `apiKey*` (path: string)<br>`query` (query: string) | 無 | void | OPDS Search endpoint |
| `GET` | `/api/Opds/{apiKey}/series/{seriesId}` | `apiKey*` (path: string)<br>`seriesId*` (path: integer (int32)) | 無 | void | Returns the items within a Series (Series Detail) |
| `GET` | `/api/Opds/{apiKey}/series/{seriesId}/volume/{volumeId}` | `apiKey*` (path: string)<br>`seriesId*` (path: integer (int32))<br>`volumeId*` (path: integer (int32)) | 無 | void | Returns items for a given Volume |
| `GET` | `/api/Opds/{apiKey}/series/{seriesId}/volume/{volumeId}/chapter/{chapterId}` | `apiKey*` (path: string)<br>`seriesId*` (path: integer (int32))<br>`volumeId*` (path: integer (int32))<br>`chapterId*` (path: integer (int32)) | 無 | void | Gets items for a given Chapter |
| `GET` | `/api/Opds/{apiKey}/series/{seriesId}/volume/{volumeId}/chapter/{chapterId}/download/{filename}` | `apiKey*` (path: string)<br>`seriesId*` (path: integer (int32))<br>`volumeId*` (path: integer (int32))<br>`chapterId*` (path: integer (int32))<br>`filename*` (path: string) | 無 | void | Downloads a file (user must have download permission) |
| `GET` | `/api/Opds/{apiKey}/smart-filters` | `apiKey*` (path: string)<br>`pageNumber` (query: integer (int32)) | 無 | void | Get the User's Smart Filters (Dashboard Context) - Supports Pagination |
| `GET` | `/api/Opds/{apiKey}/smart-filters/{filterId}` | `apiKey*` (path: string)<br>`filterId*` (path: integer (int32))<br>`pageNumber` (query: integer (int32)) | 無 | void | Get the User's Smart Filter - Supports Pagination |
| `GET` | `/api/Opds/{apiKey}/want-to-read` | `apiKey*` (path: string)<br>`pageNumber` (query: integer (int32)) | 無 | void | Get the User's Want to Read list - Supports Pagination |

---

### KoreaderController (Koreader)
**端點總數**：3 個 | **前綴**：`/api/Koreader/`

| HTTP | 路由端點 | 請求參數 (Query / Path) | Request Body | 回傳結構 (200) | 功能說明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `PUT` | `/api/Koreader/{apiKey}/syncs/progress` | `apiKey*` (path: string) | `KoreaderBookDto` | `KoreaderProgressUpdateDto` | Syncs book progress with Kavita. Will attempt to save the underlying reader position if possible. |
| `GET` | `/api/Koreader/{apiKey}/syncs/progress/{ebookHash}` | `apiKey*` (path: string)<br>`ebookHash*` (path: string) | 無 | void | Gets book progress from Kavita, if not found will return a 400 |
| `GET` | `/api/Koreader/{apiKey}/users/auth` | `apiKey*` (path: string) | 無 | void | - |

---

### TachiyomiController (Tachiyomi)
**端點總數**：2 個 | **前綴**：`/api/Tachiyomi/`

| HTTP | 路由端點 | 請求參數 (Query / Path) | Request Body | 回傳結構 (200) | 功能說明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/Tachiyomi/latest-chapter` | `seriesId` (query: integer (int32)) | 無 | `TachiyomiChapterDto` | Given the series Id, this should return the latest chapter that has been fully read. |
| `POST` | `/api/Tachiyomi/mark-chapter-until-as-read` | `seriesId` (query: integer (int32))<br>`chapterNumber` (query: number (float))<br>`generateReadingSessions` (query: boolean) | 無 | `boolean` | Marks every chapter that is sorted below the passed number as Read. This will not mark any specials as read. |

---

### CblController (Cbl)
**端點總數**：14 個 | **前綴**：`/api/Cbl/`

| HTTP | 路由端點 | 請求參數 (Query / Path) | Request Body | 回傳結構 (200) | 功能說明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/Cbl/browse` | `path` (query: string) | 無 | `CblRepoBrowseResultDto` | Provides the browse CBL Repo interface. Requires Download role. |
| `POST` | `/api/Cbl/file-import` | 無 | `object` | `CblSavedFileDto` | Saves an uploaded CBL file to disk without importing. Returns the saved file info. |
| `POST` | `/api/Cbl/finalize-import` | 無 | `CblFinalizeRequestDto` | `CblImportSummaryDto` | Finalizes the import of a saved CBL file with user decisions |
| `POST` | `/api/Cbl/re-validate` | 無 | `CblReValidateRequestDto` | `CblImportSummaryDto` | Validates an already-saved CBL file on disk. Called by the import modal after remap rule changes. |
| `GET` | `/api/Cbl/remap-rules` | 無 | 無 | `array` | Returns all remap rules accessible to the current user (own rules + global/admin rules). |
| `POST` | `/api/Cbl/remap-rules` | 無 | `CreateRemapRuleDto` | `RemapRuleDto` | Creates a new remap rule, or updates an existing one if a rule with the same CBL matching key (normalized name + volume + number) already exists for this user. When no explicit VolumeId is provided, attempts to auto-resolve a matching volume on the target series from the CBL volume string. |
| `GET` | `/api/Cbl/remap-rules/all` | 無 | 無 | `array` | Returns all rules across all users |
| `DELETE` | `/api/Cbl/remap-rules/{id}` | `id*` (path: integer (int32)) | 無 | void | Deletes a remap rule. Users can only delete their own rules. |
| `POST` | `/api/Cbl/remap-rules/{id}` | `id*` (path: integer (int32)) | `UpdateRemapRuleDto` | `RemapRuleDto` | Updates a remap rule with issue-level detail (volume/chapter). |
| `POST` | `/api/Cbl/remap-rules/{id}/demote` | `id*` (path: integer (int32)) | 無 | `RemapRuleDto` | Demotes a global remap rule back to user-scoped. Admin-only. |
| `POST` | `/api/Cbl/remap-rules/{id}/promote` | `id*` (path: integer (int32)) | 無 | `RemapRuleDto` | Promotes a remap rule to global scope. Admin-only. |
| `POST` | `/api/Cbl/repo-import` | 無 | `CblRepoImportRequestDto` | `array` | Downloads selected CBL files from the GitHub repo and saves them to disk without importing. |
| `POST` | `/api/Cbl/sync` | `readingListId` (query: integer (int32))<br>`force` (query: boolean) | 無 | void | Enqueues the Reading List to be synced on a background thread. UI will be informed from Kavita.Models.DTOs.SignalR.MessageFactory.ReadingListUpdated event |
| `POST` | `/api/Cbl/upload-cbl-file` | 無 | `UploadUrlDto` | `CblSavedFileDto` | Downloads a CBL file from a URL and saves it to disk without importing. |

---

### StreamController (Stream)
**端點總數**：17 個 | **前綴**：`/api/Stream/`

| HTTP | 路由端點 | 請求參數 (Query / Path) | Request Body | 回傳結構 (200) | 功能說明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/Stream/add-dashboard-stream` | `smartFilterId` (query: integer (int32)) | 無 | `DashboardStreamDto` | Creates a Dashboard Stream from a SmartFilter and adds it to the user's dashboard as visible |
| `POST` | `/api/Stream/add-sidenav-stream` | `smartFilterId` (query: integer (int32)) | 無 | `SideNavStreamDto` | Creates a SideNav Stream from a SmartFilter and adds it to the user's sidenav as visible |
| `POST` | `/api/Stream/add-sidenav-stream-from-external-source` | `externalSourceId` (query: integer (int32)) | 無 | `SideNavStreamDto` | Creates a SideNav Stream from a SmartFilter and adds it to the user's sidenav as visible |
| `POST` | `/api/Stream/bulk-sidenav-stream-visibility` | 無 | `BulkUpdateSideNavStreamVisibilityDto` | void | - |
| `POST` | `/api/Stream/create-external-source` | 無 | `ExternalSourceDto` | `ExternalSourceDto` | Create an external Source |
| `GET` | `/api/Stream/dashboard` | `visibleOnly` (query: boolean) | 無 | `array` | Returns the layout of the user's dashboard |
| `DELETE` | `/api/Stream/delete-external-source` | `externalSourceId` (query: integer (int32)) | 無 | void | Delete's the external source |
| `POST` | `/api/Stream/external-source-exists` | 無 | `ExternalSourceDto` | `boolean` | Validates the external source by host is unique (for this user) |
| `GET` | `/api/Stream/external-sources` | 無 | 無 | `array` | Return's the user's external sources |
| `GET` | `/api/Stream/sidenav` | `visibleOnly` (query: boolean) | 無 | `array` | Return's the user's side nav |
| `DELETE` | `/api/Stream/smart-filter-dashboard-stream` | `dashboardStreamId` (query: integer (int32)) | 無 | void | Removes a Smart Filter from a user's Dashboard Streams |
| `DELETE` | `/api/Stream/smart-filter-side-nav-stream` | `sideNavStreamId` (query: integer (int32)) | 無 | void | Removes a Smart Filter from a user's SideNav Streams |
| `POST` | `/api/Stream/update-dashboard-position` | 無 | `UpdateStreamPositionDto` | void | Updates the position of a dashboard stream |
| `POST` | `/api/Stream/update-dashboard-stream` | 無 | `DashboardStreamDto` | void | Updates the visibility of a dashboard stream |
| `POST` | `/api/Stream/update-external-source` | 無 | `ExternalSourceDto` | `ExternalSourceDto` | Updates an existing external source |
| `POST` | `/api/Stream/update-sidenav-position` | 無 | `UpdateStreamPositionDto` | void | Updates the position of a dashboard stream |
| `POST` | `/api/Stream/update-sidenav-stream` | 無 | `SideNavStreamDto` | void | Updates the visibility of a dashboard stream |

---

### PanelsController (Panels)
**端點總數**：2 個 | **前綴**：`/api/Panels/`

| HTTP | 路由端點 | 請求參數 (Query / Path) | Request Body | 回傳結構 (200) | 功能說明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/Panels/get-progress` | `chapterId` (query: integer (int32))<br>`apiKey` (query: string) | 無 | `ProgressDto` | Gets the Progress of a given chapter |
| `POST` | `/api/Panels/save-progress` | `apiKey` (query: string) | `ProgressDto` | void | Saves the progress of a given chapter. This will generate a reading session with the estimated time from the last progress till the current |

---

### ScrobblingController (Scrobbling)
**端點總數**：19 個 | **前綴**：`/api/Scrobbling/`

| HTTP | 路由端點 | 請求參數 (Query / Path) | Request Body | 回傳結構 (200) | 功能說明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/Scrobbling/add-hold` | `seriesId` (query: integer (int32)) | 無 | void | Adds a hold against the Series for user's scrobbling |
| `POST` | `/api/Scrobbling/bulk-remove-events` | 無 | `array` | void | Delete the given scrobble events if they belong to that user |
| `POST` | `/api/Scrobbling/clear-errors` | 無 | 無 | void | Clears the scrobbling errors table |
| `GET` | `/api/Scrobbling/expired-tokens` | 無 | 無 | `array` | Returns all expired tokens for the current user |
| `POST` | `/api/Scrobbling/generate-scrobble-events` | `scrobbleProvider` (query: ScrobbleProvider) | 無 | void | Generate scrobble events from history. Should only be ran once per user. |
| `POST` | `/api/Scrobbling/generate-scrobble-events-all` | 無 | 無 | `boolean` | Generate scrobble events from history for all valid providers. |
| `GET` | `/api/Scrobbling/has-hold` | `seriesId` (query: integer (int32)) | 無 | `boolean` | If there is an active hold on the series |
| `GET` | `/api/Scrobbling/holds` | 無 | 無 | `array` | Returns all scrobble holds for the current user |
| `GET` | `/api/Scrobbling/library-allows-scrobbling` | `seriesId` (query: integer (int32)) | 無 | `boolean` | Does the library the series is in allow scrobbling? |
| `GET` | `/api/Scrobbling/next-scrobble-time` | 無 | 無 | `string (date-time)` | Returns when Scrobbling upload will next execute |
| `DELETE` | `/api/Scrobbling/remove-error/{id}` | `id*` (path: integer (int32)) | 無 | void | - |
| `DELETE` | `/api/Scrobbling/remove-hold` | `seriesId` (query: integer (int32)) | 無 | void | Remove a hold against the Series for user's scrobbling |
| `POST` | `/api/Scrobbling/retry-scrobble` | 無 | `KavitaPlusAuditEntryDto` | `boolean` | Attempts to retry Scrobble Events for the current authenticated user (or admin-allowed). |
| `GET` | `/api/Scrobbling/scrobble-errors` | 無 | 無 | `array` | Returns all scrobbling errors for the instance |
| `POST` | `/api/Scrobbling/scrobble-events` | `PageNumber` (query: integer (int32))<br>`PageSize` (query: integer (int32)) | `ScrobbleEventFilter` | `array` | Returns the scrobbling history for the user |
| `GET` | `/api/Scrobbling/scrobble-settings` | 無 | 無 | `array` | Returns all scrobble providers for a user. This list is guaranteed to contain an entry for each currently valid scrobble provider. If the user has none setup, returns the empty default values. |
| `GET` | `/api/Scrobbling/token-expired` | `provider` (query: ScrobbleProvider) | 無 | `boolean` | Checks if the current Scrobbling token for the given Provider has expired for the current user |
| `POST` | `/api/Scrobbling/update-scrobble-settings` | `provider` (query: ScrobbleProvider) | `ScrobbleProviderSettingsDto` | void | Updates the scrobble settings for a given provider. Libraries are filtered on supported types |
| `POST` | `/api/Scrobbling/update-user-scrobble-provider` | 無 | `UpdateScrobbleProviderDto` | void | Update authentication details for the given provider |

---

## 五、 系統管理與伺服器 Controller (System & Administration)

### ServerController (Server)
**端點總數**：18 個 | **前綴**：`/api/Server/`

| HTTP | 路由端點 | 請求參數 (Query / Path) | Request Body | 回傳結構 (200) | 功能說明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/Server/analyze-files` | 無 | 無 | void | This is a one time task that needs to be ran for v0.7 statistics to work |
| `POST` | `/api/Server/backup-db` | 無 | 無 | void | Performs an ad-hoc backup of the Database |
| `POST` | `/api/Server/bust-kavitaplus-cache` | 無 | 無 | void | Bust Kavita+ Cache |
| `GET` | `/api/Server/changelog` | `count` (query: integer (int32)) | 無 | `array` | Pull the Changelog for Kavita from Github and display |
| `GET` | `/api/Server/check-for-updates` | 無 | 無 | void | Checks for updates and pushes an event to the UI |
| `GET` | `/api/Server/check-out-of-date` | `stableOnly` (query: boolean) | 無 | `integer (int32)` | Returns how many versions out of date this install is |
| `GET` | `/api/Server/check-update` | 無 | 無 | `UpdateNotificationDto` | Checks for updates, if no updates that are > current version installed, returns null |
| `POST` | `/api/Server/cleanup` | 無 | 無 | void | Performs the nightly maintenance work on the Server. Can be heavy. |
| `POST` | `/api/Server/cleanup-want-to-read` | 無 | 無 | void | Performs an ad-hoc cleanup of Want To Read, by removing want to read series for users, where the series are fully read and in Completed publication status. |
| `POST` | `/api/Server/clear-cache` | 無 | 無 | void | Performs an ad-hoc cleanup of Cache |
| `POST` | `/api/Server/clear-media-alerts` | 無 | 無 | void | Deletes all media errors |
| `POST` | `/api/Server/convert-media` | 無 | 無 | void | Triggers the scheduling of the convert media job. This will convert all media to the target encoding (except for PNG). Only one job will run at a time. |
| `GET` | `/api/Server/is-task-running` | `methodName` (query: string)<br>`queue` (query: string) | 無 | `boolean` | Returns true if a task is currently running or has been queued. Can be scoped to a queue, default to the default queue |
| `GET` | `/api/Server/jobs` | 無 | 無 | `array` | Returns a list of reoccurring jobs. Scheduled ad-hoc jobs will not be returned. |
| `GET` | `/api/Server/logs` | 無 | 無 | void | Downloads all the log files via a zip |
| `GET` | `/api/Server/media-errors` | 無 | 無 | `array` | Returns a list of issues found during scanning or reading in which files may have corruption or bad metadata (structural metadata) |
| `GET` | `/api/Server/server-info-slim` | 無 | 無 | `ServerInfoSlimDto` | Returns non-sensitive information about the current system |
| `POST` | `/api/Server/sync-themes` | 無 | 無 | void | Runs the Sync Themes task |

---

### SettingsController (Settings)
**端點總數**：20 個 | **前綴**：`/api/Settings/`

| HTTP | 路由端點 | 請求參數 (Query / Path) | Request Body | 回傳結構 (200) | 功能說明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/Settings` | 無 | 無 | `ServerSettingDto` | Returns the server settings |
| `POST` | `/api/Settings` | 無 | `ServerSettingDto` | `ServerSettingDto` | Update Server settings |
| `GET` | `/api/Settings/base-url` | 無 | 無 | `string` | Returns the base url for this instance (if set) |
| `POST` | `/api/Settings/import-field-mappings` | 無 | `ImportFieldMappingsDto` | `FieldMappingsImportResultDto` | Import field mappings |
| `GET` | `/api/Settings/is-email-setup` | `forDevice` (query: boolean) | 無 | `boolean` | Is the minimum information setup for Email to work |
| `POST` | `/api/Settings/is-valid-authority` | 無 | `AuthorityValidationDto` | `AuthorityValidationResult` | Validate if the given authority is reachable from the server |
| `GET` | `/api/Settings/is-valid-cron` | `cronExpression` (query: string) | 無 | `boolean` | Is the cron expression valid for Kavita's scheduler |
| `GET` | `/api/Settings/library-types` | 無 | 無 | `array` | - |
| `GET` | `/api/Settings/log-levels` | 無 | 無 | `array` | - |
| `GET` | `/api/Settings/metadata-settings` | 無 | 無 | `MetadataSettingsDto` | Get the metadata settings for Kavita+ users. |
| `POST` | `/api/Settings/metadata-settings` | 無 | `MetadataSettingsDto` | `MetadataSettingsDto` | Update the metadata settings for Kavita+ Metadata feature |
| `GET` | `/api/Settings/oidc` | 無 | 無 | `OidcPublicConfigDto` | Retrieve publicly required configuration regarding Oidc |
| `GET` | `/api/Settings/opds-enabled` | 無 | 無 | `boolean` | - |
| `POST` | `/api/Settings/reset` | 無 | 無 | `ServerSettingDto` | - |
| `POST` | `/api/Settings/reset-base-url` | 無 | 無 | `ServerSettingDto` | Resets the Base url |
| `POST` | `/api/Settings/reset-external-ids` | 無 | 無 | void | - |
| `POST` | `/api/Settings/reset-ip-addresses` | 無 | 無 | `ServerSettingDto` | Resets the IP Addresses |
| `POST` | `/api/Settings/run-metadata-mappings` | 無 | `RunMetadataMappingsRequestDto` | void | - |
| `GET` | `/api/Settings/task-frequencies` | 無 | 無 | `array` | All values allowed for Task Scheduling APIs. A custom cron job is not included. Disabled is not applicable for Cleanup. |
| `POST` | `/api/Settings/test-email-url` | 無 | 無 | `EmailTestResultDto` | Sends a test email to see if email settings are hooked up correctly |

---

### UsersController (Users)
**端點總數**：10 個 | **前綴**：`/api/Users/`

| HTTP | 路由端點 | 請求參數 (Query / Path) | Request Body | 回傳結構 (200) | 功能說明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/Users` | `includePending` (query: boolean) | 無 | `array` | Returns all users of this server |
| `DELETE` | `/api/Users/delete-user` | `userId` (query: integer (int32)) | 無 | void | - |
| `GET` | `/api/Users/get-preferences` | 無 | 無 | `UserPreferencesDto` | Returns the preferences of the user |
| `GET` | `/api/Users/has-library-access` | `libraryId` (query: integer (int32)) | 無 | `boolean` | Does the user have access to this library |
| `GET` | `/api/Users/has-profile-shared` | `userId` (query: integer (int32)) | 無 | `boolean` | Does the requested user have their profile sharing on |
| `GET` | `/api/Users/has-reading-progress` | `libraryId` (query: integer (int32)) | 無 | `boolean` | Is there any reading progress on this library |
| `GET` | `/api/Users/names` | 無 | 無 | `array` | Returns a list of the user names within the system |
| `GET` | `/api/Users/profile-info` | `userId` (query: integer (int32)) | 無 | `MemberInfoDto` | Get Information about a given user |
| `GET` | `/api/Users/tokens` | 無 | 無 | `array` | Returns all users with tokens registered and their token information. Does not send the tokens. |
| `POST` | `/api/Users/update-preferences` | 無 | `UserPreferencesDto` | `UserPreferencesDto` | Update the user preferences |

---

### StatsController (Stats)
**端點總數**：34 個 | **前綴**：`/api/Stats/`

| HTTP | 路由端點 | 請求參數 (Query / Path) | Request Body | 回傳結構 (200) | 功能說明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/Stats/avg-time-by-hour` | `StartDate` (query: string (date-time))<br>`TimeZoneId` (query: string)<br>`EndDate` (query: string (date-time))<br>`Libraries` (query: array)<br>`userId` (query: integer (int32)) | 無 | `ReadTimeByHourDto` | Returns the avg time read by hour in the given filter |
| `GET` | `/api/Stats/day-breakdown` | `userId` (query: integer (int32)) | 無 | `array` | - |
| `GET` | `/api/Stats/device/client-type` | 無 | 無 | `DeviceClientBreakdownDto` | Returns client type breakdown for the current month |
| `GET` | `/api/Stats/device/device-type` | 無 | 無 | `StringStatCount` | Desktop vs Mobile spread over this month |
| `GET` | `/api/Stats/favorite-authors` | `StartDate` (query: string (date-time))<br>`TimeZoneId` (query: string)<br>`EndDate` (query: string (date-time))<br>`Libraries` (query: array)<br>`userId` (query: integer (int32)) | 無 | `MostReadAuthorsDto` | - |
| `GET` | `/api/Stats/files-added-over-time` | 無 | 無 | `array` | - |
| `GET` | `/api/Stats/genre-breakdown` | `StartDate` (query: string (date-time))<br>`TimeZoneId` (query: string)<br>`EndDate` (query: string (date-time))<br>`Libraries` (query: array)<br>`userId` (query: integer (int32)) | 無 | `StringBreakDownDto` | Returns the top 10 genres that the user likes reading |
| `GET` | `/api/Stats/most-active-users` | `StartDate` (query: string (date-time))<br>`TimeZoneId` (query: string)<br>`EndDate` (query: string (date-time))<br>`Libraries` (query: array) | 無 | `array` | Top 5 most active readers for the given timeframe |
| `GET` | `/api/Stats/page-spread` | `StartDate` (query: string (date-time))<br>`TimeZoneId` (query: string)<br>`EndDate` (query: string (date-time))<br>`Libraries` (query: array)<br>`userId` (query: integer (int32)) | 無 | `SpreadStatsDto` | - |
| `GET` | `/api/Stats/pages-per-year` | `userId` (query: integer (int32)) | 無 | `array` | Returns a count of pages read per year for a given userId. |
| `GET` | `/api/Stats/popular-decades` | 無 | 無 | `array` | - |
| `GET` | `/api/Stats/popular-genres` | 無 | 無 | `array` | - |
| `GET` | `/api/Stats/popular-libraries` | 無 | 無 | `array` | - |
| `GET` | `/api/Stats/popular-people` | `role` (query: PersonRole) | 無 | `array` | - |
| `GET` | `/api/Stats/popular-reading-list` | 無 | 無 | `array` | Gets the top 5 most popular reading lists. Counts a reading list as active if a user has read at least some |
| `GET` | `/api/Stats/popular-series` | 無 | 無 | `array` | - |
| `GET` | `/api/Stats/popular-tags` | 無 | 無 | `array` | - |
| `GET` | `/api/Stats/reading-activity` | `StartDate` (query: string (date-time))<br>`TimeZoneId` (query: string)<br>`EndDate` (query: string (date-time))<br>`Libraries` (query: array)<br>`userId` (query: integer (int32))<br>`year` (query: integer (int32)) | 無 | `object` | - |
| `GET` | `/api/Stats/reading-counts` | `StartDate` (query: string (date-time))<br>`TimeZoneId` (query: string)<br>`EndDate` (query: string (date-time))<br>`Libraries` (query: array)<br>`userId` (query: integer (int32)) | 無 | `array` | Returns reading history events for a give or all users, broken up by day, and format |
| `GET` | `/api/Stats/reading-history` | `StartDate` (query: string (date-time))<br>`TimeZoneId` (query: string)<br>`EndDate` (query: string (date-time))<br>`Libraries` (query: array)<br>`PageNumber` (query: integer (int32))<br>`PageSize` (query: integer (int32)) | 無 | `array` | Return a user's reading session history |
| `GET` | `/api/Stats/reading-history/series/{seriesId}` | `seriesId*` (path: integer (int32))<br>`tzId` (query: string)<br>`PageNumber` (query: integer (int32))<br>`PageSize` (query: integer (int32)) | 無 | `array` | Return the authenticated users reading session history for a given series |
| `GET` | `/api/Stats/reading-pace` | `StartDate` (query: string (date-time))<br>`TimeZoneId` (query: string)<br>`EndDate` (query: string (date-time))<br>`Libraries` (query: array)<br>`userId` (query: integer (int32))<br>`year` (query: integer (int32))<br>`booksOnly` (query: boolean) | 無 | `ReadingPaceDto` | - |
| `GET` | `/api/Stats/reads-by-month` | `StartDate` (query: string (date-time))<br>`TimeZoneId` (query: string)<br>`EndDate` (query: string (date-time))<br>`Libraries` (query: array)<br>`userId` (query: integer (int32)) | 無 | `array` | - |
| `GET` | `/api/Stats/server/count/manga-format` | 無 | 無 | `array` | - |
| `GET` | `/api/Stats/server/count/publication-status` | 無 | 無 | `array` | - |
| `GET` | `/api/Stats/server/file-breakdown` | 無 | 無 | `array` | A breakdown of different files, their size, and format |
| `GET` | `/api/Stats/server/file-extension` | `fileExtension` (query: string) | 無 | void | Generates a csv of all file paths for a given extension |
| `GET` | `/api/Stats/server/stats` | 無 | 無 | `ServerStatisticsDto` | - |
| `GET` | `/api/Stats/tag-breakdown` | `StartDate` (query: string (date-time))<br>`TimeZoneId` (query: string)<br>`EndDate` (query: string (date-time))<br>`Libraries` (query: array)<br>`userId` (query: integer (int32)) | 無 | `StringBreakDownDto` | Returns top 10 tags that user likes reading |
| `GET` | `/api/Stats/total-reads` | `userId` (query: integer (int32)) | 無 | `integer (int32)` | Returns the total amount reads in the given filter |
| `GET` | `/api/Stats/user-read` | `userId` (query: integer (int32)) | 無 | `UserReadStatistics` | - |
| `GET` | `/api/Stats/user-stats` | `StartDate` (query: string (date-time))<br>`TimeZoneId` (query: string)<br>`EndDate` (query: string (date-time))<br>`Libraries` (query: array)<br>`userId` (query: integer (int32)) | 無 | `ProfileStatBarDto` | - |
| `GET` | `/api/Stats/word-spread` | `StartDate` (query: string (date-time))<br>`TimeZoneId` (query: string)<br>`EndDate` (query: string (date-time))<br>`Libraries` (query: array)<br>`userId` (query: integer (int32)) | 無 | `SpreadStatsDto` | - |
| `GET` | `/api/Stats/words-per-year` | `userId` (query: integer (int32)) | 無 | `array` | Returns a count of words read per year for a given userId. |

---

### HealthController (Health)
**端點總數**：1 個 | **前綴**：`/api/Health/`

| HTTP | 路由端點 | 請求參數 (Query / Path) | Request Body | 回傳結構 (200) | 功能說明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/Health` | 無 | 無 | `string` | No-op method that just returns Ok. Used for health checks in Docker containers. |

---

### DeviceController (Device)
**端點總數**：10 個 | **前綴**：`/api/Device/`

| HTTP | 路由端點 | 請求參數 (Query / Path) | Request Body | 回傳結構 (200) | 功能說明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `DELETE` | `/api/Device` | `deviceId` (query: integer (int32)) | 無 | void | Deletes the device from the user |
| `GET` | `/api/Device` | 無 | 無 | `array` | - |
| `GET` | `/api/Device/client/all-devices` | `includeInactive` (query: boolean) | 無 | `array` | Get All user client devices |
| `DELETE` | `/api/Device/client/device` | `clientDeviceId` (query: integer (int32)) | 無 | `boolean` | Removes the client device from DB |
| `GET` | `/api/Device/client/devices` | `includeInactive` (query: boolean) | 無 | `array` | Get my client devices |
| `POST` | `/api/Device/client/update-name` | 無 | `UpdateClientDeviceNameDto` | void | Update the friendly name of the Device |
| `POST` | `/api/Device/create` | 無 | `CreateEmailDeviceDto` | `EmailDeviceDto` | Creates a new Device |
| `POST` | `/api/Device/send-series-to` | 無 | `SendSeriesToEmailDeviceDto` | void | Attempts to send a whole series to a device. |
| `POST` | `/api/Device/send-to` | 無 | `SendToEmailDeviceDto` | void | Sends a collection of chapters to the user's device |
| `POST` | `/api/Device/update` | 無 | `UpdateEmailDeviceDto` | `EmailDeviceDto` | Updates an existing Device |

---

### EmailController (Email)
**端點總數**：1 個 | **前綴**：`/api/Email/`

| HTTP | 路由端點 | 請求參數 (Query / Path) | Request Body | 回傳結構 (200) | 功能說明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/Email/all` | 無 | 無 | `array` | - |

---

### UploadController (Upload)
**端點總數**：13 個 | **前綴**：`/api/Upload/`

| HTTP | 路由端點 | 請求參數 (Query / Path) | Request Body | 回傳結構 (200) | 功能說明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/Upload/chapter` | 無 | `UploadCoverFileDto` | void | Replaces chapter cover image and locks it with a base64 encoded image. This will update the parent volume's cover image. |
| `POST` | `/api/Upload/collection` | 無 | `UploadCoverFileDto` | void | Replaces collection tag cover image and locks it with a base64 encoded image |
| `POST` | `/api/Upload/library` | 無 | `UploadCoverFileDto` | void | Replaces library cover image with a base64 encoded image. If empty string passed, will reset to null. |
| `POST` | `/api/Upload/person` | 無 | `UploadCoverFileDto` | void | Replaces person tag cover image and locks it with a base64 encoded image |
| `POST` | `/api/Upload/reading-list` | 無 | `UploadCoverFileDto` | void | Replaces reading list cover image and locks it with a base64 encoded image |
| `POST` | `/api/Upload/series` | 無 | `UploadCoverFileDto` | void | Replaces series cover image and locks it with a base64 encoded image |
| `POST` | `/api/Upload/upload-by-file` | 無 | `object` | `string` | Stages an uploaded image file in the temp directory for use in a cover image replacement flow. This is automatically cleaned up. |
| `POST` | `/api/Upload/upload-by-url` | 無 | `UploadUrlDto` | `string` | This stores a file (image) in temp directory for use in a cover image replacement flow. This is automatically cleaned up. |
| `POST` | `/api/Upload/upload-chapter-cover` | `chapterId` (query: integer (int32)) | 無 | `string` | - |
| `POST` | `/api/Upload/upload-series-cover` | `seriesId` (query: integer (int32)) | 無 | `string` | - |
| `POST` | `/api/Upload/upload-volume-cover` | `volumeId` (query: integer (int32)) | 無 | `string` | - |
| `POST` | `/api/Upload/user` | 無 | `UploadCoverFileDto` | void | Replaces user cover image and locks it with a base64 encoded image |
| `POST` | `/api/Upload/volume` | 無 | `UploadCoverFileDto` | void | Replaces volume cover image and locks it with a base64 encoded image. |

---

### LicenseController (License)
**端點總數**：13 個 | **前綴**：`/api/License/`

| HTTP | 路由端點 | 請求參數 (Query / Path) | Request Body | 回傳結構 (200) | 功能說明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `DELETE` | `/api/License` | 無 | 無 | void | Remove the Kavita+ License on the Server |
| `POST` | `/api/License` | 無 | `UpdateLicenseDto` | `KavitaPlusRegisterResultDto` | Updates server license |
| `DELETE` | `/api/License/cancel` | 無 | `CancelKavitaPlusLicenseDto` | void | Cancels the active Kavita+ Subscription tied to this server. License will elapse at end of billing period. |
| `POST` | `/api/License/change-email` | 無 | `ChangeEmailOnLicenseDto` | `boolean` | Change email on Kavita+ License/Stripe - Sends a confirmation email on Kavita+ side. No-op for server. |
| `GET` | `/api/License/has-license` | 無 | 無 | `boolean` | Has any license registered with the instance. Does not validate against Kavita+ API |
| `GET` | `/api/License/info` | `forceCheck` (query: boolean) | 無 | `LicenseInfoDto` | Asks Kavita+ for the latest license info |
| `GET` | `/api/License/products` | 無 | 無 | `array` | Returns the available Kavita+ products (billing interval and list price) the renew flow can select. |
| `GET` | `/api/License/provider-health` | `forceCheck` (query: boolean) | 無 | `array` | Provides a 15 min snapshot of Kavita+ Providers (Hardcover, AniList, MangaBaka, etc.) API health. Kavita caches every 45 mins. |
| `POST` | `/api/License/renew` | 無 | `RenewKavitaPlusLicenseDto` | `string` | Renews the subscription on the given billing interval and returns the Stripe Checkout (Pay Now) URL the customer visits to pay. |
| `POST` | `/api/License/resend-license` | 無 | 無 | `boolean` | Resend the welcome email to the user |
| `POST` | `/api/License/reset` | 無 | `UpdateLicenseDto` | void | Break the registration between Kavita+ and this instance |
| `GET` | `/api/License/stats` | 無 | 無 | `KavitaPlusLicenseUsageDto` | Providers how many interactions this license has had with Kavita+ over a lifetime |
| `GET` | `/api/License/valid-license` | `forceCheck` (query: boolean) | 無 | `boolean` | Checks if the user's license is valid or not |

---

### ActivityController (Activity)
**端點總數**：1 個 | **前綴**：`/api/Activity/`

| HTTP | 路由端點 | 請求參數 (Query / Path) | Request Body | 回傳結構 (200) | 功能說明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/Activity/current` | 無 | 無 | `array` | Returns active reading sessions on the Server |

---

### AdminController (Admin)
**端點總數**：1 個 | **前綴**：`/api/Admin/`

| HTTP | 路由端點 | 請求參數 (Query / Path) | Request Body | 回傳結構 (200) | 功能說明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/Admin/exists` | 無 | 無 | `boolean` | Checks if an admin exists on the system. This is essentially a check to validate if the system has been set up. |

---

### OAuthController (OAuth)
**端點總數**：2 個 | **前綴**：`/api/OAuth/`

| HTTP | 路由端點 | 請求參數 (Query / Path) | Request Body | 回傳結構 (200) | 功能說明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/OAuth/callback` | `upstream` (query: OAuthUpstream)<br>`token` (query: string)<br>`apiKey` (query: string)<br>`refreshToken` (query: string)<br>`expiresIn` (query: integer (int32)) | 無 | void | Callback from KavitaPlus. |
| `GET` | `/api/OAuth/start` | `upstream` (query: OAuthUpstream) | 無 | void | Start the OAuth flow for the given upstream, redirect (302!) to KavitaPlus |

---

### OidcController (Oidc)
**端點總數**：2 個 | **前綴**：`/api/Oidc/`

| HTTP | 路由端點 | 請求參數 (Query / Path) | Request Body | 回傳結構 (200) | 功能說明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/Oidc/login` | `returnUrl` (query: string) | 無 | void | - |
| `GET` | `/Oidc/logout` | 無 | 無 | void | - |

---

### ManageController (Manage)
**端點總數**：2 個 | **前綴**：`/api/Manage/`

| HTTP | 路由端點 | 請求參數 (Query / Path) | Request Body | 回傳結構 (200) | 功能說明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/Manage/matched-series-counts` | 無 | 無 | `MatchedExternalSeriesCountDto` | Returns high level counts for matched series page |
| `POST` | `/api/Manage/series-metadata` | `PageNumber` (query: integer (int32))<br>`PageSize` (query: integer (int32)) | `ManageMatchFilterDto` | `array` | Returns a list of all Series that is Kavita+ applicable to metadata match and the status of it |

---

### KavitaPlusAuditController (KavitaPlusAudit)
**端點總數**：6 個 | **前綴**：`/api/KavitaPlusAudit/`

| HTTP | 路由端點 | 請求參數 (Query / Path) | Request Body | 回傳結構 (200) | 功能說明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/kavita-plus-audit/entries` | `PageNumber` (query: integer (int32))<br>`PageSize` (query: integer (int32)) | `KavitaPlusAuditFilterDto` | `array` | Returns a paged, filtered list of all Kavita+ audit events. Admin only. |
| `GET` | `/api/kavita-plus-audit/entries/series/{seriesId}` | `seriesId*` (path: integer (int32)) | 無 | `KavitaPlusAuditSeriesInfoDto` | Returns Kavita+ audit info scoped to a single series, for the popover. Scrobble events are filtered to the calling user unless they are an admin. |
| `GET` | `/api/kavita-plus-audit/failed-scrobble-events` | 無 | 無 | `integer (int32)` | - |
| `POST` | `/api/kavita-plus-audit/my-activity` | `PageNumber` (query: integer (int32))<br>`PageSize` (query: integer (int32)) | `KavitaPlusAuditFilterDto` | `array` | Returns the calling user's own Kavita+ activity, paged and filtered. |
| `GET` | `/api/kavita-plus-audit/my-stats` | 無 | 無 | `KavitaPlusMyAuditStatsDto` | Aggregate stats for my activity audit feed |
| `GET` | `/api/kavita-plus-audit/stats` | 無 | 無 | `KavitaPlusAuditStatsDto` | Returns aggregate stats for the admin audit feed |

---

## 六、 全量端點統計與分類總覽

全站共收錄 **47** 個 Controller，計 **519** 個標準 API 端點。

| 分類 | Controller 列表 | 端點數總計 |
| :--- | :--- | :--- |
| **客戶端核心** | Account, Plugin, Library, Series, Volume, Chapter, Reader, Book, Image, Download, Search | 172 |
| **功能擴充** | Filter, Collection, ReadingList, ReadingProfile, Annotation, Rating, Review, WantToRead, Person, ColorScape, Theme, Font, Locale | 120 |
| **第三方整合** | Opds, Koreader, Tachiyomi, Cbl, Stream, Panels, Scrobbling | 79 |
| **系統管理** | Server, Settings, Users, Stats, Health, Device, Email, Upload, License, Activity, Admin, OAuth, Oidc, Manage, KavitaPlusAudit | 134 |
