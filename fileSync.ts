import { del, get, set } from "@api/DataStore";
import type { PluginNative } from "@utils/types";

import {
    applyExternalPayload,
    getCurrentAccountPayload,
    resolveUserId,
} from "./storage";
import type { StoredFavoritesPayload, SyncFileDocument } from "./types";

const HANDLE_STORAGE_KEY = "UnlimitedFavorites_syncFileHandle_v1";
const POLL_INTERVAL_MS = 5000;
const WRITE_DEBOUNCE_MS = 350;

type NativeApi = PluginNative<typeof import("./native")>;

export type SyncState = "unconfigured" | "synced" | "needs-permission" | "error";

export interface SyncStatus {
    backend: "native" | "fsa" | "unsupported";
    state: SyncState;
    targetLabel: string | null;
    lastSyncedAt: number | null;
    error: string | null;
}

type StatusListener = (status: SyncStatus) => void;
const statusListeners = new Set<StatusListener>();

let fsaHandle: any = null;
let lastKnownMtime = 0;
let pollTimer: number | null = null;
let writeTimer: number | null = null;
let syncing = false;
let getNativePathFn: () => string = () => "";
let onFocusHandler: (() => void) | null = null;

let status: SyncStatus = {
    backend: "unsupported",
    state: "unconfigured",
    targetLabel: null,
    lastSyncedAt: null,
    error: null,
};

function getNativeApi(): NativeApi | null {
    if (IS_WEB) return null;
    try {
        const helpers = (globalThis as any).VencordNative?.pluginHelpers;
        if (helpers?.UnlimitedFavorites?.readSyncFile && helpers?.UnlimitedFavorites?.writeSyncFile) {
            return helpers.UnlimitedFavorites as NativeApi;
        }
    } catch {
        // ignore
    }
    return null;
}

export function hasNativeFileSync(): boolean {
    return getNativeApi() !== null;
}

export function hasFsaFileSync(): boolean {
    return typeof (window as any).showSaveFilePicker === "function" ||
        typeof (window as any).showOpenFilePicker === "function";
}

function getBackend(): "native" | "fsa" | "unsupported" {
    if (hasNativeFileSync()) return "native";
    if (hasFsaFileSync()) return "fsa";
    return "unsupported";
}

function updateStatus(partial: Partial<SyncStatus>): void {
    status = {
        ...status,
        backend: getBackend(),
        ...partial,
    };
    for (const listener of statusListeners) {
        try {
            listener(status);
        } catch (err) {
            console.error("[UnlimitedFavorites] Sync status listener error:", err);
        }
    }
}

export function getSyncStatus(): SyncStatus {
    return status;
}

export function subscribeSyncStatus(listener: StatusListener): () => void {
    statusListeners.add(listener);
    return () => statusListeners.delete(listener);
}

function parseSyncDocument(rawText: string, currentUserId: string): SyncFileDocument {
    const parsed = JSON.parse(rawText);
    if (parsed && parsed.version === 1 && parsed.accounts && typeof parsed.accounts === "object") {
        return parsed as SyncFileDocument;
    }

    // Backwards-compatible support for single-account exported JSON files
    if (parsed && parsed.favorites && typeof parsed.favorites === "object") {
        const single = parsed as StoredFavoritesPayload;
        return {
            version: 1,
            updatedAt: typeof single.updatedAt === "number" ? single.updatedAt : Date.now(),
            accounts: {
                [currentUserId]: {
                    version: 1,
                    updatedAt: typeof single.updatedAt === "number" ? single.updatedAt : Date.now(),
                    favorites: single.favorites,
                    nativeOrderOverrides: single.nativeOrderOverrides ?? {},
                },
            },
        };
    }

    return {
        version: 1,
        updatedAt: 0,
        accounts: {},
    };
}

async function readBackendFile(): Promise<{
    ok: boolean;
    exists: boolean;
    content?: string;
    mtimeMs?: number;
    needsPermission?: boolean;
    error?: string;
}> {
    const native = getNativeApi();
    if (native) {
        const path = getNativePathFn().trim();
        if (!path) return { ok: false, exists: false };
        return native.readSyncFile(path);
    }

    if (!fsaHandle) return { ok: false, exists: false };

    try {
        const perm = await fsaHandle.queryPermission({ mode: "readwrite" });
        if (perm !== "granted") {
            return { ok: false, exists: true, needsPermission: true };
        }
        const file: File = await fsaHandle.getFile();
        const content = await file.text();
        return {
            ok: true,
            exists: content.trim().length > 0,
            content,
            mtimeMs: file.lastModified,
        };
    } catch (err: any) {
        return { ok: false, exists: false, error: String(err?.message ?? err) };
    }
}

