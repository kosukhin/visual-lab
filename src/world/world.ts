import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import type { Visualization } from '../types';
import { Conductor } from './conductor';
import { createTextSprite } from './text-sprite';
import { buildModel, type BuiltModel } from './viz-builder';

/**
 * 3D-мир Visual Lab: пустая площадка, проводник рядом с игроком и витрина
 * визуализаций. Управление — от первого лица (WASD + мышь, Shift — бег).
 */

const PLAYER_HEIGHT = 1.68;
const WALK_SPEED = 3.6;
const RUN_SPEED = 6.8;
const ACCELERATION = 11;
const WORLD_RADIUS = 46;
const GALLERY_RADIUS = 9.5;
const MAX_GALLERY = 12;

export interface WorldCallbacks {
  onLockChange?: (locked: boolean) => void;
  onLockError?: () => void;
}

class VizInstance {
  readonly root = new THREE.Group();
  readonly model: BuiltModel;
  private readonly pedestal: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private readonly title: THREE.Sprite;
  private spin = 0.18;

  constructor(viz: Visualization) {
    this.model = buildModel(viz.spec);

    const radius = Math.max(0.95, this.model.radius + 0.35);
    this.pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius * 1.04, 0.08, 48),
      new THREE.MeshStandardMaterial({
        color: 0x1a2340,
        roughness: 0.35,
        metalness: 0.55,
        emissive: new THREE.Color(0x101a33),
        emissiveIntensity: 0.6,
      }),
    );
    this.pedestal.position.y = 0.04;
    this.pedestal.receiveShadow = true;
    this.root.add(this.pedestal);

    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius * 0.96, 0.012, 8, 64),
      new THREE.MeshBasicMaterial({ color: 0x5ec8ff, transparent: true, opacity: 0.75 }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.085;
    this.root.add(this.ring);

    this.model.object.position.y += 0.08;
    this.root.add(this.model.object);

    const label = createTextSprite(viz.title, {
      color: '#e8f4ff',
      fontSize: 52,
      background: 'rgba(12, 18, 34, 0.78)',
    });
    this.title = label.sprite;
    const width = Math.min(1.9, Math.max(0.9, viz.title.length * 0.11));
    this.title.scale.set(width, width / label.aspect, 1);
    this.title.position.set(0, this.model.height + 0.6, 0);
    this.root.add(this.title);
  }

  update(dt: number): void {
    this.spin += dt * 0.05;
    this.model.object.rotation.y += dt * 0.22;
    this.ring.rotation.z = this.spin;
    const pulse = 0.6 + Math.sin(performance.now() * 0.0016) * 0.12;
    (this.ring.material as THREE.MeshBasicMaterial).opacity = pulse;
  }

  setPosition(position: THREE.Vector3, facing: number): void {
    this.root.position.copy(position);
    this.root.position.y = 0;
    this.root.rotation.y = facing;
  }

  dispose(): void {
    this.model.dispose();
    this.pedestal.geometry.dispose();
    (this.pedestal.material as THREE.Material).dispose();
    this.ring.geometry.dispose();
    (this.ring.material as THREE.Material).dispose();
    const sprite = this.title.material as THREE.SpriteMaterial;
    sprite.map?.dispose();
    sprite.dispose();
  }
}

export class World {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly conductor = new Conductor();

  private readonly controls: PointerLockControls;
  private readonly keys = new Set<string>();
  private readonly velocity = new THREE.Vector3();
  private readonly instances = new Map<string, VizInstance>();
  private readonly resizeObserver: ResizeObserver;
  private readonly stopListeners: Array<() => void> = [];

