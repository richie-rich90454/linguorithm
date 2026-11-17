import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
import "@fontsource-variable/noto-sans";
import "./style.css";

export default {
    extends: DefaultTheme,
} satisfies Theme;
