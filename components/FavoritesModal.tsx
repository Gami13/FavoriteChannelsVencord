import { Button } from "@components/Button";
import { Heading } from "@components/LegacyHeading";
import { Paragraph } from "@components/Paragraph";
import {
    ModalCloseButton,
    ModalContent,
    ModalFooter,
    ModalHeader,
    ModalProps,
    ModalRoot,
    ModalSize,
    openModal,
} from "@utils/modal";
import {
    ChannelStore,
    GuildStore,
    NavigationRouter,
    React,
    showToast,
    TextInput,
    UserStore,
} from "@webpack/common";

import {
    exportFavoritesJson,
    getLocalFavoritesList,
    importFavoritesMap,
    moveLocalFavorite,
    removeLocalFavorite,
    setFavoriteNickname,
    subscribeFavorites,
} from "../storage";
import { getNativeFavoriteChannels } from "../storePatch";
import { FavoriteChannelType, LocalFavoriteChannel } from "../types";

function resolveChannelDisplay(channelId: string): {
    name: string;
    subtitle: string;
    guildId: string | null;
} {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel) {
        return {
            name: `Unknown Channel (${channelId})`,
            subtitle: "Channel unavailable or inaccessible",
            guildId: null,
        };
    }

    const guildId = channel.guild_id ?? null;
    if (guildId) {
        const guild = GuildStore.getGuild(guildId);
        return {
            name: `#${channel.name || channelId}`,
            subtitle: guild?.name ?? `Server ${guildId}`,
            guildId,
        };
    }

    if (channel.name) {
        return {
            name: channel.name,
            subtitle: "Group DM",
            guildId: null,
        };
    }

    const recipientIds: string[] = channel.recipients ?? [];
    if (recipientIds.length > 0) {
        const names = recipientIds
            .map(id => UserStore.getUser(id)?.username ?? id)
            .join(", ");
        return {
            name: `@${names}`,
            subtitle: recipientIds.length > 1 ? "Group DM" : "Direct Message",
            guildId: null,
        };
    }

    return {
        name: `DM (${channelId})`,
        subtitle: "Direct Message",
        guildId: null,
    };
}

function jumpToChannel(channelId: string, guildId: string | null): void {
    const target = guildId ? `/channels/${guildId}/${channelId}` : `/channels/@me/${channelId}`;
    NavigationRouter.transitionTo(target);
}

