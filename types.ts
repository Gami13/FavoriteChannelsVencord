export const enum FavoriteChannelType {
    UNSET = 0,
    REFERENCE_ORIGINAL = 1,
    CATEGORY = 2,
}

export interface LocalFavoriteChannel {
    id: string;
    nickname: string | null;
    type: FavoriteChannelType;
    channelType?: number;
    order: number;
    parentId: string | null;
}

export type FavoriteChannelMap = Record<string, LocalFavoriteChannel>;

export interface StoredFavoritesPayload {
    version: 1;
    updatedAt?: number;
    favorites: FavoriteChannelMap;
    nativeOrderOverrides?: Record<string, number>;
}

export interface SyncFileDocument {
    version: 1;
    updatedAt: number;
    accounts: Record<string, StoredFavoritesPayload>;
}
