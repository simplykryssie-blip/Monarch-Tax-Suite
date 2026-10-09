// Installation platforms for the embeddable Basic Tax Calculator.
//
// Every platform uses the same platform-neutral mechanism: an <iframe> pointing
// at /embed/calculator?id=<public embed id>. Licensing is enforced server-side
// by license status + authorized domain (Content-Security-Policy
// frame-ancestors), so no platform-specific script or credential is required.
//
// `support` is deliberately conservative: a platform is "verified" only after
// the embed has been installed and checked on that platform for real.

import type { InstallationMethod, Platform } from "./types.ts";

export type SupportLevel = "verified" | "generic_embed" | "awaiting_testing";

export type PlatformGuide = {
  id: Platform;
  label: string;
  defaultMethod: InstallationMethod;
  methods: InstallationMethod[];
  support: SupportLevel;
  supportNote: string;
  steps: string[];
  limitations: string[];
};

export const METHOD_LABELS: Record<InstallationMethod, string> = {
  iframe_embed: "Iframe embed (HTML)",
  ghl_custom_code: "GoHighLevel Custom Code / HTML element",
  shopify_custom_liquid: "Shopify Custom Liquid section",
  wix_embed_site: "Wix Embed a Site (URL)",
  wix_html_embed: "Wix Embed HTML / Custom Code",
  jotform_iframe_widget: "Jotform Iframe Embed widget",
  other: "Other method",
};

export const PLATFORM_GUIDES: Record<Platform, PlatformGuide> = {
  gohighlevel: {
    id: "gohighlevel",
    label: "GoHighLevel (funnels & websites)",
    defaultMethod: "ghl_custom_code",
    methods: ["ghl_custom_code", "iframe_embed"],
    support: "generic_embed",
    supportNote: "Uses the standard iframe embed in a Custom Code element. Not yet verified on a live GHL funnel.",
    steps: [
      "Open the funnel or website page in the GoHighLevel builder.",
      "Add a Custom Code (Custom JS/HTML) element where the calculator should appear.",
      "Paste the embed code below and save.",
      "Publish the page and open it on the authorized domain (the custom domain connected to the funnel).",
    ],
    limitations: [
      "The calculator only displays on the domain authorized on the license. If the funnel is also reachable on a GHL preview or app domain, that domain will be blocked unless it is authorized too.",
    ],
  },
  shopify: {
    id: "shopify",
    label: "Shopify",
    defaultMethod: "shopify_custom_liquid",
    methods: ["shopify_custom_liquid", "iframe_embed"],
    support: "awaiting_testing",
    supportNote: "Planned via a Custom Liquid section using the standard iframe embed. No native Shopify app exists. Awaiting a test on a Shopify store.",
    steps: [
      "In Shopify admin go to Online Store → Themes → Customize.",
      "Open the page template where the calculator should appear and add a section → Custom Liquid.",
      "Paste the embed code below and save.",
      "Authorize the store's public domain (and the .myshopify.com domain if customers use it).",
    ],
    limitations: ["Not a native Shopify app.", "Theme-specific section availability varies; older (vintage) themes may not have Custom Liquid sections."],
  },
  wix: {
    id: "wix",
    label: "Wix",
    defaultMethod: "wix_embed_site",
    methods: ["wix_embed_site", "wix_html_embed"],
    support: "awaiting_testing",
    supportNote: "Awaiting a test on a Wix site. 'Embed a Site' (URL) is the expected method.",
    steps: [
      "In the Wix Editor click Add → Embed Code → Embed a Site.",
      "Click Enter Website Address and paste the calculator URL shown below (not the full HTML snippet).",
      "Resize the element to about 1,400px tall and publish.",
      "Authorize the site's public domain on the license.",
    ],
    limitations: [
      "Wix's 'Embed HTML' option places code inside an extra Wix-hosted frame, which domain authorization may block; use 'Embed a Site' instead.",
      "Not a native Wix app.",
    ],
  },
  jotform: {
    id: "jotform",
    label: "Jotform",
    defaultMethod: "jotform_iframe_widget",
    methods: ["jotform_iframe_widget"],
    support: "awaiting_testing",
    supportNote: "Awaiting a test in a Jotform form. Jotform widgets run inside Jotform-hosted frames, so domain binding is weaker here.",
    steps: [
      "In the Jotform Form Builder add the 'Iframe Embed' widget.",
      "Paste the calculator URL shown below as the widget's URL and set the height to about 1,400px.",
      "Authorize form.jotform.com (or your Jotform custom domain) on the license.",
    ],
    limitations: [
      "Calculator results are not submitted with the Jotform form; it is a display/estimation tool only.",
      "Authorizing a shared Jotform domain allows any form on that domain to display the calculator; prefer a Jotform custom domain where available.",
      "Not a native Jotform integration.",
    ],
  },
  custom_html: {
    id: "custom_html",
    label: "Custom HTML website",
    defaultMethod: "iframe_embed",
    methods: ["iframe_embed"],
    support: "generic_embed",
    supportNote: "Standard iframe embed. Domain enforcement was tested in Chromium (renders on the authorized origin, blocked elsewhere); a first live installation has not been verified yet.",
    steps: [
      "Paste the embed code below into the page's HTML where the calculator should appear.",
      "Publish the page on the authorized domain.",
    ],
    limitations: ["The page must be served over HTTPS on the authorized domain (or its www variant)."],
  },
  other: {
    id: "other",
    label: "Other / custom website",
    defaultMethod: "iframe_embed",
    methods: ["iframe_embed", "other"],
    support: "generic_embed",
    supportNote: "Any site builder that allows an HTML iframe on your own domain should work; compatibility is confirmed per installation.",
    steps: [
      "Find your platform's HTML / custom code / embed block.",
      "Paste the embed code below, or the calculator URL if the platform only accepts a URL.",
      "Publish on the authorized domain and confirm the calculator displays.",
    ],
    limitations: ["Builders that wrap embeds in their own hosted frame may need their frame domain authorized as well."],
  },
};

export const PLATFORM_ORDER: Platform[] = ["gohighlevel", "shopify", "wix", "jotform", "custom_html", "other"];

export const SUPPORT_LABELS: Record<SupportLevel, string> = {
  verified: "Verified",
  generic_embed: "Generic embed (not yet verified on platform)",
  awaiting_testing: "Awaiting compatibility testing",
};

/** URL loaded inside the iframe. */
export function embedUrl(appOrigin: string, embedId: string): string {
  return `${appOrigin.replace(/\/$/, "")}/embed/calculator?id=${encodeURIComponent(embedId)}`;
}

/** Platform-neutral HTML snippet. Contains only the public embed id, never a license key. */
export function embedSnippet(appOrigin: string, embedId: string): string {
  const src = embedUrl(appOrigin, embedId);
  return [
    `<iframe src="${src}" title="Monarch Basic Tax Calculator" loading="lazy"`,
    `  style="width:100%;max-width:1200px;height:1400px;border:0;display:block;margin:0 auto"></iframe>`,
  ].join("\n");
}
