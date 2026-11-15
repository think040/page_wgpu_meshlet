// ─────────────────────────────────────────────────────────────
// 가상 작가·작품·클래스 정보 — 사이트의 모든 문구는 이 파일에서 바꾼다.
// 여기 등장하는 인물·공방·작품·연락처는 모두 허구이다.
// ─────────────────────────────────────────────────────────────

export const ARTIST = {
  name: '윤서하',
  nameEn: 'Yoon Seoha',
  studio: '스튜디오 결',
  studioEn: 'Studio Gyeol',
  practice: '돌과 석고를 깎아 만드는 추상 조각',
  series: '「결」 연작',
  heroLine: '덜어낸 자리에 남는 것을 깎습니다.',
  bio: [
    '윤서하는 돌과 석고를 깎아 형태를 찾아가는 조각가입니다. 덩어리를 덜어내며 남는 자리, 재료가 스스로 드러내는 결에 관심을 두고 작업합니다.',
    '「결」 연작은 물방울, 매듭, 비틀림처럼 손으로 만질 수 없는 움직임을 단단한 재료 안에 붙잡아 두려는 시도입니다. 여섯 점은 서로 다른 돌과 석고, 청동, 백자로 완성되었습니다.',
    '스튜디오 결에서는 작업과 함께 누구나 참여할 수 있는 원데이 클래스를 운영합니다. 감상실 뒷벽 선반에는 수강생들이 만든 작은 조각들이 놓여 있습니다.',
  ],
  facts: [
    ['작업', '돌·석고 직조각, 청동 주조'],
    ['연작', '「결」 6점'],
    ['공방', '스튜디오 결'],
  ] as const,
} as const;

export type MaterialKind = 'plaster' | 'bronze' | 'granite' | 'marble' | 'basalt' | 'porcelain';

export interface Artwork {
  /** 0..5 — 감상실 인스턴스 번호와 같다 */
  id: number;
  slug: string;
  title: string;
  form: string;
  material: string;
  materialKind: MaterialKind;
  description: string;
}

export const ARTWORKS: readonly Artwork[] = [
  {
    id: 0,
    slug: 'condensation',
    title: '응결',
    form: '크기가 다른 구들이 부드럽게 맞붙은 물방울 덩어리',
    material: '흰 석고',
    materialKind: 'plaster',
    description: '맺히기 직전의 물방울들이 서로를 끌어당기는 순간을 붙잡았습니다.',
  },
  {
    id: 1,
    slug: 'knot',
    title: '매듭',
    form: '토러스 매듭(2,3)을 따라 감기는 두꺼운 관',
    material: '청동',
    materialKind: 'bronze',
    description: '끝과 시작이 없는 한 줄의 선이 스스로를 세 번 지나갑니다.',
  },
  {
    id: 2,
    slug: 'twist',
    title: '비틀림',
    form: '높이에 따라 회전하는 둥근 사각 기둥',
    material: '회색 화강암',
    materialKind: 'granite',
    description: '단단한 돌이 천천히 몸을 돌리는 시간을 한 덩어리에 담았습니다.',
  },
  {
    id: 3,
    slug: 'vacancy',
    title: '빈 자리',
    form: '달걀형 덩어리에서 구와 캡슐을 파낸 형태',
    material: '대리석',
    materialKind: 'marble',
    description: '덜어낸 자리가 남은 덩어리보다 더 많은 것을 말합니다.',
  },
  {
    id: 4,
    slug: 'erosion',
    title: '침식',
    form: '구와 자이로이드 곡면이 교차한 다공성 형태',
    material: '현무암',
    materialKind: 'basalt',
    description: '오랜 물길이 돌 속에 남긴 통로를 상상했습니다.',
  },
  {
    id: 5,
    slug: 'layers',
    title: '겹',
    form: '여러 겹의 얇은 구면 껍질을 비스듬히 잘라낸 형태',
    material: '무광 백자',
    materialKind: 'porcelain',
    description: '겹겹이 쌓인 얇은 막을 비스듬히 열어 안쪽을 보여줍니다.',
  },
] as const;

export const ONE_DAY_CLASS = {
  title: '석고 소형 조각 만들기',
  duration: '2시간 30분',
  capacity: 6,
  summary: '석고 블록을 깎아 손바닥만 한 추상 조각 한 점을 완성합니다.',
  intro:
    '작가의 「결」 연작을 함께 살펴본 뒤, 석고 블록에서 나만의 형태를 찾아 깎아 봅니다. 처음이어도 괜찮습니다. 덩어리를 덜어내는 감각을 천천히 익히는 시간입니다.',
  curriculum: [
    ['20분', '재료와 도구 안내, 안전 수칙'],
    ['20분', '「결」 연작 감상과 형태 스케치'],
    ['80분', '석고 블록 깎기 — 덩어리에서 형태 찾기'],
    ['30분', '사포로 결 다듬기, 마무리와 포장'],
  ] as const,
  includes: ['석고 블록과 모든 도구', '작업 앞치마·보안경', '완성작 포장 상자'],
  notes: [
    '초보자도 참여할 수 있습니다.',
    '석고 가루가 날리니 편한 복장으로 오세요.',
    '완성작은 당일 가져가실 수 있습니다.',
    '만 12세 이상 참여할 수 있습니다.',
  ],
  schedule: '화–토 오전 11시 · 오후 3시',
} as const;

export const CONTACT = {
  // 가상의 연락처 — 실제로 연결되지 않는다.
  email: 'hello@studio-gyeol.example',
  address: '가상시 결동 1-2, 스튜디오 결',
  hours: '화–토 11:00–18:00 (일·월 휴무)',
} as const;

export const SITE = {
  title: `${ARTIST.studio} — ${ARTIST.name} 조각`,
  description: `${ARTIST.practice}. ${ARTIST.series} 6점과 원데이 클래스.`,
  demoNotice: '이 사이트는 가상의 작가를 위한 데모 사이트입니다. 등장하는 인물·공방·작품·연락처는 모두 허구입니다.',
  galleryUnsupported:
    '3D 감상실은 WebGPU를 지원하는 데스크톱 Chrome 또는 Edge 최신 버전에서 볼 수 있습니다.',
  galleryIntro: '3D 감상실에서 여섯 점을 둘러보고, 작품 앞으로 다가가 결을 가까이 볼 수 있습니다.',
} as const;
