import { useRef, useState, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { Text, RoundedBox } from "@react-three/drei";
import type { Group, Mesh } from "three";
import * as THREE from "three";
import { useAppStore } from "../stores/appStore";
import type { SwarmNode, Agent } from "../types";
import AgentSphere from "./AgentSphere";

interface Props {
  node: SwarmNode;
  agents: Agent[];
}

export default function NodePlatform({ node, agents }: Props) {
  const groupRef = useRef<Group>(null);
  const glowRef = useRef<Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const selectedNodeId = useAppStore((s) => s.selectedNodeId);
  const selectNode = useAppStore((s) => s.selectNode);
  const isSelected = selectedNodeId === node.id;

  const color = useMemo(() => new THREE.Color(node.color), [node.color]);

  // Floating animation
  useFrame((state) => {
    if (groupRef.current) {
      groupRef.current.position.y =
        node.position[1] + Math.sin(state.clock.elapsedTime * 0.5 + node.position[0]) * 0.15;
    }
    if (glowRef.current) {
      const mat = glowRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = (hovered || isSelected)
        ? 0.15 + Math.sin(state.clock.elapsedTime * 2) * 0.05
        : 0.06;
    }
  });

  // Arrange agents in a circle on the platform
  const agentPositions = useMemo(() => {
    if (agents.length === 0) return [];
    if (agents.length === 1) return [[0, 0.8, 0] as [number, number, number]];

    const radius = Math.min(1.5, 0.6 + agents.length * 0.2);
    return agents.map((_, i) => {
      const angle = (i / agents.length) * Math.PI * 2 - Math.PI / 2;
      return [
        Math.cos(angle) * radius,
        0.8,
        Math.sin(angle) * radius,
      ] as [number, number, number];
    });
  }, [agents.length]);

  const platformSize = Math.max(3, 1.5 + agents.length * 0.8);

  return (
    <group
      ref={groupRef}
      position={node.position}
      onClick={(e) => {
        e.stopPropagation();
        selectNode(isSelected ? null : node.id);
      }}
      onPointerOver={() => setHovered(true)}
      onPointerOut={() => setHovered(false)}
    >
      {/* Platform base */}
      <RoundedBox
        args={[platformSize, 0.15, platformSize]}
        radius={0.08}
        smoothness={4}
      >
        <meshStandardMaterial
          color={node.color}
          transparent
          opacity={isSelected ? 0.3 : hovered ? 0.2 : 0.12}
          roughness={0.5}
          metalness={0.5}
        />
      </RoundedBox>

      {/* Glow ring under platform */}
      <mesh ref={glowRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]}>
        <ringGeometry args={[platformSize * 0.45, platformSize * 0.52, 64]} />
        <meshBasicMaterial color={node.color} transparent opacity={0.08} side={THREE.DoubleSide} />
      </mesh>

      {/* Edge glow lines */}
      <lineSegments position={[0, 0.08, 0]}>
        <edgesGeometry
          args={[new THREE.BoxGeometry(platformSize - 0.1, 0.12, platformSize - 0.1)]}
        />
        <lineBasicMaterial color={node.color} transparent opacity={isSelected ? 0.6 : 0.2} />
      </lineSegments>

      {/* Node name label */}
      <Text
        position={[0, 0.4, -platformSize / 2 + 0.3]}
        fontSize={0.28}
        color={node.color}
        anchorX="center"
        anchorY="bottom"
        font={undefined}
      >
        {node.name}
      </Text>

      {/* Agent count badge */}
      <Text
        position={[platformSize / 2 - 0.3, 0.4, -platformSize / 2 + 0.3]}
        fontSize={0.18}
        color="#64748b"
        anchorX="right"
        anchorY="bottom"
        font={undefined}
      >
        {agents.length} agent{agents.length !== 1 ? "s" : ""}
      </Text>

      {/* Agent spheres */}
      {agents.map((agent, i) => (
        <AgentSphere
          key={agent.id}
          agent={agent}
          position={agentPositions[i] || [0, 0.8, 0]}
          nodeColor={node.color}
        />
      ))}
    </group>
  );
}
