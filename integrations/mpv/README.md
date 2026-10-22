# mpv / 繁體中文 Modern Glass

Based on [akFace/mpv.config](https://github.com/akFace/mpv.config), revision `ac4677dadd6ef2e45aeb4457b9b236676051a36e`.
The patch translates the configuration and scripts into Traditional Chinese and selects the Modern Glass skin, Noto Sans TC, a restrained blue-grey panel, rounded corners and reduced motion. Video refraction and interface blur effects are disabled to reduce rendering overhead.

以該版本為基礎繁體中文化，使用 Modern Glass、思源黑體、灰藍玻璃與圓角；停用介面折射及模糊效果以減少負擔。播放紀錄、字幕 API 金鑰與執行檔均不包含在 repo。

```powershell
git clone https://github.com/akFace/mpv.config.git mpv-config
git -C mpv-config checkout ac4677dadd6ef2e45aeb4457b9b236676051a36e
./prepare-config.ps1 -Upstream ./mpv-config -Destination ./portable_config
```

Install a current Windows mpv build from the links on [mpv.io](https://mpv.io/installation/) into `%LOCALAPPDATA%\Programs\mpv`, place the generated `portable_config` beside `mpv.exe`, then run `./register.ps1`. Registration redirects existing mpv/umpv ProgIDs and creates per-user Start menu shortcuts; it preserves protected Windows UserChoice settings.

將新版 mpv 與產生的 `portable_config` 放進上述目錄後執行 `register.ps1`。腳本更新目前使用者的 mpv／umpv 關聯及開始選單捷徑，不改受保護的預設應用程式雜湊。若要更改預設播放器，請在 Windows「預設應用程式」選擇 mpv。

The machine used for this update runs `mpv v0.41.0-1227-ge471496c5`, Windows build dated 2026-10-21. Original `C:\mpv-lazy` files were retained outside the active installation.

Upstream licensing: [LGPL-2.1](LICENSE.LGPL), plus notices retained in individual upstream scripts. Shared subtitle credentials embedded upstream are removed during preparation; supply your own key if using that provider.
