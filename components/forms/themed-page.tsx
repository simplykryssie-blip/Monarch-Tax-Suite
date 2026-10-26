import { isThemed, sanitizeCss, themeVars, THEME_SCOPE, type FormTheme } from "@/lib/forms/theme.ts";

/**
 * The page a respondent sees: the form's card on its page, in the office's colors, font and header, with the
 * office's own (cleaned and scoped) CSS. An unthemed form looks exactly as it always did.
 */
export function ThemedPage({ theme, firm, maxWidth = 820, wrapper = "main", poweredBy = false, children }: { theme: FormTheme; firm?: string; maxWidth?: number; wrapper?: "main" | "div"; poweredBy?: boolean; children: React.ReactNode }) {
  const themed = isThemed(theme);
  const css = theme.custom_css ? sanitizeCss(theme.custom_css) : "";
  const banner = theme.logo_url || theme.header_image_url || theme.header;
  const Wrapper = wrapper;
  return (
    <Wrapper className={"monarch-public" + (themed ? ` ${THEME_SCOPE}` : "")} style={themed ? (themeVars(theme) as React.CSSProperties) : undefined}>
      {css && <style dangerouslySetInnerHTML={{ __html: css }} />}
      <div className="monarch-public-card" style={{ maxWidth }}>
        {banner && (
          <div className="mf-banner" style={theme.header_image_url ? { backgroundImage: `url("${theme.header_image_url}")` } : undefined}>
            {theme.logo_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={theme.logo_url} alt={firm ? `${firm} logo` : "Logo"} className="mf-logo" />
            )}
          </div>
        )}
        {children}
        {poweredBy && <p className="mf-powered">Powered by Verexa HQ</p>}
      </div>
    </Wrapper>
  );
}
