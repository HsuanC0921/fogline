# Fogline · 霧線

[English](README.md) · [繁體中文](README.zh-TW.md)

> **專案狀態（2026-10-27）：已封存。** 我已暫停 Fogline 開發，正在改測以 YASB + Windhawk 為主的 Windows 桌面配置。這是因為我自己的 Seelen UI 環境反覆讓我擔心穩定性、Windows 相容性與背景資源使用。這是單一電腦的個人經驗，不是通用評測，也不代表所有 Seelen UI 安裝都會遇到相同問題。

為 **Windows 11 與 Seelen UI** 設計、受 macOS 啟發的桌面外觀：半透明頂欄、浮動 Dock、共用材質的彈出面板，以及 Spotlight 風格的搜尋框。Fogline 是獨立社群專案，與 Apple 無隸屬關係。

![Fogline 頂欄](docs/menubar.png)
![Fogline Dock](docs/dock.png)

以上圖片供外觀參考，不代表每個現行面板都已通過畫面驗證。

## 功能

| 區域 | 內容 |
| --- | --- |
| 桌面 | 深淺色共用材質、桌布強調色、圓角 Dock、執行指示與圖示放大 |
| 頂欄 | Fogline 選單、前景程式、系統匣、輸入法、藍牙、網路、搜尋、控制中心、月曆與通知；有電池的裝置才顯示電池 |
| 控制中心 | 連線、媒體、螢幕亮度、音訊輸出、深淺色、護眼暖色與專注控制 |
| 月曆 | 農曆、ISO 週數、月份／年份導覽、公開假日資料與快取；支援台灣、日本及 Nager.Date 涵蓋的其他國家 |
| 輸入法 | 已安裝的鍵盤配置、輸入法狀態，以及輸入法有支援時的模式切換 |
| 連線 | 原生橋接程式處理 Wi-Fi；藍牙支援已配對裝置及按需搜尋／配對 |
| 搜尋 | `Alt + Space` 開啟 Fogline Lantern：應用程式、已開啟視窗、檔案、設定、快速動作、計算機、單位換算與網頁；Seelen Apps Menu 作為應用程式抽屜 |
| 圖示 | Files、原生啟動器、設定等 Fogline 圖示 |

## 安裝

需要 Windows 11、已安裝且至少執行一次的 Seelen UI 2.8.x。繁體中文建議安裝 Noto Sans TC，日文可加裝 Noto Sans JP。安裝腳本使用 Windows 內建的 .NET Framework 編譯器建立原生橋接程式；只有重新建置小工具時才需要 Node.js。

```powershell
git clone https://github.com/HsuanC0921/fogline.git
cd fogline
./install.ps1
```

腳本會先停止 Seelen 的 watchdog 與 UI，安裝資源，合併建議設定、取代頂欄排列，再重新啟動 Seelen。安裝前可先查看 [settings.example.json](settings.example.json) 與 [toolbar-layout.yml](toolbar-layout.yml)，確認要套用的桌面配置。

Fogline 保留 Seelen 原生 Dock，統一純文字數字徽章的樣式，App 提供的圖片、圖示及狀態色徽章則自動維持原樣。徽章來源可能代表程式狀態、App 提供的數字或 Windows 通知，不保證等於 App 內的未讀總數；視窗數量徽章則維持關閉。安裝器只會移除先前那份帶有 Fogline 標記的不相容 Dock 覆寫，不會動到未標記資源。

| 選項 | 作用 |
| --- | --- |
| `-ThemeOnly` | 略過建議設定／頂欄合併；仍安裝 Fogline 資源並重啟 Seelen |
| `-PinSettings` | 另外把系統設定釘選至 Dock |

請自行決定是否允許 Seelen 小工具要求的控制權限。變更 Seelen 語言後，重新執行安裝腳本可更新頂欄提示文字。Windows 強調色設為「自動」時，主題可跟隨桌布強調色。

## Lantern 搜尋

`Alt + Space` 開啟 Fogline Lantern，一個 Spotlight 風格的搜尋框，只在開啟時執行。它**不自建索引**：應用程式讀 Seelen 已維護的「開始」功能表清單，視窗讀 Seelen 的視窗清單，檔案則透過原生橋接程式、按需查詢 Windows 自己的搜尋索引。唯一會儲存的是一個用來排序的小型啟動次數。

| 類型 | 範例 |
| --- | --- |
| 應用程式 | `edge`；搜尋框空白時顯示最近使用，常用的排名較前 |
| 已開啟視窗 | 輸入標題的一部分即可切換；`quit telegram` 結束該程式 |
| 檔案 | Windows 搜尋結果，新的在前；`Ctrl + Enter` 開啟所在資料夾，`Ctrl + Shift + C` 複製路徑 |
| 設定 | `wifi`、`display`、`sound`、`update`⋯ 開啟對應的設定頁 |
| 快速動作 | 鎖定、睡眠、重新啟動、關機、登出、工作管理員、資源回收筒、深色／淺色模式、護眼、勿擾 |
| 計算機與單位 | `2^10 + sqrt(16)`、`10 km to mi`、`20c to f`、`5 gb to mib` |
| 小工具 | `uuid`、`now`、`#ff8800`（顏色）、`~\Downloads` 或 `C:\路徑`（開啟）、`> ipconfig`（在命令列執行） |
| 網頁 | `yt`、`gh`、`wiki`、`map` 前綴，任何 `網域.tld`，否則以網頁搜尋 |

