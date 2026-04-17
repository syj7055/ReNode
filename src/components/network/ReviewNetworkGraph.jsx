import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";

const getNodeId = (nodeRef) => (typeof nodeRef === "object" ? nodeRef.id : nodeRef);

function ReviewNetworkGraph({ graphData, selectedReviewId, onSelectReviewId }) {
  const containerRef = useRef(null);
  const fgRef = useRef(null);
  const [size, setSize] = useState({ width: 720, height: 520 });

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
    if (!fgRef.current || graphData.nodes.length === 0) {
      return;
    }

    const fitTimer = window.setTimeout(() => {
      fgRef.current.zoomToFit(380, 80);
    }, 120);

    return () => window.clearTimeout(fitTimer);
  }, [graphData]);

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

  const highlightedNodeIds = useMemo(() => {
    if (!selectedReviewId) {
      return new Set();
    }

    const neighbors = connectionMap.get(selectedReviewId) || new Set();
    return new Set([selectedReviewId, ...neighbors]);
  }, [connectionMap, selectedReviewId]);

  return (
    <div ref={containerRef} className="network-canvas relative h-[460px] overflow-hidden rounded-3xl">
      <ForceGraph2D
        ref={fgRef}
        width={size.width}
        height={size.height}
        graphData={graphData}
        cooldownTicks={120}
        backgroundColor="rgba(0,0,0,0)"
        d3VelocityDecay={0.2}
        linkWidth={(link) => {
          const sourceId = getNodeId(link.source);
          const targetId = getNodeId(link.target);
          const selected = sourceId === selectedReviewId || targetId === selectedReviewId;
          return selected ? 2.8 : 1.1;
        }}
        linkColor={(link) => {
          const sourceId = getNodeId(link.source);
          const targetId = getNodeId(link.target);
          const selected = sourceId === selectedReviewId || targetId === selectedReviewId;
          if (selected) {
            return "rgba(249, 115, 22, 0.92)";
          }
          if (selectedReviewId) {
            return "rgba(148, 163, 184, 0.26)";
          }
          return "rgba(148, 163, 184, 0.55)";
        }}
        nodeRelSize={7}
        onNodeClick={(node) => onSelectReviewId(node.id)}
        nodeCanvasObject={(node, ctx, globalScale) => {
          const isSelected = node.id === selectedReviewId;
          const isConnected = highlightedNodeIds.has(node.id);
          const radius = 4 + node.centrality * 15;
          const label = `${node.label} (${node.helpfulnessScore})`;

          let fill = "rgba(51, 65, 85, 0.78)";
          if (node.helpfulnessScore >= 90) {
            fill = "#f97316";
          } else if (node.helpfulnessScore >= 82) {
            fill = "#f59e0b";
          } else if (node.helpfulnessScore >= 72) {
            fill = "#06b6d4";
          }

          if (selectedReviewId && !isConnected) {
            fill = "rgba(148, 163, 184, 0.45)";
          }

          ctx.beginPath();
          ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
          ctx.fillStyle = fill;
          ctx.fill();

          ctx.beginPath();
          ctx.arc(node.x, node.y, radius + (isSelected ? 5 : 2), 0, 2 * Math.PI, false);
          ctx.lineWidth = isSelected ? 2.4 : 1.2;
          ctx.strokeStyle = isSelected ? "rgba(249, 115, 22, 0.95)" : "rgba(255, 255, 255, 0.7)";
          ctx.stroke();

          const fontSize = 12 / globalScale;
          ctx.font = `600 ${fontSize}px Pretendard`;
          ctx.fillStyle = "rgba(30, 41, 59, 0.86)";
          ctx.fillText(label, node.x + radius + 2, node.y + 3);
        }}
      />
    </div>
  );
}

export default ReviewNetworkGraph;
