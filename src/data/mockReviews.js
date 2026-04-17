const PURPOSE_OPTIONS = ["가족모임", "데이트", "혼밥", "회식", "친구모임", "조용한"];
const FACILITY_OPTIONS = ["주차가능", "예약가능", "아기의자", "룸식당", "늦은영업", "테라스석"];
const KEYWORD_POOL = [
  "가성비",
  "재방문",
  "서비스",
  "회전율",
  "분위기",
  "청결",
  "웨이팅",
  "신선도",
  "주차",
  "좌석간격",
  "혼밥친화",
  "단체석",
  "디저트",
  "시그니처",
  "음악볼륨",
  "양",
  "친절",
  "구성",
  "매운맛",
  "포장",
];

const SHARED_SENTENCE_POOL = [
  "직원 응대가 빠르고 정확해서 주문 과정이 매끄러웠어요.",
  "대표 메뉴의 간이 과하지 않아 끝까지 편하게 먹을 수 있었어요.",
  "좌석 간격이 넓어서 대화하기에 부담이 없었습니다.",
  "주차 동선이 단순해서 가족 단위 방문에 편리했어요.",
  "피크 타임에도 음식 온도가 안정적으로 유지됐습니다.",
  "혼자 방문해도 시선 부담이 없고 회전이 빨라요.",
  "재료 신선도가 좋다는 인상을 공통적으로 받았습니다.",
  "웨이팅이 있었지만 안내가 체계적이라 체감이 짧았어요.",
  "매장이 조용한 편이라 업무 대화나 미팅에 적합했습니다.",
  "가격 대비 양이 충분해서 재방문 의사가 높아졌습니다.",
];

const AUTHOR_POOL = [
  "김하윤",
  "이서준",
  "박지민",
  "최윤서",
  "정도윤",
  "한지우",
  "오민재",
  "윤하린",
  "송예준",
  "배서아",
  "문도현",
  "장유진",
];

const AVATAR_COLORS = ["#fb923c", "#22c55e", "#38bdf8", "#f43f5e", "#f59e0b", "#14b8a6"];

const FILTER_PILLS = [
  "가족모임",
  "주차가능",
  "혼밥",
  "조용한",
  "데이트",
  "친구모임",
  "회식",
  "예약가능",
  "아기의자",
  "룸식당",
  "테라스석",
  "늦은영업",
];

const seeded = (seed) => {
  const x = Math.sin(seed * 127.1) * 43758.5453;
  return x - Math.floor(x);
};

const pickSeveral = (arr, count, seedBase) => {
  const picked = new Set();
  let cursor = 0;

  while (picked.size < count && cursor < arr.length * 3) {
    const idx = Math.floor(seeded(seedBase + cursor) * arr.length);
    picked.add(arr[idx]);
    cursor += 1;
  }

  return Array.from(picked);
};

const makeReviewText = ({ sharedSentence, purpose, keywords }) => {
  const intro = `주요 방문 목적은 ${purpose}이었고, 매장 컨디션을 중심으로 관찰했습니다.`;
  const body = `특히 ${keywords[0]}, ${keywords[1]} 요소가 만족도에 크게 영향을 줬습니다.`;
  const outro = "동일한 상황의 이용자라면 의사결정에 도움이 될 만한 정보라고 생각합니다.";
  return `${intro} ${sharedSentence} ${body} ${outro}`;
};

const createReview = (index) => {
  const id = `review-${index + 1}`;
  const purpose = PURPOSE_OPTIONS[index % PURPOSE_OPTIONS.length];
  const facilities = pickSeveral(FACILITY_OPTIONS, 2, 100 + index);
  const keywords = pickSeveral(KEYWORD_POOL, 4, 400 + index);
  const sharedSentence = SHARED_SENTENCE_POOL[index % SHARED_SENTENCE_POOL.length];
  const rating = Number((3.6 + seeded(800 + index) * 1.4).toFixed(1));
  const helpfulnessScore = Math.round(62 + seeded(1200 + index) * 36);
  const centrality = Number((0.35 + seeded(1400 + index) * 0.65).toFixed(2));
  const author = AUTHOR_POOL[index % AUTHOR_POOL.length];
  const avatarColor = AVATAR_COLORS[index % AVATAR_COLORS.length];
  const day = ((index * 2) % 27) + 1;
  const month = (index % 3) + 2;

  return {
    id,
    author,
    avatarColor,
    rating,
    helpfulnessScore,
    centrality,
    date: `2026.${String(month).padStart(2, "0")}.${String(day).padStart(2, "0")}`,
    visitTags: [purpose, ...facilities],
    purpose,
    facilities,
    keywords,
    sharedSentences: [sharedSentence],
    text: makeReviewText({ sharedSentence, purpose, keywords }),
  };
};

const buildGraphLinks = (reviews) => {
  const links = [];

  for (let i = 0; i < reviews.length; i += 1) {
    for (let j = i + 1; j < reviews.length; j += 1) {
      const source = reviews[i];
      const target = reviews[j];
      const overlapCount = source.keywords.filter((keyword) => target.keywords.includes(keyword)).length;
      const samePurpose = source.purpose === target.purpose;
      const deterministicPick = seeded((i + 1) * (j + 3));

      if (overlapCount >= 2 || (samePurpose && deterministicPick > 0.58)) {
        links.push({
          source: source.id,
          target: target.id,
          overlapCount,
          weight: Number((1 + overlapCount * 0.4 + (samePurpose ? 0.25 : 0)).toFixed(2)),
          reason: samePurpose ? "방문 목적 유사" : "공통 키워드 유사",
        });
      }
    }
  }

  return links;
};

const reviews = Array.from({ length: 36 }, (_, idx) => createReview(idx));
const links = buildGraphLinks(reviews);

const graphNodes = reviews.map((review) => ({
  id: review.id,
  label: review.author,
  helpfulnessScore: review.helpfulnessScore,
  centrality: review.centrality,
  purpose: review.purpose,
}));

const graphData = {
  nodes: graphNodes,
  links,
};

export { FILTER_PILLS, reviews as MOCK_REVIEWS, graphData as MOCK_GRAPH_DATA };
