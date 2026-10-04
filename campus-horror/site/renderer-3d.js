import * as THREE from './vendor/three/three.module.js';
import { BUILDINGS, getScene, nearbyObject, visibleFrom } from './world.js';

const COLORS = {
  night: '#263749', tile: '#345c53', paper: '#c6a76b', wall: '#bdc6be',
  ink: '#182b30', wood: '#655543', metal: '#536469', fog: '#15232f',
};

export class Renderer3D {
  constructor(canvas) {
    this.canvas = canvas;
    const context = canvas.getContext('webgl2', { alpha: false, antialias: false, powerPreference: 'low-power' });
    if (!context) throw new Error('第一人称 3D 需要 WebGL2，请检查浏览器的硬件加速支持。');
    this.renderer = new THREE.WebGLRenderer({ canvas, context, antialias: false, alpha: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.setClearColor(COLORS.fog);
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.06, 70);
    this.camera.rotation.order = 'YXZ';
    this.scene = null;
    this.sceneId = null;
    this.quality = 'standard';
    this.width = 0;
    this.height = 0;
    this.pixelRatio = 0;
    this.disposed = false;
    this.direction = new THREE.Vector3();
    this.resources = new Set();
    this.resize();
  }

  resize() {
    if (this.disposed) return;
    const width = Math.max(1, this.canvas.clientWidth || this.width || this.canvas.width || 1);
    const height = Math.max(1, this.canvas.clientHeight || this.height || this.canvas.height || 1);
    const ratio = Math.min(globalThis.devicePixelRatio || 1, this.quality === 'low' ? 1 : 1.5);
    if (width === this.width && height === this.height && ratio === this.pixelRatio) return;
    this.width = width;
    this.height = height;
    this.pixelRatio = ratio;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  keep(resource) {
    this.resources.add(resource);
    return resource;
  }

  material(color, extra = {}) {
    return this.keep(new THREE.MeshLambertMaterial({ color, ...extra }));
  }

  mesh(geometry, material, x, y, z, parent = this.scene) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }

  box(x, y, z, w, h, d, material, parent = null) {
    if (parent) {
      const mesh = this.mesh(this.cube, material, x, y, z, parent);
      mesh.scale.set(w, h, d);
      return mesh;
    }
    if (!this.boxes.has(material)) this.boxes.set(material, []);
    this.boxes.get(material).push([x, y, z, w, h, d]);
    return null;
  }

  flushBoxes() {
    const transform = new THREE.Object3D();
    for (const [material, boxes] of this.boxes) {
      const batch = new THREE.InstancedMesh(this.cube, material, boxes.length);
      boxes.forEach(([x, y, z, w, h, d], index) => {
        transform.position.set(x, y, z);
        transform.scale.set(w, h, d);
        transform.updateMatrix();
        batch.setMatrixAt(index, transform.matrix);
      });
      batch.instanceMatrix.needsUpdate = true;
      batch.computeBoundingSphere();
      this.scene.add(batch);
    }
    this.boxes.clear();
  }

  tileTexture(base, grout) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(3, 3, 58, 58);
    ctx.fillRect(67, 67, 58, 58);
    ctx.strokeStyle = grout;
    ctx.lineWidth = 2;
    for (const n of [0, 64, 128]) {
      ctx.beginPath();
      ctx.moveTo(n, 0); ctx.lineTo(n, 128);
      ctx.moveTo(0, n); ctx.lineTo(128, n);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(17,30,34,0.14)';
    for (let i = 0; i < 48; i++) ctx.fillRect((i * 47) % 128, (i * 71) % 128, 2, 1);
    const texture = this.keep(new THREE.CanvasTexture(canvas));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    return texture;
  }

  sign(text, subtitle, x, y, z, width, yaw = 0, background = COLORS.tile) {
    const key = `${text}|${subtitle}|${background}`;
    let material = this.signMaterials.get(key);
    if (!material) {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 192;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, 512, 192);
      ctx.strokeStyle = COLORS.paper;
      ctx.lineWidth = 3;
      ctx.strokeRect(10, 10, 492, 172);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      let size = 64;
      ctx.font = `600 ${size}px "Noto Serif SC", "Songti SC", serif`;
      while (ctx.measureText(text).width > 464 && size > 22) {
        size -= 2;
        ctx.font = `600 ${size}px "Noto Serif SC", "Songti SC", serif`;
      }
      ctx.fillStyle = '#eee2c6';
      ctx.fillText(text, 256, subtitle ? 78 : 96);
      if (subtitle) {
        ctx.font = '26px "Noto Sans SC", sans-serif';
        ctx.fillStyle = '#c4c7b7';
        ctx.fillText(subtitle, 256, 140, 456);
      }
      const texture = this.keep(new THREE.CanvasTexture(canvas));
      texture.colorSpace = THREE.SRGBColorSpace;
      material = this.material('#ffffff', { map: texture, emissive: '#ffffff', emissiveMap: texture, emissiveIntensity: 0.25, side: THREE.DoubleSide });
      this.signMaterials.set(key, material);
    }
    const board = this.mesh(this.plane, material, x, y, z);
    board.scale.set(width, width * 192 / 512, 1);
    board.rotation.y = yaw;
    return board;
  }

