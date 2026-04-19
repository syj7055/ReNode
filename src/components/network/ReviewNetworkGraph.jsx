import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";

const getNodeId = (nodeRef) => (typeof nodeRef === "object" ? nodeRef.id : nodeRef);
const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

const FOCUS_LAYOUT = [
  { x: -260, y: -170 },
  { x: 250, y: -170 },
  { x: 0, y: 220 },
];

const colorFromScale = (value, alpha = 1) => {
  const v = clamp01(value);
  const red = Math.round(59 + (239 - 59) * v);
  const green = Math.round(130 + (68 - 130) * v);
  const blue = Math.round(246 + (68 - 246) * v);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
};

const createSemanticClusterForce = (focusByKeyword) => {
  let nodes = [];

  const force = (alpha) => {
    nodes.forEach((node) => {
      if (!node || node.isBridge) {
        return;
      }

      const focus = focusByKeyword.get(node.primaryKeyword);
      if (!focus) {
        return;
      }

      const gravityDamping = 1 - clamp01(node.centralGravity);
      const strength = 0.038 + gravityDamping * 0.058;
      node.vx += (focus.x - node.x) * strength * alpha;
      node.vy += (focus.y - node.y) * strength * alpha;
    });
  };

  force.initialize = (nextNodes) => {
    nodes = nextNodes || [];
  };

  return force;
};

const createBridgeCenterForce = () => {
  let nodes = [];

  const force = (alpha) => {
    nodes.forEach((node) => {
      if (!node?.isBridge) {
        return;
      }

      const strength = 0.082 + clamp01(node.centralGravity) * 0.23;
      node.vx += (0 - node.x) * strength * alpha;
      node.vy += (0 - node.y) * strength * alpha;
    });
  };

  force.initialize = (nextNodes) => {
    nodes = nextNodes || [];
  };

  return force;
};

const createCollisionForce = () => {
  let nodes = [];

  const force = (alpha) => {
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        if (!a || !b) {
          continue;
        }

        const dx = (b.x || 0) - (a.x || 0);
        const dy = (b.y || 0) - (a.y || 0);
        const distSq = dx * dx + dy * dy || 1e-6;
        const minDistance = (a.size || 8) + (b.size || 8) + 14;

        if (distSq >= minDistance * minDistance) {
          continue;
        }

        const distance = Math.sqrt(distSq);
        const overlap = ((minDistance - distance) / distance) * 0.58 * alpha;
        const pushX = dx * overlap;
        const pushY = dy * overlap;

        a.vx -= pushX;
        a.vy -= pushY;
        b.vx += pushX;
        b.vy += pushY;
      }
    }
  };

  force.initialize = (nextNodes) => {
    nodes = nextNodes || [];
  };

  return force;
};

