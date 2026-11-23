import { get, set } from "@api/DataStore";
import { UserStore } from "@webpack/common";

import { FavoriteChannelMap, FavoriteChannelType, LocalFavoriteChannel, StoredFavoritesPayload } from "./types";

const STORAGE_PREFIX = "UnlimitedFavorites_v1_";

let currentUserId: string | null = null;
let cache: FavoriteChannelMap = {};
let loaded = false;

type ChangeListener = () => void;
const listeners = new Set<ChangeListener>();

function getStorageKey(userId: string): string {
    return `${STORAGE_PREFIX}${userId}`;
}

function resolveUserId(explicitUserId?: string): string {
    return explicitUserId ?? UserStore.getCurrentUser()?.id ?? currentUserId ?? "default";
}

function notifyListeners(): void {
    for (const listener of listeners) {
        try {
            listener();
        } catch (err) {
            console.error("[UnlimitedFavorites] Listener error:", err);
        }
    }
}

async function persist(): Promise<void> {
    const userId = resolveUserId();
    const payload: StoredFavoritesPayload = {
        version: 1,
        favorites: { ...cache },
    };
    await set(getStorageKey(userId), payload);
}

export function subscribeFavorites(listener: ChangeListener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export async function loadFavorites(explicitUserId?: string): Promise<FavoriteChannelMap> {
    const userId = resolveUserId(explicitUserId);
    currentUserId = userId;

    const stored = await get<StoredFavoritesPayload>(getStorageKey(userId));
    if (stored && stored.version === 1 && stored.favorites && typeof stored.favorites === "object") {
        cache = { ...stored.favorites };
    } else {
        cache = {};
    }

    loaded = true;
    notifyListeners();
    return cache;
}

export function isFavoritesLoaded(): boolean {
    return loaded;
}

export function getActiveUserId(): string | null {
    return currentUserId;
}

export function getLocalFavorites(): FavoriteChannelMap {
    return cache;
}

export function getLocalFavoritesList(): LocalFavoriteChannel[] {
    return Object.values(cache).sort((a, b) => a.order - b.order);
}

export function getLocalCategories(): LocalFavoriteChannel[] {
    return getLocalFavoritesList().filter(f => f.type === FavoriteChannelType.CATEGORY);
}

export function getLocalFavorite(channelId: string): LocalFavoriteChannel | undefined {
    return cache[channelId];
}

export function isLocalFavorite(channelId: string): boolean {
    return Object.prototype.hasOwnProperty.call(cache, channelId);
}

function getNextOrder(): number {
    const values = Object.values(cache);
    if (values.length === 0) return 0;
    return Math.max(...values.map(v => v.order)) + 1;
}

export async function addLocalFavorite(
    channelId: string,
    options?: {
        nickname?: string;
        parentId?: string | null;
        type?: FavoriteChannelType;
        order?: number;
    }
): Promise<LocalFavoriteChannel> {
    const existing = cache[channelId];
    const entry: LocalFavoriteChannel = {
        id: channelId,
        nickname: options?.nickname ?? existing?.nickname ?? "",
        type: options?.type ?? existing?.type ?? FavoriteChannelType.REFERENCE_ORIGINAL,
        order: options?.order ?? existing?.order ?? getNextOrder(),
        parentId: options?.parentId !== undefined ? options.parentId : (existing?.parentId ?? null),
    };

    cache = { ...cache, [channelId]: entry };
    notifyListeners();
    await persist();
    return entry;
}

export async function removeLocalFavorite(channelId: string): Promise<boolean> {
    if (!isLocalFavorite(channelId)) return false;

    const next = { ...cache };
    delete next[channelId];

    // If a category is removed, unassign any children pointing to it
    for (const key of Object.keys(next)) {
        if (next[key].parentId === channelId) {
            next[key] = { ...next[key], parentId: null };
        }
    }

    cache = next;
    notifyListeners();
    await persist();
    return true;
}

export async function toggleLocalFavorite(channelId: string): Promise<boolean> {
    if (isLocalFavorite(channelId)) {
        await removeLocalFavorite(channelId);
        return false;
    }

    await addLocalFavorite(channelId);
    return true;
}

export async function setFavoriteNickname(channelId: string, nickname: string): Promise<void> {
    const existing = cache[channelId];
    if (!existing) return;

    cache = {
        ...cache,
        [channelId]: { ...existing, nickname: nickname.trim() },
    };
    notifyListeners();
    await persist();
}

export async function setFavoriteParent(channelId: string, parentId: string | null): Promise<void> {
    const existing = cache[channelId];
    if (!existing) return;

    cache = {
        ...cache,
        [channelId]: { ...existing, parentId },
    };
    notifyListeners();
    await persist();
}

export async function createLocalCategory(name: string): Promise<LocalFavoriteChannel> {
    // Generate a unique numeric snowflake-like ID for compatibility with Discord's FavoriteStore
    const id = `${Date.now()}${Math.floor(Math.random() * 100000).toString().padStart(5, "0")}`;
    return addLocalFavorite(id, {
        nickname: name.trim() || "New Category",
        type: FavoriteChannelType.CATEGORY,
        parentId: null,
    });
}

export async function moveLocalFavorite(channelId: string, direction: -1 | 1): Promise<void> {
    const sorted = getLocalFavoritesList().filter(f => f.type === FavoriteChannelType.REFERENCE_ORIGINAL);
    const index = sorted.findIndex(f => f.id === channelId);
    const swapIndex = index + direction;
    if (index === -1 || swapIndex < 0 || swapIndex >= sorted.length) return;

    const current = sorted[index];
    const target = sorted[swapIndex];

    cache = {
        ...cache,
        [current.id]: { ...current, order: target.order },
        [target.id]: { ...target, order: current.order },
    };

    // Normalize orders if they happened to be equal
    if (current.order === target.order) {
        const reordered = [...sorted];
        reordered[index] = target;
        reordered[swapIndex] = current;
        const normalized: FavoriteChannelMap = { ...cache };
        reordered.forEach((item, idx) => {
            normalized[item.id] = { ...normalized[item.id], order: idx };
        });
        cache = normalized;
    }

    notifyListeners();
    await persist();
}

export async function importFavoritesMap(entries: FavoriteChannelMap): Promise<number> {
    let importedCount = 0;
    const next: FavoriteChannelMap = { ...cache };
    let nextOrder = getNextOrder();

    for (const [id, raw] of Object.entries(entries)) {
        if (!id || !raw || typeof raw !== "object") continue;
        if (!next[id]) {
            next[id] = {
                id,
                nickname: typeof raw.nickname === "string" ? raw.nickname : "",
                type: typeof raw.type === "number" ? raw.type : FavoriteChannelType.REFERENCE_ORIGINAL,
                order: typeof raw.order === "number" ? raw.order : nextOrder++,
                parentId: typeof raw.parentId === "string" ? raw.parentId : null,
            };
            importedCount++;
        }
    }

    if (importedCount > 0) {
        cache = next;
        notifyListeners();
        await persist();
    }

    return importedCount;
}

export function exportFavoritesJson(): string {
    const payload: StoredFavoritesPayload = {
        version: 1,
        favorites: cache,
    };
    return JSON.stringify(payload, null, 2);
}

export async function clearLocalFavorites(): Promise<void> {
    cache = {};
    notifyListeners();
    await persist();
}

export function resetCache(): void {
    cache = {};
    loaded = false;
    currentUserId = null;
}