  buildScene(id) {
    this.clearScene();
    this.sceneId = id;
    this.world = getScene(id);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(COLORS.fog);
    this.scene.fog = new THREE.Fog(COLORS.fog, 5, 16);
    this.boxes = new Map();
    this.signMaterials = new Map();
    this.items = new Map();
    this.cube = this.keep(new THREE.BoxGeometry(1, 1, 1));
    this.plane = this.keep(new THREE.PlaneGeometry(1, 1));
    this.cylinder = this.keep(new THREE.CylinderGeometry(1, 1, 1, 8));
    this.sphere = this.keep(new THREE.IcosahedronGeometry(1, 0));
    this.cone = this.keep(new THREE.ConeGeometry(1, 1, 7));
    this.m = {
      wall: this.material(COLORS.wall), tile: this.material(COLORS.tile),
      metal: this.material(COLORS.metal), dark: this.material(COLORS.ink),
      wood: this.material(COLORS.wood), paper: this.material('#d5c8a5'),
      glass: this.material('#678183', { emissive: '#345458', emissiveIntensity: 0.3 }),
      warm: this.material(COLORS.paper, { emissive: COLORS.paper, emissiveIntensity: 0.65 }),
      leaf: this.material('#304b45'), coat: this.material('#3c4d50'),
    };
    const outdoor = id === 'campus';
    const floorMap = this.tileTexture(outdoor ? '#637077' : '#78857c', outdoor ? '#3a4a52' : '#455e56');
    floorMap.repeat.set(this.world.width / 3, this.world.height / 3);
    const floor = this.mesh(this.plane, this.material('#ffffff', { map: floorMap }), this.world.width / 2, -0.015, this.world.height / 2);
    floor.rotation.x = -Math.PI / 2;
    floor.scale.set(this.world.width, this.world.height, 1);
    this.ambient = new THREE.HemisphereLight('#a7c4d5', '#52634f', 1.15);
    this.scene.add(this.ambient);
    const moon = new THREE.DirectionalLight('#8fa8be', 0.7);
    moon.position.set(-12, 30, 12);
    this.scene.add(moon);
    this.fill = new THREE.PointLight('#b8c9c2', 0.65, 7, 0);
    this.flashlight = new THREE.SpotLight('#e6dfbf', 22, 16, 0.51, 0.7, 1);
    this.scene.add(this.fill, this.flashlight, this.flashlight.target);
    this.safeLight = new THREE.PointLight(COLORS.paper, 0, 8, 1);
    this.scene.add(this.safeLight);
    if (outdoor) this.buildCampus();
    else this.buildInterior();
    for (const object of this.world.objects) this.buildObject(object);
    this.buildEnemy();
    this.flushBoxes();
    if (outdoor) this.buildRain();
  }

