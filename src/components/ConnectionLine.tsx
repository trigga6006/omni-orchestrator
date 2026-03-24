import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

interface Props {
  from: [number, number, number];
  to: [number, number, number];
  color: string;
  active: boolean;
}

export default function ConnectionLine({ from, to, color, active }: Props) {
  const lineRef = useRef<THREE.Line | null>(null);
  const dashOffsetVal = useRef(0);

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

  useFrame(() => {
    if (lineRef.current && active) {
      dashOffsetVal.current -= 0.02;
      material.opacity = 0.4 + Math.sin(dashOffsetVal.current * 5) * 0.2;
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

  return <group ref={groupRef} />;
}
