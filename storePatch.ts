import { findStore } from "@webpack";

import {
    getLocalFavorite,
    getLocalFavorites,
    isLocalFavorite,
} from "./storage";
import { FavoriteChannelMap, LocalFavoriteChannel } from "./types";

interface DiscordFavoriteStore {
    getFavoriteChannels?: () => FavoriteChannelMap;
    getFavorite?: (channelId: string) => LocalFavoriteChannel | undefined;
    isFavorite?: (channelId: string) => boolean;
    isChannelOrParentFavorited?: (channel: { id?: string; parent_id?: string | null; } | null | undefined) => boolean;
    favoriteGuildEnabled?: boolean;
    hasFavoriteChannels?: boolean | (() => boolean);
    emitChange?: () => void;
    [key: string]: any;
}

interface PatchOptions {
    isEnabled: () => boolean;
    shouldForceGuildVisible: () => boolean;
}

type SavedDescriptor = {
    target: object;
    key: string;
    descriptor: PropertyDescriptor | undefined;
    hadOwn: boolean;
};

let favoriteStore: DiscordFavoriteStore | null = null;
let originalGetFavoriteChannels: (() => FavoriteChannelMap) | null = null;
const savedDescriptors: SavedDescriptor[] = [];
let patched = false;

function findDescriptor(obj: object, key: string): { owner: object; descriptor: PropertyDescriptor; } | null {
    let curr: object | null = obj;
    while (curr && curr !== Object.prototype) {
        const desc = Object.getOwnPropertyDescriptor(curr, key);
        if (desc) return { owner: curr, descriptor: desc };
        curr = Object.getPrototypeOf(curr);
    }
    return null;
}

function saveAndDefine(target: object, key: string, newDescriptor: PropertyDescriptor): void {
    const hadOwn = Object.prototype.hasOwnProperty.call(target, key);
    const descriptor = hadOwn ? Object.getOwnPropertyDescriptor(target, key) : undefined;
    savedDescriptors.push({ target, key, descriptor, hadOwn });
    Object.defineProperty(target, key, {
        configurable: true,
        ...newDescriptor,
    });
}

export function getFavoriteStore(): DiscordFavoriteStore | null {
    if (!favoriteStore) {
        try {
            favoriteStore = findStore("FavoriteStore") as DiscordFavoriteStore | null;
        } catch {
            favoriteStore = null;
        }
    }
    return favoriteStore;
}

export function getNativeFavoriteChannels(): FavoriteChannelMap {
    const store = getFavoriteStore();
    if (!store) return {};

    if (originalGetFavoriteChannels) {
        try {
            return originalGetFavoriteChannels.call(store) ?? {};
        } catch {
            return {};
        }
    }

    if (typeof store.getFavoriteChannels === "function") {
        try {
            return store.getFavoriteChannels() ?? {};
        } catch {
            return {};
        }
    }

    return {};
}

export function emitFavoriteStoreChange(): void {
    const store = getFavoriteStore();
    if (store && typeof store.emitChange === "function") {
        try {
            store.emitChange();
        } catch (err) {
            console.error("[UnlimitedFavorites] Failed to emit FavoriteStore change:", err);
        }
    }
}

