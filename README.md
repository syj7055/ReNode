# ReNode

ReviewGraph Place 리뷰 큐레이션 서비스 UI입니다.

## Stack

- React (Vite)
- Tailwind CSS
- Framer Motion
- react-force-graph-2d

## Features

- 시작 화면에서 코드 A/B/C 선택 후 URL 분기 (`?group=a|b|c`)
- 좌측 사이드바(선호 키워드 + Place 선택) / 우측 리뷰 피드 2열 레이아웃
- Place 리스트 우선 탐색 후, 선택 Place의 리뷰 렌더링
- A/B: 리스트형 리뷰 피드, C: 네트워크 그래프 + 상세 패널
- CSV의 `방문 목적` + `child_friendly` + `solo_dining`를 선호 키워드로 사용
- C 그룹 네트워크는 SBERT 코사인 유사도 전처리 결과(`resources/review_similarity_edges.json`)를 사용
- 선호 키워드 일치 리뷰 우선 정렬, 비일치 리뷰도 후순위 노출
- 모든 상황에서 상위 리뷰 20개만 노출
- 선호 키워드 변경 및 Place 변경 시 모든 코드 그룹에 0.8초 스켈레톤 로딩
- 최종 Place 결정 후 통합 설문 팝업(리커트, 방문 의향 %, 주관식)
- 태스크 완료 시간, Top3 리뷰 CTR/체류시간, 스크롤/필터 상호작용 로그 수집
- 마지막 화면에서 복사 가능한 텍스트 로그 출력
- `resources/reviews_preprocessed.csv` 실제 리뷰 데이터 기반 렌더링

## URL 분기 규칙

- `?group=a` : A 코드 화면
- `?group=b` : B 코드 화면
- `?group=c` : C 코드 화면
- 파라미터가 없으면 시작 화면에서 코드를 선택합니다.

## Run

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## 리뷰 유사도 전처리 (SBERT)

리뷰 간 의미론적 유사도(코사인)를 미리 계산해 C 그룹 네트워크 엣지로 사용합니다.

- 임베딩 모델: `snunlp/KR-SBERT-V40K-klueNLI-augSTS`
- 유사도 기준: `cosine similarity >= tau`
- 기본 임계값: `tau = 0.60`
- 계산 범위: 같은 `place_id` 내부 리뷰끼리만
- 추가 산출: `node_metrics_by_place` ( `color_value`, `central_gravity`, 고유벡터/매개 중심성 원값 )

실행 전(최초 1회) Python 패키지 설치:

```bash
pip install -U sentence-transformers
```

전처리 실행:

```bash
npm run build:similarity
```

고급 옵션 예시:

```bash
.venv/Scripts/python.exe scripts/build_review_similarity_edges.py --threshold 0.6 --batch-size 32
```

웹사이트 런타임에서는 모델/API를 호출하지 않고, 전처리된 `resources/review_similarity_edges.json`만 읽습니다.

## Vercel 배포

Vite 기본 설정 그대로 배포 가능합니다.

- Framework Preset: `Vite`
- Build Command: `npm run build`
- Output Directory: `dist`

## Notes

- Node.js 18+ 환경을 권장합니다.