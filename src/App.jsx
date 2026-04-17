import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FlaskConical, Gauge, Network } from "lucide-react";
import ExperimentSwitcher from "./components/ExperimentSwitcher";
import FilterPills from "./components/FilterPills";
import GroupAView from "./components/views/GroupAView";
import GroupBView from "./components/views/GroupBView";
import GroupCView from "./components/views/GroupCView";
import { FILTER_PILLS, MOCK_GRAPH_DATA, MOCK_REVIEWS } from "./data/mockReviews";

const toggleFilter = (selectedFilters, targetFilter) => {
  if (selectedFilters.includes(targetFilter)) {
    return selectedFilters.filter((filter) => filter !== targetFilter);
  }

  return [...selectedFilters, targetFilter];
};

function App() {
  const [activeGroup, setActiveGroup] = useState("A");
  const [selectedFilters, setSelectedFilters] = useState(["가족모임", "주차가능"]);
  const [searchText, setSearchText] = useState("");

  const filteredReviews = useMemo(() => {
    const normalizedSearch = searchText.trim().toLowerCase();

    return MOCK_REVIEWS.filter((review) => {
      const filterMatch =
        selectedFilters.length === 0 || selectedFilters.some((filter) => review.visitTags.includes(filter));

      const searchMatch =
        normalizedSearch.length === 0 ||
        review.text.toLowerCase().includes(normalizedSearch) ||
        review.keywords.some((keyword) => keyword.toLowerCase().includes(normalizedSearch));

      return filterMatch && searchMatch;
    });
  }, [searchText, selectedFilters]);

  const metrics = useMemo(() => {
    if (!filteredReviews.length) {
      return {
        avgHelpfulness: 0,
        topCentrality: 0,
      };
    }

    const totalHelpfulness = filteredReviews.reduce((sum, review) => sum + review.helpfulnessScore, 0);
    const topCentrality = Math.max(...filteredReviews.map((review) => review.centrality));

    return {
      avgHelpfulness: Math.round(totalHelpfulness / filteredReviews.length),
      topCentrality,
    };
  }, [filteredReviews]);

  return (
    <main className="relative mx-auto min-h-screen w-full max-w-[1480px] px-4 pb-10 pt-24 sm:px-8">
      <div className="floating-blur left-[-80px] top-[220px] bg-orange-300/50" />
      <div className="floating-blur bottom-[120px] right-[-70px] bg-cyan-300/45" />

      <ExperimentSwitcher activeGroup={activeGroup} onGroupChange={setActiveGroup} />

      <motion.header
        initial={{ opacity: 0, y: 22 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: "easeOut" }}
        className="mb-5"
      >
        <div className="glass-card rounded-[2rem] p-5 soft-shadow sm:p-7">
          <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr] lg:items-center">
            <div>
              <p className="mb-2 inline-flex items-center gap-2 rounded-full bg-orange-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.15em] text-orange-800">
                <FlaskConical size={13} />
                ReNode Lab Interface
              </p>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-4xl">
                리뷰 유용성 평가 실험 대시보드
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-600 sm:text-base">
                A/B/C 실험군별로 리뷰 추천 방식이 사용자 신뢰 형성에 미치는 영향을 시각적으로 비교합니다.
                알고리즘 점수, 강조 문장, 관계 네트워크를 하나의 인터페이스에서 탐색할 수 있습니다.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
              <div className="glass-panel rounded-2xl p-4">
                <p className="mb-1 text-xs font-medium uppercase tracking-[0.15em] text-slate-500">Visible Reviews</p>
                <p className="text-2xl font-semibold text-slate-900">{filteredReviews.length}</p>
              </div>
              <div className="glass-panel rounded-2xl p-4">
                <p className="mb-1 flex items-center gap-1 text-xs font-medium uppercase tracking-[0.15em] text-slate-500">
                  <Gauge size={13} />
                  Avg Helpfulness
                </p>
                <p className="text-2xl font-semibold text-slate-900">{metrics.avgHelpfulness}</p>
              </div>
              <div className="glass-panel rounded-2xl p-4">
                <p className="mb-1 flex items-center gap-1 text-xs font-medium uppercase tracking-[0.15em] text-slate-500">
                  <Network size={13} />
                  Max Centrality
                </p>
                <p className="text-2xl font-semibold text-slate-900">{metrics.topCentrality.toFixed(2)}</p>
              </div>
            </div>
          </div>
        </div>
      </motion.header>

      <section className="mb-6">
        <FilterPills
          filters={FILTER_PILLS}
          selectedFilters={selectedFilters}
          onToggleFilter={(filter) => setSelectedFilters((prev) => toggleFilter(prev, filter))}
          searchText={searchText}
          onSearchTextChange={setSearchText}
        />
      </section>

      <AnimatePresence mode="wait">
        <motion.section
          key={activeGroup}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
        >
          {activeGroup === "A" && <GroupAView reviews={filteredReviews} />}
          {activeGroup === "B" && <GroupBView reviews={filteredReviews} />}
          {activeGroup === "C" && <GroupCView reviews={filteredReviews} graphData={MOCK_GRAPH_DATA} />}
        </motion.section>
      </AnimatePresence>
    </main>
  );
}

export default App;