async function writeBackendFile(content: string): Promise<{
    ok: boolean;
    mtimeMs?: number;
    needsPermission?: boolean;
    error?: string;
}> {
    const native = getNativeApi();
    if (native) {
        const path = getNativePathFn().trim();
        if (!path) return { ok: false, error: "No sync file path configured." };
        return native.writeSyncFile(path, content);
    }

    if (!fsaHandle) return { ok: false, error: "No sync file linked." };

    try {
        const perm = await fsaHandle.queryPermission({ mode: "readwrite" });
        if (perm !== "granted") {
            return { ok: false, needsPermission: true };
        }
        const writable = await fsaHandle.createWritable();
        await writable.write(content);
        await writable.close();
        const file: File = await fsaHandle.getFile();
        return { ok: true, mtimeMs: file.lastModified };
    } catch (err: any) {
        return { ok: false, error: String(err?.message ?? err) };
    }
}

function getTargetLabel(): string | null {
    if (hasNativeFileSync()) {
        const p = getNativePathFn().trim();
        return p || null;
    }
    return fsaHandle?.name ?? null;
}

export async function syncWithFile(options?: { forceWrite?: boolean; }): Promise<boolean> {
    if (syncing) return false;

    const target = getTargetLabel();
    if (!target) {
        updateStatus({ state: "unconfigured", targetLabel: null, error: null });
        return false;
    }

    syncing = true;
    try {
        const userId = resolveUserId();
        const localPayload = getCurrentAccountPayload();
        const readRes = await readBackendFile();

        if (readRes.needsPermission) {
            updateStatus({
                state: "needs-permission",
                targetLabel: target,
                error: "Click \"Reconnect Sync File\" to grant file access after restart.",
            });
            return false;
        }

        if (!readRes.ok) {
            updateStatus({
                state: "error",
                targetLabel: target,
                error: readRes.error ?? "Failed to read sync file.",
            });
            return false;
        }

        let doc: SyncFileDocument = {
            version: 1,
            updatedAt: 0,
            accounts: {},
        };

        if (readRes.exists && readRes.content && readRes.content.trim().length > 0) {
            try {
                doc = parseSyncDocument(readRes.content, userId);
            } catch (err: any) {
                updateStatus({
                    state: "error",
                    targetLabel: target,
                    error: `Sync file contains invalid JSON: ${String(err?.message ?? err)}`,
                });
                return false;
            }
        }

        const remoteAccount = doc.accounts[userId];
        const remoteUpdatedAt = typeof remoteAccount?.updatedAt === "number" ? remoteAccount.updatedAt : 0;
        const localUpdatedAt = typeof localPayload.updatedAt === "number" ? localPayload.updatedAt : 0;

        if (!options?.forceWrite && remoteAccount && remoteUpdatedAt > localUpdatedAt) {
            await applyExternalPayload(remoteAccount);
            lastKnownMtime = readRes.mtimeMs ?? Date.now();
            updateStatus({
                state: "synced",
                targetLabel: target,
                lastSyncedAt: Date.now(),
                error: null,
            });
            return true;
        }

        if (options?.forceWrite || !readRes.exists || localUpdatedAt > remoteUpdatedAt || !remoteAccount) {
            const now = Math.max(localUpdatedAt, Date.now());
            doc.version = 1;
            doc.updatedAt = now;
            doc.accounts[userId] = {
                ...localPayload,
                updatedAt: localUpdatedAt || now,
            };

            const writeRes = await writeBackendFile(JSON.stringify(doc, null, 2));
            if (writeRes.needsPermission) {
                updateStatus({
                    state: "needs-permission",
                    targetLabel: target,
                    error: "Click \"Reconnect Sync File\" to grant write permission.",
                });
                return false;
            }
            if (!writeRes.ok) {
                updateStatus({
                    state: "error",
                    targetLabel: target,
                    error: writeRes.error ?? "Failed to write sync file.",
                });
                return false;
            }

            lastKnownMtime = writeRes.mtimeMs ?? Date.now();
        } else {
            lastKnownMtime = readRes.mtimeMs ?? lastKnownMtime;
        }

        updateStatus({
            state: "synced",
            targetLabel: target,
            lastSyncedAt: Date.now(),
            error: null,
        });
        return true;
    } finally {
        syncing = false;
    }
}

export function scheduleSyncWrite(): void {
    if (!getTargetLabel()) return;
    if (writeTimer !== null) {
        window.clearTimeout(writeTimer);
    }
    writeTimer = window.setTimeout(() => {
        writeTimer = null;
        syncWithFile({ forceWrite: true }).catch(err => {
            console.error("[UnlimitedFavorites] Scheduled sync write failed:", err);
        });
    }, WRITE_DEBOUNCE_MS);
}

