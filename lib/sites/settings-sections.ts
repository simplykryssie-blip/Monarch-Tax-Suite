// The parts of a website's settings page, in the order of its side menu. `form` parts are saved together as the website's
// settings; General and Domains act on the website itself.
export const SETTINGS_SECTIONS = [
  { key: "general", label: "General", hint: "Name and free address" },
  { key: "domains", label: "Domains", hint: "Your own web address" },
  { key: "brand", label: "Branding", hint: "Colors, background, logo, font" },
  { key: "header", label: "Header and footer", hint: "Top bar and bottom area" },
  { key: "business", label: "Business info", hint: "Phone, address, hours, social" },
  { key: "seo", label: "Search and sharing", hint: "Google and shared links" },
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]["key"];
export const settingsSectionOf = (v: unknown): SettingsSection => (SETTINGS_SECTIONS.find((s) => s.key === v)?.key ?? "general");
