import type { Metadata } from 'next';
import { CONTACT, ONE_DAY_CLASS } from '@/content/site';
import { ReservationForm } from '@/components/ReservationForm';

export const metadata: Metadata = { title: `원데이 클래스 — ${ONE_DAY_CLASS.title}` };

export default function ClassPage() {
  return (
    <>
      <section className="section page-head">
        <p className="eyebrow">원데이 클래스</p>
        <h1>{ONE_DAY_CLASS.title}</h1>
        <p className="lead">{ONE_DAY_CLASS.intro}</p>
        <ul className="pill-list">
          <li>소요 {ONE_DAY_CLASS.duration}</li>
          <li>정원 {ONE_DAY_CLASS.capacity}명</li>
          <li>{ONE_DAY_CLASS.schedule}</li>
        </ul>
      </section>

      <section className="section split">
        <div>
          <h2>진행 순서</h2>
          <ol className="timeline">
            {ONE_DAY_CLASS.curriculum.map(([time, text]) => (
              <li key={text}>
                <span className="timeline-time">{time}</span>
                <span>{text}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="stack">
          <div className="info-card">
            <h3>포함 사항</h3>
            <ul>
              {ONE_DAY_CLASS.includes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
          <div className="info-card">
            <h3>안내</h3>
            <ul>
              {ONE_DAY_CLASS.notes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section id="reserve" className="section split">
        <div>
          <h2>예약 문의</h2>
          <p>원하는 날짜와 인원을 남겨 주세요. 공방에서 확인 후 연락드립니다.</p>
          <p className="muted-text">
            {CONTACT.email}
            <br />
            {CONTACT.hours}
          </p>
        </div>
        <ReservationForm />
      </section>
    </>
  );
}
