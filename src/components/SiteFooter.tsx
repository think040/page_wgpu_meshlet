import { ARTIST, SITE } from '@/content/site';

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <p>
        © {ARTIST.studio} · {ARTIST.name}
      </p>
      <p className="demo-notice">{SITE.demoNotice}</p>
    </footer>
  );
}
