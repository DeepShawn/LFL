import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { createWebGLContext, getQualityProfile, pixelRatio, type Quality } from './qualityProfiles';
import { PerformanceMonitor } from './performanceMonitor';
import { moveWithinRoom, type CollisionRoom } from '../world/collision';
import { animateCharacter, createCharacter } from './characters';

export type Room = 'classroom' | 'corridor' | 'office';
export interface WorldState {
  view: 'map' | 'first-person'; room: Room; position: { x: number; z: number };
  phase: string; elapsed: number; switchRemaining: number;
  chase: { remaining: number; distance: number; goalRoom: Room } | null;
}
export interface InteractionPrompt {
  id: string;
  label: string;
  hint: string;
  actionIds: string[];
  distance: number;
  kind: 'hotspot' | 'portal';
  targetRoom?: Room;
}
interface HotspotDefinition {
  id: string;
  room: Room;
  x: number;
  z: number;
  label: string;
  hint: string;
  actionIds: string[];
}
const SPAWN: Record<Room, [number, number]> = { classroom: [0, 2.9], corridor: [-8.8, 0], office: [0, -3.2] };
const PORTALS: Record<Room, { target: Room; x: number; z: number; label: string }[]> = {
  classroom: [{ target: 'corridor', x: -4.45, z: -1, label: '走廊' }],
  corridor: [{ target: 'classroom', x: -9.5, z: -.9, label: '教室' }, { target: 'office', x: 9.5, z: -.9, label: '办公室' }],
  office: [{ target: 'corridor', x: 0, z: 3.1, label: '走廊' }],
};
const HOTSPOTS: HotspotDefinition[] = [
  { id: 'classroom-board', room: 'classroom', x: 0, z: -3.18, label: '黑板与讲台', hint: '查看板书、作业批注和课堂记录', actionIds: ['inspect:q2', 'inspect:q5', 'evidence:blackboard', 'evidence:classroom', 'evidence:work', 'evidence:experiment'] },
  { id: 'classroom-desks', room: 'classroom', x: 0, z: .55, label: '课桌与作业本', hint: '整理桌面上的草稿与实验记录', actionIds: ['evidence:work', 'evidence:experiment', 'inspect:q2', 'inspect:q5'] },
  { id: 'corridor-student', room: 'corridor', x: 0, z: 0, label: '走廊同学', hint: '询问同学，核对语气和独立作答过程', actionIds: ['evidence:witness', 'listen'] },
  { id: 'office-records', room: 'office', x: 0, z: -3.05, label: '办公室资料桌', hint: '查看审批记录、订单与付款便条', actionIds: ['evidence:office', 'evidence:order'] },
];

