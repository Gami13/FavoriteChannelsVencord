# UnlimitedFavorites (Vencord UserPlugin)

A Vencord userplugin that lets you favorite **more than 3 channels/DMs without Discord Nitro** by storing your favorites locally on your device, merging them directly into Discord's native `FavoriteStore`, and optionally syncing them to a custom JSON file (e.g. inside a Syncthing folder).

## Features

- **Unlimited Local Favorites**: Bypass Discord's 3-channel free limit by storing favorites locally via Vencord's `DataStore` (IndexedDB), scoped per Discord account.
- **Native Favorites Tab Integration**: Patches Discord's `FavoriteStore` and `UserSettingsActionCreators.updateAsync("favorites", ...)` so your local favorites appear right inside Discord's native Favorites tab and support drag-and-drop reordering alongside native favorites.
- **Server Icons in Favorites**: Displays the parent server's circular icon right beside a compact `#` icon for favorited server channels.
- **Custom File Sync (Syncthing / Dropbox / OneDrive)**:
  - **Desktop Vencord (`native.ts`)**: Choose any custom file path via the native file picker or text input; writes atomically using Node `fs` with automatic external-change polling.
  - **Legcord / Web (`File System Access API`)**: Link or create a JSON file in your synced folder via the file picker; writes on every change and polls for updates from other devices.
- **Right-Click Context Menus & Manager Modal**: Right-click any text/voice/forum channel, thread, DM, or Group DM to add/remove favorites, or open **Manage Local Favorites** to search, rename, reorder, and jump directly to channels.

## Installation (Vencord Developer Build)

1. Clone this repository into your Vencord `src/userplugins/` directory:
   ```bash
   cd path/to/Vencord
   git clone https://github.com/Gami13/FavoriteChannelsVencord.git src/userplugins/unlimitedFavorites
   ```
2. Build Vencord:
   - **Desktop Vencord**: `pnpm build`
   - **Legcord (standalone web bundle)**: `pnpm buildWebStandalone` (then copy `dist/browser.js` and `dist/browser.css` to `%APPDATA%\legcord\vencord.js` / `vencord.css` and set `"noBundleUpdates": true` in `%APPDATA%\legcord\storage\settings.json`)
3. Reload Discord/Legcord (`Ctrl + R`), open **User Settings → Vencord → Plugins**, and enable **UnlimitedFavorites**.

## Project Structure

- `index.ts` — Plugin entry point, lifecycle hooks (`start`/`stop`), and `CONNECTION_OPEN` handler.
- `storage.ts` — Per-account local persistence using `@api/DataStore` with timestamps and a synchronous in-memory cache.
- `fileSync.ts` — Dual-mode bidirectional file sync engine (Desktop `native.ts` + Legcord File System Access API).
- `native.ts` — Electron main-process atomic file read/write and native file picker for Desktop Vencord.
- `storePatch.ts` — Safe runtime patching and restoration of Discord's `FavoriteStore` and favorites reorder updates.
- `serverIconDecorator.ts` — Renders server icons beside compact channel-type icons for favorited server channels.
- `contextMenus.tsx` — Context menu items for channels, threads, DMs, and Group DMs.
- `settings.tsx` — Plugin settings, file sync controls, and manual JSON import/export.
- `components/FavoritesModal.tsx` — Searchable modal for jumping to, renaming, reordering, and managing local favorites.
- `types.ts` — Shared TypeScript interfaces.