function FavoritesModalComponent({ modalProps }: { modalProps: ModalProps; }) {
    const [favorites, setFavorites] = React.useState<LocalFavoriteChannel[]>(() =>
        getLocalFavoritesList().filter(f => f.type === FavoriteChannelType.REFERENCE_ORIGINAL)
    );
    const [search, setSearch] = React.useState("");
    const [editingId, setEditingId] = React.useState<string | null>(null);
    const [draftNickname, setDraftNickname] = React.useState("");

    React.useEffect(() => {
        return subscribeFavorites(() => {
            setFavorites(
                getLocalFavoritesList().filter(f => f.type === FavoriteChannelType.REFERENCE_ORIGINAL)
            );
        });
    }, []);

    const query = search.trim().toLowerCase();
    const filtered = favorites.filter(fav => {
        if (!query) return true;
        const info = resolveChannelDisplay(fav.id);
        return (
            info.name.toLowerCase().includes(query) ||
            info.subtitle.toLowerCase().includes(query) ||
            (fav.nickname ?? "").toLowerCase().includes(query) ||
            fav.id.includes(query)
        );
    });

    async function handleImportNative() {
        const native = getNativeFavoriteChannels();
        const count = await importFavoritesMap(native);
        showToast({
            text: count > 0
                ? `Imported ${count} native favorite channel${count === 1 ? "" : "s"}.`
                : "No new native favorites to import.",
            variant: count > 0 ? "success" : "default",
        });
    }

    async function handleCopyBackup() {
        try {
            await navigator.clipboard.writeText(exportFavoritesJson());
            showToast({
                text: "Copied local favorites JSON to clipboard.",
                variant: "success",
            });
        } catch {
            showToast({
                text: "Failed to copy to clipboard.",
                variant: "critical",
            });
        }
    }

    async function saveNickname(channelId: string) {
        await setFavoriteNickname(channelId, draftNickname);
        setEditingId(null);
        setDraftNickname("");
    }

    return (
        <ModalRoot {...modalProps} size={ModalSize.MEDIUM}>
            <ModalHeader separator={false}>
                <Heading tag="h2" style={{ margin: 0, flexGrow: 1 }}>
                    Local Favorite Channels ({favorites.length})
                </Heading>
                <ModalCloseButton onClick={modalProps.onClose} />
            </ModalHeader>

            <ModalContent style={{ paddingBottom: 16 }}>
                <div style={{ marginBottom: 12 }}>
                    <TextInput
                        value={search}
                        onChange={setSearch}
                        placeholder="Filter favorite channels by name, server, or nickname..."
                    />
                </div>

                {filtered.length === 0 ? (
                    <Paragraph style={{ textAlign: "center", padding: "24px 8px", opacity: 0.75 }}>
                        {favorites.length === 0
                            ? "No local favorites yet. Right-click any channel or DM and select \"Add to Local Favorites\"."
                            : "No favorite channels match your search."}
                    </Paragraph>
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {filtered.map((fav, idx) => {
                            const info = resolveChannelDisplay(fav.id);
                            const isEditing = editingId === fav.id;

                            return (
                                <div
                                    key={fav.id}
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                        gap: 8,
                                        padding: "10px 12px",
                                        borderRadius: 8,
                                        backgroundColor: "var(--background-secondary)",
                                    }}
                                >
                                    <div style={{ minWidth: 0, flex: 1 }}>
                                        {isEditing ? (
                                            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                                <TextInput
                                                    value={draftNickname}
                                                    onChange={setDraftNickname}
                                                    placeholder={info.name}
                                                />
                                                <Button
                                                    size="small"
                                                    variant="positive"
                                                    onClick={() => saveNickname(fav.id)}
                                                >
                                                    Save
                                                </Button>
                                                <Button
                                                    size="small"
                                                    variant="secondary"
                                                    onClick={() => setEditingId(null)}
                                                >
                                                    Cancel
                                                </Button>
                                            </div>
                                        ) : (
                                            <>
                                                <Paragraph
                                                    style={{
                                                        fontWeight: 600,
                                                        overflow: "hidden",
                                                        textOverflow: "ellipsis",
                                                        whiteSpace: "nowrap",
                                                    }}
                                                >
                                                    {fav.nickname ? `${fav.nickname} (${info.name})` : info.name}
                                                </Paragraph>
                                                <Paragraph
                                                    style={{
                                                        fontSize: 12,
                                                        opacity: 0.7,
                                                        overflow: "hidden",
                                                        textOverflow: "ellipsis",
                                                        whiteSpace: "nowrap",
                                                    }}
                                                >
                                                    {info.subtitle}
                                                </Paragraph>
                                            </>
                                        )}
                                    </div>

                                    {!isEditing && (
                                        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                                            <Button
                                                size="small"
                                                variant="secondary"
                                                disabled={idx === 0 || Boolean(query)}
                                                onClick={() => moveLocalFavorite(fav.id, -1)}
                                            >
                                                ↑
                                            </Button>
                                            <Button
                                                size="small"
                                                variant="secondary"
                                                disabled={idx === filtered.length - 1 || Boolean(query)}
                                                onClick={() => moveLocalFavorite(fav.id, 1)}
                                            >
                                                ↓
                                            </Button>
                                            <Button
                                                size="small"
                                                variant="secondary"
                                                onClick={() => {
                                                    setEditingId(fav.id);
                                                    setDraftNickname(fav.nickname ?? "");
                                                }}
                                            >
                                                Rename
                                            </Button>
                                            <Button
                                                size="small"
                                                variant="primary"
                                                onClick={() => {
                                                    jumpToChannel(fav.id, info.guildId);
                                                    modalProps.onClose();
                                                }}
                                            >
                                                Jump
                                            </Button>
                                            <Button
                                                size="small"
                                                variant="dangerPrimary"
                                                onClick={() => removeLocalFavorite(fav.id)}
                                            >
                                                Remove
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </ModalContent>

            <ModalFooter>
                <div style={{ display: "flex", gap: 8, width: "100%", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", gap: 8 }}>
                        <Button
                            size="small"
                            variant="secondary"
                            onClick={handleImportNative}
                        >
                            Import Native Favorites
                        </Button>
                        <Button
                            size="small"
                            variant="secondary"
                            onClick={handleCopyBackup}
                        >
                            Copy JSON Backup
                        </Button>
                    </div>
                    <Button size="small" onClick={modalProps.onClose}>
                        Done
                    </Button>
                </div>
            </ModalFooter>
        </ModalRoot>
    );
}

export function openFavoritesModal(): void {
    openModal(modalProps => <FavoritesModalComponent modalProps={modalProps} />);
}
