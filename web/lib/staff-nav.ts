/*
 * The staff sidebars. Each area links only inside itself (/admin or /console), plus one way back to the chat.
 * Admins can still open the console by URL; the role checks don't change. Pages not built yet are listed as later.
 */

export const CHAT_HREF = "/chat";

export type NavLink = { id: string; href: string; label: string; icon: string };
export type NavArea = { root: string; work: NavLink[]; later: { label: string; icon: string }[] };

export const ADMIN_NAV: NavArea = {
  root: "/admin",
  work: [
    { id: "home", href: "/admin", label: "Home", icon: "layout-dashboard" },
    { id: "products", href: "/admin/products", label: "Products", icon: "package" },
    { id: "rules", href: "/admin/rules", label: "Rules", icon: "sliders-horizontal" },
    { id: "analytics", href: "/admin/analytics", label: "Analytics", icon: "chart-column" },
    { id: "sentiment", href: "/admin/sentiment", label: "Sentiment", icon: "smile" },
    { id: "audit", href: "/admin/audit", label: "Audit log", icon: "scroll-text" },
    { id: "users", href: "/admin/users", label: "Users and roles", icon: "users" },
    { id: "specialists", href: "/admin/specialists", label: "Specialists", icon: "calendar-clock" },
  ],
  later: [],
};

export const CONSOLE_NAV: NavArea = {
  root: "/console",
  work: [
    { id: "reviews", href: "/console/reviews", label: "Reviews", icon: "inbox" },
    { id: "win-rate", href: "/console/reviews#win-rate", label: "Win rate", icon: "trending-up" },
    { id: "calendar", href: "/console/calendar", label: "Calendar", icon: "calendar-days" },
    { id: "products", href: "/console/products", label: "Products", icon: "package" },
  ],
  later: [
    { label: "Parameters", icon: "sliders-horizontal" }, { label: "Audit log", icon: "scroll-text" },
  ],
};

/** True when a link stays in its area or goes back to the chat. */
export const staysInArea = (area: NavArea, href: string) => href === CHAT_HREF || href === area.root || href.startsWith(`${area.root}/`);
