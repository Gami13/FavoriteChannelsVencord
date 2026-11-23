import { ChannelStore, GuildStore, IconUtils, SelectedGuildStore } from "@webpack/common";

const BADGE_CLASS = "vc-uf-server-icon";
const ICON_SCALED_ATTR = "data-vc-uf-scaled";
const STYLE_ID = "vc-uf-server-icon-style";

let observer: MutationObserver | null = null;
let rafId: number | null = null;
let isEnabledFn: () => boolean = () => true;

function ensureStyles(): void {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
        .${BADGE_CLASS} {
            width: 20px;
            height: 20px;
            border-radius: 50%;
            object-fit: cover;
            flex-shrink: 0;
            margin-right: -3px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            background-color: var(--background-primary, #313338);
            color: var(--text-normal, #dbdee1);
            font-size: 9px;
            font-weight: 700;
            line-height: 1;
            overflow: hidden;
            user-select: none;
            vertical-align: middle;
        }
        [${ICON_SCALED_ATTR}="true"] {
            width: 14px !important;
            height: 14px !important;
            min-width: 14px !important;
            opacity: 0.72;
            margin-left: 0 !important;
            margin-right: -3px !important;
        }
        [${ICON_SCALED_ATTR}="true"] svg {
            width: 14px !important;
            height: 14px !important;
        }
    `;
    document.head.appendChild(style);
}

function removeStyles(): void {
    document.getElementById(STYLE_ID)?.remove();
}

function getGuildAcronym(name: string): string {
    return name
        .replace(/'s /g, " ")
        .replace(/\w+/g, e => e[0])
        .replace(/\s/g, "")
        .slice(0, 3)
        .toUpperCase();
}

function extractChannelId(anchor: HTMLElement): string | null {
    const listItemId = anchor.getAttribute("data-list-item-id");
    if (listItemId) {
        const match = listItemId.match(/^channels___(\d+)$/);
        if (match) return match[1];
    }

    const href = anchor.getAttribute("href");
    if (href) {
        const match = href.match(/^\/channels\/(?:@favorites|@me|\d+)\/(\d+)$/);
        if (match) return match[1];
    }

    return null;
}

function cleanupElement(anchor: HTMLElement): void {
    anchor.querySelectorAll(`.${BADGE_CLASS}`).forEach(el => el.remove());
    anchor.querySelectorAll(`[${ICON_SCALED_ATTR}="true"]`).forEach(el => {
        el.removeAttribute(ICON_SCALED_ATTR);
    });
}

function decorateChannelAnchor(anchor: HTMLElement): void {
    if (!isEnabledFn()) {
        cleanupElement(anchor);
        return;
    }

    const channelId = extractChannelId(anchor);
    if (!channelId) return;

    const channel = ChannelStore.getChannel(channelId);
    const guildId = channel?.guild_id;

    // Only decorate server channels when NOT currently viewing that channel's own server
    if (!guildId || SelectedGuildStore.getGuildId() === guildId) {
        cleanupElement(anchor);
        return;
    }

    const guild = GuildStore.getGuild(guildId);
    if (!guild) {
        cleanupElement(anchor);
        return;
    }

    // Check if already decorated for this guild
    const existing = anchor.querySelector(`.${BADGE_CLASS}`) as HTMLElement | null;
    if (existing && existing.dataset.guildId === guildId) {
        return;
    }

    cleanupElement(anchor);

    // Locate the channel's leading icon container (the '#' or voice/forum SVG wrapper)
    const svg = anchor.querySelector("svg");
    if (!svg) return;

    const iconWrapper = svg.parentElement;
    if (!iconWrapper || !iconWrapper.parentElement) return;

    // Build the server icon element (image if available, otherwise acronym badge)
    const iconUrl = guild.icon
        ? IconUtils.getGuildIconURL({
            id: guild.id,
            icon: guild.icon,
            size: 64,
            canAnimate: false,
        })
        : null;

    let badge: HTMLElement;
    if (iconUrl) {
        const img = document.createElement("img");
        img.src = iconUrl;
        img.alt = guild.name;
        img.title = guild.name;
        img.className = BADGE_CLASS;
        img.dataset.guildId = guildId;
        badge = img;
    } else {
        const div = document.createElement("div");
        div.textContent = (guild as any).acronym || getGuildAcronym(guild.name);
        div.title = guild.name;
        div.className = BADGE_CLASS;
        div.dataset.guildId = guildId;
        badge = div;
    }

    // Scale down the '#' icon right beside the server icon
    iconWrapper.setAttribute(ICON_SCALED_ATTR, "true");
    iconWrapper.parentElement.insertBefore(badge, iconWrapper);
}

export function refreshServerIcons(): void {
    const anchors = document.querySelectorAll<HTMLElement>(
        'a[data-list-item-id^="channels___"], a[href^="/channels/@favorites/"]'
    );
    anchors.forEach(decorateChannelAnchor);
}

function scheduleRefresh(): void {
    if (rafId !== null) return;
    rafId = window.requestAnimationFrame(() => {
        rafId = null;
        refreshServerIcons();
    });
}

export function startServerIconDecorator(isEnabled: () => boolean): void {
    isEnabledFn = isEnabled;
    ensureStyles();

    if (!observer) {
        observer = new MutationObserver(() => {
            scheduleRefresh();
        });
        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });
    }

    scheduleRefresh();
}

export function stopServerIconDecorator(): void {
    if (observer) {
        observer.disconnect();
        observer = null;
    }
    if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
    }

    document.querySelectorAll(`.${BADGE_CLASS}`).forEach(el => el.remove());
    document.querySelectorAll(`[${ICON_SCALED_ATTR}="true"]`).forEach(el => {
        el.removeAttribute(ICON_SCALED_ATTR);
    });
    removeStyles();
}
