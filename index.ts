import definePlugin from "@utils/types";

import {
    channelContextMenuPatch,
    gdmContextMenuPatch,
    threadContextMenuPatch,
    userContextMenuPatch,
} from "./contextMenus";
import { scheduleSyncWrite, startFileSync, stopFileSync, syncWithFile } from "./fileSync";
import { refreshServerIcons, startServerIconDecorator, stopServerIconDecorator } from "./serverIconDecorator";
import { settings } from "./settings";
import { loadFavorites, resetCache, subscribeFavorites } from "./storage";
import { emitFavoriteStoreChange, patchFavoriteStore, unpatchFavoriteStore } from "./storePatch";

let unsubscribeStorage: (() => void) | null = null;

export default definePlugin({
    name: "UnlimitedFavorites",
    description: "Favorite unlimited channels and DMs locally without Nitro, with optional file sync (e.g. Syncthing).",
    authors: [
        {
            name: "Local User",
            id: 0n,
        },
    ],
    settings,

    contextMenus: {
        "channel-context": channelContextMenuPatch,
        "thread-context": threadContextMenuPatch,
        "gdm-context": gdmContextMenuPatch,
        "user-context": userContextMenuPatch,
    },

    flux: {
        CONNECTION_OPEN(event: { user?: { id?: string; }; }) {
            loadFavorites(event?.user?.id)
                .then(() => syncWithFile())
                .catch(err => {
                    console.error("[UnlimitedFavorites] Failed to load/sync favorites on CONNECTION_OPEN:", err);
                });
        },
    },

    async start() {
        unsubscribeStorage = subscribeFavorites(source => {
            emitFavoriteStoreChange();
            refreshServerIcons();
            if (source === "local") {
                scheduleSyncWrite();
            }
        });

        patchFavoriteStore({
            isEnabled: () => settings.store.enableStoreIntegration,
            shouldForceGuildVisible: () => settings.store.forceShowFavoritesTab,
        });

        startServerIconDecorator(() => settings.store.showServerIcon);

        try {
            await loadFavorites();
            await startFileSync(() => settings.store.syncFilePath);
        } catch (err) {
            console.error("[UnlimitedFavorites] Failed to initialize favorites on start:", err);
        }
    },

    stop() {
        unsubscribeStorage?.();
        unsubscribeStorage = null;

        stopFileSync();
        stopServerIconDecorator();
        unpatchFavoriteStore();
        resetCache();
    },
});