  private frame = 0;
  private lastTime = 0;
  private bobPhase = 0;
  private featuredId: string | null = null;
  private interactive = false;
  private disposed = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly callbacks: WorldCallbacks = {},
  ) {
    this.scene.background = new THREE.Color(0x070a14);
    this.scene.fog = new THREE.FogExp2(0x080c17, 0.016);

    this.camera = new THREE.PerspectiveCamera(72, 1, 0.05, 240);
    this.camera.position.set(0, PLAYER_HEIGHT, 6.5);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.classList.add('world-canvas');
    this.container.appendChild(this.renderer.domElement);

    this.controls = new PointerLockControls(this.camera, this.renderer.domElement);
    this.scene.add(this.controls.object);

    this.buildEnvironment();
    this.scene.add(this.conductor.group);
    this.conductor.group.position.set(1.8, 0, 5.4);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();

    this.bindInput();
  }

  /* ---------------------------------------------------------- сцена ------- */

  private buildEnvironment(): void {
    const hemi = new THREE.HemisphereLight(0xb3c8ff, 0x232c48, 1.6);
    this.scene.add(hemi);

    const fill = new THREE.DirectionalLight(0x6f8cff, 0.55);
    fill.position.set(-6, 8, -9);
    this.scene.add(fill);

    const sun = new THREE.DirectionalLight(0xdfe9ff, 1.75);
    sun.position.set(9, 16, 7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.radius = 3;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 60;
    sun.shadow.camera.left = -22;
    sun.shadow.camera.right = 22;
    sun.shadow.camera.top = 22;
    sun.shadow.camera.bottom = -22;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    this.scene.add(sun);

    const accent = new THREE.PointLight(0x6b4bff, 26, 40, 2);
    accent.position.set(-8, 6, -10);
    this.scene.add(accent);

    // небо: большой шар с градиентом
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(150, 32, 20),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          topColor: { value: new THREE.Color(0x0a1030) },
          bottomColor: { value: new THREE.Color(0x1a1338) },
        },
        vertexShader: `
          varying vec3 vPosition;
          void main() {
            vPosition = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 topColor;
          uniform vec3 bottomColor;
          varying vec3 vPosition;
          void main() {
            float h = clamp(normalize(vPosition).y * 0.5 + 0.5, 0.0, 1.0);
            gl_FragColor = vec4(mix(bottomColor, topColor, pow(h, 0.8)), 1.0);
          }
        `,
      }),
    );
    this.scene.add(sky);

    // звёзды
    const starCount = 900;
    const positions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const radius = 60 + Math.random() * 70;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 0.9);
      positions[i * 3] = Math.sin(phi) * Math.cos(theta) * radius;
      positions[i * 3 + 1] = Math.abs(Math.cos(phi)) * radius * 0.75 + 4;
      positions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * radius;
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.scene.add(
      new THREE.Points(
        starGeometry,
        new THREE.PointsMaterial({ color: 0xcfd9ff, size: 0.42, sizeAttenuation: true, transparent: true, opacity: 0.8 }),
      ),
    );

    // пол
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(WORLD_RADIUS + 12, 72),
      new THREE.MeshStandardMaterial({ color: 0x0b1120, roughness: 0.92, metalness: 0.08 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const grid = new THREE.GridHelper(120, 60, 0x2c3f74, 0x161f36);
    grid.position.y = 0.004;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.6;
    this.scene.add(grid);

    // круг в центре площадки + кольцо витрины
    const centerRing = new THREE.Mesh(
      new THREE.RingGeometry(2.4, 2.46, 96),
      new THREE.MeshBasicMaterial({ color: 0x3f6bd8, transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
    );
    centerRing.rotation.x = -Math.PI / 2;
    centerRing.position.y = 0.006;
    this.scene.add(centerRing);
  }

  /* --------------------------------------------------------- ввод --------- */

  private bindInput(): void {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.code === 'Space') event.preventDefault();
      this.keys.add(event.code);
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      this.keys.delete(event.code);
    };
    const onBlur = (): void => this.keys.clear();

    const onLock = (): void => this.callbacks.onLockChange?.(true);
    const onUnlock = (): void => {
      this.keys.clear();
      this.callbacks.onLockChange?.(false);
    };
    const onCanvasClick = (): void => {
      if (this.interactive && !this.controls.isLocked) this.lock();
    };
    const onLockError = (): void => this.callbacks.onLockError?.();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    this.renderer.domElement.addEventListener('click', onCanvasClick);
    this.controls.addEventListener('lock', onLock);
    this.controls.addEventListener('unlock', onUnlock);
    document.addEventListener('pointerlockerror', onLockError);

    this.stopListeners.push(() => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      this.renderer.domElement.removeEventListener('click', onCanvasClick);
      this.controls.removeEventListener('lock', onLock);
      this.controls.removeEventListener('unlock', onUnlock);
      document.removeEventListener('pointerlockerror', onLockError);
    });
  }

  private resize(): void {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  /* ------------------------------------------------------- управление ----- */

  start(): void {
    if (this.frame !== 0) return;
    this.lastTime = performance.now();
    this.animate();
  }

  stop(): void {
    if (this.frame !== 0) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  /** Разрешает захват мыши (включается, когда пользователь вошёл в мир). */
  setInteractive(value: boolean): void {
    this.interactive = value;
    if (!value) this.unlock();
  }

  lock(): void {
    try {
      this.controls.lock();
    } catch (error) {
      console.warn('[visual-lab] не удалось захватить мышь', error);
    }
  }

  unlock(): void {
    if (this.controls.isLocked) this.controls.unlock();
  }

  get isLocked(): boolean {
    return this.controls.isLocked;
  }

  getPlayerPosition(): THREE.Vector3 {
    return this.camera.position.clone();
  }

  getForward(): THREE.Vector3 {
    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);
    direction.y = 0;
    return direction.normalize();
  }

  private getFrontPosition(distance: number): THREE.Vector3 {
    const position = this.camera.position.clone().addScaledVector(this.getForward(), distance);
    position.y = 0;
    const length = Math.hypot(position.x, position.z);
    if (length > WORLD_RADIUS) position.multiplyScalar(WORLD_RADIUS / length);
    return position;
  }

  /* ---------------------------------------------------- визуализации ------ */

  /** Подпись над проводником: какой движок отвечает сейчас. */
  setConductorName(label: string): void {
    this.conductor.setName(label);
  }

  setConductorStatus(status: 'idle' | 'thinking' | 'drawing' | 'speaking'): void {
    this.conductor.setStatus(status, status === 'idle' ? 0 : 6000);
  }

  /** Показывает новую модель прямо перед игроком. */
  showVisualization(viz: Visualization): void {
    this.featuredId = viz.id;
    let instance = this.instances.get(viz.id);
    if (!instance) {
      instance = new VizInstance(viz);
      this.scene.add(instance.root);
      this.instances.set(viz.id, instance);
    }
    const position = this.getFrontPosition(5.2);
    const facing = Math.atan2(
      this.camera.position.x - position.x,
      this.camera.position.z - position.z,
    );
    instance.setPosition(position, facing);
  }

  /**
   * Раскладывает сохранённые визуализации по кольцу-витрине вокруг центра.
   * Модель, которую показали последней, остаётся перед игроком.
   */
  syncGallery(vizs: Visualization[]): void {
    const list = vizs.slice(0, MAX_GALLERY);
    const ids = new Set(list.map((item) => item.id));

    for (const [id, instance] of this.instances) {
      if (ids.has(id)) continue;
      this.scene.remove(instance.root);
      instance.dispose();
      this.instances.delete(id);
    }

    const ring = list.filter((item) => item.id !== this.featuredId);
    ring.forEach((viz, index) => {
      let instance = this.instances.get(viz.id);
      if (!instance) {
        instance = new VizInstance(viz);
        this.scene.add(instance.root);
        this.instances.set(viz.id, instance);
      }
      const angle = Math.PI + (index / Math.max(ring.length, 1)) * Math.PI * 2;
      const position = new THREE.Vector3(
        Math.sin(angle) * GALLERY_RADIUS,
        0,
        Math.cos(angle) * GALLERY_RADIUS,
      );
      instance.setPosition(position, angle + Math.PI);
    });

    // если «избранная» модель больше не в списке — забываем её
    if (this.featuredId && !ids.has(this.featuredId)) {
      const stale = this.instances.get(this.featuredId);
      if (stale) {
        this.scene.remove(stale.root);
        stale.dispose();
        this.instances.delete(this.featuredId);
      }
      this.featuredId = null;
    }
  }

  removeVisualization(id: string): void {
    const instance = this.instances.get(id);
    if (!instance) return;
    this.scene.remove(instance.root);
    instance.dispose();
    this.instances.delete(id);
    if (this.featuredId === id) this.featuredId = null;
  }

  clearVisualizations(): void {
    for (const instance of this.instances.values()) {
      this.scene.remove(instance.root);
      instance.dispose();
    }
    this.instances.clear();
    this.featuredId = null;
  }

  get visualizationCount(): number {
    return this.instances.size;
  }

  /* ------------------------------------------------------------ цикл ------ */

  private updatePlayer(dt: number): void {
    const direction = new THREE.Vector3();
    if (this.controls.isLocked) {
      const forward = this.getForward();
      const right = new THREE.Vector3(forward.z, 0, -forward.x);

      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) direction.add(forward);
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) direction.sub(forward);
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) direction.add(right);
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) direction.sub(right);
    }

    const running = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const targetSpeed = running ? RUN_SPEED : WALK_SPEED;
    const desired = direction.lengthSq() > 0
      ? direction.normalize().multiplyScalar(targetSpeed)
      : new THREE.Vector3();

    const alpha = 1 - Math.exp(-ACCELERATION * dt);
    this.velocity.lerp(desired, alpha);

    const position = this.camera.position;
    position.x += this.velocity.x * dt;
    position.z += this.velocity.z * dt;

    const distance = Math.hypot(position.x, position.z);
    if (distance > WORLD_RADIUS) {
      position.x *= WORLD_RADIUS / distance;
      position.z *= WORLD_RADIUS / distance;
    }

    // лёгкое покачивание головы при ходьбе
    const speed = this.velocity.length();
    this.bobPhase += dt * speed * 2.4;
    position.y = PLAYER_HEIGHT + Math.sin(this.bobPhase) * 0.022 * Math.min(speed / 4, 1);
  }

  private animate = (): void => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.animate);
    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;

    this.updatePlayer(dt);
    this.conductor.update(dt, this.camera.position, this.camera.rotation.y);
    for (const instance of this.instances.values()) instance.update(dt);
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    this.disposed = true;
    this.stop();
    for (const stop of this.stopListeners) stop();
    this.stopListeners.length = 0;
    this.resizeObserver.disconnect();
    this.clearVisualizations();
    this.conductor.dispose();
    this.controls.disconnect?.();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