  buildCampus() {
    for (const obstacle of this.world.obstacles) {
      const { x, z, w, d, kind } = obstacle;
      if (kind === 'building') {
        this.box(x, 4.8, z, w, 9.6, d, this.m.wall);
        this.box(x, 0.55, z, w + 0.01, 1.1, d + 0.01, this.m.tile);
        this.box(x, 9.52, z, w + 0.02, 0.18, d + 0.02, this.m.metal);
        for (const y of [2.7, 5.5, 8]) {
          for (const dz of [-3.5, 0, 3.5]) {
            if (y === 2.7 && dz === 0) continue;
            this.box(x - w / 2 - 0.008, y, z + dz, 0.025, 1.65, 2.25, this.m.dark);
            this.box(x - w / 2 - 0.025, y, z + dz, 0.025, 1.38, 1.97, this.m.glass);
            this.box(x - w / 2 - 0.045, y, z + dz, 0.026, 1.43, 0.06, this.m.metal);
          }
          for (const dx of [-6, -2, 2, 6]) {
            for (const edge of [-1, 1]) {
              this.box(x + dx, y, z + edge * (d / 2 + 0.012), 2.2, 1.6, 0.02, this.m.dark);
              this.box(x + dx, y, z + edge * (d / 2 + 0.026), 1.96, 1.36, 0.02, this.m.glass);
              this.box(x + dx, y, z + edge * (d / 2 + 0.04), 0.06, 1.38, 0.02, this.m.metal);
            }
          }
        }
        const building = BUILDINGS.find(item => item.z === z);
        this.box(x - w / 2 - 0.03, 1.3, z, 0.04, 2.6, 2.15, this.m.dark);
        this.box(x - w / 2 - 0.055, 1.3, z, 0.04, 2.3, 0.07, this.m.metal);
        this.sign(building.name, '夜间值守通道', x - w / 2 - 0.06, 3.35, z, 4.2, -Math.PI / 2);
        this.box(x - w / 2 + 0.45, 3, z, 0.9, 0.17, 3.2, this.m.tile);
      } else if (kind === 'tree' || kind === 'planter') {
        this.box(x, 0.31, z, w, 0.62, d, this.m.tile);
        this.box(x, 0.63, z, w - 0.3, 0.05, d - 0.3, this.m.dark);
        if (kind === 'tree') {
          const trunk = this.mesh(this.cylinder, this.m.wood, x, 2, z);
          trunk.scale.set(0.32, 3, 0.32);
          const crown = this.mesh(this.sphere, this.m.leaf, x, 4.7, z);
          crown.scale.set(w * 0.47, 2.6, d * 0.47);
          this.box(x - w * 0.35, 0.66, z, 0.4, 0.08, d * 0.85, this.m.wood);
        } else {
          for (let i = -1; i <= 1; i++) {
            const bush = this.mesh(this.sphere, this.m.leaf, x + i * w * 0.25, 0.95, z);
            bush.scale.set(w * 0.25, 0.6, d * 0.42);
          }
        }
      } else {
        this.box(x, 1.45, z, w, 2.9, d, this.m.wall);
        this.box(x, 0.45, z, w + 0.01, 0.9, d + 0.01, this.m.tile);
      }
    }
    for (let z = 7; z < this.world.height - 3; z += 3) {
      this.box(16, 0.003, z, 0.07, 0.008, 1.6, this.m.paper);
      this.box(23.1, 0.004, z, 0.38, 0.01, 1.75, this.m.dark);
    }
    this.sign('北 门', '旧凭核验 · 请勿追随点名', 19, 3.1, 0.54, 6);
    this.box(19, 1.3, 0.53, 6, 2.6, 0.025, this.m.dark);
    for (let x = 16.3; x <= 21.8; x += 0.45) this.box(x, 1.35, 0.56, 0.065, 2.5, 0.04, this.m.metal);
  }

