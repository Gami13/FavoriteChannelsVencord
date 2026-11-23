import definePlugin from "@utils/types";

import {
    channelContextMenuPatch,
    gdmContextMenuPatch,
    threadContextMenuPatch,
    userContextMenuPatch,
} from "./contextMenus";
import { settings } from "./settings";
import { loadFavorites, resetCache, subscribeFavorites } from "./storage";
import { emitFavoriteStoreChange, patchFavoriteStore, unpatchFavoriteStore } from "./storePatch";

let unsubscribeStorage: (() => void) | null = null;

export default definePlugin({
    name: "UnlimitedFavorites",
    description: "Favorite unlimited channels and DMs locally without Nitro.",
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
            loadFavorites(event?.user?.id).catch(err => {
                console.error("[UnlimitedFavorites] Failed to load favorites on CONNECTION_OPEN:", err);
            });
        },
    },

    async start() {
        unsubscribeStorage = subscribeFavorites(() => {
            emitFavoriteStoreChange();
        });

        patchFavoriteStore({
            isEnabled: () => settings.store.enableStoreIntegration,
            shouldForceGuildVisible: () => settings.store.forceShowFavoritesTab,
        });

        try {
            await loadFavorites();
        } catch (err) {
            console.error("[UnlimitedFavorites] Failed to load favorites on start:", err);
        }
    },

    stop() {
        unsubscribeStorage?.();
        unsubscribeStorage = null;

        unpatchFavoriteStore();
        resetCache();
    },
});
