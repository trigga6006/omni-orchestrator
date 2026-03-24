import { useRef, useState, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import type { Mesh } from "three";
import * as THREE from "three";
import { useAppStore } from "../stores/appStore";
import type { Agent, AgentStatus } from "../types";

const STATUS_COLORS: Record<AgentStatus, string> = {
  starting: "#f59e0b",
  active: "#06b6d4",
  idle: "#64748b",
  error: "#ef4444",
  stopped: "#374151",
};

const STATUS_EMISSIVE: Record<AgentStatus, number> = {
  starting: 0.4,
  active: 0.8,
  idle: 0.1,
  error: 0.6,
  stopped: 0,
};

interface Props {
  agent: Agent;
  position: [number, number, number];
  nodeColor: string;
}

export default function AgentSphere({ agent, position, nodeColor }: Props) {
  const meshRef = useRef<Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const selectAgent = useAppStore((s) => s.selectAgent);
  const selectedAgentId = useAppStore((s) => s.selectedAgentId);
  const isSelected = selectedAgentId === agent.id;

  const statusColor = useMemo(
    () => new THREE.Color(STATUS_COLORS[agent.status]),
    [agent.status]
  );

  useFrame((state) => {
    if (!meshRef.current) return;
    // Gentle bob
    meshRef.current.position.y =
      position[1] + Math.sin(state.clock.elapsedTime * 1.2 + position[0] * 3) * 0.06;

    // Pulse emissive for active agents
    if (agent.status === "active") {
      const mat = meshRef.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity =
        0.5 + Math.sin(state.clock.elapsedTime * 2.5) * 0.3;
    }
  });

  return (
    <group position={position}>
      {/* Main sphere */}
      <mesh
        ref={meshRef}
        onClick={(e) => {
          e.stopPropagation();
          selectAgent(isSelected ? null : agent.id);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          setHovered(false);
          document.body.style.cursor = "default";
        }}
        scale={hovered || isSelected ? 1.15 : 1}
      >
        <sphereGeometry args={[0.25, 32, 32]} />
        <meshStandardMaterial
          color={STATUS_COLORS[agent.status]}
          emissive={STATUS_COLORS[agent.status]}
          emissiveIntensity={STATUS_EMISSIVE[agent.status]}
          roughness={0.2}
          metalness={0.6}
          transparent
          opacity={0.9}
        />
      </mesh>

      {/* Outer ring for selected state */}
      {isSelected && (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.35, 0.38, 32]} />
          <meshBasicMaterial
            color={STATUS_COLORS[agent.status]}
            transparent
            opacity={0.5}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}

      {/* Agent name label */}
      {(hovered || isSelected) && (
        <Text
          position={[0, 0.45, 0]}
          fontSize={0.15}
          color="#f1f5f9"
          anchorX="center"
          anchorY="bottom"
          font={undefined}
        >
          {agent.name}
        </Text>
      )}

      {/* Status dot indicator */}
      <mesh position={[0.2, 0.2, 0.2]}>
        <sphereGeometry args={[0.05, 16, 16]} />
        <meshBasicMaterial color={STATUS_COLORS[agent.status]} />
      </mesh>
    </group>
  );
}
