import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";

const getNodeId = (nodeRef) => (typeof nodeRef === "object" ? nodeRef.id : nodeRef);
const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

const FOCUS_LAYOUT = [
  { x: -170, y: -105 },
  { x: 160, y: -135 },
  { x: 40, y: 165 },
];

const colorFromScale = (value, alpha = 1) => {
  const v = clamp01(value);
  const hue = 210 - 210 * v;
  const saturation = 78;
  const lightness = 57 - 10 * v;
  return `hsla(${hue}, ${saturation}%, ${lightness}%, ${alpha})`;
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
      const strength = 0.045 + gravityDamping * 0.06;
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

      const strength = 0.13 + clamp01(node.centralGravity) * 0.34;
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
        const minDistance = (a.size || 6) + (b.size || 6) + 6;

        if (distSq >= minDistance * minDistance) {
          continue;
        }

        const distance = Math.sqrt(distSq);
        const overlap = ((minDistance - distance) / distance) * 0.5 * alpha;
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
        height: Math.max(360, Math.floor(entry.contentRect.height)),
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

  useEffect(() => {
    if (!fgRef.current || graphData.nodes.length === 0) {
      return;
    }

    const linkForce = fgRef.current.d3Force("link");
    linkForce?.distance((link) => 120 - Math.min(58, clamp01(Number(link.weight || 0)) * 70));
    linkForce?.strength((link) => 0.18 + Math.min(0.62, clamp01(Number(link.weight || 0)) * 0.75));

    fgRef.current.d3Force("charge")?.strength(-210);
    fgRef.current.d3Force("semantic-cluster", createSemanticClusterForce(focusByKeyword));
    fgRef.current.d3Force("bridge-center", createBridgeCenterForce());
    fgRef.current.d3Force("collision", createCollisionForce());
    fgRef.current.d3ReheatSimulation();

    const fitTimer = window.setTimeout(() => {
      fgRef.current.zoomToFit(520, 75);
    }, 120);

    return () => {
      window.clearTimeout(fitTimer);
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

  return (
    <div ref={containerRef} className="network-canvas relative h-[460px] overflow-hidden rounded-3xl">
      <ForceGraph2D
        ref={fgRef}
        width={size.width}
        height={size.height}
        graphData={graphData}
        cooldownTicks={180}
        backgroundColor="rgba(0,0,0,0)"
        d3VelocityDecay={0.22}
        linkWidth={(link) => {
          const sourceId = getNodeId(link.source);
          const targetId = getNodeId(link.target);
          const baseWidth = 0.65 + clamp01(Number(link.weight || 0)) * 2.4;
          const isSelectedLink = sourceId === selectedReviewId || targetId === selectedReviewId;
          const inFocus =
            activeFocusNodeIds &&
            (activeFocusNodeIds.has(sourceId) || activeFocusNodeIds.has(targetId));

          if (isSelectedLink) {
            return baseWidth + 1.6;
          }
          if (inFocus) {
            return baseWidth + 0.8;
          }
          if (dimByFocus) {
            return Math.max(0.24, baseWidth * 0.28);
          }
          return baseWidth;
        }}
        linkColor={(link) => {
          const sourceId = getNodeId(link.source);
          const targetId = getNodeId(link.target);
          const isSelectedLink = sourceId === selectedReviewId || targetId === selectedReviewId;
          if (isSelectedLink) {
            return "rgba(249, 115, 22, 0.92)";
          }
          const inFocus =
            activeFocusNodeIds &&
            activeFocusNodeIds.has(sourceId) &&
            activeFocusNodeIds.has(targetId);

          if (inFocus) {
            return "rgba(56, 189, 248, 0.82)";
          }
          if (dimByFocus) {
            return "rgba(148, 163, 184, 0.12)";
          }
          return "rgba(148, 163, 184, 0.48)";
        }}
        onRenderFramePost={(ctx, globalScale) => {
          if (!focalPoints.length) {
            return;
          }

          const fontSize = Math.max(14, 38 / Math.max(globalScale, 0.3));

          ctx.save();
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.font = `700 ${fontSize}px Pretendard, Noto Sans KR, sans-serif`;

          focalPoints.forEach((focus) => {
            const dimmed = hoveredClusterKeyword && hoveredClusterKeyword !== focus.keyword;
            ctx.fillStyle = dimmed ? "rgba(100, 116, 139, 0.14)" : "rgba(100, 116, 139, 0.27)";
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
          const radius = Math.max(3.2, Number(node.size) || 6);

          const nodeAlpha = dimByFocus && !inFocus ? 0.2 : 1;
          const fill = colorFromScale(node.colorValue, 0.92 * nodeAlpha);

          ctx.beginPath();
          ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
          ctx.fillStyle = fill;
          ctx.fill();

          ctx.beginPath();
          ctx.arc(node.x, node.y, radius + (isSelected ? 5.2 : isHovered ? 3.6 : node.isBridge ? 2.8 : 1.6), 0, 2 * Math.PI, false);
          ctx.lineWidth = isSelected ? 2.8 : node.isBridge ? 2.1 : 1.25;

          if (isSelected) {
            ctx.strokeStyle = "rgba(249, 115, 22, 0.96)";
          } else if (node.isBridge) {
            ctx.strokeStyle = `rgba(220, 38, 38, ${dimByFocus && !inFocus ? 0.24 : 0.85})`;
          } else {
            ctx.strokeStyle = `rgba(255, 255, 255, ${dimByFocus && !inFocus ? 0.2 : 0.72})`;
          }

          ctx.stroke();
        }}
      />
    </div>
  );
}

export default ReviewNetworkGraph;
