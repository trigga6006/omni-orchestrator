import { useRef, useMemo, useEffect, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";

interface Props {
  from: [number, number, number];
  to: [number, number, number];
  color: string;
  active: boolean;
  fromName?: string;
  toName?: string;
  lastMessage?: string;
  lastMessageAt?: string;
}

export default function ConnectionLine({
  from,
  to,
  color,
  active,
  fromName,
  toName,
  lastMessage,
  lastMessageAt,
}: Props) {
  const lineRef = useRef<THREE.Line | null>(null);
  const dashOffsetVal = useRef(0);
  const [hovered, setHovered] = useState(false);

  const curve = useMemo(() => {
    const mid: [number, number, number] = [
      (from[0] + to[0]) / 2,
      Math.max(from[1], to[1]) + 2,
      (from[2] + to[2]) / 2,
    ];
    return new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(...from),
      new THREE.Vector3(...mid),
      new THREE.Vector3(...to)
    );
  }, [from[0], from[1], from[2], to[0], to[1], to[2]]);

  const midPoint = useMemo(() => curve.getPoint(0.5), [curve]);

  const geometry = useMemo(() => {
    const points = curve.getPoints(40);
    return new THREE.BufferGeometry().setFromPoints(points);
  }, [curve]);

  const material = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: active ? 0.6 : 0.2,
      }),
    [color, active]
  );

  // Invisible tube for hover detection
  const tubeGeo = useMemo(
    () => new THREE.TubeGeometry(curve, 20, 0.15, 8, false),
    [curve]
  );

  useFrame(() => {
    if (lineRef.current && active) {
      dashOffsetVal.current -= 0.02;
      material.opacity = 0.4 + Math.sin(dashOffsetVal.current * 5) * 0.2;
    }
    if (lineRef.current && hovered) {
      material.opacity = 0.8;
    }
  });

  // Imperatively create the Three.js line to avoid JSX type conflicts
  const groupRef = useRef<THREE.Group>(null);

  useEffect(() => {
    if (!groupRef.current) return;
    const line = new THREE.Line(geometry, material);
    lineRef.current = line;
    groupRef.current.add(line);
    return () => {
      groupRef.current?.remove(line);
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  return (
    <group ref={groupRef}>
      {/* Invisible tube for raycast detection */}
      <mesh
        geometry={tubeGeo}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          setHovered(false);
          document.body.style.cursor = "default";
        }}
        visible={false}
      >
        <meshBasicMaterial transparent opacity={0} />
      </mesh>

      {/* Hover tooltip */}
      {hovered && (fromName || toName) && (
        <Html
          position={[midPoint.x, midPoint.y + 0.4, midPoint.z]}
          center
          style={{ pointerEvents: "none" }}
        >
          <div className="glass-strong rounded-lg px-3 py-2 text-[11px] whitespace-nowrap min-w-[140px]">
            <div className="flex items-center gap-1.5 text-text-primary font-medium">
              <span>{fromName ?? "?"}</span>
              <span className="text-accent-cyan">-&gt;</span>
              <span>{toName ?? "?"}</span>
            </div>
            {lastMessage && (
              <div className="mt-1 text-text-secondary max-w-[240px] truncate">
                {lastMessage}
              </div>
            )}
            {lastMessageAt && (
              <div className="mt-0.5 text-text-muted text-[10px]">
                {new Date(lastMessageAt).toLocaleTimeString()}
              </div>
            )}
          </div>
        </Html>
      )}
    </group>
  );
}
