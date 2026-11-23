import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { Paragraph } from "@components/Paragraph";
import { OptionType } from "@utils/types";
import { React, showToast, TextArea } from "@webpack/common";

import { openFavoritesModal } from "./components/FavoritesModal";
import {
    clearLocalFavorites,
    exportFavoritesJson,
    getLocalFavoritesList,
    importFavoritesMap,
    subscribeFavorites,
} from "./storage";
import { emitFavoriteStoreChange, getNativeFavoriteChannels } from "./storePatch";
import { FavoriteChannelType, StoredFavoritesPayload } from "./types";

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
    showToasts: {
        type: OptionType.BOOLEAN,
        description: "Show a toast notification when adding or removing a local favorite channel.",
        default: true,
    },
    manageFavorites: {
        type: OptionType.COMPONENT,
        description: "Manage, reorder, rename, import, or export your local favorite channels.",
        component: ManageFavoritesSettingsComponent,
    },
});