  buildInterior() {
    const { width, height } = this.world;
    for (const obstacle of this.world.obstacles) {
      const { x, z, w, d } = obstacle;
      const storageWall = x === width;
      if (storageWall) {
        // Recesses stay inside the collision footprint, never across a walkable aisle.
        this.box(x + w * 0.42, 1.65, z, w * 0.16, 3.3, d, this.m.wall);
        this.box(x, 2.82, z, w, 0.96, d, this.m.wall);
        this.box(x, 0.08, z, w, 0.16, d, this.m.tile);
      } else {
        this.box(x, 1.65, z, w, 3.3, d, this.m.wall);
        this.box(x, 0.54, z, w + 0.012, 1.08, d + 0.012, this.m.tile);
        this.box(x, 1.1, z, w + 0.02, 0.045, d + 0.02, this.m.paper);
      }
    }
    this.box(width / 2, 3.36, height / 2, width, 0.12, height, this.m.wall);
    for (const x of [6, 19]) {
      for (const z of [6, 17, 23]) {
        this.box(x, 3.25, z, 1.3, 0.055, 0.22, this.m.metal);
        this.box(x, 3.215, z, 1.1, 0.018, 0.15, this.m.glass);
      }
    }
    for (const z of [4, 9, 18, 23]) {
      this.box(0.515, 2.05, z, 0.025, 1.7, 2.5, this.m.dark);
      this.box(0.535, 2.05, z, 0.025, 1.48, 2.24, this.m.glass);
      this.box(0.551, 2.05, z, 0.025, 1.5, 0.045, this.m.metal);
      this.box(0.551, 2.05, z, 0.025, 0.045, 2.24, this.m.metal);
    }
    this.box(14, 1.23, 27.48, 2.05, 2.46, 0.04, this.m.dark);
    this.sign('返回校园', this.world.label, 14, 2.78, 27.43, 2.75, Math.PI);
    this.sign(this.world.label, '保持安静 · 沿灯而行', 10.8, 2.1, 0.53, 3.4);
    this.sign('值夜须知', '读纸背，不要回应门外', 3.8, 1.95, 0.54, 3.1);
    const deskScene = ['classroom', 'canteen', 'tutorial'].includes(this.sceneId);
    const jars = this.sceneId === 'lab' ? new THREE.InstancedMesh(this.cylinder, this.m.glass, 126) : null;
    const jarTransform = jars ? new THREE.Object3D() : null;
    let jarIndex = 0;
    for (let i = 0; i < 7; i++) {
      const z = 3.1 + i * 3.35;
      if (deskScene) {
        this.box(27.99, 0.88, z, 0.85, 0.1, 2.3, this.m.wood);
        for (const dz of [-0.93, 0.93]) {
          this.box(27.63, 0.48, z + dz, 0.065, 0.8, 0.065, this.m.metal);
          this.box(28.29, 0.48, z + dz, 0.065, 0.8, 0.065, this.m.metal);
        }
        this.box(27.87, 0.49, z, 0.56, 0.08, 0.65, this.m.wood);
        this.box(28.11, 0.72, z, 0.06, 0.49, 0.65, this.m.wood);
        for (const dz of [-0.25, 0.25]) this.box(27.69, 0.26, z + dz, 0.055, 0.47, 0.055, this.m.metal);
        if (this.sceneId === 'canteen') {
          const bowl = this.mesh(this.cylinder, this.m.paper, 27.86, 1, z + 0.55);
          bowl.scale.set(0.14, 0.13, 0.14);
        } else this.box(27.8, 0.947, z + 0.6, 0.34, 0.02, 0.48, this.m.paper);
      } else if (this.sceneId === 'dorm') {
        this.box(28.03, 1.16, z, 0.82, 2.1, 2.8, this.m.tile);
        for (const dz of [-0.68, 0.68]) {
          this.box(27.609, 1.22, z + dz, 0.022, 1.95, 1.22, this.m.metal);
          this.box(27.584, 1.1, z + dz + 0.28, 0.025, 0.15, 0.04, this.m.paper);
        }
      } else {
        this.box(28.07, 1.05, z, 0.72, 2, 2.6, this.m.wood);
        for (const y of [0.57, 1.25, 1.9]) {
          this.box(27.7, y, z, 0.04, 0.08, 2.45, this.m.paper);
          for (let j = 0; j < 6; j++) {
            if (jars) {
              jarTransform.position.set(27.65, y + 0.22, z - 1 + j * 0.39);
              jarTransform.scale.set(0.105, 0.3, 0.105);
              jarTransform.updateMatrix();
              jars.setMatrixAt(jarIndex++, jarTransform.matrix);
            } else this.box(27.62, y + 0.23, z - 1 + j * 0.39, 0.16, 0.38, 0.28, j % 2 ? this.m.paper : this.m.tile);
          }
        }
      }
    }
    if (jars) {
      jars.instanceMatrix.needsUpdate = true;
      jars.computeBoundingSphere();
      this.scene.add(jars);
    }
    if (this.sceneId === 'classroom' || this.sceneId === 'tutorial') {
      this.box(21.5, 1.7, 0.532, 6, 1.65, 0.04, this.m.wood);
      this.sign(this.sceneId === 'classroom' ? '第 17 座' : '入夜演习', '纸背有留给你的字', 21.5, 1.75, 0.56, 5.7);
    }
  }

