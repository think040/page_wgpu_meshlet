import Link from 'next/link';
import { ArtworkCard } from '@/components/ArtworkCard';
import { ARTIST, ARTWORKS, CONTACT, ONE_DAY_CLASS, SITE } from '@/content/site';

export default function HomePage() {
  return (
    <>
      <section className="hero">
        <div className="hero-text">
          <p className="eyebrow">
            {ARTIST.studio} · {ARTIST.series}
          </p>
          <h1>{ARTIST.heroLine}</h1>
          <p className="lead">
            {ARTIST.name} — {ARTIST.practice}
          </p>
          <div className="hero-actions">
            <Link href="/gallery" className="button primary">
              3D 감상실 입장
            </Link>
            <Link href="/class" className="button">
              원데이 클래스
            </Link>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="stone s1" />
          <div className="stone s2" />
          <div className="stone s3" />
          <div className="plinth" />
        </div>
      </section>

      <section id="about" className="section split">
        <div>
          <p className="eyebrow">작가 소개</p>
          <h2>{ARTIST.name}</h2>
          <dl className="facts-list">
            {ARTIST.facts.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="prose">
          {ARTIST.bio.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      </section>

      <section id="works" className="section">
        <div className="section-head">
          <div>
            <p className="eyebrow">작품</p>
            <h2>{ARTIST.series} 6점</h2>
          </div>
          <p className="muted-text">{SITE.galleryIntro}</p>
        </div>
        <div className="artwork-grid">
          {ARTWORKS.map((a) => (
            <ArtworkCard key={a.id} artwork={a} />
          ))}
        </div>
      </section>

      <section id="class" className="section class-teaser">
        <div>
          <p className="eyebrow">원데이 클래스</p>
          <h2>{ONE_DAY_CLASS.title}</h2>
          <p>{ONE_DAY_CLASS.summary}</p>
        </div>
        <ul className="pill-list">
          <li>{ONE_DAY_CLASS.duration}</li>
          <li>정원 {ONE_DAY_CLASS.capacity}명</li>
          <li>{ONE_DAY_CLASS.schedule}</li>
        </ul>
        <Link href="/class" className="button primary">
          자세히 보기 · 예약 문의
        </Link>
      </section>

      <section id="contact" className="section split">
        <div>
          <p className="eyebrow">문의</p>
          <h2>공방에 들르기</h2>
        </div>
        <dl className="facts-list">
          <div>
            <dt>이메일</dt>
            <dd>{CONTACT.email}</dd>
          </div>
          <div>
            <dt>주소</dt>
            <dd>{CONTACT.address}</dd>
          </div>
          <div>
            <dt>운영</dt>
            <dd>{CONTACT.hours}</dd>
          </div>
          <div>
            <dt>클래스 예약</dt>
            <dd>
              <Link href="/class#reserve">예약 문의 폼</Link>
            </dd>
          </div>
        </dl>
      </section>
    </>
  );
}