async function pollForExternalChanges(): Promise<void> {
    if (syncing || !getTargetLabel()) return;

    const native = getNativeApi();
    if (native) {
        const readRes = await readBackendFile();
        if (readRes.ok && readRes.exists && readRes.mtimeMs && readRes.mtimeMs !== lastKnownMtime) {
            await syncWithFile();
        }
        return;
    }

    if (fsaHandle) {
        try {
            const perm = await fsaHandle.queryPermission({ mode: "readwrite" });
            if (perm !== "granted") return;
            const file: File = await fsaHandle.getFile();
            if (file.lastModified !== lastKnownMtime) {
                await syncWithFile();
            }
        } catch {
            // ignore transient errors while Syncthing swaps files
        }
    }
}

export async function pickNativeSyncFile(currentPath?: string): Promise<string | null> {
    const native = getNativeApi();
    if (!native) return null;
    return native.pickSyncFile(currentPath);
}

export async function pickFsaSyncFile(mode: "create" | "open"): Promise<boolean> {
    try {
        let handle: any;
        if (mode === "create" && typeof (window as any).showSaveFilePicker === "function") {
            handle = await (window as any).showSaveFilePicker({
                suggestedName: "unlimited-favorites.json",
                types: [
                    {
                        description: "JSON Files",
                        accept: { "application/json": [".json"] },
                    },
                ],
            });
        } else if (typeof (window as any).showOpenFilePicker === "function") {
            const [picked] = await (window as any).showOpenFilePicker({
                multiple: false,
                types: [
                    {
                        description: "JSON Files",
                        accept: { "application/json": [".json"] },
                    },
                ],
            });
            handle = picked;
        } else {
            return false;
        }

        if (!handle) return false;
        const perm = await handle.requestPermission({ mode: "readwrite" });
        if (perm !== "granted") {
            updateStatus({
                state: "needs-permission",
                targetLabel: handle.name ?? null,
                error: "Read/write permission was not granted.",
            });
            return false;
        }

        fsaHandle = handle;
        await set(HANDLE_STORAGE_KEY, handle);
        lastKnownMtime = 0;
        return syncWithFile();
    } catch (err: any) {
        if (err?.name === "AbortError") return false;
        updateStatus({
            state: "error",
            error: String(err?.message ?? err),
        });
        return false;
    }
}

export async function reconnectFsaSyncFile(): Promise<boolean> {
    if (!fsaHandle) return false;
    try {
        const perm = await fsaHandle.requestPermission({ mode: "readwrite" });
        if (perm !== "granted") {
            updateStatus({
                state: "needs-permission",
                targetLabel: fsaHandle.name ?? null,
                error: "Read/write permission was not granted.",
            });
            return false;
        }
        lastKnownMtime = 0;
        return syncWithFile();
    } catch (err: any) {
        updateStatus({
            state: "error",
            error: String(err?.message ?? err),
        });
        return false;
    }
}

export async function unlinkFsaSyncFile(): Promise<void> {
    fsaHandle = null;
    lastKnownMtime = 0;
    await del(HANDLE_STORAGE_KEY);
    updateStatus({
        state: "unconfigured",
        targetLabel: null,
        lastSyncedAt: null,
        error: null,
    });
}

export async function startFileSync(getNativePath: () => string): Promise<void> {
    getNativePathFn = getNativePath;
    lastKnownMtime = 0;

    if (!hasNativeFileSync() && hasFsaFileSync()) {
        try {
            const saved = await get(HANDLE_STORAGE_KEY);
            if (saved) {
                fsaHandle = saved;
            }
        } catch (err) {
            console.warn("[UnlimitedFavorites] Failed to load saved sync file handle:", err);
        }
    }

    await syncWithFile();

    if (pollTimer === null) {
        pollTimer = window.setInterval(() => {
            pollForExternalChanges().catch(() => {});
        }, POLL_INTERVAL_MS);
    }

    if (!onFocusHandler) {
        onFocusHandler = () => {
            pollForExternalChanges().catch(() => {});
        };
        window.addEventListener("focus", onFocusHandler);
    }
}

export function stopFileSync(): void {
    if (pollTimer !== null) {
        window.clearInterval(pollTimer);
        pollTimer = null;
    }
    if (writeTimer !== null) {
        window.clearTimeout(writeTimer);
        writeTimer = null;
    }
    if (onFocusHandler) {
        window.removeEventListener("focus", onFocusHandler);
        onFocusHandler = null;
    }
    syncing = false;
}
