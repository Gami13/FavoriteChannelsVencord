import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { ChannelStore, Menu, Toasts } from "@webpack/common";

import { openFavoritesModal } from "./components/FavoritesModal";
import { settings } from "./settings";
import { isLocalFavorite, toggleLocalFavorite } from "./storage";

function showFavoriteToast(added: boolean, channelName?: string): void {
    if (!settings.store.showToasts) return;

    const label = channelName ? `#${channelName}` : "channel";
    Toasts.show({
        message: added
            ? `Added ${label} to local favorites.`
            : `Removed ${label} from local favorites.`,
        type: Toasts.Type.SUCCESS,
        id: Toasts.genId(),
    });
}

function injectFavoriteMenuItems(children: any[], channelId: string | undefined, channelName?: string): void {
    if (!channelId) return;

    const favorited = isLocalFavorite(channelId);
    const items = [
        <Menu.MenuItem
            key="vc-unlimited-favorites-toggle"
            id="vc-unlimited-favorites-toggle"
            label={favorited ? "Remove from Local Favorites" : "Add to Local Favorites"}
            color={favorited ? "danger" : undefined}
            action={async () => {
                const nowFavorited = await toggleLocalFavorite(channelId);
                showFavoriteToast(nowFavorited, channelName);
            }}
        />,
        <Menu.MenuItem
            key="vc-unlimited-favorites-manage"
            id="vc-unlimited-favorites-manage"
            label="Manage Local Favorites"
            action={() => openFavoritesModal()}
        />,
    ];

    const group =
        findGroupChildrenByChildId("favorite-channel", children) ??
        findGroupChildrenByChildId("mute-channel", children) ??
        findGroupChildrenByChildId("mark-channel-read", children) ??
        findGroupChildrenByChildId("close-dm", children);

    if (group) {
        group.push(...items);
    } else {
        children.push(
            <Menu.MenuGroup key="vc-unlimited-favorites-group">
                {items}
            </Menu.MenuGroup>
        );
    }
}

export const channelContextMenuPatch: NavContextMenuPatchCallback = (children, { channel }) => {
    if (!channel?.id) return;
    // Skip category channels (type 4)
    if (channel.type === 4) return;

    injectFavoriteMenuItems(children, channel.id, channel.name);
};

export const threadContextMenuPatch: NavContextMenuPatchCallback = (children, { channel }) => {
    if (!channel?.id) return;
    injectFavoriteMenuItems(children, channel.id, channel.name);
};

export const gdmContextMenuPatch: NavContextMenuPatchCallback = (children, { channel }) => {
    if (!channel?.id) return;
    injectFavoriteMenuItems(children, channel.id, channel.name || "Group DM");
};

export const userContextMenuPatch: NavContextMenuPatchCallback = (children, { channel, user }) => {
    const channelId = channel?.id ?? (user?.id ? ChannelStore.getDMFromUserId(user.id) : undefined);
    if (!channelId) return;

    injectFavoriteMenuItems(children, channelId, user?.username);
};