function ReviewNetworkGraph({ graphData, selectedReviewId, onSelectReviewId }) {
  const containerRef = useRef(null);
  const fgRef = useRef(null);
  const [size, setSize] = useState({ width: 720, height: 520 });
  const [hoveredNodeId, setHoveredNodeId] = useState(null);

  useEffect(() => {
    if (!containerRef.current) {
      return undefined;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }

      setSize({
        width: Math.max(320, Math.floor(entry.contentRect.width)),
        height: Math.max(460, Math.floor(entry.contentRect.height)),
      });
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!hoveredNodeId) {
      return;
    }

    const stillExists = graphData.nodes.some((node) => node.id === hoveredNodeId);
    if (!stillExists) {
      setHoveredNodeId(null);
    }
  }, [graphData.nodes, hoveredNodeId]);

  const focalPoints = useMemo(() => {
    const keywords = Array.isArray(graphData.clusterKeywords) ? graphData.clusterKeywords.slice(0, 3) : [];
    return keywords.map((keyword, idx) => ({
      keyword,
      ...FOCUS_LAYOUT[idx % FOCUS_LAYOUT.length],
    }));
  }, [graphData.clusterKeywords]);

  const focusByKeyword = useMemo(
    () => new Map(focalPoints.map((point) => [point.keyword, point])),
    [focalPoints]
  );

  const normalizedColorByNodeId = useMemo(() => {
    if (!graphData.nodes.length) {
      return new Map();
    }

    const values = graphData.nodes.map((node) => {
      const rawEigen = Number(node.eigenvectorCentrality);
      if (Number.isFinite(rawEigen)) {
        return rawEigen;
      }
      return Number.isFinite(Number(node.colorValue)) ? Number(node.colorValue) : 0;
    });

    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    if (!Number.isFinite(minValue) || !Number.isFinite(maxValue) || maxValue <= minValue) {
      return new Map(graphData.nodes.map((node) => [node.id, 0.5]));
    }

    return new Map(
      graphData.nodes.map((node) => {
        const rawEigen = Number(node.eigenvectorCentrality);
        const base = Number.isFinite(rawEigen)
          ? rawEigen
          : Number.isFinite(Number(node.colorValue))
            ? Number(node.colorValue)
            : minValue;
        const normalized = clamp01((base - minValue) / (maxValue - minValue));
        return [node.id, normalized];
      })
    );
  }, [graphData.nodes]);

  useEffect(() => {
    if (!fgRef.current || graphData.nodes.length === 0) {
      return;
    }

    const linkForce = fgRef.current.d3Force("link");
    linkForce?.distance((link) => 270 - Math.min(140, clamp01(Number(link.weight || 0)) * 170));
    linkForce?.strength((link) => 0.08 + Math.min(0.52, clamp01(Number(link.weight || 0)) * 0.72));

    fgRef.current.d3Force("charge")?.strength(-670);
    fgRef.current.d3Force("semantic-cluster", createSemanticClusterForce(focusByKeyword));
    fgRef.current.d3Force("bridge-center", createBridgeCenterForce());
    fgRef.current.d3Force("collision", createCollisionForce());
    fgRef.current.d3ReheatSimulation();

    const fitTimer = window.setTimeout(() => {
      fgRef.current?.zoomToFit(760, 130);
    }, 420);
    const refitTimer = window.setTimeout(() => {
      fgRef.current?.zoomToFit(520, 145);
    }, 1200);

    return () => {
      window.clearTimeout(fitTimer);
      window.clearTimeout(refitTimer);
      fgRef.current?.d3Force("semantic-cluster", null);
      fgRef.current?.d3Force("bridge-center", null);
      fgRef.current?.d3Force("collision", null);
    };
  }, [focusByKeyword, graphData]);

  const connectionMap = useMemo(() => {
    const map = new Map();

    graphData.links.forEach((link) => {
      const sourceId = getNodeId(link.source);
      const targetId = getNodeId(link.target);
      if (!map.has(sourceId)) {
        map.set(sourceId, new Set());
      }
      if (!map.has(targetId)) {
        map.set(targetId, new Set());
      }
      map.get(sourceId).add(targetId);
      map.get(targetId).add(sourceId);
    });

    return map;
  }, [graphData]);

  const nodeById = useMemo(() => new Map(graphData.nodes.map((node) => [node.id, node])), [graphData.nodes]);

  const selectedFocusIds = useMemo(() => {
    if (!selectedReviewId) {
      return null;
    }

    const neighbors = connectionMap.get(selectedReviewId) || new Set();
    return new Set([selectedReviewId, ...neighbors]);
  }, [connectionMap, selectedReviewId]);

  const hoverContext = useMemo(() => {
    if (!hoveredNodeId) {
      return null;
    }

    const hoveredNode = nodeById.get(hoveredNodeId);
    if (!hoveredNode) {
      return null;
    }

    const neighbors = connectionMap.get(hoveredNodeId) || new Set();

    if (hoveredNode.isBridge) {
      return {
        mode: "bridge",
        keyword: null,
        focusNodeIds: new Set([hoveredNodeId, ...neighbors]),
      };
    }

    const clusterNodeIds = graphData.nodes
      .filter((node) => node.primaryKeyword === hoveredNode.primaryKeyword)
      .map((node) => node.id);

    return {
      mode: "cluster",
      keyword: hoveredNode.primaryKeyword,
      focusNodeIds: new Set([hoveredNodeId, ...neighbors, ...clusterNodeIds]),
    };
  }, [connectionMap, graphData.nodes, hoveredNodeId, nodeById]);

  const activeFocusNodeIds = selectedFocusIds || hoverContext?.focusNodeIds || null;
  const dimByFocus = Boolean(activeFocusNodeIds);
  const hoveredClusterKeyword = hoverContext?.mode === "cluster" ? hoverContext.keyword : null;
  const focusedNodeId = selectedReviewId || hoveredNodeId || null;

  return (
    <div ref={containerRef} className="network-canvas relative h-[660px] overflow-hidden rounded-3xl">
      <div className="pointer-events-none absolute left-3 top-3 z-10 max-w-[330px] rounded-2xl bg-white/88 p-3 shadow-sm ring-1 ring-slate-200/70">
        <p className="text-[11px] font-bold tracking-[0.06em] text-slate-700">그래프 읽는 법</p>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
          크기: 리뷰 유용성 점수, 색상: 네트워크 영향력 점수, 위치: 핵심 키워드 군집(중앙은 브릿지 노드)
        </p>
      </div>
      <ForceGraph2D
        ref={fgRef}
        width={size.width}
        height={size.height}
        graphData={graphData}
        cooldownTicks={240}
        backgroundColor="rgba(0,0,0,0)"
        d3VelocityDecay={0.22}
        enableNodeDrag={false}
        linkWidth={(link) => {
          const sourceId = getNodeId(link.source);
          const targetId = getNodeId(link.target);
          const baseWidth = 1.25 + clamp01(Number(link.weight || 0)) * 3.2;
          const isDirectFocusedLink =
            focusedNodeId && (sourceId === focusedNodeId || targetId === focusedNodeId);

          if (isDirectFocusedLink) {
            return baseWidth + 0.65;
          }
          if (dimByFocus) {
            return Math.max(0.42, baseWidth * 0.34);
          }
          return baseWidth;
        }}
        linkColor={(link) => {
          const sourceId = getNodeId(link.source);
          const targetId = getNodeId(link.target);
          const isDirectFocusedLink =
            focusedNodeId && (sourceId === focusedNodeId || targetId === focusedNodeId);
          if (isDirectFocusedLink) {
            return "rgba(51, 65, 85, 0.84)";
          }
          if (dimByFocus) {
            return "rgba(203, 213, 225, 0.4)";
          }
          return "rgba(100, 116, 139, 0.64)";
        }}
        onRenderFramePost={(ctx, globalScale) => {
          if (!focalPoints.length) {
            return;
          }

          const fontSize = Math.max(11, 24 / Math.max(globalScale, 0.4));

          ctx.save();
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.font = `700 ${fontSize}px Pretendard, Noto Sans KR, sans-serif`;

          focalPoints.forEach((focus) => {
            const dimmed = hoveredClusterKeyword && hoveredClusterKeyword !== focus.keyword;
            ctx.fillStyle = dimmed ? "rgba(100, 116, 139, 0.2)" : "rgba(71, 85, 105, 0.38)";
            ctx.fillText(focus.keyword, focus.x, focus.y);
          });

          ctx.restore();
        }}
        onNodeClick={(node) => onSelectReviewId(node.id)}
        onNodeHover={(node) => {
          setHoveredNodeId(node ? node.id : null);
          if (containerRef.current) {
            containerRef.current.style.cursor = node ? "pointer" : "default";
          }
        }}
        nodeCanvasObject={(node, ctx) => {
          const isSelected = node.id === selectedReviewId;
          const isHovered = node.id === hoveredNodeId;
          const inFocus = activeFocusNodeIds ? activeFocusNodeIds.has(node.id) : true;
          const radius = Math.max(7.6, Number(node.size) || 10.8);

          const nodeAlpha = dimByFocus && !inFocus ? 0.34 : 1;
          const normalizedColor = normalizedColorByNodeId.get(node.id);
          const fill = colorFromScale(normalizedColor ?? node.colorValue, 0.98 * nodeAlpha);

          ctx.beginPath();
          ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
          ctx.fillStyle = fill;
          ctx.fill();

          ctx.beginPath();
          ctx.arc(node.x, node.y, radius + (isSelected ? 6.1 : isHovered ? 4.4 : node.isBridge ? 3.6 : 2.2), 0, 2 * Math.PI, false);
          ctx.lineWidth = isSelected ? 3.2 : node.isBridge ? 2.4 : 1.8;

          if (isSelected) {
            ctx.strokeStyle = "rgba(15, 23, 42, 0.96)";
          } else if (inFocus) {
            ctx.strokeStyle = "rgba(51, 65, 85, 0.82)";
          } else {
            ctx.strokeStyle = `rgba(241, 245, 249, ${dimByFocus && !inFocus ? 0.42 : 0.88})`;
          }

          ctx.stroke();
        }}
      />
    </div>
  );
}

export default ReviewNetworkGraph;
