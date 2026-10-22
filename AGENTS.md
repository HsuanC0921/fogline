# AGENTS.md — applying Fogline

Goal: install the Fogline theme for Seelen UI on the user's Windows 11 machine.

## Fast path

1. Confirm Seelen UI is installed and has run once: `%APPDATA%\com.seelen.seelen-ui\settings.json` exists.
2. Run `powershell -ExecutionPolicy Bypass -File install.ps1` from the repo root. Use `-ThemeOnly` if the user only
   wants the theme files.
3. Verify: `activeThemes` in `settings.json` contains `@hsuan/fogline`; `data\seelen-fancy-toolbar\state.yml` lists the
   launcher plus 10 items in total (the input method item is Fogline Input); `widgets\fogline-menu` exists.

## Rules that will otherwise bite you

- Never edit `settings.json` or `state.yml` while Seelen runs. It rewrites them on exit. Stop `seelen-ui`, wait for the
  process to disappear, edit, then relaunch with `shell:AppsFolder\Seelen.SeelenUI_p6yyn03m1894e!App`.
- Theme CSS hot-reloads on file change; settings, plugins and widgets need a restart.
- An invalid theme manifest is silently dropped from `activeThemes`. `tags` must be valid values (`toolbar`, `weg`…),
  and the id must match `^@[a-zA-Z][\w\-]{1,30}[a-zA-Z0-9]\/[a-zA-Z][\w\-]+[a-zA-Z0-9]$`.
- A popup widget must be enabled in `byWidget` (`"@hsuan/fogline-menu": {"enabled": true}`) or triggering it logs
  `Can't trigger a disabled widget`.
- Do not touch the user's wallpaper engine, fonts or other apps. Don't create backups unless asked.

## Layout

- `theme/shared.css` defines the material tokens (`--mat`, `--tile`, `--accent`, …) with dark and light variants.
  Everything else uses those tokens; change a colour there, not in each file.
- `theme/styles/toolbar.css` (menu bar) and `theme/styles/weg.css` (Dock, magnification, indicators).
- `widgets/fogline-menu/src/main.ts` is the source of the menu widget; rebuild with `npm install && npm run build`
  inside that folder and commit the resulting `index.js`.

## Verifying visually

Screenshot the desktop (menu bar at y 0–48, Dock at the bottom). Do not click around in the user's apps; use
`slu.exe settings` or the launcher to open Seelen windows.
