import { dialog, IpcMainInvokeEvent } from "electron";
import { mkdir, readFile, rename, stat, writeFile } from "fs/promises";
import { dirname, resolve } from "path";

export interface NativeReadResult {
    ok: boolean;
    exists: boolean;
    content?: string;
    mtimeMs?: number;
    error?: string;
}

export interface NativeWriteResult {
    ok: boolean;
    mtimeMs?: number;
    error?: string;
}

export async function readSyncFile(_: IpcMainInvokeEvent, rawPath: string): Promise<NativeReadResult> {
    if (!rawPath || typeof rawPath !== "string") {
        return { ok: false, exists: false, error: "Invalid file path." };
    }

    const filePath = resolve(rawPath.trim());
    try {
        const [content, info] = await Promise.all([
            readFile(filePath, "utf8"),
            stat(filePath),
        ]);
        return { ok: true, exists: true, content, mtimeMs: info.mtimeMs };
    } catch (err: any) {
        if (err?.code === "ENOENT") {
            return { ok: true, exists: false };
        }
        return { ok: false, exists: false, error: String(err?.message ?? err) };
    }
}

export async function writeSyncFile(_: IpcMainInvokeEvent, rawPath: string, content: string): Promise<NativeWriteResult> {
    if (!rawPath || typeof rawPath !== "string") {
        return { ok: false, error: "Invalid file path." };
    }

    const filePath = resolve(rawPath.trim());
    const tmpPath = `${filePath}.tmp-${Date.now()}`;

    try {
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(tmpPath, content, "utf8");
        await rename(tmpPath, filePath);
        const info = await stat(filePath);
        return { ok: true, mtimeMs: info.mtimeMs };
    } catch (err: any) {
        return { ok: false, error: String(err?.message ?? err) };
    }
}

export async function pickSyncFile(_: IpcMainInvokeEvent, defaultPath?: string): Promise<string | null> {
    const result = await dialog.showSaveDialog({
        title: "Choose UnlimitedFavorites Sync File",
        defaultPath: defaultPath?.trim() || "unlimited-favorites.json",
        filters: [
            { name: "JSON Files", extensions: ["json"] },
            { name: "All Files", extensions: ["*"] },
        ],
    });

    if (result.canceled || !result.filePath) return null;
    return result.filePath;
}
