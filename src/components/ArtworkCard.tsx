import Link from 'next/link';
import type { Artwork } from '@/content/site';

/** 작품 카드 — 누르면 감상실에서 해당 작품 앞으로 카메라가 이동한다(/gallery?work=slug). */
export function ArtworkCard({ artwork }: { artwork: Artwork }) {
  const no = String(artwork.id + 1).padStart(2, '0');
  return (
    <Link href={`/gallery?work=${artwork.slug}`} className="artwork-card">
      <div className={`artwork-thumb material-${artwork.materialKind} shape-${artwork.slug}`} aria-hidden="true">
        <span className="thumb-form" />
        <span className="thumb-no">{no}</span>
      </div>
      <div className="artwork-body">
        <h3>「{artwork.title}」</h3>
        <p className="artwork-meta">{artwork.material}</p>
        <p className="artwork-desc">{artwork.description}</p>
        <span className="artwork-cta">감상실에서 보기 →</span>
      </div>
    </Link>
  );
}
