import { BUILDINGS, getScene, getFloor, nearbyObject, onStairs, visibleFrom } from './world.js';

const TAU = Math.PI * 2;
const COLORS = {
  dark: '#111d27', floor: '#435762', tile: '#345c53', wall: '#bdc6be',
  paper: '#c6a76b', ink: '#172b30', rain: '#7d9ba9',
};

export class Renderer2D {
  constructor(canvas, options = { mini: false }) {
    this.canvas = canvas;
    this.mini = !!options.mini;
    this.ctx = canvas.getContext('2d', { alpha: false });
    if (!this.ctx) throw new Error('无法创建 Canvas 2D 绘图上下文。');
    this.width = 0;
    this.height = 0;
    this.pixelRatio = 0;
    this.quality = 'standard';
    this.sceneId = null;
    this.world = null;
    this.obstacles = [];
    this.visibilityKey = '';
    this.polygon = [];
    this.disposed = false;
    this.resize();
  }

  resize() {
    if (this.disposed) return;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width <= 0 || height <= 0) return;
    const ratio = Math.min(globalThis.devicePixelRatio || 1, this.quality === 'low' ? 1 : 1.5);
    if (width === this.width && height === this.height && ratio === this.pixelRatio) return;
    this.width = width;
    this.height = height;
    this.pixelRatio = ratio;
    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(height * ratio);
  }

  loadScene(id) {
    this.world = getScene(id);
    this.sceneId = id;
    this.obstacles = this.world.obstacles.map(object => ({
      object,
      left: object.x - object.w / 2,
      right: object.x + object.w / 2,
      top: object.z - object.d / 2,
      bottom: object.z + object.d / 2,
    }));
    this.visibilityKey = '';
  }

  visibility(player, range) {
    const eyeY = (player.y || 0) + 1.65;
    const key = `${player.x}:${player.z}:${eyeY}:${player.floor}:${range}:${this.quality}`;
    if (this.visibilityKey === key) return this.polygon;
    const nearby = this.obstacles.filter(box => {
      const { object } = box;
      if (!object.blocksSight || eyeY <= object.y || eyeY >= object.y + object.h) return false;
      const x = Math.max(box.left, Math.min(player.x, box.right));
      const z = Math.max(box.top, Math.min(player.z, box.bottom));
      return Math.hypot(x - player.x, z - player.z) <= range + 0.1;
    });
    const count = this.quality === 'low' ? 80 : 128;
    const angles = Array.from({ length: count }, (_, i) => i * TAU / count);
    for (const box of nearby) {
      for (const x of [box.left, box.right]) {
        for (const z of [box.top, box.bottom]) {
          const angle = (Math.atan2(z - player.z, x - player.x) + TAU) % TAU;
          angles.push((angle - 0.0001 + TAU) % TAU, angle, (angle + 0.0001) % TAU);
        }
      }
    }
    angles.sort((a, b) => a - b);
    this.polygon = angles.map(angle => {
      const dx = Math.cos(angle);
      const dz = Math.sin(angle);
      let distance = range;
      for (const box of nearby) {
        let nearX = -Infinity, farX = Infinity, nearZ = -Infinity, farZ = Infinity;
        if (Math.abs(dx) < 1e-9) {
          if (player.x < box.left || player.x > box.right) continue;
        } else {
          const a = (box.left - player.x) / dx;
          const b = (box.right - player.x) / dx;
          nearX = Math.min(a, b); farX = Math.max(a, b);
        }
        if (Math.abs(dz) < 1e-9) {
          if (player.z < box.top || player.z > box.bottom) continue;
        } else {
          const a = (box.top - player.z) / dz;
          const b = (box.bottom - player.z) / dz;
          nearZ = Math.min(a, b); farZ = Math.max(a, b);
        }
        const entry = Math.max(nearX, nearZ);
        const exit = Math.min(farX, farZ);
        if (exit >= Math.max(0, entry) && entry >= 0 && entry < distance) distance = entry;
      }
      return { x: player.x + dx * Math.min(range, distance + 0.085), z: player.z + dz * Math.min(range, distance + 0.085) };
    });
    this.visibilityKey = key;
    return this.polygon;
  }

  clipVisibility(points) {
    const ctx = this.ctx;
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.z);
      else ctx.lineTo(point.x, point.z);
    });
    ctx.closePath();
    ctx.clip();
  }

  drawFloor(player, range) {
    const ctx = this.ctx;
    const outdoor = this.sceneId === 'campus';
    ctx.save();
    if (this.world.floors > 1) {
      ctx.beginPath();
      ctx.rect(0, 0, 28.5, this.world.height);
      ctx.rect(28.5, 22, this.world.width - 28.5, 6);
      ctx.clip();
    }
    ctx.fillStyle = outdoor ? COLORS.floor : '#52635b';
    ctx.fillRect(0, 0, this.world.width, this.world.height);
    if (this.mini) { ctx.restore(); return; }
    if (outdoor) {
      ctx.fillStyle = '#2c4543';
      ctx.fillRect(1, 1, 9.5, this.world.height - 2);
      ctx.fillStyle = '#52636a';
      ctx.fillRect(11, 1, 13, this.world.height - 2);
      ctx.fillStyle = '#64756e';
      for (const building of BUILDINGS) ctx.fillRect(20.7, building.z - 1.4, 3.8, 2.8);
    }
    ctx.beginPath();
    ctx.strokeStyle = outdoor ? 'rgba(171,192,193,0.12)' : 'rgba(176,194,174,0.17)';
    ctx.lineWidth = 0.025;
    const step = outdoor ? 2 : 1.5;
    const minX = Math.max(0, Math.floor((player.x - range) / step) * step);
    const minZ = Math.max(0, Math.floor((player.z - range) / step) * step);
    for (let x = minX; x < Math.min(this.world.width, player.x + range); x += step) {
      ctx.moveTo(x, Math.max(0, player.z - range));
      ctx.lineTo(x, Math.min(this.world.height, player.z + range));
    }
    for (let z = minZ; z < Math.min(this.world.height, player.z + range); z += step) {
      ctx.moveTo(Math.max(0, player.x - range), z);
      ctx.lineTo(Math.min(this.world.width, player.x + range), z);
    }
    ctx.stroke();
    if (outdoor) {
      ctx.strokeStyle = '#84908a';
      ctx.lineWidth = 0.055;
      ctx.setLineDash([0.85, 1.5]);
      ctx.beginPath(); ctx.moveTo(16, 4); ctx.lineTo(16, 108); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.fillStyle = 'rgba(9,22,30,0.22)';
    for (const zone of this.world.darkZones) if (zone.floor === getFloor(this.world, player.y)) ctx.fillRect(zone.x - zone.w / 2, zone.z - zone.d / 2, zone.w, zone.d);
    ctx.restore();
  }

  drawStairs(player, scale) {
    if (this.world.floors === 1) return;
    const floor = getFloor(this.world, player.y);
    let stair = this.world.stairs.find(s => s.from === floor) || this.world.stairs.at(-1);
    if (onStairs(this.world, player)) {
      const fraction = player.z <= 8 ? 0.5 : player.x < 34 ? (22 - player.z) / 28 : 0.5 + (player.z - 8) / 28;
      stair = this.world.stairs.reduce((nearest, s) => Math.abs(s.y + s.rise * fraction - player.y) < Math.abs(nearest.y + nearest.rise * fraction - player.y) ? s : nearest);
    }
    const ctx = this.ctx;
    const climbing = onStairs(this.world, player);
    const showA = climbing || floor < this.world.floors;
    const showB = climbing || floor > 1;
    ctx.fillStyle = '#60766b';
    ctx.fillRect(30, 5, 8, 3);
    ctx.fillStyle = '#53685f';
    if (showA) ctx.fillRect(30, 8, 3, 14);
    ctx.fillStyle = '#637368';
    if (showB) ctx.fillRect(35, 8, 3, 14);
    ctx.strokeStyle = '#b5b198';
    ctx.lineWidth = Math.max(0.045, 0.5 / scale);
    ctx.beginPath();
    for (let z = 8; z <= 22; z += this.mini ? 1.4 : 0.7) {
      if (showA) { ctx.moveTo(30, z); ctx.lineTo(33, z); }
      if (showB) { ctx.moveTo(35, z); ctx.lineTo(38, z); }
    }
    ctx.stroke();
    ctx.strokeStyle = '#97aaa4';
    ctx.lineWidth = 0.16;
    ctx.beginPath();
    for (const x of [29.8, 33.2, 34.8, 38.2]) {
      if (x < 34 ? !showA : !showB) continue;
      ctx.moveTo(x, 8.2); ctx.lineTo(x, 21.8);
    }
    ctx.stroke();
    ctx.strokeStyle = COLORS.paper;
    ctx.lineWidth = Math.max(0.1, 1 / scale);
    ctx.beginPath();
    for (const x of [31.5, 36.5]) {
      if (x < 34 ? !showA : !showB) continue;
      const direction = climbing && x > 34 ? 1 : -1;
      ctx.moveTo(x, 16 - direction); ctx.lineTo(x, 16 + direction);
      ctx.moveTo(x - 0.45, 16 + direction * 0.45); ctx.lineTo(x, 16 + direction); ctx.lineTo(x + 0.45, 16 + direction * 0.45);
    }
    ctx.stroke();
    if (!this.mini) {
      ctx.font = '0.5px "Noto Sans SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#e4d9b7';
      ctx.fillText(climbing ? `${stair.from}F — ${stair.to}F` : `${floor}F 楼梯`, 34, 6.8);
    }
  }

  drawWalls(player, range) {
    const ctx = this.ctx;
    const floor = getFloor(this.world, player.y);
    for (const { object: wall, left, right, top, bottom } of this.obstacles) {
      if (wall.floor && wall.floor !== floor) continue;
      if (wall.kind === 'stair-guard' || wall.kind === 'table' || wall.kind === 'lamp-post') continue;
      if (right < player.x - range || left > player.x + range || bottom < player.z - range || top > player.z + range) continue;
      ctx.fillStyle = wall.kind === 'tree' || wall.kind === 'planter' ? '#33564e' : '#7d908b';
      ctx.fillRect(left, top, wall.w, wall.d);
      ctx.strokeStyle = COLORS.wall;
      ctx.lineWidth = 0.17;
      ctx.strokeRect(left, top, wall.w, wall.d);
      if (wall.kind === 'building') {
        ctx.fillStyle = '#aac2b8';
        for (const dz of [-3.5, 0, 3.5]) ctx.fillRect(left - 0.018, wall.z + dz - 0.68, 0.12, 1.36);
        ctx.fillStyle = COLORS.paper;
        ctx.fillRect(left - 0.04, wall.z - 1, 0.14, 2);
      } else if (wall.kind === 'tree') {
        ctx.fillStyle = '#203c38';
        ctx.beginPath(); ctx.arc(wall.x, wall.z, wall.w * 0.43, 0, TAU); ctx.fill();
      }
    }
    if (this.sceneId !== 'campus' && !this.mini) {
      ctx.fillStyle = '#a2b8ae';
      for (const z of [4, 9, 18, 23]) ctx.fillRect(0.5, z - 1.1, 0.13, 2.2);
    }
  }

  drawObject(object, state, scale, nearby) {
    const ctx = this.ctx;
    const lit = object.type === 'lamp' && state.activatedLamps.includes(object.id);
    const locked = object.type === 'entrance' && object.required && !state.flags[object.required];
    ctx.save();
    ctx.translate(object.x, object.z);
    ctx.lineWidth = Math.max(0.06, 1.3 / scale);
    ctx.strokeStyle = locked ? '#98a9a8' : '#ead8b0';
    ctx.fillStyle = COLORS.ink;
    const table = this.world.obstacles.find(obstacle => obstacle.kind === 'table' && obstacle.objectId === object.id);
    if (table) {
      ctx.fillStyle = '#655543';
      ctx.fillRect(-table.w / 2, -table.d / 2, table.w, table.d);
      ctx.strokeRect(-table.w / 2, -table.d / 2, table.w, table.d);
    }
    switch (object.type) {
      case 'entrance':
      case 'exit':
      case 'gate':
        ctx.fillStyle = locked ? '#3d4f50' : COLORS.tile;
        ctx.fillRect(-0.48, -0.62, 0.96, 1.24);
        ctx.strokeRect(-0.48, -0.62, 0.96, 1.24);
        ctx.beginPath();
        ctx.moveTo(-0.24, 0.32); ctx.lineTo(0.23, 0); ctx.lineTo(-0.24, -0.32);
        ctx.stroke();
        if (locked) {
          ctx.beginPath(); ctx.moveTo(-0.36, 0.52); ctx.lineTo(0.36, -0.52); ctx.stroke();
        }
        break;
      case 'lamp': {
        const glow = ctx.createRadialGradient(0, 0, 0.1, 0, 0, lit ? 2.25 : 0.7);
        glow.addColorStop(0, lit ? 'rgba(227,190,113,0.42)' : 'rgba(196,172,119,0.14)');
        glow.addColorStop(1, 'rgba(198,167,107,0)');
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(0, 0, lit ? 2.25 : 0.7, 0, TAU); ctx.fill();
        ctx.fillStyle = lit ? '#e6c17f' : '#646b5d';
        ctx.fillRect(-0.2, -0.27, 0.4, 0.54);
        ctx.strokeRect(-0.2, -0.27, 0.4, 0.54);
        ctx.beginPath(); ctx.moveTo(-0.32, -0.33); ctx.lineTo(0.32, -0.33); ctx.stroke();
        break;
      }
      case 'water':
        ctx.fillStyle = '#a4c7c0';
        ctx.fillRect(-0.16, -0.29, 0.32, 0.6);
        ctx.strokeRect(-0.16, -0.29, 0.32, 0.6);
        ctx.fillStyle = COLORS.paper;
        ctx.fillRect(-0.11, -0.4, 0.22, 0.12);
        ctx.fillRect(-0.16, -0.03, 0.32, 0.16);
        break;
      case 'bell':
        ctx.fillStyle = COLORS.paper;
        ctx.beginPath();
        ctx.moveTo(-0.35, 0.22); ctx.lineTo(-0.22, -0.2);
        ctx.quadraticCurveTo(0, -0.52, 0.22, -0.2);
        ctx.lineTo(0.35, 0.22); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.arc(0, 0.31, 0.075, 0, TAU); ctx.fill();
        break;
      case 'control':
        ctx.fillStyle = '#304942';
        ctx.fillRect(-0.4, -0.3, 0.8, 0.6); ctx.strokeRect(-0.4, -0.3, 0.8, 0.6);
        ctx.fillStyle = COLORS.paper;
        for (let i = -1; i <= 1; i++) ctx.fillRect(i * 0.22 - 0.055, -0.14, 0.11, 0.28);
        break;
      case 'echoes':
        for (let i = 0; i < 5; i++) {
          const angle = i * TAU / 5;
          ctx.beginPath(); ctx.arc(Math.cos(angle) * 0.29, Math.sin(angle) * 0.29, 0.11, 0, TAU); ctx.stroke();
        }
        break;
      case 'training':
        ctx.beginPath(); ctx.arc(0, 0, 0.38, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-0.2, 0.12); ctx.lineTo(0, -0.19); ctx.lineTo(0.2, 0.12); ctx.stroke();
        break;
      case 'puzzle':
      case 'investigation':
        ctx.fillStyle = '#6c5f48';
        ctx.fillRect(-0.42, -0.32, 0.84, 0.64); ctx.strokeRect(-0.42, -0.32, 0.84, 0.64);
        ctx.beginPath(); ctx.moveTo(0, -0.24); ctx.lineTo(0, 0.24); ctx.stroke();
        ctx.fillStyle = COLORS.paper; ctx.fillRect(-0.25, -0.13, 0.12, 0.2);
        break;
      case 'note':
      case 'evidence':
      case 'voice':
        ctx.fillStyle = '#d8c8a4';
        ctx.fillRect(-0.31, -0.37, 0.62, 0.74);
        ctx.strokeStyle = '#655b47';
        ctx.beginPath();
        for (let i = 0; i < 3; i++) {
          ctx.moveTo(-0.21, -0.18 + i * 0.17); ctx.lineTo(0.19 - i * 0.04, -0.18 + i * 0.17);
        }
        ctx.stroke();
        break;
    }
    if (nearby?.id === object.id) {
      ctx.strokeStyle = '#f2d399';
      ctx.lineWidth = 0.065;
      ctx.beginPath(); ctx.arc(0, 0, 0.83, 0, TAU); ctx.stroke();
    }
    const labelled = nearby?.id === object.id || object.type === 'entrance' || object.type === 'exit' || object.type === 'gate';
    if (labelled) {
      const text = object.label.split(' · ')[0];
      const fontSize = Math.max(0.38, 12 / scale);
      ctx.font = `600 ${fontSize}px "Noto Sans SC", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const width = ctx.measureText(text).width + 0.36;
      ctx.fillStyle = 'rgba(17,29,39,0.88)';
      ctx.fillRect(-width / 2, 0.94, width, fontSize + 0.24);
      ctx.fillStyle = '#eddfc1';
      ctx.fillText(text, 0, 1.06 + fontSize / 2);
    }
    ctx.restore();
  }

  drawEnemy(enemy, scale) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(enemy.x, enemy.z);
    ctx.rotate(-enemy.yaw);
    ctx.fillStyle = '#19282d';
    ctx.strokeStyle = '#8c9e98';
    ctx.lineWidth = Math.max(0.055, 1 / scale);
    ctx.beginPath();
    ctx.moveTo(-0.24, -0.28); ctx.lineTo(-0.48, 0.5);
    ctx.lineTo(0.48, 0.5); ctx.lineTo(0.24, -0.28); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#4c615e';
    ctx.beginPath(); ctx.arc(0, -0.23, 0.28, 0, TAU); ctx.fill();
    ctx.fillStyle = '#15242c';
    ctx.beginPath(); ctx.arc(0, -0.3, 0.15, Math.PI, TAU); ctx.fill();
    ctx.fillStyle = '#c6b88f';
    ctx.fillRect(0.31, 0.1, 0.25, 0.36);
    ctx.strokeStyle = '#5c5140';
    ctx.beginPath(); ctx.moveTo(0.37, 0.12); ctx.lineTo(0.37, 0.44); ctx.stroke();
    ctx.restore();
  }

  renderMini(state, range) {
    const ctx = this.ctx;
    const { player } = state;
    const floor = getFloor(this.world, player.y);
    const scale = Math.max(0.01, Math.min((this.width - 16) / this.world.width, (this.height - 48) / this.world.height));
    const left = (this.width - this.world.width * scale) / 2;
    const top = 24 + (this.height - 48 - this.world.height * scale) / 2;
    ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = COLORS.dark;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.save();
    ctx.translate(left, top);
    ctx.scale(scale, scale);
    ctx.save();
    this.clipVisibility(this.visibility(player, range));
    this.drawFloor(player, range);
    this.drawStairs(player, scale);
    this.drawWalls(player, range);
    for (const object of this.world.objects) {
      if (!['entrance', 'exit', 'gate', 'lamp'].includes(object.type)) continue;
      if (object.floor !== floor || Math.abs(object.y - (player.y || 0)) > 0.45 || !visibleFrom(this.world, player, object, range)) continue;
      ctx.strokeStyle = COLORS.paper;
      ctx.lineWidth = 1.2 / scale;
      if (object.type === 'lamp') {
        ctx.fillStyle = state.activatedLamps.includes(object.id) ? '#e6c17f' : '#646b5d';
        ctx.beginPath(); ctx.arc(object.x, object.z, 2.4 / scale, 0, TAU); ctx.fill(); ctx.stroke();
      } else {
        ctx.fillStyle = COLORS.tile;
        ctx.fillRect(object.x - 2.5 / scale, object.z - 3 / scale, 5 / scale, 6 / scale);
        ctx.strokeRect(object.x - 2.5 / scale, object.z - 3 / scale, 5 / scale, 6 / scale);
      }
    }
    ctx.restore();
    ctx.translate(player.x, player.z);
    ctx.rotate(-player.yaw);
    ctx.fillStyle = '#efce89';
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = 1 / scale;
    ctx.beginPath();
    ctx.moveTo(0, -5 / scale); ctx.lineTo(-3.5 / scale, 4 / scale); ctx.lineTo(0, 2 / scale); ctx.lineTo(3.5 / scale, 4 / scale);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    ctx.font = '11px "Noto Sans SC", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ddd8c4';
    ctx.fillText(`北 ↑   ${floor}F${onStairs(this.world, player) ? ' 楼梯间' : ''}`, 8, 12);
    ctx.font = '10px "Noto Sans SC", sans-serif';
    ctx.lineWidth = 1;
    const legendY = this.height - 11;
    for (const [index, text] of ['楼梯', '门', '安全灯'].entries()) {
      const x = 8 + index * (this.width - 16) / 3;
      ctx.strokeStyle = COLORS.paper;
      if (index === 0) {
        ctx.beginPath(); ctx.moveTo(x, legendY + 3); ctx.lineTo(x + 3, legendY + 3); ctx.lineTo(x + 3, legendY); ctx.lineTo(x + 6, legendY); ctx.lineTo(x + 6, legendY - 3); ctx.stroke();
      } else if (index === 1) ctx.strokeRect(x, legendY - 4, 6, 8);
      else { ctx.beginPath(); ctx.arc(x + 3, legendY, 3, 0, TAU); ctx.stroke(); }
      ctx.fillText(text, x + 10, legendY);
    }
  }

  render(state, dt, settings = {}) {
    if (this.disposed) return;
    this.quality = settings.quality || 'standard';
    this.resize();
    if (!this.canvas.clientWidth || !this.canvas.clientHeight) return;
    if (state.scene !== this.sceneId) this.loadScene(state.scene);
    const ctx = this.ctx;
    const { player } = state;
    const sanity = Math.max(0, Math.min(100, player.san)) / 100;
    const range = (player.flashlight ? 16 : 11) * (0.68 + sanity * 0.32);
    if (this.mini) { this.renderMini(state, range); return; }
    const floor = getFloor(this.world, player.y);
    const scale = Math.min(this.width / 25, this.height / 20, 43);
    const centerX = this.width / 2;
    const centerY = this.height / 2;
    ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = COLORS.dark;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.save();
    ctx.translate(centerX - player.x * scale, centerY - player.z * scale);
    ctx.scale(scale, scale);
    this.clipVisibility(this.visibility(player, range));
    this.drawFloor(player, range);
    this.drawStairs(player, scale);
    const angle = -Math.PI / 2 - player.yaw;
    const light = ctx.createRadialGradient(player.x, player.z, 0.4, player.x, player.z, range);
    light.addColorStop(0, 'rgba(220,211,171,0.21)');
    light.addColorStop(0.55, 'rgba(206,201,165,0.075)');
    light.addColorStop(1, 'rgba(206,201,165,0)');
    ctx.fillStyle = light;
    ctx.beginPath(); ctx.arc(player.x, player.z, range, 0, TAU); ctx.fill();
    ctx.fillStyle = player.flashlight ? 'rgba(230,220,173,0.16)' : 'rgba(182,206,209,0.075)';
    ctx.beginPath();
    ctx.moveTo(player.x, player.z);
    ctx.arc(player.x, player.z, range, angle - 0.52, angle + 0.52);
    ctx.closePath(); ctx.fill();
    this.drawWalls(player, range);
    const nearby = nearbyObject(state);
    for (const object of this.world.objects) {
      if (object.floor !== floor || Math.abs(object.y - (player.y || 0)) > 0.45) continue;
      if (object.type === 'water' && state.collected.includes(object.id)) continue;
      if (!visibleFrom(this.world, player, object, range)) continue;
      this.drawObject(object, state, scale, nearby);
    }
    if (state.enemy?.active && state.enemy.floor === floor && Math.abs((state.enemy.y || 0) - (player.y || 0)) < this.world.floorHeight / 2 && visibleFrom(this.world, player, state.enemy, range)) this.drawEnemy(state.enemy, scale);
    if (this.sceneId === 'campus' && !settings.reducedEffects) {
      ctx.strokeStyle = 'rgba(164,189,200,0.16)';
      ctx.lineWidth = 0.026;
      ctx.beginPath();
      const drops = this.quality === 'low' ? 28 : 58;
      for (let i = 0; i < drops; i++) {
        const x = player.x - range + ((i * 7.31) % (range * 2));
        const z = player.z - range + ((i * 11.71 + state.elapsed * 5) % (range * 2));
        ctx.moveTo(x, z); ctx.lineTo(x + 0.1, z + 0.38);
      }
      ctx.stroke();
    }
    const fog = ctx.createRadialGradient(player.x, player.z, range * 0.28, player.x, player.z, range);
    fog.addColorStop(0, `rgba(17,29,39,${(1 - sanity) * 0.08})`);
    fog.addColorStop(0.72, 'rgba(17,29,39,0.38)');
    fog.addColorStop(1, 'rgba(17,29,39,1)');
    ctx.fillStyle = fog;
    ctx.fillRect(player.x - range, player.z - range, range * 2, range * 2);
    ctx.save();
    ctx.translate(player.x, player.z);
    const halo = ctx.createRadialGradient(0, 0, 0.15, 0, 0, 1.4);
    halo.addColorStop(0, 'rgba(205,225,215,0.3)');
    halo.addColorStop(1, 'rgba(205,225,215,0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(0, 0, 1.4, 0, TAU); ctx.fill();
    ctx.rotate(-player.yaw);
    ctx.fillStyle = '#dce5d7';
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = 0.07;
    ctx.beginPath(); ctx.arc(0, 0, 0.27, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#efce89';
    ctx.beginPath(); ctx.moveTo(0, -0.75); ctx.lineTo(-0.19, -0.36); ctx.lineTo(0.19, -0.36); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.restore();
  }

  dispose() {
    if (this.disposed) return;
    this.obstacles.length = 0;
    this.polygon.length = 0;
    this.world = null;
    this.ctx = null;
    this.disposed = true;
  }
}
