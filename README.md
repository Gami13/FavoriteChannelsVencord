# UnlimitedFavorites (Vencord UserPlugin)

A Vencord userplugin that lets you favorite **more than 3 channels/DMs without Discord Nitro** by storing your favorites locally on your device and merging them directly into Discord's native `FavoriteStore`.

## Features

- **Unlimited Local Favorites**: Bypass Discord's 3-channel free limit by storing favorites locally via Vencord's `DataStore` (IndexedDB), scoped per Discord account.
- **Native Favorites Tab Integration**: Patches Discord's `FavoriteStore` (`getFavoriteChannels`, `getFavorite`, `isFavorite`, `isChannelOrParentFavorited`, `favoriteGuildEnabled`) so your local favorites appear right inside Discord's native Favorites server tab.
- **Right-Click Context Menus**: Right-click any text/voice/forum channel, thread, DM, or Group DM and choose **Add to Local Favorites** / **Remove from Local Favorites**.
- **Favorites Manager Modal**: Search, rename (custom nicknames), reorder, jump straight to channels, or remove favorites from **Manage Local Favorites** (or from plugin settings).
- **Import & Backup**: One-click import of your existing native Discord favorites, plus JSON export/import for manual backups.

## Installation (Vencord Developer Build)

1. Clone or copy this repository into your Vencord `src/userplugins/` directory:
   ```bash
   cd path/to/Vencord
   git clone <this-repo-url> src/userplugins/unlimitedFavorites
   ```
2. Build Vencord:
   ```bash
   pnpm build
   ```
3. Reload Discord (`Ctrl + R`), open **User Settings → Vencord → Plugins**, and enable **UnlimitedFavorites**.

## Project Structure

- `index.ts` — Plugin entry point, lifecycle hooks (`start`/`stop`), and `CONNECTION_OPEN` handler.
- `storage.ts` — Per-account local persistence using `@api/DataStore` with a synchronous in-memory cache.
- `storePatch.ts` — Safe runtime patching and restoration of Discord's `FavoriteStore`.
- `contextMenus.tsx` — Context menu items for channels, threads, DMs, and Group DMs.
- `settings.tsx` — Plugin settings and import/export controls.
- `components/FavoritesModal.tsx` — Searchable modal for jumping to, renaming, reordering, and managing local favorites.
- `types.ts` — Shared TypeScript interfaces matching Discord's `FavoriteChannel` structure.
