import * as THREE from 'three';
import type { ConductorStatus } from '../types';
import { createTextSprite } from './text-sprite';

/**
 * Аватар проводника — человечек, собранный из кубиков.
 *
 * Он всегда держится рядом с игроком: догоняет его, разворачивается лицом,
 * машет руками на ходу и меняет цвет антенны в зависимости от состояния
 * (думает / рисует / говорит).
 */

const BODY = 0x5b7cff;
const LIMB = 0x4763d1;
const HEAD = 0xe2eeff;
const VISOR = 0x22e6ff;

const STATUS_COLOR: Record<ConductorStatus, number> = {
  idle: 0x7fe7ff,
  thinking: 0xb388ff,
  drawing: 0x5ef2a0,
  speaking: 0xffd166,
};

const FOLLOW_DISTANCE = 1.9;
const FOLLOW_AHEAD = 2.4;
const CATCH_UP_RADIUS = 9;

interface Leg {
  pivot: THREE.Group;
  mesh: THREE.Mesh;
}

export class Conductor {
  readonly group = new THREE.Group();

  private readonly body = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly eyes: THREE.Mesh[] = [];
  private readonly arms: THREE.Group[] = [];
  private readonly legs: Leg[] = [];
  private readonly antennaTip: THREE.Mesh;
  private readonly antennaLight: THREE.PointLight;
  private readonly ring: THREE.Mesh;
  private nameSprite: THREE.Sprite;
  private currentName = '';

  private walkPhase = 0;
  private yaw = 0;
  private targetYaw = 0;
  private status: ConductorStatus = 'idle';
  private statusUntil = 0;
  private readonly lastPosition = new THREE.Vector3(2.2, 0, 0.6);