  buildObject(object) {
    const group = new THREE.Group();
    group.position.set(object.x, 0, object.z);
    this.scene.add(group);
    const item = { object, group, indicator: null, lightMaterial: null, sign: null };
    this.items.set(object.id, item);
    const ring = this.keep(new THREE.RingGeometry(0.38, 0.43, 24));
    const marker = this.mesh(ring, this.m.warm, 0, 0.018, 0, group);
    marker.rotation.x = -Math.PI / 2;
    item.indicator = marker;
    const box = (x, y, z, w, h, d, material) => this.box(x, y, z, w, h, d, material, group);
    const cylinder = (x, y, z, r, h, material) => {
      const shape = this.mesh(this.cylinder, material, x, y, z, group);
      shape.scale.set(r, h, r);
      return shape;
    };
    switch (object.type) {
      case 'entrance': {
        box(0, 0.032, 0, 1.4, 0.045, 2.25, this.m.tile);
        for (const dz of [-0.6, 0, 0.6]) box(0, 0.06, dz, 0.7, 0.012, 0.075, this.m.paper);
        break;
      }
      case 'exit':
      case 'gate':
        box(0, 0.025, 0, object.type === 'gate' ? 2.4 : 1.5, 0.035, 1.1, this.m.tile);
        box(0, 0.048, 0, 1.15, 0.01, 0.06, this.m.paper);
        break;
      case 'note':
        box(0, 0.13, 0, 0.7, 0.2, 0.52, this.m.wood);
        box(0, 0.245, 0, 0.6, 0.025, 0.43, this.m.paper);
        for (let i = 0; i < 4; i++) box(-0.035, 0.26, -0.13 + i * 0.077, 0.38 - i * 0.04, 0.004, 0.009, this.m.dark);
        break;
      case 'water':
        cylinder(0, 0.3, 0, 0.17, 0.54, this.m.glass);
        cylinder(0, 0.61, 0, 0.095, 0.08, this.m.paper);
        cylinder(0, 0.35, 0, 0.173, 0.17, this.m.paper);
        break;
      case 'lamp': {
        box(0, 0.08, 0, 0.45, 0.14, 0.45, this.m.metal);
        cylinder(0, 0.52, 0, 0.045, 0.9, this.m.metal);
        item.lightMaterial = this.material('#9b997c', { emissive: COLORS.paper, emissiveIntensity: 0.16 });
        box(0, 1.06, 0, 0.33, 0.44, 0.33, item.lightMaterial);
        box(0, 1.31, 0, 0.43, 0.08, 0.43, this.m.tile);
        break;
      }
      case 'control':
        box(0, 0.27, 0, 0.67, 0.5, 0.44, this.m.tile);
        box(0, 0.53, 0, 0.6, 0.04, 0.38, this.m.metal);
        for (let i = -1; i <= 1; i++) cylinder(i * 0.19, 0.565, 0, 0.044, 0.04, this.m.warm);
        break;
      case 'bell': {
        cylinder(0, 0.045, 0, 0.34, 0.06, this.m.wood);
        const bell = this.mesh(this.cone, this.m.warm, 0, 0.47, 0, group);
        bell.scale.set(0.3, 0.5, 0.3);
        cylinder(0, 0.82, 0, 0.045, 0.25, this.m.metal);
        box(0.13, 0.97, 0, 0.34, 0.07, 0.09, this.m.wood);
        box(-0.46, 0.46, -0.08, 0.07, 0.84, 0.07, this.m.metal);
        box(-0.46, 0.85, 0.02, 0.13, 0.11, 0.22, this.m.metal);
        item.clapper = new THREE.Group();
        item.clapper.position.set(-0.46, 0.85, 0.06);
        item.clapper.rotation.z = -0.3;
        group.add(item.clapper);
        this.box(0, -0.21, 0, 0.045, 0.42, 0.045, this.m.wood, item.clapper);
        const head = this.mesh(this.cylinder, this.m.paper, 0, -0.43, 0, item.clapper);
        head.scale.set(0.09, 0.2, 0.09);
        head.rotation.x = Math.PI / 2;
        box(0.65, 0.66, -0.13, 0.58, 1.16, 0.08, this.m.wood);
        box(0.65, 0.66, -0.082, 0.025, 1.08, 0.015, this.m.dark);
        for (const x of [0.4, 0.9]) box(x, 0.74, 0.01, 0.045, 0.68, 0.1, this.m.metal);
        box(0.65, 0.43, 0.06, 0.18, 0.08, 0.17, this.m.metal);
        item.latch = new THREE.Group();
        item.latch.position.set(0.65, 0.51, 0.09);
        group.add(item.latch);
        this.box(0, 0, 0, 0.58, 0.1, 0.12, this.m.paper, item.latch);
        this.box(0, 0.17, 0, 0.045, 0.3, 0.045, this.m.metal, item.latch);
        this.box(0, 0.32, 0, 0.18, 0.045, 0.07, this.m.metal, item.latch);
        break;
      }
      case 'voice':
        box(0, 0.022, 0, 0.64, 0.02, 0.45, this.m.paper);
        box(0.02, 0.04, 0, 0.3, 0.013, 0.009, this.m.dark);
        this.box(27.53, 1.13, object.z, 0.02, 2.2, 1.35, this.m.wood);
        this.sign('值夜室', '请勿应门', 27.50, 2.5, object.z, 1.65, -Math.PI / 2);
        break;
      case 'echoes':
        for (let i = 0; i < 5; i++) {
          const a = i * Math.PI * 2 / 5;
          cylinder(Math.sin(a) * 0.28, 0.13, Math.cos(a) * 0.28, 0.105, 0.19, this.m.paper);
        }
        break;
      case 'training':
        box(0, 0.09, 0, 0.6, 0.16, 0.55, this.m.tile);
        box(0, 0.19, 0, 0.48, 0.025, 0.38, this.m.paper);
        break;
      case 'puzzle':
        if (this.sceneId === 'lab') {
          box(0, 0.18, 0, 0.68, 0.3, 0.48, this.m.metal);
          for (let i = -1; i <= 1; i++) box(i * 0.16, 0.35, 0, 0.045, 0.04, 0.32, i === 0 ? this.m.warm : this.m.tile);
        } else if (this.sceneId === 'canteen') {
          cylinder(0, 0.17, 0, 0.3, 0.28, this.m.paper);
          cylinder(0, 0.314, 0, 0.245, 0.012, this.m.dark);
        } else {
          box(0, 0.15, 0, 0.65, 0.26, 0.48, this.m.wood);
          box(0, 0.293, 0, 0.55, 0.025, 0.4, this.m.paper);
          box(-0.2, 0.312, 0, 0.035, 0.015, 0.41, this.m.tile);
        }
        break;
    }
    if (!['entrance', 'exit', 'gate'].includes(object.type)) {
      item.sign = this.sign(object.label.split(' · ')[0], '', object.x, 0.045, object.z + 0.68, 1.4, 0, COLORS.ink);
      item.sign.rotation.x = -Math.PI / 2;
    }
  }

