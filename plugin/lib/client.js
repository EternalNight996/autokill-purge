// autokill-purge-plugin · 客户端入口（梦神装甲）
//
// 作用：在 DSH 左侧栏底部（sidebar.footer.action，list 槽）挂一个「图标 + 名称」的导航项，
// 点一下在真实浏览器里打开 autokill-purge 控制台（默认 http://127.0.0.1:8792）。
//
// 为什么走 client 插件而不是改宿主源码：DSH 的浏览器端由 dsh-client-modules 统一装载
// 各插件的 lib/client.js（__ModuleLoader__ 工厂格式），槽位由 dsh-client-ui-sidebar 声明，
// 我们只是往这个声明好的 list 槽里加一行 —— 不改宿主、不抢别人的 single 槽
// （shell.leading / sidebar.settings 都已被占用）。
//
// 这个文件是手写的 bundle（与 tsdown 产物同格式），因此不能 import 任何相对模块，
// 只能 require 平台内置模块（react / react/jsx-runtime）。
window.__ModuleLoader__.load({
  id: "autokill-purge-plugin",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const react = require("react");
    const h = react.createElement;

    /** 控制台地址：默认本机 8792；页面里可用 localStorage["ap.consoleUrl"] 覆盖（调试用） */
    function consoleUrl() {
      try {
        const override = window.localStorage && window.localStorage.getItem("ap.consoleUrl");
        if (override) return String(override).replace(/\/+$/, "");
      } catch (_) { /* 隐私模式 */ }
      return "http://127.0.0.1:8792";
    }

    const LABEL = "梦神装甲";

    function openConsole() {
      const url = consoleUrl();
      try {
        const w = window.open(url, "_blank", "noopener,noreferrer");
        if (!w) window.location.href = url;
      } catch (_) {
        window.location.href = url;
      }
    }

    /** 盾形图标：16px 线性，跟随 currentColor */
    function ArmorIcon(props) {
      const size = (props && props.size) || 16;
      return h("svg", {
        width: size, height: size, viewBox: "0 0 16 16", fill: "none",
        "aria-hidden": "true", focusable: "false",
      }, h("path", {
        d: "M8 1.6 13 3.4v4.1c0 3.2-2.1 5.7-5 6.9-2.9-1.2-5-3.7-5-6.9V3.4L8 1.6Z",
        stroke: "currentColor", strokeWidth: 1.3, strokeLinejoin: "round",
      }), h("path", {
        d: "M6 7.9 7.4 9.3 10.2 6.5",
        stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round", strokeLinejoin: "round",
      }));
    }

    const CSS = [
      ".ap-armor-nav{width:100%;display:flex;align-items:center}",
      ".ap-armor-btn{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;height:34px;padding:0 8px;border-radius:var(--dsw-radius-sm,8px);cursor:pointer;color:var(--dsw-alias-label-secondary,#9aa0a6);font-size:13px;line-height:1}",
      "@media (hover:hover){.ap-armor-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16));color:var(--dsw-alias-label-primary,#e6e6e6)}}",
      ".ap-armor-btn:focus-visible{outline:2px solid var(--dsw-alias-accent,#6ea8ff);outline-offset:1px}",
      ".ap-armor-icon{display:inline-flex;align-items:center;justify-content:center;flex:none}",
      ".ap-armor-label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:.02em}",
      ".ap-armor-collapsed{justify-content:center;padding:0}",
    ].join("");
    const TAG_ID = "autokill-purge-plugin/armor-nav.css";
    if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(TAG_ID) + "]") === null) {
      const tag = document.createElement("style");
      tag.dataset.plugin = "autokill-purge-plugin";
      tag.dataset.pluginCss = TAG_ID;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    /** 侧栏底部的一项：收起时只有图标，展开时图标 + 名称 */
    function ArmorNavButton(props) {
      const wide = !!(props && props.wide);
      return h("div", { className: "ap-armor-nav" },
        h("button", {
          type: "button",
          className: "ap-armor-btn" + (wide ? "" : " ap-armor-collapsed"),
          title: LABEL + " · 打开 autokill-purge 控制台",
          "aria-label": LABEL,
          "data-mengshen-armor": "1",
          onClick: openConsole,
        },
          h("span", { className: "ap-armor-icon" }, h(ArmorIcon, { size: wide ? 16 : 18 })),
          wide ? h("span", { className: "ap-armor-label" }, LABEL) : null,
        ),
      );
    }

    const inject = ["slots"];

    /** 只往 sidebar.footer.action（list 槽）加一行，别的一概不碰 */
    function apply(ctx) {
      ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
        name: "sidebar.footer.action",
        id: "mengshen-armor",
        inject: () => ({}),
      }, ArmorNavButton));
    }

    exports.name = "autokill-purge-plugin";
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  }
});
