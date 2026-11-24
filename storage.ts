import { get, set } from "@api/DataStore";
import { ChannelStore, UserStore } from "@webpack/common";

import { FavoriteChannelMap, FavoriteChannelType, LocalFavoriteChannel, StoredFavoritesPayload } from "./types";

const STORAGE_PREFIX = "UnlimitedFavorites_v1_";

let currentUserId: string | null = null;
let cache: FavoriteChannelMap = {};
let nativeOrderOverrides: Record<string, number> = {};
let lastUpdatedAt = 0;
let loaded = false;

type ChangeListener = (source: "local" | "external" | "load") => void;
const listeners = new Set<ChangeListener>();

function getStorageKey(userId: string): string {
    return `${STORAGE_PREFIX}${userId}`;
}

export function resolveUserId(explicitUserId?: string): string {
    return explicitUserId ?? UserStore.getCurrentUser()?.id ?? currentUserId ?? "default";
}

function normalizeNickname(nickname: string | null | undefined): string | null {
    if (typeof nickname !== "string") return null;
    const trimmed = nickname.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function resolveChannelType(channelId: string, explicitType?: number): number | undefined {
    if (typeof explicitType === "number") return explicitType;
    const ch = ChannelStore.getChannel(channelId);
    return typeof ch?.type === "number" ? ch.type : undefined;
}

function normalizeEntry(id: string, raw: Partial<LocalFavoriteChannel>, fallbackOrder: number): LocalFavoriteChannel {
    return {
        id,
        nickname: normalizeNickname(raw.nickname),
        type: typeof raw.type === "number" ? raw.type : FavoriteChannelType.REFERENCE_ORIGINAL,
        channelType: resolveChannelType(id, raw.channelType),
        order: typeof raw.order === "number" ? raw.order : fallbackOrder,
        parentId: typeof raw.parentId === "string" && raw.parentId.length > 0 ? raw.parentId : null,
    };
}

function normalizeFavoritesMap(rawMap: FavoriteChannelMap | undefined): FavoriteChannelMap {
    if (!rawMap || typeof rawMap !== "object") return {};
    const normalized: FavoriteChannelMap = {};
    let idx = 0;
    for (const [id, raw] of Object.entries(rawMap)) {
        if (!id || !raw || typeof raw !== "object") continue;
        normalized[id] = normalizeEntry(id, raw, idx++);
    }
    return normalized;
}

function notifyListeners(source: "local" | "external" | "load"): void {
    for (const listener of listeners) {
        try {
            listener(source);
        } catch (err) {
            console.error("[UnlimitedFavorites] Listener error:", err);
        }
    }
}

async function persist(source: "local" | "external" = "local", explicitTimestamp?: number): Promise<void> {
    const userId = resolveUserId();
    if (source === "local") {
        lastUpdatedAt = Date.now();
    } else if (typeof explicitTimestamp === "number") {
        lastUpdatedAt = explicitTimestamp;
    }

    const payload: StoredFavoritesPayload = {
        version: 1,
        updatedAt: lastUpdatedAt,
        favorites: { ...cache },
        nativeOrderOverrides: { ...nativeOrderOverrides },
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
        cache = normalizeFavoritesMap(stored.favorites);
        nativeOrderOverrides = stored.nativeOrderOverrides && typeof stored.nativeOrderOverrides === "object"
            ? { ...stored.nativeOrderOverrides }
            : {};
        lastUpdatedAt = typeof stored.updatedAt === "number"
            ? stored.updatedAt
            : (Object.keys(cache).length > 0 ? 1 : 0);
    } else {
        cache = {};
        nativeOrderOverrides = {};
        lastUpdatedAt = 0;
    }

    loaded = true;
    notifyListeners("load");
    return cache;
}

export function getCurrentAccountPayload(): StoredFavoritesPayload {
    return {
        version: 1,
        updatedAt: lastUpdatedAt,
        favorites: { ...cache },
        nativeOrderOverrides: { ...nativeOrderOverrides },
    };
}

export async function applyExternalPayload(payload: StoredFavoritesPayload): Promise<boolean> {
    const incomingUpdatedAt = typeof payload.updatedAt === "number" ? payload.updatedAt : Date.now();
    if (incomingUpdatedAt <= lastUpdatedAt && loaded) {
        return false;
    }

    cache = normalizeFavoritesMap(payload.favorites);
    nativeOrderOverrides = payload.nativeOrderOverrides && typeof payload.nativeOrderOverrides === "object"
        ? { ...payload.nativeOrderOverrides }
        : {};
    lastUpdatedAt = incomingUpdatedAt;

    notifyListeners("external");
    await persist("external", incomingUpdatedAt);
    return true;
}

export function isFavoritesLoaded(): boolean {
    return loaded;
}

export function getActiveUserId(): string | null {
    return currentUserId;
}

export function getLastUpdatedAt(): number {
    return lastUpdatedAt;
}

export function getLocalFavorites(): FavoriteChannelMap {
    return cache;
}

export function getNativeOrderOverrides(): Record<string, number> {
    return nativeOrderOverrides;
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

function getNextOrder(extraOrders: number[] = []): number {
    const orders = [
        ...Object.values(cache).map(v => v.order),
        ...Object.values(nativeOrderOverrides),
        ...extraOrders,
    ].filter(n => typeof n === "number" && Number.isFinite(n));

    if (orders.length === 0) return 0;
    return Math.max(...orders) + 1;
}

export async function addLocalFavorite(
    channelId: string,
    options?: {
        nickname?: string | null;
        parentId?: string | null;
        type?: FavoriteChannelType;
        channelType?: number;
        order?: number;
        existingOrders?: number[];
    }
): Promise<LocalFavoriteChannel> {
    const existing = cache[channelId];
    const entry: LocalFavoriteChannel = {
        id: channelId,
        nickname: options?.nickname !== undefined
            ? normalizeNickname(options.nickname)
            : normalizeNickname(existing?.nickname),
        type: options?.type ?? existing?.type ?? FavoriteChannelType.REFERENCE_ORIGINAL,
        channelType: resolveChannelType(channelId, options?.channelType ?? existing?.channelType),
        order: options?.order ?? existing?.order ?? getNextOrder(options?.existingOrders),
        parentId: options?.parentId !== undefined ? options.parentId : (existing?.parentId ?? null),
    };

    cache = { ...cache, [channelId]: entry };
    notifyListeners("local");
    await persist("local");
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
    notifyListeners("local");
    await persist("local");
    return true;
}

export async function toggleLocalFavorite(channelId: string, existingOrders?: number[]): Promise<boolean> {
    if (isLocalFavorite(channelId)) {
        await removeLocalFavorite(channelId);
        return false;
    }

    await addLocalFavorite(channelId, { existingOrders });
    return true;
}

export async function setFavoriteNickname(channelId: string, nickname: string | null): Promise<void> {
    const existing = cache[channelId];
    if (!existing) return;

    cache = {
        ...cache,
        [channelId]: { ...existing, nickname: normalizeNickname(nickname) },
    };
    notifyListeners("local");
    await persist("local");
}

export async function setFavoriteParent(channelId: string, parentId: string | null): Promise<void> {
    const existing = cache[channelId];
    if (!existing) return;

    cache = {
        ...cache,
        [channelId]: { ...existing, parentId },
    };
    notifyListeners("local");
    await persist("local");
}

export async function createLocalCategory(name: string): Promise<LocalFavoriteChannel> {
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

    notifyListeners("local");
    await persist("local");
}

export async function applyReorderUpdates(
    localUpdates: Record<string, { order: number; parentId: string | null; nickname?: string | null; }>,
    deletedLocalIds: string[],
    updatedNativeOrders: Record<string, number>
): Promise<void> {
    let changed = false;
    const nextCache: FavoriteChannelMap = { ...cache };

    for (const id of deletedLocalIds) {
        if (nextCache[id]) {
            delete nextCache[id];
            changed = true;
        }
    }

    for (const [id, update] of Object.entries(localUpdates)) {
        const existing = nextCache[id];
        if (!existing) continue;

        const nextNick = update.nickname !== undefined ? normalizeNickname(update.nickname) : existing.nickname;
        if (
            existing.order !== update.order ||
            existing.parentId !== update.parentId ||
            existing.nickname !== nextNick
        ) {
            nextCache[id] = {
                ...existing,
                order: update.order,
                parentId: update.parentId,
                nickname: nextNick,
            };
            changed = true;
        }
    }

    const nextOverrides: Record<string, number> = { ...nativeOrderOverrides };
    for (const [id, pos] of Object.entries(updatedNativeOrders)) {
        if (nextOverrides[id] !== pos) {
            nextOverrides[id] = pos;
            changed = true;
        }
    }

    if (!changed) return;

    cache = nextCache;
    nativeOrderOverrides = nextOverrides;
    notifyListeners("local");
    await persist("local");
}

export async function importFavoritesMap(entries: FavoriteChannelMap): Promise<number> {
    let importedCount = 0;
    const next: FavoriteChannelMap = { ...cache };
    let nextOrder = getNextOrder();

    for (const [id, raw] of Object.entries(entries)) {
        if (!id || !raw || typeof raw !== "object") continue;
        if (!next[id]) {
            next[id] = normalizeEntry(id, raw, nextOrder++);
            importedCount++;
        }
    }

    if (importedCount > 0) {
        cache = next;
        notifyListeners("local");
        await persist("local");
    }

    return importedCount;
}

export function exportFavoritesJson(): string {
    const payload: StoredFavoritesPayload = {
        version: 1,
        updatedAt: lastUpdatedAt || Date.now(),
        favorites: cache,
        nativeOrderOverrides,
    };
    return JSON.stringify(payload, null, 2);
}

export async function clearLocalFavorites(): Promise<void> {
    cache = {};
    nativeOrderOverrides = {};
    notifyListeners("local");
    await persist("local");
}

export function resetCache(): void {
    cache = {};
    nativeOrderOverrides = {};
    lastUpdatedAt = 0;
    loaded = false;
    currentUserId = null;
}
