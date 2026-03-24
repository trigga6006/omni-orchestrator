import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

interface Props {
  from: [number, number, number];
  to: [number, number, number];
  color: string;
  dashed: boolean;
}

/**
 * Visual arc between two node platforms.
 * Solid = same-directory auto-link (emerald).
 * Dashed = explicit cross-speak link (violet).
 */
export default function NodeLink({ from, to, color, dashed }: Props) {
  const groupRef = useRef<THREE.Group>(null);
  const lineRef = useRef<THREE.Line | null>(null);
  const dashOffset = useRef(0);

  const curve = useMemo(() => {
    const mid: [number, number, number] = [
      (from[0] + to[0]) / 2,
      Math.max(from[1], to[1]) + 3.5,
      (from[2] + to[2]) / 2,
    ];
    return new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(...from),
      new THREE.Vector3(...mid),
      new THREE.Vector3(...to)
    );
  }, [from[0], from[1], from[2], to[0], to[1], to[2]]);

  const geometry = useMemo(() => {
    const points = curve.getPoints(50);
    const geo = new THREE.BufferGeometry().setFromPoints(points);

    if (dashed) {
      // Compute distances for dash effect
      const distances = new Float32Array(points.length);
      let total = 0;
      for (let i = 1; i < points.length; i++) {
        total += points[i].distanceTo(points[i - 1]);
        distances[i] = total;
      }
      geo.setAttribute("lineDistance", new THREE.BufferAttribute(distances, 1));
    }

    return geo;
  }, [curve, dashed]);

  const material = useMemo(() => {
    if (dashed) {
      return new THREE.LineDashedMaterial({
        color,
        transparent: true,
        opacity: 0.4,
        dashSize: 0.4,
        gapSize: 0.25,
      });
    }
    return new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.25,
    });
  }, [color, dashed]);

  useFrame(() => {
    if (dashed && lineRef.current) {
      dashOffset.current -= 0.01;
      (material as unknown as { dashOffset: number }).dashOffset = dashOffset.current;
    }
  });

  useEffect(() => {
    if (!groupRef.current) return;
    const line = new THREE.Line(geometry, material);
    if (dashed) line.computeLineDistances();
    lineRef.current = line;
    groupRef.current.add(line);
    return () => {
      groupRef.current?.remove(line);
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material, dashed]);

  return <group ref={groupRef} />;
}