export function patchFavoriteStore(options: PatchOptions): boolean {
    if (patched) return true;

    const store = getFavoriteStore();
    if (!store) {
        console.warn("[UnlimitedFavorites] Could not locate Discord's FavoriteStore.");
        return false;
    }

    // 1. Patch getFavoriteChannels
    if (typeof store.getFavoriteChannels === "function") {
        const orig = store.getFavoriteChannels;
        originalGetFavoriteChannels = orig;

        saveAndDefine(store, "getFavoriteChannels", {
            writable: true,
            value: function getFavoriteChannelsPatched(): FavoriteChannelMap {
                const nativeFavs = orig.call(this) ?? {};
                if (!options.isEnabled()) return nativeFavs;

                const localFavs = getLocalFavorites();
                if (Object.keys(localFavs).length === 0) return nativeFavs;

                return {
                    ...nativeFavs,
                    ...localFavs,
                };
            },
        });
    }

    // 2. Patch getFavorite
    if (typeof store.getFavorite === "function") {
        const orig = store.getFavorite;
        saveAndDefine(store, "getFavorite", {
            writable: true,
            value: function getFavoritePatched(channelId: string): LocalFavoriteChannel | undefined {
                if (options.isEnabled()) {
                    const local = getLocalFavorite(channelId);
                    if (local) return local;
                }
                return orig.call(this, channelId);
            },
        });
    }

    // 3. Patch isFavorite
    if (typeof store.isFavorite === "function") {
        const orig = store.isFavorite;
        saveAndDefine(store, "isFavorite", {
            writable: true,
            value: function isFavoritePatched(channelId: string): boolean {
                if (options.isEnabled() && isLocalFavorite(channelId)) {
                    return true;
                }
                return Boolean(orig.call(this, channelId));
            },
        });
    }

    // 4. Patch isChannelOrParentFavorited
    if (typeof store.isChannelOrParentFavorited === "function") {
        const orig = store.isChannelOrParentFavorited;
        saveAndDefine(store, "isChannelOrParentFavorited", {
            writable: true,
            value: function isChannelOrParentFavoritedPatched(
                channel: { id?: string; parent_id?: string | null; } | null | undefined
            ): boolean {
                if (options.isEnabled() && channel) {
                    if (channel.id && isLocalFavorite(channel.id)) return true;
                    if (channel.parent_id && isLocalFavorite(channel.parent_id)) return true;
                }
                return Boolean(orig.call(this, channel));
            },
        });
    }

    // 5. Patch favoriteGuildEnabled getter/property so the Favorites tab shows up even without Nitro
    const guildEnabledInfo = findDescriptor(store, "favoriteGuildEnabled");
    if (guildEnabledInfo) {
        const origDesc = guildEnabledInfo.descriptor;
        saveAndDefine(store, "favoriteGuildEnabled", {
            get(this: DiscordFavoriteStore): boolean {
                const origVal = origDesc.get ? Boolean(origDesc.get.call(this)) : Boolean(origDesc.value);
                if (!options.isEnabled() || !options.shouldForceGuildVisible()) {
                    return origVal;
                }
                if (Object.keys(getLocalFavorites()).length > 0) {
                    return true;
                }
                return origVal;
            },
        });
    }

    // 6. Patch hasFavoriteChannels if present (either getter or method)
    const hasFavsInfo = findDescriptor(store, "hasFavoriteChannels");
    if (hasFavsInfo) {
        const origDesc = hasFavsInfo.descriptor;
        if (typeof origDesc.value === "function") {
            const origFn = origDesc.value;
            saveAndDefine(store, "hasFavoriteChannels", {
                writable: true,
                value: function hasFavoriteChannelsPatched(): boolean {
                    if (options.isEnabled() && Object.keys(getLocalFavorites()).length > 0) {
                        return true;
                    }
                    return Boolean(origFn.call(this));
                },
            });
        } else {
            saveAndDefine(store, "hasFavoriteChannels", {
                get(this: DiscordFavoriteStore): boolean {
                    if (options.isEnabled() && Object.keys(getLocalFavorites()).length > 0) {
                        return true;
                    }
                    return origDesc.get ? Boolean(origDesc.get.call(this)) : Boolean(origDesc.value);
                },
            });
        }
    }

    patched = true;
    emitFavoriteStoreChange();
    return true;
}

export function unpatchFavoriteStore(): void {
    if (!patched) return;

    // Restore in reverse order
    while (savedDescriptors.length > 0) {
        const entry = savedDescriptors.pop()!;
        try {
            if (entry.hadOwn && entry.descriptor) {
                Object.defineProperty(entry.target, entry.key, entry.descriptor);
            } else {
                delete (entry.target as Record<string, unknown>)[entry.key];
            }
        } catch (err) {
            console.error(`[UnlimitedFavorites] Failed to restore ${entry.key}:`, err);
        }
    }

    originalGetFavoriteChannels = null;
    patched = false;
    emitFavoriteStoreChange();
}