`Alt + 1…9` 直接執行對應列；結果依類型分組，像 Spotlight。沒有原生橋接程式時，只是不會出現檔案結果。

## Files 與 QuickLook

`./integrations/files/install.ps1` 讓 [Files](https://files.community/) 與 [QuickLook](https://github.com/QL-Win/QuickLook) 使用與面板相同的材質。Files 已不再支援主題檔，所以腳本只寫入側邊欄、工具列、網址列與檔案區的顏色（會先關閉 Files，完成後重開）；QuickLook 則在 `QuickLook.config` 開啟 `UseTransparency`、`WindowBackdrop` 與 `WindowBackgroundColor`。顏色依安裝當下的 Windows 深淺色決定，切換後請重新執行，或加上 `-Light`。你在 Files 裡選的字型與背板材質不會被改動。

## 快捷鍵與其他整合

| 快捷鍵 | 作用 |
| --- | --- |
| `Alt + Space` | Fogline Lantern |
| `Alt + Shift + Space` | Fogline 選單 |

各面板的位置以安裝的頂欄配置為準。Files、Everything、QuickLook 都是獨立應用程式；主題不會取代 Windows Explorer 的 Shell 程序，也不保證所有檔案管理器都能使用 QuickLook。

選用的 [mpv 整合](integrations/mpv/README.md) 提供以 akFace/mpv.config 為基礎的繁中 Modern Glass 設定與目前使用者的註冊腳本，需要另外安裝，不包含在桌面主題安裝流程中。

## 建置與目錄

```powershell
npm ci
npm run build
```

修改 TypeScript 後，請連同產生的各小工具 `index.js` 提交。建置成功代表完成打包，不代表該電腦的原生功能都能正常運作。

| 路徑 | 負責內容 |
| --- | --- |
| `theme/shared.css` | 材質、顏色、字體與共用面板樣式 |
| `theme/styles/` | 頂欄、Dock、右鍵選單、提示與 flyout |
| `plugins/`、`toolbar-layout.yml` | 頂欄行為及排列 |
| `widgets/` | 面板原始碼與打包檔案 |
| `native/` | 顯示、輸入法、Wi-Fi 與桌面整合橋接程式 |
| `integrations/mpv/` | 選用播放器設定及註冊腳本 |

修改已安裝的桌面前先讀 [AGENTS.md](AGENTS.md)。Seelen 的 UI／watchdog 尚可能覆寫設定時，不要直接編輯其持久化設定檔。

## 限制與排錯

- 亮度控制取決於螢幕與驅動支援；輸入模式控制取決於輸入法，不是每款第三方輸入法都支援直接切換。
- 護眼強度可調整 0–100%，預設收合；50% 以上提供更深的暖琥珀色。拖曳即時預覽、放開儲存，下次啟動沿用。百分比代表效果強度，並非校準過的色溫。
- 護眼暖色是 Fogline 的 Magnification 色彩轉換，與 Windows 夜間光線分開。HDR、受保護內容及獨佔全螢幕需要另外驗證。
- 深淺色切換使用未公開的 Windows 主題介面；勿擾直接使用 IQuietHoursSettings，並讀回生效中的設定檔，不會開啟設定視窗。這些未公開 COM 介面可能隨 Windows 更新改變。
- 各假日 API 的年度及地區涵蓋不同。離線可用已有快取，缺少的年度不會以虛構假日替代。
- 小工具權限、外部程式選單及全螢幕行為需要在目標電腦測試。隱藏原生工作列不等於停止 Explorer 或消除其背景活動。
- Seelen 日誌位於 `%LOCALAPPDATA%\com.seelen.seelen-ui\logs`。

- 通知的啟用、清除與回覆使用 Seelen 原生指令。部分桌面通知不允許第三方啟用，會保留原通知並展開完整內容，提示回到原程式處理。勿擾由原生橋接讀取 Windows 狀態，不會以本機模式切換冒充系統切換成功。

## 授權

Fogline 原創程式與圖像使用 [MIT](LICENSE)。小工具打包檔包含 **AGPL-3.0-only** 的 `@seelen-ui/lib`，散布打包版本時需遵循其授權。mpv 整合保留各上游聲明與 [LGPL 授權](integrations/mpv/LICENSE.LGPL)；原生橋接程式的第三方聲明見 [native/THIRD-PARTY.txt](native/THIRD-PARTY.txt)。
