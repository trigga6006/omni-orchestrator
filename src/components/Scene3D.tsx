import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Stars, Text, Line } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import { useAppStore } from "../stores/appStore";
import NodePlatform from "./NodePlatform";
import ConnectionLine from "./ConnectionLine";
import NodeLink from "./NodeLink";

export default function Scene3D() {
  const nodes = useAppStore((s) => s.nodes);
  const agents = useAppStore((s) => s.agents);
  const connections = useAppStore((s) => s.connections);
  const crossSpeakLinks = useAppStore((s) => s.crossSpeakLinks);

  // Compute same-directory auto-links between node pairs
  const autoLinks = useMemo(() => {
    const links: { from: string; to: string }[] = [];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        if (
          a.directory.replace(/[\\/]+$/, "").toLowerCase() ===
          b.directory.replace(/[\\/]+$/, "").toLowerCase()
        ) {
          links.push({ from: a.id, to: b.id });
        }
      }
    }
    return links;
  }, [nodes]);

  return (
    <Canvas
      camera={{ position: [0, 12, 20], fov: 55, near: 0.1, far: 200 }}
      style={{ background: "#06080d" }}
      gl={{ antialias: true, alpha: false }}
    >
      {/* Ambient environment */}
      <ambientLight intensity={0.15} />
      <pointLight position={[10, 20, 10]} intensity={0.4} color="#94a3b8" />
      <pointLight position={[-10, 15, -10]} intensity={0.2} color="#06b6d4" />

      {/* Background stars */}
      <Stars radius={80} depth={60} count={1500} factor={3} fade speed={0.5} />

      {/* Ground grid */}
      <GridFloor />

      {/* Nodes */}
      {nodes.map((node) => {
        const nodeAgents = agents.filter((a) => a.nodeId === node.id);
        return (
          <NodePlatform
            key={node.id}
            node={node}
            agents={nodeAgents}
          />
        );
      })}

      {/* Connection lines between agents */}
      {connections.map((conn) => {
        const fromAgent = agents.find((a) => a.id === conn.from);
        const toAgent = agents.find((a) => a.id === conn.to);
        if (!fromAgent || !toAgent) return null;

        const fromNode = nodes.find((n) => n.id === fromAgent.nodeId);
        const toNode = nodes.find((n) => n.id === toAgent.nodeId);
        if (!fromNode || !toNode) return null;

        // Find the last message between these two agents
        const lastMsg = [...fromAgent.messages, ...toAgent.messages]
          .filter(
            (m) =>
              (m.fromId === fromAgent.peerId && m.toId === toAgent.peerId) ||
              (m.fromId === toAgent.peerId && m.toId === fromAgent.peerId) ||
              m.text.includes(toAgent.name) ||
              m.text.includes(fromAgent.name)
          )
          .sort((a, b) => b.sentAt.localeCompare(a.sentAt))[0];

        return (
          <ConnectionLine
            key={`${conn.from}-${conn.to}`}
            from={fromNode.position}
            to={toNode.position}
            color="#06b6d4"
            active={conn.active}
            fromName={fromAgent.name}
            toName={toAgent.name}
            lastMessage={lastMsg?.text.slice(0, 100)}
            lastMessageAt={conn.lastMessageAt}
          />
        );
      })}

      {/* Same-directory auto-links (solid emerald arcs between nodes) */}
      {autoLinks.map((link) => {
        const fromNode = nodes.find((n) => n.id === link.from);
        const toNode = nodes.find((n) => n.id === link.to);
        if (!fromNode || !toNode) return null;
        return (
          <NodeLink
            key={`auto-${link.from}-${link.to}`}
            from={fromNode.position}
            to={toNode.position}
            color="#10b981"
            dashed={false}
          />
        );
      })}

      {/* Cross-speak links (dashed violet arcs between nodes) */}
      {crossSpeakLinks.map((link) => {
        const fromNode = nodes.find((n) => n.id === link.nodeA);
        const toNode = nodes.find((n) => n.id === link.nodeB);
        if (!fromNode || !toNode) return null;
        return (
          <NodeLink
            key={`xspeak-${link.id}`}
            from={fromNode.position}
            to={toNode.position}
            color="#8b5cf6"
            dashed={true}
          />
        );
      })}

      {/* Empty state text */}
      {nodes.length === 0 && (
        <Text
          position={[0, 2, 0]}
          fontSize={0.6}
          color="#64748b"
          anchorX="center"
          anchorY="middle"
          font={undefined}
        >
          Create a node to get started
        </Text>
      )}

      {/* Post-processing */}
      <EffectComposer>
        <Bloom
          intensity={0.5}
          luminanceThreshold={0.6}
          luminanceSmoothing={0.9}
          mipmapBlur
        />
      </EffectComposer>

      {/* Controls */}
      <OrbitControls
        makeDefault
        enablePan
        enableZoom
        enableRotate
        maxPolarAngle={Math.PI / 2.1}
        minDistance={5}
        maxDistance={60}
        zoomSpeed={0.8}
        panSpeed={0.8}
        rotateSpeed={0.5}
      />
    </Canvas>
  );
}

function GridFloor() {
  const gridSize = 40;
  const divisions = 40;
  const lines: [number, number, number][][] = [];

  for (let i = -gridSize / 2; i <= gridSize / 2; i += gridSize / divisions) {
    lines.push([
      [i, -0.01, -gridSize / 2],
      [i, -0.01, gridSize / 2],
    ]);
    lines.push([
      [-gridSize / 2, -0.01, i],
      [gridSize / 2, -0.01, i],
    ]);
  }

  return (
    <group>
      {lines.map((points, i) => (
        <Line
          key={i}
          points={points}
          color="#1e293b"
          lineWidth={0.5}
          transparent
          opacity={0.4}
        />
      ))}
    </group>
  );
}
