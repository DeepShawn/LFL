import * as THREE from 'three';

export type CharacterKind = 'teacher' | 'student';
export type TeacherStyle = 'classroom' | 'office';

export interface CharacterOptions {
  kind: CharacterKind;
  variant?: number;
  name?: string;
  style?: TeacherStyle;
}

const SKIN = [0xb88975, 0xd5a58d, 0x9e6f5f, 0xe0b498];
const HAIR = [0x17171e, 0x2d2220, 0x46332c, 0x171b20];
const STUDENT_SHIRTS = [0x477f92, 0x6f8792, 0x8d6f67, 0x52766e, 0x6e658b];
const STUDENT_PANTS = [0x273747, 0x35404a, 0x463d42, 0x263b35];

function material(color: number, roughness = .78, metalness = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function mesh<T extends THREE.BufferGeometry>(geometry: T, mat: THREE.Material, name: string) {
  const node = new THREE.Mesh(geometry, mat);
  node.name = name;
  node.castShadow = true;
  node.receiveShadow = true;
  return node;
}

/**
 * A small low-poly character rig used for NPCs. It is intentionally built from
 * shared primitives so the scene gains readable silhouettes without adding
 * external downloads or making the mobile asset tier heavier.
 */
export function createCharacter({ kind, variant = 0, name, style = 'classroom' }: CharacterOptions) {
  const root = new THREE.Group();
  root.name = name || `${kind}-${variant}`;
  root.userData.characterKind = kind;
  root.userData.variant = variant;
  root.userData.teacherStyle = kind === 'teacher' ? style : undefined;

  const skin = material(SKIN[variant % SKIN.length], .9);
  const hair = material(HAIR[variant % HAIR.length], .98);
  const officeTeacher = kind === 'teacher' && style === 'office';
  const shirt = material(kind === 'teacher' ? (officeTeacher ? 0x40586a : 0x27283b) : STUDENT_SHIRTS[variant % STUDENT_SHIRTS.length]);
  const pants = material(kind === 'teacher' ? (officeTeacher ? 0x283542 : 0x322c3f) : STUDENT_PANTS[variant % STUDENT_PANTS.length]);
  const shoe = material(kind === 'teacher' ? 0x171820 : 0x1e252d, .88);
  const paper = material(kind === 'teacher' ? 0x9e5547 : 0xd1bd92, .9);
  const accent = material(kind === 'teacher' ? (officeTeacher ? 0xb7c9c3 : 0xd7ac71) : 0xd3ae7e, .68, .1);

  // Keep feet planted while giving teachers a visibly taller, more mature
  // silhouette and students small individual height differences.
  const stature = kind === 'teacher' ? 1.08 : .94 + (variant % 3) * .025;
  root.scale.set(1, stature, 1);

  const torso = mesh(new THREE.CapsuleGeometry(.2, .48, 6, 10), shirt, 'torso');
  torso.position.y = .72;
  torso.scale.x = kind === 'teacher' ? 1.08 : .94;
  root.add(torso);

  // A shallow shoulder layer gives the jacket and school uniform a clean
  // transition into the arms without adding a separate high-poly asset.
  const shoulderGeometry = new THREE.SphereGeometry(.13, 8, 5);
  for (const side of [-1, 1]) {
    const shoulder = mesh(shoulderGeometry, shirt, 'shoulder');
    shoulder.position.set(side * .19, .94, 0);
    shoulder.scale.set(1, .72, .86);
    root.add(shoulder);
  }

  const collar = mesh(new THREE.ConeGeometry(.12, .12, 5), accent, 'collar');
  collar.position.set(0, 1.08, -.03);
  root.add(collar);

  const neck = mesh(new THREE.CylinderGeometry(.07, .08, .13, 8), skin, 'neck');
  neck.position.y = 1.12;
  root.add(neck);

  const head = mesh(new THREE.SphereGeometry(.19, 12, 8), skin, 'head');
  head.scale.set(.92, 1.08, .9);
  head.position.y = 1.38;
  root.add(head);

  const hairCap = mesh(new THREE.SphereGeometry(.2, 12, 8), hair, 'hair');
  hairCap.scale.set(1, .74, .96);
  hairCap.position.set(0, 1.5, .035);
  root.add(hairCap);

  if (kind === 'teacher') {
    const bun = mesh(new THREE.SphereGeometry(.1, 8, 6), hair, 'hair-bun');
    bun.position.set(officeTeacher ? -.12 : 0, 1.57, .16);
    root.add(bun);
    if (officeTeacher) {
      const glasses = new THREE.TorusGeometry(.065, .008, 5, 12);
      const frame = material(0x1b222a, .52, .25);
      for (const x of [-.065, .065]) {
        const lens = mesh(glasses, frame, 'glasses');
        lens.position.set(x, 1.39, -.191);
        root.add(lens);
      }
      const bridge = mesh(new THREE.BoxGeometry(.045, .012, .01), frame, 'glasses-bridge');
      bridge.position.set(0, 1.39, -.191);
      root.add(bridge);
    }
  } else {
    const fringe = mesh(new THREE.BoxGeometry(.2, .075, .045), hair, 'fringe');
    fringe.position.set(0, 1.47, -.18);
    fringe.rotation.x = -.12;
    root.add(fringe);
    if (variant % 3 === 0) {
      const sideHair = new THREE.SphereGeometry(.075, 8, 6);
      for (const side of [-1, 1]) {
        const lock = mesh(sideHair, hair, 'side-hair');
        lock.position.set(side * .16, 1.4, .01);
        lock.scale.set(.8, 1.25, .8);
        root.add(lock);
      }
    } else if (variant % 3 === 1) {
      const ponytail = mesh(new THREE.SphereGeometry(.095, 8, 6), hair, 'ponytail');
      ponytail.position.set(.02, 1.43, .17);
      ponytail.scale.set(.78, 1.35, .78);
      root.add(ponytail);
    }
  }

  const eye = new THREE.SphereGeometry(.025, 6, 4);
  const eyeMat = material(0x16161a, .6);
  for (const x of [-.065, .065]) {
    const eyeNode = mesh(eye, eyeMat, 'eye');
    eyeNode.position.set(x, 1.39, -.171);
    root.add(eyeNode);
  }
  const nose = mesh(new THREE.ConeGeometry(.018, .07, 5), skin, 'nose');
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 1.34, -.19);
  root.add(nose);

  const browMaterial = material(HAIR[variant % HAIR.length], .98);
  for (const side of [-1, 1]) {
    const brow = mesh(new THREE.BoxGeometry(.055, .012, .012), browMaterial, 'brow');
    brow.position.set(side * .065, 1.445, -.183);
    brow.rotation.z = side * (kind === 'teacher' ? -.05 : .08);
    root.add(brow);
  }

  const armGeometry = new THREE.CapsuleGeometry(.055, .34, 4, 6);
  for (const side of [-1, 1]) {
    const arm = mesh(armGeometry, shirt, 'arm');
    arm.position.set(side * .24, .76, -.015);
    arm.rotation.z = side * -.18;
    root.add(arm);
    const hand = mesh(new THREE.SphereGeometry(.06, 7, 5), skin, 'hand');
    hand.position.set(side * .29, .51, -.02);
    root.add(hand);
  }

  const legGeometry = new THREE.CapsuleGeometry(.075, .36, 4, 6);
  for (const side of [-1, 1]) {
    const leg = mesh(legGeometry, pants, 'leg');
    leg.position.set(side * .1, .28, 0);
    root.add(leg);
    const foot = mesh(new THREE.BoxGeometry(.14, .08, .24), shoe, 'shoe');
    foot.position.set(side * .1, .055, -.045);
    root.add(foot);
  }

  if (kind === 'teacher') {
    const clipboard = mesh(new THREE.BoxGeometry(.2, .27, .035), paper, 'clipboard');
    clipboard.position.set(.23, .62, -.14);
    clipboard.rotation.set(-.18, -.25, -.18);
    root.add(clipboard);
    const clip = mesh(new THREE.BoxGeometry(.11, .03, .045), accent, 'clipboard-clip');
    clip.position.set(.23, .755, -.16);
    clip.rotation.z = -.18;
    root.add(clip);
    const lapel = material(officeTeacher ? 0xb7c9c3 : 0x9f9ab5, .72);
    for (const side of [-1, 1]) {
      const panel = mesh(new THREE.BoxGeometry(.055, .22, .025), lapel, 'lapel');
      panel.position.set(side * .075, .94, -.19);
      panel.rotation.z = side * -.24;
      root.add(panel);
    }
    if (officeTeacher) {
      const badge = mesh(new THREE.BoxGeometry(.08, .11, .018), accent, 'teacher-badge');
      badge.position.set(.1, .86, -.205);
      root.add(badge);
    }
  } else {
    const backpack = mesh(new THREE.BoxGeometry(.22, .3, .12), accent, 'backpack');
    backpack.position.set(0, .72, .14);
    root.add(backpack);
    const notebook = mesh(new THREE.BoxGeometry(.13, .18, .025), paper, 'notebook');
    notebook.position.set(.12, .69, -.17);
    notebook.rotation.z = -.12;
    root.add(notebook);
    const badge = mesh(new THREE.BoxGeometry(.065, .075, .018), paper, 'student-badge');
    badge.position.set(.1, .86, -.2);
    root.add(badge);
  }

  return root;
}

export function animateCharacter(root: THREE.Object3D, elapsed: number, phase = 0, walking = false) {
  const bob = walking ? Math.sin(elapsed * 8 + phase) * .018 : Math.sin(elapsed * 1.6 + phase) * .008;
  const baseY = typeof root.userData.baseY === 'number' ? root.userData.baseY : root.position.y;
  root.position.y = baseY + bob;
  const head = root.getObjectByName('head');
  if (head) head.rotation.y = Math.sin(elapsed * .65 + phase) * .08;
  const arms: THREE.Object3D[] = [];
  root.traverse((node) => { if (node.name === 'arm') arms.push(node); });
  const leftArm = arms[0];
  const rightArm = arms[1];
  if (leftArm && rightArm) {
    const swing = walking ? Math.sin(elapsed * 8 + phase) * .18 : Math.sin(elapsed * 1.2 + phase) * .025;
    leftArm.rotation.x = swing;
    rightArm.rotation.x = -swing;
  }
}
