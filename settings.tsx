import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";
import { Button, Forms, React, TextArea, Toasts } from "@webpack/common";

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
        Toasts.show({
            message: imported > 0
                ? `Imported ${imported} native favorite channel${imported === 1 ? "" : "s"}.`
                : "No new native favorites found to import.",
            type: imported > 0 ? Toasts.Type.SUCCESS : Toasts.Type.MESSAGE,
            id: Toasts.genId(),
        });
    }

    async function handleExport() {
        try {
            await navigator.clipboard.writeText(exportFavoritesJson());
            Toasts.show({
                message: "Copied local favorites JSON to clipboard.",
                type: Toasts.Type.SUCCESS,
                id: Toasts.genId(),
            });
        } catch {
            Toasts.show({
                message: "Could not copy JSON to clipboard.",
                type: Toasts.Type.FAILURE,
                id: Toasts.genId(),
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
            Toasts.show({
                message: `Imported ${imported} favorite channel${imported === 1 ? "" : "s"}.`,
                type: Toasts.Type.SUCCESS,
                id: Toasts.genId(),
            });
            setImportText("");
            setShowImportBox(false);
        } catch {
            Toasts.show({
                message: "Invalid JSON backup format.",
                type: Toasts.Type.FAILURE,
                id: Toasts.genId(),
            });
        }
    }

    async function handleClear() {
        await clearLocalFavorites();
        Toasts.show({
            message: "Cleared all local favorites.",
            type: Toasts.Type.SUCCESS,
            id: Toasts.genId(),
        });
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Forms.FormText>
                Currently storing <strong>{count}</strong> local favorite channel{count === 1 ? "" : "s"} on this device.
            </Forms.FormText>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <Button size={Button.Sizes.SMALL} onClick={openFavoritesModal}>
                    Open Favorites Manager
                </Button>
                <Button size={Button.Sizes.SMALL} color={Button.Colors.PRIMARY} onClick={handleImportNative}>
                    Import Native Favorites
                </Button>
                <Button size={Button.Sizes.SMALL} color={Button.Colors.PRIMARY} onClick={handleExport}>
                    Export JSON
                </Button>
                <Button
                    size={Button.Sizes.SMALL}
                    color={Button.Colors.PRIMARY}
                    onClick={() => setShowImportBox(v => !v)}
                >
                    {showImportBox ? "Hide JSON Import" : "Import JSON"}
                </Button>
                <Button
                    size={Button.Sizes.SMALL}
                    color={Button.Colors.RED}
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
                        <Button size={Button.Sizes.SMALL} color={Button.Colors.GREEN} onClick={handleImportJson}>
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
