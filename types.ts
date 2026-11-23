export const enum FavoriteChannelType {
    UNSET = 0,
    REFERENCE_ORIGINAL = 1,
    CATEGORY = 2,
}

export interface LocalFavoriteChannel {
    id: string;
    nickname: string;
    type: FavoriteChannelType;
    order: number;
    parentId: string | null;
}

export type FavoriteChannelMap = Record<string, LocalFavoriteChannel>;

export interface StoredFavoritesPayload {
    version: 1;
    favorites: FavoriteChannelMap;
}