  buildEnemy() {
    this.enemy = new THREE.Group();
    this.scene.add(this.enemy);
    const coatGeometry = this.keep(new THREE.CylinderGeometry(0.28, 0.47, 1.27, 7));
    this.mesh(coatGeometry, this.m.coat, 0, 1.08, 0, this.enemy);
    const hood = this.mesh(this.sphere, this.m.coat, 0, 1.89, 0, this.enemy);
    hood.scale.set(0.31, 0.38, 0.3);
    const face = this.mesh(this.sphere, this.m.dark, 0, 1.88, -0.2, this.enemy);
    face.scale.set(0.205, 0.24, 0.095);
    this.enemyLegs = [];
    for (const side of [-1, 1]) {
      const leg = this.box(side * 0.16, 0.25, 0, 0.17, 0.48, 0.22, this.m.dark, this.enemy);
      this.enemyLegs.push(leg);
      const arm = this.box(side * 0.35, 1.2, -0.05, 0.18, 0.75, 0.21, this.m.coat, this.enemy);
      arm.rotation.z = side * 0.1;
    }
    this.box(0.33, 0.93, -0.24, 0.31, 0.47, 0.075, this.m.wood, this.enemy);
    this.box(0.33, 0.94, -0.285, 0.255, 0.38, 0.021, this.m.paper, this.enemy);
    this.box(0.2, 0.93, -0.297, 0.026, 0.44, 0.027, this.m.tile, this.enemy);
    this.enemy.visible = false;
  }

