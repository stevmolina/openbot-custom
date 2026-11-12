/** The key under which this browser keeps the web client's theme. */
export const WEB_APPEARANCE_STORAGE_KEY = "openbot.web.appearance";

/**
 * An inline script for the head of `/app`. It shows the saved theme before the first paint: without
 * it, the loading screen paints dark until its code runs. No saved theme leaves the dark default.
 * The loading screen's code then takes over, and removes the attribute when the user leaves `/app`.
 */
/** The browser bar and status bar colors that go with `--openbot-bg-canvas` in the dark and light themes. */
export const WEB_THEME_COLORS = { dark: "#1a1a1a", light: "#f5f5f6" } as const;

const THEME_COLOR_SCRIPT = `var c=${JSON.stringify(WEB_THEME_COLORS)};var d=document.documentElement;function t(){var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",d.dataset.openbotColorScheme==="light"?c.light:c.dark)}new MutationObserver(t).observe(d,{attributes:true,attributeFilter:["data-openbot-color-scheme"]});document.addEventListener("DOMContentLoaded",t);t();`;

/**
 * An inline script for the head of `/app`. It shows the saved theme before the first paint: without
 * it, the loading screen paints dark until its code runs. No saved theme leaves the dark default.
 * The loading screen's code then takes over, and removes the attribute when the user leaves `/app`.
 * It also keeps the `theme-color` of the page on the theme, which the user picks in the app and not
 * through the system, so a `media` pair of `theme-color` tags could not follow it.
 */
export const WEB_APPEARANCE_BOOT_SCRIPT = `try{var a=localStorage.getItem(${JSON.stringify(WEB_APPEARANCE_STORAGE_KEY)});if(a==="system")a=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";if(a==="light"||a==="dark")document.documentElement.dataset.openbotColorScheme=a}catch(e){}${THEME_COLOR_SCRIPT}`;
