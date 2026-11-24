import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { Paragraph } from "@components/Paragraph";
import { OptionType } from "@utils/types";
import { React, showToast, TextArea, TextInput } from "@webpack/common";

import { openFavoritesModal } from "./components/FavoritesModal";
import {
    getSyncStatus,
    hasFsaFileSync,
    hasNativeFileSync,
    pickFsaSyncFile,
    pickNativeSyncFile,
    reconnectFsaSyncFile,
    subscribeSyncStatus,
    SyncStatus,
    syncWithFile,
    unlinkFsaSyncFile,
} from "./fileSync";
import { refreshServerIcons } from "./serverIconDecorator";
import {
    clearLocalFavorites,
    exportFavoritesJson,
    getLocalFavoritesList,
    importFavoritesMap,
    subscribeFavorites,
} from "./storage";
import { emitFavoriteStoreChange, getNativeFavoriteChannels } from "./storePatch";
import { FavoriteChannelType, StoredFavoritesPayload } from "./types";

function FileSyncSettingsComponent() {
    const [syncStatus, setSyncStatus] = React.useState<SyncStatus>(() => getSyncStatus());
    const [pathInput, setPathInput] = React.useState<string>(() => settings.store.syncFilePath ?? "");

    React.useEffect(() => {
        return subscribeSyncStatus(setSyncStatus);
    }, []);

    const isNative = hasNativeFileSync();
    const isFsa = hasFsaFileSync();

    async function handleBrowseNative() {
        const picked = await pickNativeSyncFile(pathInput);
        if (!picked) return;
        setPathInput(picked);
        settings.store.syncFilePath = picked;
        const ok = await syncWithFile();
        showToast({
            text: ok ? `Synced favorites with ${picked}` : "Sync path saved (check status for details).",
            variant: ok ? "success" : "default",
        });
    }

    async function handleApplyNativePath() {
        settings.store.syncFilePath = pathInput.trim();
        const ok = await syncWithFile();
        showToast({
            text: !pathInput.trim()
                ? "Disabled file sync."
                : ok
                    ? "Synced favorites with custom file."
                    : "Could not sync with that path — check error below.",
            variant: ok || !pathInput.trim() ? "success" : "critical",
        });
    }

    async function handlePickFsa(mode: "create" | "open") {
        const ok = await pickFsaSyncFile(mode);
        if (ok) {
            showToast({
                text: "Linked and synced favorites file!",
                variant: "success",
            });
        }
    }

    async function handleReconnectFsa() {
        const ok = await reconnectFsaSyncFile();
        showToast({
            text: ok ? "Reconnected and synced favorites file!" : "Could not reconnect sync file.",
            variant: ok ? "success" : "critical",
        });
    }

    async function handleManualSync() {
        const ok = await syncWithFile();
        showToast({
            text: ok ? "Favorites synced with file." : "Sync failed or file not configured.",
            variant: ok ? "success" : "critical",
        });
    }

    async function handleUnlink() {
        if (isNative) {
            setPathInput("");
            settings.store.syncFilePath = "";
            await syncWithFile();
        } else {
            await unlinkFsaSyncFile();
        }
        showToast({
            text: "Unlinked sync file.",
            variant: "success",
        });
    }

    const statusLine = (() => {
        if (syncStatus.state === "synced" && syncStatus.targetLabel) {
            const time = syncStatus.lastSyncedAt
                ? new Date(syncStatus.lastSyncedAt).toLocaleTimeString()
                : "";
            return `Synced with ${syncStatus.targetLabel}${time ? ` (last synced ${time})` : ""}`;
        }
        if (syncStatus.state === "needs-permission" && syncStatus.targetLabel) {
            return `File linked (${syncStatus.targetLabel}), but needs permission after restart.`;
        }
        if (syncStatus.state === "error") {
            return `Sync error: ${syncStatus.error ?? "Unknown error"}`;
        }
        return "No sync file configured. Favorites are saved locally in Discord's DataStore only.";
    })();

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Paragraph>
                Point this at a JSON file inside a synced folder (e.g. Syncthing, Dropbox, OneDrive) to automatically sync favorites across devices.
            </Paragraph>

            <Paragraph style={{ fontSize: 13, opacity: 0.85 }}>
                <strong>Status:</strong> {statusLine}
            </Paragraph>

            {isNative ? (
                <>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <div style={{ flex: 1 }}>
                            <TextInput
                                value={pathInput}
                                onChange={setPathInput}
                                placeholder="e.g. C:\Users\you\Syncthing\discord-favorites.json"
                            />
                        </div>
                        <Button size="small" variant="secondary" onClick={handleBrowseNative}>
                            Browse...
                        </Button>
                        <Button size="small" variant="positive" onClick={handleApplyNativePath}>
                            Save Path
                        </Button>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        <Button
                            size="small"
                            variant="secondary"
                            disabled={!syncStatus.targetLabel}
                            onClick={handleManualSync}
                        >
                            Sync Now
                        </Button>
                        <Button
                            size="small"
                            variant="dangerPrimary"
                            disabled={!syncStatus.targetLabel}
                            onClick={handleUnlink}
                        >
                            Disable File Sync
                        </Button>
                    </div>
                </>
            ) : isFsa ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    <Button size="small" onClick={() => handlePickFsa("create")}>
                        Create / Pick Sync File
                    </Button>
                    <Button size="small" variant="secondary" onClick={() => handlePickFsa("open")}>
                        Link Existing Sync File
                    </Button>
                    {syncStatus.state === "needs-permission" && (
                        <Button size="small" variant="positive" onClick={handleReconnectFsa}>
                            Reconnect Sync File
                        </Button>
                    )}
                    <Button
                        size="small"
                        variant="secondary"
                        disabled={!syncStatus.targetLabel}
                        onClick={handleManualSync}
                    >
                        Sync Now
                    </Button>
                    <Button
                        size="small"
                        variant="dangerPrimary"
                        disabled={!syncStatus.targetLabel}
                        onClick={handleUnlink}
                    >
                        Unlink File
                    </Button>
                </div>
            ) : (
                <Paragraph style={{ opacity: 0.75 }}>
                    File sync is not supported in this browser environment. Use Export/Import JSON below instead.
                </Paragraph>
            )}
        </div>
    );
}

