/**
 * The Monarch mark. If the owner's logo file is present (public/brand/logo.png|svg|webp, decided on the server
 * and passed in as `src`), it is used as-is. Until then a drawn crown-M monogram in the same black-and-gold
 * language stands in, so the sidebar never shows a broken image.
 */
export function BrandMark({ src, size = 46 }: { src?: string | null; size?: number }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="Monarch Tax Suite" width={size} height={size} className="mt-logo-img" style={{ width: size, height: size }} />;
  }
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="Monarch Tax Suite" className="mt-logo-mark">
      <defs>
        <linearGradient id="mt-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8a6420" />
          <stop offset=".22" stopColor="#d4ae55" />
          <stop offset=".42" stopColor="#f6e6ac" />
          <stop offset=".6" stopColor="#b88c2c" />
          <stop offset=".8" stopColor="#ecd078" />
          <stop offset="1" stopColor="#8a6420" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="62" height="62" rx="9" fill="#0b0b0a" stroke="url(#mt-gold)" strokeWidth="1.5" />
      <path d="M16 24l6 5 5-9 5 9 5-9 5 9 6-5-3 12H19z" fill="url(#mt-gold)" />
      <path d="M17 52V40l8 8 7-10 7 10 8-8v12" fill="none" stroke="url(#mt-gold)" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="mt-wordmark">
      <b>MONARCH</b>
      <small>TAX SUITE</small>
    </span>
  );
}
