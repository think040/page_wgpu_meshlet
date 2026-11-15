'use client';

import { useState } from 'react';
import { ONE_DAY_CLASS } from '@/content/site';

/** UI 전용 폼 — 백엔드 없음. 제출해도 어디로도 전송되지 않는다. */
export function ReservationForm() {
  const [submitted, setSubmitted] = useState<string | null>(null);

  if (submitted) {
    return (
      <div className="form-done" role="status">
        <p>
          <strong>{submitted}</strong>님, 문의가 접수된 것처럼 보이지만 데모 사이트라 실제로는 아무 곳에도 전송되지 않았습니다.
        </p>
        <button type="button" className="button" onClick={() => setSubmitted(null)}>
          다시 작성
        </button>
      </div>
    );
  }

  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        setSubmitted(String(data.get('name') || '방문객'));
      }}
    >
      <div className="form-row">
        <label>
          이름
          <input name="name" required autoComplete="name" />
        </label>
        <label>
          연락처
          <input name="contact" required placeholder="이메일 또는 전화" />
        </label>
      </div>
      <div className="form-row">
        <label>
          희망 날짜
          <input name="date" type="date" required />
        </label>
        <label>
          인원
          <select name="people" defaultValue="1">
            {Array.from({ length: ONE_DAY_CLASS.capacity }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {i + 1}명
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        남길 말
        <textarea name="message" rows={4} placeholder="궁금한 점이나 요청 사항" />
      </label>
      <p className="form-note">백엔드가 없는 데모 폼입니다. 입력한 내용은 저장·전송되지 않습니다.</p>
      <button type="submit" className="button primary">
        문의 보내기
      </button>
    </form>
  );
}