function ManageFavoritesSettingsComponent() {
    const [count, setCount] = React.useState(
        () => getLocalFavoritesList().filter(f => f.type === FavoriteChannelType.REFERENCE_ORIGINAL).length
    );
    const [showImportBox, setShowImportBox] = React.useState(false);
    const [importText, setImportText] = React.useState("");

    React.useEffect(() => {
        return subscribeFavorites(() => {
            setCount(
                getLocalFavoritesList().filter(f => f.type === FavoriteChannelType.REFERENCE_ORIGINAL).length
            );
        });
    }, []);

    async function handleImportNative() {
        const native = getNativeFavoriteChannels();
        const imported = await importFavoritesMap(native);
        showToast({
            text: imported > 0
                ? `Imported ${imported} native favorite channel${imported === 1 ? "" : "s"}.`
                : "No new native favorites found to import.",
            variant: imported > 0 ? "success" : "default",
        });
    }

    async function handleExport() {
        try {
            await navigator.clipboard.writeText(exportFavoritesJson());
            showToast({
                text: "Copied local favorites JSON to clipboard.",
                variant: "success",
            });
        } catch {
            showToast({
                text: "Could not copy JSON to clipboard.",
                variant: "critical",
            });
        }
    }

    async function handleImportJson() {
        try {
            const parsed = JSON.parse(importText) as Partial<StoredFavoritesPayload>;
            const map = parsed.favorites ?? (parsed as any);
            if (!map || typeof map !== "object") {
                throw new Error("Invalid format");
            }
            const imported = await importFavoritesMap(map);
            showToast({
                text: `Imported ${imported} favorite channel${imported === 1 ? "" : "s"}.`,
                variant: "success",
            });
            setImportText("");
            setShowImportBox(false);
        } catch {
            showToast({
                text: "Invalid JSON backup format.",
                variant: "critical",
            });
        }
    }

    async function handleClear() {
        await clearLocalFavorites();
        showToast({
            text: "Cleared all local favorites.",
            variant: "success",
        });
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Paragraph>
                Currently storing <strong>{count}</strong> local favorite channel{count === 1 ? "" : "s"} on this device.
            </Paragraph>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <Button size="small" onClick={openFavoritesModal}>
                    Open Favorites Manager
                </Button>
                <Button size="small" variant="secondary" onClick={handleImportNative}>
                    Import Native Favorites
                </Button>
                <Button size="small" variant="secondary" onClick={handleExport}>
                    Export JSON
                </Button>
                <Button
                    size="small"
                    variant="secondary"
                    onClick={() => setShowImportBox(v => !v)}
                >
                    {showImportBox ? "Hide JSON Import" : "Import JSON"}
                </Button>
                <Button
                    size="small"
                    variant="dangerPrimary"
                    disabled={count === 0}
                    onClick={handleClear}
                >
                    Clear All
                </Button>
            </div>

            {showImportBox && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
                    <TextArea
                        value={importText}
                        onChange={setImportText}
                        placeholder="Paste exported UnlimitedFavorites JSON here..."
                        rows={5}
                    />
                    <div>
                        <Button size="small" variant="positive" onClick={handleImportJson}>
                            Apply JSON Import
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}

export const settings = definePluginSettings({
    enableStoreIntegration: {
        type: OptionType.BOOLEAN,
        description: "Merge local favorites into Discord's native Favorites tab (FavoriteStore).",
        default: true,
        onChange: () => emitFavoriteStoreChange(),
    },
    forceShowFavoritesTab: {
        type: OptionType.BOOLEAN,
        description: "Show Discord's Favorites server tab in the sidebar whenever you have local favorites (no Nitro required).",
        default: true,
        onChange: () => emitFavoriteStoreChange(),
    },
    showServerIcon: {
        type: OptionType.BOOLEAN,
        description: "Show the server's icon next to a compact # icon for favorited server channels.",
        default: true,
        onChange: () => refreshServerIcons(),
    },
    showToasts: {
        type: OptionType.BOOLEAN,
        description: "Show a toast notification when adding or removing a local favorite channel.",
        default: true,
    },
    syncFilePath: {
        type: OptionType.STRING,
        description: "Internal storage for Desktop Vencord custom sync file path.",
        default: "",
        hidden: true,
    },
    fileSync: {
        type: OptionType.COMPONENT,
        description: "Sync favorites to a custom file path (e.g. inside a Syncthing folder).",
        component: FileSyncSettingsComponent,
    },
    manageFavorites: {
        type: OptionType.COMPONENT,
        description: "Manage, reorder, rename, import, or export your local favorite channels.",
        component: ManageFavoritesSettingsComponent,
    },
});