  constructor() {
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: BODY,
      roughness: 0.35,
      metalness: 0.25,
      emissive: new THREE.Color(BODY),
      emissiveIntensity: 0.12,
    });
    const limbMaterial = new THREE.MeshStandardMaterial({
      color: LIMB,
      roughness: 0.5,
      metalness: 0.15,
    });
    const headMaterial = new THREE.MeshStandardMaterial({
      color: HEAD,
      roughness: 0.28,
      metalness: 0.1,
      emissive: new THREE.Color(0x8fb4ff),
      emissiveIntensity: 0.18,
    });
    const visorMaterial = new THREE.MeshStandardMaterial({
      color: VISOR,
      emissive: new THREE.Color(VISOR),
      emissiveIntensity: 1.4,
      roughness: 0.2,
    });

    // корпус
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.56, 0.32), bodyMaterial);
    torso.position.y = 0.94;
    torso.castShadow = true;
    this.body.add(torso);

    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.02), visorMaterial);
    chest.position.set(0, 0.98, 0.17);
    this.body.add(chest);

    // голова
    const skull = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.34, 0.34), headMaterial);
    skull.castShadow = true;
    this.head.add(skull);

    for (const x of [-0.085, 0.085]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.06, 0.02), visorMaterial);
      eye.position.set(x, 0.03, 0.171);
      this.head.add(eye);
      this.eyes.push(eye);
    }

    const mouth = new THREE.Mesh(
      new THREE.BoxGeometry(0.11, 0.022, 0.012),
      new THREE.MeshStandardMaterial({ color: 0x2b3550, roughness: 0.6 }),
    );
    mouth.position.set(0, -0.09, 0.172);
    this.head.add(mouth);

    const stem = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.1, 0.03), limbMaterial);
    stem.position.set(0, 0.22, 0);
    this.head.add(stem);

    this.antennaTip = new THREE.Mesh(
      new THREE.BoxGeometry(0.11, 0.11, 0.11),
      visorMaterial.clone() as THREE.MeshStandardMaterial,
    );
    this.antennaTip.position.set(0, 0.32, 0);
    this.head.add(this.antennaTip);

    this.head.position.y = 1.32;
    this.body.add(this.head);

    // руки
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.31, 1.14, 0);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.44, 0.13), limbMaterial);
      arm.position.y = -0.21;
      arm.castShadow = true;
      pivot.add(arm);
      this.body.add(pivot);
      this.arms.push(pivot);
    }

    // ноги
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.13, 0.66, 0);
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.66, 0.17), limbMaterial);
      leg.position.y = -0.33;
      leg.castShadow = true;
      pivot.add(leg);
      this.body.add(pivot);
      this.legs.push({ pivot, mesh: leg });
    }

    // подсветка и «нимб» под ногами
    this.antennaLight = new THREE.PointLight(0x7fe7ff, 2.4, 4, 2);
    this.antennaLight.position.set(0, 1.65, 0);
    this.body.add(this.antennaLight);

    this.ring = new THREE.Mesh(
      new THREE.CircleGeometry(0.52, 40),
      new THREE.MeshBasicMaterial({
        color: 0x7fe7ff,
        transparent: true,
        opacity: 0.22,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.02;
    this.group.add(this.ring);

    const label = createTextSprite('Gemini Nano', {
      color: '#dbeafe',
      fontSize: 48,
      background: 'rgba(11, 15, 26, 0.6)',
    });
    this.nameSprite = label.sprite;
    this.nameSprite.scale.set(0.72, 0.72 / label.aspect, 1);
    this.currentName = 'Gemini Nano';
    this.nameSprite.position.set(0, 2.0, 0);
    this.group.add(this.nameSprite);

    this.group.add(this.body);
    this.group.position.copy(this.lastPosition);
  }

  get positionVector(): THREE.Vector3 {
    return this.group.position;
  }

  /**
   * Подпись над проводником: показывает, какой движек сейчас отвечает
   * (Gemini Nano / локальная WASM-модель / демо-режим).
   */
  setName(text: string): void {
    if (!text || text === this.currentName) return;
    this.currentName = text;

    this.group.remove(this.nameSprite);
    const oldMaterial = this.nameSprite.material as THREE.SpriteMaterial;
    oldMaterial.map?.dispose();
    oldMaterial.dispose();

    const label = createTextSprite(text, {
      color: '#dbeafe',
      fontSize: 48,
      background: 'rgba(11, 15, 26, 0.6)',
    });
    this.nameSprite = label.sprite;
    const width = Math.max(0.6, Math.min(1.7, 0.62 + text.length * 0.055));
    this.nameSprite.scale.set(width, width / label.aspect, 1);
    this.nameSprite.position.set(0, 2.0, 0);
    this.group.add(this.nameSprite);
  }

  /** Проводник «говорит» / думает — оживляем мимику и подсветку. */
  setStatus(status: ConductorStatus, durationMs = 1500): void {
    this.status = status;
    this.statusUntil = performance.now() + durationMs;
  }

  update(dt: number, playerPosition: THREE.Vector3, playerYaw: number): void {
    const now = performance.now();
    if (now > this.statusUntil && this.status !== 'idle') {
      this.status = 'idle';
    }

    const forward = new THREE.Vector3(-Math.sin(playerYaw), 0, -Math.cos(playerYaw));
    const right = new THREE.Vector3(Math.cos(playerYaw), 0, -Math.sin(playerYaw));
    const desired = playerPosition
      .clone()
      .addScaledVector(right, FOLLOW_DISTANCE)
      .addScaledVector(forward, FOLLOW_AHEAD);

    const distanceToPlayer = this.group.position.distanceTo(playerPosition);
    if (distanceToPlayer > CATCH_UP_RADIUS) {
      this.group.position.copy(desired);
    } else {
      const stiffness = distanceToPlayer > 4 ? 5.5 : 3.2;
      const alpha = 1 - Math.exp(-stiffness * dt);
      this.group.position.lerp(desired, alpha);
    }

    // не залезаем в камеру
    const toPlayer = playerPosition.clone().sub(this.group.position);
    toPlayer.y = 0;
    if (toPlayer.length() < 0.85) {
      toPlayer.setLength(0.85);
      this.group.position.copy(playerPosition).sub(toPlayer);
    }
    this.group.position.y = 0;

    // поворот: рядом — лицом к игроку, иначе по направлению движения
    const velocity = this.group.position.clone().sub(this.lastPosition);
    velocity.y = 0;
    if (distanceToPlayer < 3.6 || velocity.lengthSq() < 0.00002) {
      this.targetYaw = Math.atan2(toPlayer.x, toPlayer.z);
    } else {
      this.targetYaw = Math.atan2(velocity.x, velocity.z);
    }
    this.yaw = lerpAngle(this.yaw, this.targetYaw, 1 - Math.exp(-6 * dt));
    this.group.rotation.y = this.yaw;
    this.lastPosition.copy(this.group.position);

    // походка
    const speed = velocity.length() / Math.max(dt, 0.0001);
    this.walkPhase += dt * (2.4 + Math.min(speed, 6) * 1.6);
    const stride = Math.min(speed / 2.2, 1);
    const swing = Math.sin(this.walkPhase) * 0.55 * stride;

    for (const [index, arm] of this.arms.entries()) {
      const direction = index === 0 ? 1 : -1;
      arm.rotation.x = swing * direction * 0.9;
      arm.rotation.z = Math.sin(this.walkPhase * 0.5) * 0.05;
    }
    for (const [index, leg] of this.legs.entries()) {
      const direction = index === 0 ? 1 : -1;
      leg.pivot.rotation.x = -swing * direction;
    }

    // «дыхание» и лёгкое покачивание
    this.body.position.y = Math.sin(this.walkPhase * 2) * 0.022 * stride;
    this.body.rotation.z = Math.sin(this.walkPhase) * 0.02 * stride;

    // голова следит за игроком
    const look = Math.atan2(toPlayer.x, toPlayer.z) - this.yaw;
    this.head.rotation.y = clamp(shortestAngle(look), -0.7, 0.7);
    this.head.rotation.x = clamp((playerPosition.y - 1.1 - 1.32) * -0.25, -0.3, 0.35);

    // состояние
    const color = new THREE.Color(STATUS_COLOR[this.status]);
    const tipMaterial = this.antennaTip.material as THREE.MeshStandardMaterial;
    tipMaterial.color.lerp(color, 0.15);
    tipMaterial.emissive.lerp(color, 0.15);
    tipMaterial.emissiveIntensity = this.status === 'idle' ? 1.1 : 1.9;
    this.antennaLight.color.lerp(color, 0.15);
    const ringMaterial = this.ring.material as THREE.MeshBasicMaterial;
    ringMaterial.color.lerp(color, 0.1);
    ringMaterial.opacity = 0.16 + Math.sin(now * 0.002) * 0.05 + (this.status === 'idle' ? 0 : 0.1);

    const busy = this.status === 'thinking' || this.status === 'drawing';
    const eyeMaterial = this.eyes[0]?.material as THREE.MeshStandardMaterial | undefined;
    if (eyeMaterial) {
      eyeMaterial.emissiveIntensity = busy ? 1.2 + Math.sin(now * 0.02) * 0.6 : 1.4;
    }

    this.nameSprite.position.y = 1.98 + Math.sin(now * 0.0012) * 0.02;
  }

  dispose(): void {
    this.group.traverse((child) => {
      const mesh = child as Partial<THREE.Mesh> & Partial<THREE.Sprite>;
      mesh.geometry?.dispose();
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(material)) material.forEach((item) => item.dispose());
      else material?.dispose();
    });
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function shortestAngle(angle: number): number {
  let value = angle;
  while (value > Math.PI) value -= Math.PI * 2;
  while (value < -Math.PI) value += Math.PI * 2;
  return value;
}

function lerpAngle(from: number, to: number, alpha: number): number {
  return from + shortestAngle(to - from) * alpha;
}