  buildRain() {
    const positions = new Float32Array(180 * 6);
    for (let i = 0; i < 180; i++) {
      const x = ((i * 73) % 181) / 181 * 24 - 12;
      const y = ((i * 47) % 179) / 179 * 10;
      const z = ((i * 113) % 183) / 183 * 24 - 12;
      positions.set([x, y, z, x + 0.04, y - 0.32, z + 0.025], i * 6);
    }
    const geometry = this.keep(new THREE.BufferGeometry());
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = this.keep(new THREE.LineBasicMaterial({ color: '#8fabb9', transparent: true, opacity: 0.16, depthWrite: false }));
    this.rain = new THREE.LineSegments(geometry, material);
    this.rain.frustumCulled = false;
    this.scene.add(this.rain);
  }

  render(state, dt, settings = {}) {
    if (this.disposed) return;
    this.quality = settings.quality || 'standard';
    this.resize();
    if (state.scene !== this.sceneId) this.buildScene(state.scene);
    const { player } = state;
    const sanity = Math.max(0, Math.min(100, player.san)) / 100;
    const range = (player.flashlight ? 16 : 11) * (0.68 + sanity * 0.32);
    this.camera.position.set(player.x, 1.65, player.z);
    this.camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
    const fov = settings.reducedEffects ? 72 : 66 + 6 * sanity;
    if (Math.abs(this.camera.fov - fov) > 0.15) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.scene.fog.near = range * 0.34;
    this.scene.fog.far = range;
    this.renderer.toneMappingExposure = 1.15 + 0.25 * sanity;
    this.ambient.intensity = 0.95 + sanity * 0.2;
    this.fill.position.copy(this.camera.position);
    this.fill.intensity = player.flashlight ? 0.5 : 0.68;
    this.flashlight.position.copy(this.camera.position);
    this.flashlight.position.y -= 0.12;
    this.camera.getWorldDirection(this.direction);
    this.flashlight.target.position.copy(this.camera.position).add(this.direction);
    this.flashlight.intensity = player.flashlight ? 22 : 0;
    this.flashlight.distance = range;
    const nearby = nearbyObject(state);
    let litLamp = null;
    let lampDistance = Infinity;
    for (const item of this.items.values()) {
      const { object } = item;
      const collected = object.type === 'water' && state.collected.includes(object.id);
      const visible = !collected && visibleFrom(this.world, player, object, range);
      item.group.visible = visible;
      if (item.sign) item.sign.visible = visible && Math.hypot(object.x - player.x, object.z - player.z) < 5.5;
      item.indicator.visible = visible && nearby?.id === object.id;
      if (object.type === 'lamp') {
        const lit = state.activatedLamps.includes(object.id);
        item.lightMaterial.emissiveIntensity = lit ? 1.6 : 0.16;
        item.lightMaterial.color.set(lit ? '#e4cf9c' : '#9b997c');
        const distance = Math.hypot(player.x - object.x, player.z - object.z);
        if (lit && visible && distance < lampDistance) {
          lampDistance = distance;
          litLamp = object;
        }
      }
      if (object.type === 'entrance') {
        item.indicator.material = !object.required || state.flags[object.required] ? this.m.warm : this.m.metal;
      }
      if (object.type === 'bell' && (dt > 0 || item.bellElapsed === undefined)) {
        item.bellElapsed = state.elapsed;
        const time = item.bellElapsed - (state.bellUntil - 2.3);
        const ringing = state.flags.circuit && state.bellUntil > 0 && time >= 0 && time < 2.3;
        let swing = 0;
        if (ringing) {
          if (time >= 0.1 && time < 0.4) swing = Math.sin((time - 0.1) / 0.3 * Math.PI);
          else if (time >= 0.55 && time < 0.85) swing = Math.sin((time - 0.55) / 0.3 * Math.PI);
          else if (time >= 1 && time < 1.9) swing = Math.sin((time - 1) / 0.9 * Math.PI);
        }
        item.clapper.rotation.z = -0.3 + swing * 0.95;
        const lift = state.flags.circuit ? (ringing ? Math.max(0, Math.min(1, (time - 1.9) / 0.4)) : 1) : 0;
        item.latch.position.y = 0.51 + 0.4 * lift * lift * (3 - 2 * lift);
      }
    }
    this.safeLight.intensity = litLamp ? 7 : 0;
    if (litLamp) this.safeLight.position.set(litLamp.x, 1.15, litLamp.z);
    const enemy = state.enemy;
    this.enemy.visible = !!enemy?.active && visibleFrom(this.world, player, enemy, range);
    if (this.enemy.visible) {
      this.enemy.position.set(enemy.x, 0, enemy.z);
      this.enemy.rotation.y = enemy.yaw;
      const stride = settings.reducedEffects ? 0 : Math.sin(state.elapsed * (enemy.mode === 'chase' ? 9 : 4)) * 0.15;
      this.enemyLegs[0].rotation.x = stride;
      this.enemyLegs[1].rotation.x = -stride;
    }
    if (this.rain) {
      this.rain.visible = !settings.reducedEffects;
      this.rain.geometry.setDrawRange(0, this.quality === 'low' ? 140 : 360);
      this.rain.position.set(player.x, -(state.elapsed * 4.5 % 7), player.z);
    }
    this.renderer.render(this.scene, this.camera);
  }

  clearScene() {
    if (this.scene) {
      this.scene.traverse(object => {
        if (object.isInstancedMesh) object.dispose();
      });
      this.scene.clear();
    }
    for (const resource of this.resources) resource.dispose();
    this.resources.clear();
    this.items?.clear();
    this.signMaterials?.clear();
    this.scene = null;
    this.sceneId = null;
    this.rain = null;
    this.renderer.renderLists.dispose();
  }

  dispose() {
    if (this.disposed) return;
    this.clearScene();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.disposed = true;
  }
}
