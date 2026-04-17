# ReNode

레스토랑 리뷰 유용성 실험(A/B/C) 프론트엔드 대시보드입니다.

## Stack

- React (Vite)
- Tailwind CSS
- Framer Motion
- react-force-graph-2d

## Features

- 상단 필터 검색 + 가로 스크롤 Pill 토글
- 실험군 전환 플로팅 탭 (A/B/C)
- A그룹: 포털형 카드 리스트 + 1.5초 Placebo 로딩 스켈레톤
- B그룹: AI 유용성 점수 배지 + 공통 핵심 문장 하이라이트
- C그룹: 2D 리뷰 네트워크 그래프 + 선택 리뷰 상세 패널 애니메이션
- 36개 노드 기반 정교한 Mock Data 내장

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

## Vercel 배포

Vite 기본 설정 그대로 배포 가능합니다.

- Framework Preset: `Vite`
- Build Command: `npm run build`
- Output Directory: `dist`

## Notes

- Node.js 18+ 환경을 권장합니다.