import Link from 'next/link';
import { ARTIST } from '@/content/site';

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link href="/" className="site-logo">
          {ARTIST.studio}
          <small>{ARTIST.name}</small>
        </Link>
        <nav className="site-nav" aria-label="주 메뉴">
          <Link href="/#about">작가</Link>
          <Link href="/#works">작품</Link>
          <Link href="/class">원데이 클래스</Link>
          <Link href="/#contact">문의</Link>
          <Link href="/gallery" className="nav-gallery">
            3D 감상실 →
          </Link>
        </nav>
      </div>
    </header>
  );
}