export class WorldRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly monitor = new PerformanceMonitor();
  readonly scene = new THREE.Scene();
  readonly perspective = new THREE.PerspectiveCamera(64, 1, .08, 70);
  readonly map = new THREE.OrthographicCamera(-8, 8, 7, -7, .1, 80);
  readonly loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  readonly input = { x: 0, z: 0 };
  private profile;
  private quality: Quality;
  private keys = new Set<string>();
  private abort = new AbortController();
  private room: Room | null = null;
  private requestedRoom: Room | null = null;
  private model: THREE.Group | null = null;
  private cutaway: THREE.Object3D[] = [];
  private collision: Record<Room, CollisionRoom> | null = null;
  private portals = new THREE.Group();
  private interactables = new THREE.Group();
  private teacher = createCharacter({ kind: 'teacher', variant: 0, name: 'teacher-classroom' });
  private officeTeacher = createCharacter({ kind: 'teacher', variant: 2, name: 'teacher-office' });
  private students = new THREE.Group();
  private studentCharacters: THREE.Object3D[] = [];
  private player = new THREE.Mesh(new THREE.ConeGeometry(.13, .45, 8), new THREE.MeshBasicMaterial({ color: 0xf4bb79 }));
  private rain: THREE.Points;
  private rainPositions: Float32Array;
  private moon = new THREE.DirectionalLight(0xa8c5d9, 2.4);
  private cursor = new THREE.Vector2();
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private target = new THREE.Vector3();
  private destination: THREE.Vector3 | null = null;
  private yaw = 0;
  private pitch = 0;
  private last = 0;
  private raf = 0;
  private running = false;
  private loadGeneration = 0;
  private loaded = false;
  private lost = false;
  private disposed = false;
  private loadMs = 0;
  private meshes = 0;
  private view = '';
  private drag: { id: number; x: number; y: number } | null = null;
  private portalRequested = false;
  private activePromptKey = '';
  private activePrompt: InteractionPrompt | null = null;
  private slowSeconds = 0;
  private chasing = false;
  private state: WorldState | null = null;
  private resizeObserver: ResizeObserver;
  onTick: (dt: number) => void = () => {};
  onRoom: (room: Room) => void = () => {};
  onInteract: (prompt?: InteractionPrompt | null) => void = () => {};
  onInteractionPrompt: (prompt: InteractionPrompt | null) => void = () => {};
  onCaught: () => void = () => {};
  onStatus: (message: string) => void = () => {};
  onView: () => void = () => {};

  constructor(readonly canvas: HTMLCanvasElement, quality: Quality = 'auto') {
    this.quality = quality;
    this.profile = getQualityProfile(quality, matchMedia('(pointer: coarse)').matches);
    const context = createWebGLContext(canvas, this.profile.shadows);
    if (!context) throw new Error('此浏览器未提供 WebGL 2；请开启硬件加速，或换用支持 WebGL 2 的浏览器。');
    this.renderer = new THREE.WebGLRenderer({ canvas, context, antialias: this.profile.shadows });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.enabled = this.profile.shadows;
    this.renderer.shadowMap.autoUpdate = false;
    this.scene.background = new THREE.Color(0x151d26);
    this.scene.fog = new THREE.FogExp2(0x17222c, .026);
    this.scene.add(new THREE.HemisphereLight(0xc2d3df, 0x54473e, 2.6));
    this.moon.position.set(3, 6, 1);
    this.moon.castShadow = this.profile.shadows;
    this.moon.shadow.mapSize.setScalar(this.profile.shadowSize);
    Object.assign(this.moon.shadow.camera, { left: -6, right: 6, top: 5, bottom: -5, near: .1, far: 20 });
    this.moon.shadow.bias = -.001;
    this.scene.add(this.moon);
    const lamp = new THREE.PointLight(0xffd0a0, 14, 9, 2);
    lamp.position.set(-1, 2.7, -1);
    this.scene.add(lamp, this.player, this.portals, this.interactables, this.teacher, this.officeTeacher, this.students);
    this.player.position.y = .6;
    this.buildStudents();
    this.rainPositions = new Float32Array(this.profile.rainCount * 3);
    for (let i = 0; i < this.rainPositions.length; i += 3) {
      this.rainPositions[i] = Math.random() * 20 - 10;
      this.rainPositions[i + 1] = Math.random() * 5;
      this.rainPositions[i + 2] = Math.random() * 10 - 5;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.rainPositions, 3));
    this.rain = new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0x9eabb7, size: .025, transparent: true, opacity: .65, depthWrite: false }));
    this.rain.visible = false;
    this.scene.add(this.rain);
    this.bindInput();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement!);
    this.resize();
  }

  private buildStudents() {
    const variants = [1, 2, 3, 4, 0, 2, 1, 3];
    for (const [index, variant] of variants.entries()) {
      const student = createCharacter({ kind: 'student', variant, name: `student-${index + 1}` });
      this.studentCharacters.push(student);
      this.students.add(student);
    }
    this.teacher.userData.baseY = 0;
    this.officeTeacher.userData.baseY = 0;
  }

  async load(room: Room): Promise<void> {
    this.requestedRoom = room;
    this.portalRequested = false;
    if (room === this.room && this.loaded) return;
    const generation = ++this.loadGeneration;
    this.loaded = false;
    this.onStatus('正在载入场景…');
    const start = performance.now();
    try {
      if (!this.collision) {
        const response = await fetch(`${import.meta.env.BASE_URL}assets/models/collision.json`);
        if (!response.ok) throw new Error('碰撞资源无法加载');
        this.collision = await response.json();
      }
      const baseline = import.meta.env.DEV && new URLSearchParams(location.search).has('assetBaseline');
      const url = `${import.meta.env.BASE_URL}assets/models/${baseline ? 'source' : this.profile.assetTier}/${room}.glb`;
      const gltf = await this.loader.loadAsync(url);
      if (this.disposed || generation !== this.loadGeneration) { this.disposeObjects(gltf.scene); return; }
      if (this.model) { this.scene.remove(this.model); this.disposeObjects(this.model); }
      this.model = gltf.scene;
      this.room = room;
      this.cutaway = [];
      this.meshes = 0;
      this.model.traverse(object => {
        if (/ceiling|cutaway|roof|upper|backwall|leftwall|curtain/i.test(object.name)) this.cutaway.push(object);
        if (object instanceof THREE.Mesh) {
          this.meshes++;
          object.receiveShadow = this.profile.shadows;
          object.castShadow = this.profile.shadows && !/glass|floor|ceiling|cutaway/i.test(object.name);
          object.matrixAutoUpdate = false;
          object.updateMatrix();
        }
      });
      this.scene.add(this.model);
      this.disposeObjects(this.portals);
      this.portals.clear();
      for (const portal of PORTALS[room]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(.32, .04, 6, 18), new THREE.MeshBasicMaterial({ color: 0xd3a968 }));
        ring.position.set(portal.x, 1.1, portal.z);
        ring.userData.targetRoom = portal.target;
        this.portals.add(ring);
      }
      this.disposeObjects(this.interactables);
      this.interactables.clear();
      this.createHotspots(room);
      this.positionCharacters(room);
      this.chasing = false;
      this.portalRequested = false;
      this.activePrompt = null;
      this.activePromptKey = '';
      this.onInteractionPrompt(null);
      this.destination = null;
      this.yaw = room === 'corridor' ? -Math.PI / 2 : room === 'office' ? Math.PI : 0;
      this.pitch = 0;
      this.loaded = true;
      this.resize();
      this.loadMs = performance.now() - start;
      this.view = '';
      this.renderer.shadowMap.needsUpdate = true;
      this.monitor.reset();
      this.onStatus('');
    } catch (error) {
      this.onStatus(`场景加载失败：${error instanceof Error ? error.message : String(error)}。可在设置里重试。`);
    }
  }

  private createHotspots(room: Room) {
    const defs = HOTSPOTS.filter((hotspot) => hotspot.room === room);
    for (const hotspot of defs) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(.27, .035, 6, 18), new THREE.MeshBasicMaterial({ color: 0xb9d8c2, transparent: true, opacity: .92 }));
      ring.position.set(hotspot.x, .06, hotspot.z);
      ring.rotation.x = -Math.PI / 2;
      ring.userData.hotspotId = hotspot.id;
      const beacon = new THREE.Mesh(new THREE.CylinderGeometry(.012, .045, .65, 6, 1, true), new THREE.MeshBasicMaterial({ color: 0xb9d8c2, transparent: true, opacity: .2, depthWrite: false }));
      beacon.position.set(hotspot.x, .38, hotspot.z);
      beacon.userData.hotspotId = hotspot.id;
      this.interactables.add(ring, beacon);
    }
  }

  private positionCharacters(room: Room) {
    const classroom = [[-3.45, 1.8], [-2.15, 1.8], [1.55, 1.8], [2.85, 1.8], [-2.8, .35], [2.25, .35]];
    const corridor = [[-3.25, .08], [2.65, -.08]];
    const office = [[-2.75, -3.05]];
    const positions = room === 'classroom' ? classroom : room === 'corridor' ? corridor : office;
    this.studentCharacters.forEach((student, index) => {
      const position = positions[index];
      student.visible = Boolean(position);
      if (position) {
        student.position.set(position[0], 0, position[1]);
        student.rotation.y = room === 'classroom' ? Math.PI : index % 2 ? Math.PI / 2 : -Math.PI / 2;
        student.userData.baseY = 0;
      }
    });
    this.teacher.visible = room === 'classroom' || this.chasing;
    this.teacher.position.set(-1.15, 0, -2.65);
    this.teacher.rotation.y = 0;
    this.officeTeacher.visible = room === 'office';
    this.officeTeacher.position.set(1.55, 0, -3.05);
    this.officeTeacher.rotation.y = 0;
  }

  private interactionAt(state: WorldState): InteractionPrompt | null {
    const portal = PORTALS[state.room].find((candidate) => Math.hypot(candidate.x - state.position.x, candidate.z - state.position.z) < 1.25);
    if (portal) return {
      id: `portal:${portal.target}`,
      label: `进入${portal.label}`,
      hint: '抵达门口后按 E 进入相邻房间',
      actionIds: [],
      distance: Math.hypot(portal.x - state.position.x, portal.z - state.position.z),
      kind: 'portal',
      targetRoom: portal.target,
    };
    const hotspot = HOTSPOTS.filter((item) => item.room === state.room)
      .map((item) => ({ item, distance: Math.hypot(item.x - state.position.x, item.z - state.position.z) }))
      .filter(({ distance }) => distance < 1.55)
      .sort((a, b) => a.distance - b.distance)[0];
    if (!hotspot) return null;
    return { id: hotspot.item.id, label: hotspot.item.label, hint: hotspot.item.hint, actionIds: hotspot.item.actionIds, distance: hotspot.distance, kind: 'hotspot' };
  }

  private updateInteractionPrompt(state: WorldState) {
    if (!['playing', 'chase'].includes(state.phase) || state.switchRemaining > 0) return;
    const prompt = this.interactionAt(state);
    const key = prompt ? `${prompt.kind}:${prompt.id}` : '';
    if (key === this.activePromptKey) return;
    this.activePromptKey = key;
    this.activePrompt = prompt;
    this.onInteractionPrompt(prompt);
  }

  private animateCharacters(elapsed: number, state: WorldState) {
    animateCharacter(this.teacher, elapsed, 0, state.phase === 'chase');
    animateCharacter(this.officeTeacher, elapsed, 1.2, false);
    this.studentCharacters.forEach((student, index) => animateCharacter(student, elapsed, index * .7, false));
  }

  spawn(room: Room): { x: number; z: number } { return { x: SPAWN[room][0], z: SPAWN[room][1] }; }
  async setQuality(quality: Quality, automatic = false) {
    const before = this.profile.assetTier;
    if (!automatic) this.quality = quality;
    this.profile = getQualityProfile(quality, matchMedia('(pointer: coarse)').matches);
    this.renderer.shadowMap.enabled = this.profile.shadows;
    this.moon.castShadow = this.profile.shadows;
    this.resize();
    if (this.requestedRoom && before !== this.profile.assetTier) { const room = this.requestedRoom; this.loaded = false; await this.load(room); }
    this.renderer.shadowMap.needsUpdate = true;
  }
  start(state: WorldState): void {
    this.state = state;
    if (this.running || this.disposed) return;
    this.running = true;
    this.last = performance.now();
    if (!document.hidden) this.raf = requestAnimationFrame(this.frame);
  }
  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.keys.clear();
    this.input.x = this.input.z = 0;
  }
  private frame = (now: number) => {
    if (!this.running || this.disposed || !this.state) return;
    const ms = now - this.last;
    this.last = now;
    const dt = Math.min(ms / 1000, .05);
    const state = this.state;
    if (!document.hidden && !this.lost && this.loaded) {
      this.move(dt, state);
      this.onTick(dt);
      this.updateInteractionPrompt(state);
      this.animateCharacters(now / 1000, state);
      this.updateView(state);
      this.player.position.set(state.position.x, .7, state.position.z);
      this.teacher.visible = state.room === 'classroom' || state.phase === 'chase';
      this.officeTeacher.visible = state.room === 'office' && state.phase !== 'ending';
      if (state.phase === 'chase' && !this.chasing) {
        this.teacher.position.set(state.position.x + (state.room === 'corridor' ? -3 : 3), 0, state.position.z);
      }
      this.chasing = state.phase === 'chase';
      if (state.phase === 'chase' && state.chase) {
        const dx = state.position.x - this.teacher.position.x;
        const dz = state.position.z - this.teacher.position.z;
        const distance = Math.hypot(dx, dz);
        state.chase.distance = distance;
        if (distance > .001) { this.teacher.position.x += dx / distance * dt * 1.05; this.teacher.position.z += dz / distance * dt * 1.05; }
        this.teacher.rotation.y = Math.atan2(dx, dz);
        if (distance < .38) this.onCaught();
      } else {
        this.teacher.position.set(Math.sin(state.elapsed * .33) * 2.3, 0, -2.7);
        this.teacher.rotation.y = Math.sin(state.elapsed * .3) * 1.4;
      }
      this.rain.visible = state.phase === 'chase';
      if (this.rain.visible) {
        for (let i = 1; i < this.rainPositions.length; i += 3) { this.rainPositions[i] -= dt * 3.7; if (this.rainPositions[i] < 0) this.rainPositions[i] = 5; }
        this.rain.geometry.attributes.position.needsUpdate = true;
      }
      this.renderer.render(this.scene, state.view === 'map' ? this.map : this.perspective);
      this.monitor.record(ms, this.renderer.info.render);
      if (state.phase === 'ending') this.stop();
      if (this.quality === 'auto') {
        this.slowSeconds = ms > 36 ? this.slowSeconds + Math.min(ms / 1000, .25) : Math.max(0, this.slowSeconds - dt);
        if (this.slowSeconds > 4 && this.profile.maxPixelRatio > .85) {
          this.slowSeconds = 0;
          void this.setQuality(this.profile.assetTier === 'desktop' ? 'medium' : 'low', true);
        }
      }
    }
    if (this.running) this.raf = requestAnimationFrame(this.frame);
  };

  private move(dt: number, state: WorldState) {
    if (state.switchRemaining > 0 || !['playing', 'chase'].includes(state.phase) || !this.collision) return;
    let strafe = this.input.x + Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) - Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft'));
    let forward = -this.input.z + Number(this.keys.has('KeyW') || this.keys.has('ArrowUp')) - Number(this.keys.has('KeyS') || this.keys.has('ArrowDown'));
    let dx = 0, dz = 0;
    if (state.view === 'map' && this.destination && !strafe && !forward) {
      dx = this.destination.x - state.position.x; dz = this.destination.z - state.position.z;
      const len = Math.hypot(dx, dz);
      if (len < .12) { this.destination = null; return; }
      dx /= len; dz /= len;
    } else {
      const len = Math.hypot(strafe, forward);
      if (len > 1) { strafe /= len; forward /= len; }
      const yaw = state.view === 'map' ? 0 : this.yaw;
      dx = Math.cos(yaw) * strafe - Math.sin(yaw) * forward;
      dz = -Math.sin(yaw) * strafe - Math.cos(yaw) * forward;
    }
    const moved = moveWithinRoom(state.position, dx * dt * 2.35, dz * dt * 2.35, this.collision[state.room]);
    state.position.x = moved.x; state.position.z = moved.z;
    this.perspective.position.set(moved.x, 1.6, moved.z);
    this.perspective.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
  private updateView(state: WorldState) {
    this.player.visible = state.view === 'map';
    if (this.view !== state.view) {
      this.view = state.view;
      for (const object of this.cutaway) object.visible = state.view !== 'map';
      this.renderer.shadowMap.needsUpdate = true;
    }
    this.map.position.set(7, 13, 9);
    this.map.lookAt(0, 0, 0);
    this.perspective.position.set(state.position.x, 1.6, state.position.z);
    this.perspective.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
  interact() {
    if (!this.running || !this.state || !this.loaded || !['playing', 'chase'].includes(this.state.phase)) return;
    const prompt = this.interactionAt(this.state);
    if (prompt?.kind === 'portal' && prompt.targetRoom && !this.portalRequested) {
      this.portalRequested = true;
      this.onRoom(prompt.targetRoom);
    } else this.onInteract(prompt);
  }
  private bindInput() {
    const signal = this.abort.signal;
    window.addEventListener('keydown', e => {
      if (!this.running || (e.target as HTMLElement).closest('input,select,textarea,dialog')) return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
      if (e.repeat) return;
      if (e.code === 'KeyE') this.interact();
      if (e.code === 'KeyV') this.onView();
    }, { signal });
    window.addEventListener('keyup', e => this.keys.delete(e.code), { signal });
    window.addEventListener('blur', () => { this.keys.clear(); this.input.x = this.input.z = 0; }, { signal });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { cancelAnimationFrame(this.raf); this.keys.clear(); }
      else if (this.running) { cancelAnimationFrame(this.raf); this.last = performance.now(); this.raf = requestAnimationFrame(this.frame); }
    }, { signal });
    this.canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); this.lost = true; this.onStatus('图形上下文已丢失，等待恢复…'); }, { signal });
    this.canvas.addEventListener('webglcontextrestored', () => { this.lost = false; this.last = performance.now(); this.renderer.shadowMap.needsUpdate = true; this.onStatus(''); }, { signal });
    this.canvas.addEventListener('pointerdown', e => {
      this.canvas.setPointerCapture(e.pointerId);
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      if (this.state?.view === 'map') {
        const box = this.canvas.getBoundingClientRect();
        this.cursor.set((e.clientX - box.left) / box.width * 2 - 1, -((e.clientY - box.top) / box.height) * 2 + 1);
        this.ray.setFromCamera(this.cursor, this.map);
        const portal = this.ray.intersectObjects(this.portals.children)[0];
        if (portal?.object.userData.targetRoom) {
          this.destination = portal.object.position.clone();
          this.onStatus('走近门口后按 E 或「交互」进入。');
        } else {
          const hotspot = this.ray.intersectObjects(this.interactables.children)[0];
          if (hotspot?.object.userData.hotspotId) {
            this.destination = hotspot.object.position.clone();
            this.onStatus('正在前往场景目标，靠近后按 E 调查。');
          } else if (this.ray.ray.intersectPlane(this.plane, this.target)) this.destination = this.target.clone();
        }
      }
    }, { signal });
    this.canvas.addEventListener('pointermove', e => {
      if (this.drag?.id !== e.pointerId || this.state?.view !== 'first-person') return;
      this.yaw -= (e.clientX - this.drag.x) * .004;
      this.pitch = Math.max(-1.15, Math.min(1.15, this.pitch - (e.clientY - this.drag.y) * .004));
      this.drag.x = e.clientX; this.drag.y = e.clientY;
    }, { signal });
    for (const event of ['pointerup', 'pointercancel']) this.canvas.addEventListener(event, () => { this.drag = null; }, { signal });
  }
  resize() {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(pixelRatio(this.profile, width, height, devicePixelRatio));
    this.renderer.setSize(width, height, false);
    this.perspective.aspect = width / height; this.perspective.updateProjectionMatrix();
    const halfHeight = this.room === 'corridor' ? 12 : 7.2;
    const aspect = width / height;
    this.map.left = -halfHeight * Math.max(1, aspect); this.map.right = -this.map.left;
    this.map.top = halfHeight / Math.min(1, aspect); this.map.bottom = -this.map.top;
    this.map.updateProjectionMatrix();
  }
  metrics() {
    return { ...this.monitor.snapshot(), webgl: 'WebGL2', loaded: this.loaded, room: this.room, meshes: this.meshes, loadMs: +this.loadMs.toFixed(1), quality: this.quality, assetTier: this.profile.assetTier, textures: this.renderer.info.memory.textures, geometries: this.renderer.info.memory.geometries, pixelRatio: this.renderer.getPixelRatio(), lost: this.lost, loopActive: this.running && !document.hidden };
  }
  private disposeObjects(root: THREE.Object3D) {
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
    root.traverse(object => { if (object instanceof THREE.Mesh) { geometries.add(object.geometry); for (const mat of Array.isArray(object.material) ? object.material : [object.material]) materials.add(mat); } });
    for (const mat of materials) { for (const value of Object.values(mat)) if (value instanceof THREE.Texture) textures.add(value); mat.dispose(); }
    for (const geo of geometries) geo.dispose();
    for (const tex of textures) tex.dispose();
  }
  dispose() {
    this.stop(); this.disposed = true; this.loadGeneration++;
    this.abort.abort(); this.resizeObserver.disconnect();
    this.disposeObjects(this.scene);
    this.rain.geometry.dispose(); (this.rain.material as THREE.Material).dispose();
    this.renderer.dispose();
  }
}
