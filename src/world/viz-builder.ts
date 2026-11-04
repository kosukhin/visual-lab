import * as THREE from 'three';
import type { Vec3, VisualizationSpec, VizPart } from '../types';
import { createTextSprite } from './text-sprite';

/**
 * Превращает декларативную спеку (её пишет Gemini Nano) в реальную геометрию.
 *
 * Результат всегда «нормализован»: модель центрирована по X/Z, стоит на
 * плоскости y = 0 и вписана в габарит ~2.4 м, чтобы любые числа от модели
 * выглядели аккуратно.
 */

export interface BuiltModel {
  /** Группа, у которой низ модели находится на y = 0. */
  object: THREE.Group;
  height: number;
  radius: number;
  dispose(): void;
}

const TARGET_SIZE = 2.4;
const MAX_SCALE = 2.2;

function toVector([x, y, z]: Vec3): THREE.Vector3 {
  return new THREE.Vector3(x, y, z);
}

function createGeometry(part: VizPart): THREE.BufferGeometry | null {
  switch (part.shape) {
    case 'box':
      return new THREE.BoxGeometry(1, 1, 1);
    case 'sphere':
      return new THREE.SphereGeometry(0.5, 28, 18);
    case 'cylinder':
      return new THREE.CylinderGeometry(0.5, 0.5, 1, 28);
    case 'cone':
      return new THREE.ConeGeometry(0.5, 1, 28);
    case 'torus':
      return new THREE.TorusGeometry(0.5, 0.16, 16, 48);
    case 'capsule':
      return new THREE.CapsuleGeometry(0.35, 0.4, 8, 20);
    case 'plane':
      return new THREE.PlaneGeometry(1, 1);
    case 'octahedron':
      return new THREE.OctahedronGeometry(0.6, 0);
    default:
      return null;
  }
}

function buildPart(part: VizPart): THREE.Object3D | null {
  const position = toVector(part.position ?? [0, 1.6, 0]);
  const rotation = toVector(part.rotation ?? [0, 0, 0]);
  const scale = toVector(part.scale ?? [1, 1, 1]);

  if (part.shape === 'text') {
    const { sprite } = createTextSprite(part.text ?? 'text', {
      color: part.color ?? '#e2eeff',
      fontSize: 56,
    });
    const width = Math.max(0.8, (part.text?.length ?? 4) * 0.22);
    sprite.scale.set(width, width / 2.6, 1);
    sprite.position.copy(position);
    sprite.userData.dispose = () => {
      sprite.material.map?.dispose();
      sprite.material.dispose();
    };
    return sprite;
  }

  if (part.shape === 'line') {
    const points = (part.points ?? []).map(toVector);
    if (points.length < 2) return null;
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: new THREE.Color(part.color ?? '#7fe7ff'),
      transparent: (part.opacity ?? 1) < 1,
      opacity: part.opacity ?? 1,
    });
    return new THREE.Line(geometry, material);
  }

  const geometry = createGeometry(part);
  if (!geometry) return null;

  const color = new THREE.Color(part.color ?? '#4ea1ff');
  const opacity = part.opacity ?? 1;
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.42,
    metalness: 0.18,
    // лёгкое собственное свечение, чтобы модели не проваливались в чёрный
    emissive: color,
    emissiveIntensity: part.glow ? 0.9 : 0.22,
    transparent: opacity < 1,
    opacity,
    wireframe: part.wireframe === true,
    side: part.shape === 'plane' ? THREE.DoubleSide : THREE.FrontSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(position);
  mesh.rotation.set(rotation.x, rotation.y, rotation.z);
  mesh.scale.copy(scale);
  mesh.castShadow = !part.wireframe;
  mesh.receiveShadow = true;
  return mesh;
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((child) => {
    const disposable = child.userData.dispose as (() => void) | undefined;
    disposable?.();
    const mesh = child as Partial<THREE.Mesh> & Partial<THREE.Line> & Partial<THREE.Sprite>;
    mesh.geometry?.dispose();
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) {
      material.forEach((item) => item.dispose());
    } else {
      material?.dispose();
    }
  });
}

export function buildModel(spec: VisualizationSpec): BuiltModel {
  const inner = new THREE.Group();

  for (const part of spec.parts) {
    const object = buildPart(part);
    if (object) inner.add(object);
  }

  const bounds = new THREE.Box3().setFromObject(inner);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const maxDimension = Math.max(size.x, size.y, size.z, 0.001);
  const scale = Math.min(TARGET_SIZE / maxDimension, MAX_SCALE);

  inner.scale.setScalar(scale);
  inner.position.set(-center.x * scale, -center.y * scale, -center.z * scale);

  const object = new THREE.Group();
  object.add(inner);

  const height = Math.max(size.y * scale, 0.2);
  const radius = Math.max(size.x * scale, size.z * scale, 0.4) / 2;

  // низ модели на y = 0
  object.position.y = height / 2;

  return {
    object,
    height,
    radius,
    dispose: () => disposeObject(object),
  };
}
