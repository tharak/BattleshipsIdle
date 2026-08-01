import * as THREE from 'three';
import { ARENA } from '../config/balance.js';
import { ObjectPool } from './ObjectPool.js';

const COLORS = Object.freeze({
  background: 0x040713,
  friendly: 0x54f4eb,
  friendlyCore: 0xe7ffff,
  command: 0xffc76c,
  enemy: 0xff596f,
  enemyCore: 0xffc0c7,
  elite: 0xffb14a,
  boss: 0xb76cff,
  grid: 0x17314d,
});

function makeShape(points) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let index = 1; index < points.length; index += 1) {
    shape.lineTo(points[index][0], points[index][1]);
  }
  shape.closePath();
  return shape;
}

function createMaterial(color, options = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: options.emissiveIntensity ?? 0.62,
    metalness: 0.68,
    roughness: 0.28,
    transparent: options.transparent ?? false,
    opacity: options.opacity ?? 1,
    depthWrite: options.depthWrite ?? true,
  });
}

export class GameRenderer {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(COLORS.background);
    this.scene.fog = new THREE.FogExp2(COLORS.background, 0.0022);

    this.camera = new THREE.OrthographicCamera(-55, 55, 82, -82, 0.1, 500);
    this.camera.position.set(0, -38, 180);
    this.camera.lookAt(0, 0, 0);
    this.baseCameraPosition = this.camera.position.clone();

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.24;
    container.appendChild(this.renderer.domElement);

    this.clockTime = 0;
    this.shake = 0;
    this.screenShakeEnabled = true;
    this.entityMeshes = new Map();
    this.projectileMeshes = new Map();
    this.effects = [];
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.battlePlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    this.worldPoint = new THREE.Vector3();

    this.shared = this.createSharedResources();
    this.projectilePool = this.createProjectilePool();
    this.effectPool = this.createEffectPool();
    this.createEnvironment();
    this.createTargetMarker();
    this.resize();
  }

  createSharedResources() {
    return {
      friendlyMaterial: createMaterial(COLORS.friendly),
      friendlyCoreMaterial: new THREE.MeshBasicMaterial({ color: COLORS.friendlyCore }),
      commandMaterial: createMaterial(COLORS.command, { emissiveIntensity: 0.78 }),
      enemyMaterial: createMaterial(COLORS.enemy, { emissiveIntensity: 0.88 }),
      eliteMaterial: createMaterial(COLORS.elite, { emissiveIntensity: 0.96 }),
      bossMaterial: createMaterial(COLORS.boss, { emissiveIntensity: 1.08 }),
      enemyCoreMaterial: new THREE.MeshBasicMaterial({ color: COLORS.enemyCore }),
      friendlyHaloMaterial: new THREE.MeshBasicMaterial({
        color: COLORS.friendly,
        transparent: true,
        opacity: 0.18,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
      enemyHaloMaterial: new THREE.MeshBasicMaterial({
        color: COLORS.enemy,
        transparent: true,
        opacity: 0.18,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
      bossHaloMaterial: new THREE.MeshBasicMaterial({
        color: COLORS.boss,
        transparent: true,
        opacity: 0.32,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
      shieldMaterial: new THREE.MeshBasicMaterial({
        color: 0x72a7ff,
        transparent: true,
        opacity: 0.46,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
      darkMaterial: createMaterial(0x0a1629, { emissiveIntensity: 0.08 }),
      healthMaterial: new THREE.MeshBasicMaterial({ color: COLORS.friendly }),
      enemyHealthMaterial: new THREE.MeshBasicMaterial({ color: COLORS.enemy }),
      healthBackMaterial: new THREE.MeshBasicMaterial({ color: 0x172033, transparent: true, opacity: 0.7 }),
      projectileFriendly: new THREE.MeshBasicMaterial({ color: COLORS.friendlyCore }),
      projectileEnemy: new THREE.MeshBasicMaterial({ color: COLORS.enemyCore }),
      projectileGeometry: new THREE.CapsuleGeometry(0.25, 1.7, 2, 6),
      haloGeometry: new THREE.RingGeometry(2.2, 2.8, 18),
      ringGeometry: new THREE.RingGeometry(0.86, 1, 32),
    };
  }

  createEnvironment() {
    const ambient = new THREE.AmbientLight(0x6aa9c7, 0.72);
    const key = new THREE.DirectionalLight(0xb9ffff, 2.2);
    key.position.set(-30, -20, 80);
    const rim = new THREE.DirectionalLight(0xff647d, 1.2);
    rim.position.set(30, 60, 35);
    this.scene.add(ambient, key, rim);

    const grid = new THREE.GridHelper(240, 24, COLORS.grid, COLORS.grid);
    grid.rotation.x = Math.PI / 2;
    grid.position.set(0, 0, -2.8);
    grid.material.transparent = true;
    grid.material.opacity = 0.24;
    this.scene.add(grid);

    const borderPoints = [
      new THREE.Vector3(ARENA.minX, ARENA.minY, -0.8),
      new THREE.Vector3(ARENA.maxX, ARENA.minY, -0.8),
      new THREE.Vector3(ARENA.maxX, ARENA.maxY, -0.8),
      new THREE.Vector3(ARENA.minX, ARENA.maxY, -0.8),
      new THREE.Vector3(ARENA.minX, ARENA.minY, -0.8),
    ];
    const border = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(borderPoints),
      new THREE.LineBasicMaterial({ color: COLORS.grid, transparent: true, opacity: 0.65 }),
    );
    this.scene.add(border);

    const lineGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(ARENA.minX, ARENA.defenseLineY, -0.4),
      new THREE.Vector3(ARENA.maxX, ARENA.defenseLineY, -0.4),
    ]);
    this.defenseLine = new THREE.Line(
      lineGeometry,
      new THREE.LineBasicMaterial({ color: COLORS.friendly, transparent: true, opacity: 0.42 }),
    );
    this.scene.add(this.defenseLine);

    const starCount = 520;
    const positions = new Float32Array(starCount * 3);
    const sizes = new Float32Array(starCount);
    let seed = 1907;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    for (let index = 0; index < starCount; index += 1) {
      positions[index * 3] = (random() - 0.5) * 280;
      positions[index * 3 + 1] = (random() - 0.5) * 250;
      positions[index * 3 + 2] = -4 - random() * 30;
      sizes[index] = 0.4 + random();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    this.stars = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color: 0x8ac8df,
        size: 0.45,
        transparent: true,
        opacity: 0.72,
        sizeAttenuation: true,
      }),
    );
    this.scene.add(this.stars);

    const haze = new THREE.Mesh(
      new THREE.PlaneGeometry(150, 85),
      new THREE.MeshBasicMaterial({ color: 0x13234d, transparent: true, opacity: 0.09, depthWrite: false }),
    );
    haze.position.set(-32, 30, -9);
    haze.rotation.z = -0.18;
    this.scene.add(haze);
  }

  createTargetMarker() {
    this.targetMarker = new THREE.Group();
    const material = new THREE.MeshBasicMaterial({
      color: COLORS.friendly,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const outer = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 48, 1, 0, Math.PI * 1.72), material);
    const inner = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.5, 24), material.clone());
    const crossGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-7, 0, 0), new THREE.Vector3(-3.4, 0, 0),
      new THREE.Vector3(7, 0, 0), new THREE.Vector3(3.4, 0, 0),
      new THREE.Vector3(0, -7, 0), new THREE.Vector3(0, -3.4, 0),
      new THREE.Vector3(0, 7, 0), new THREE.Vector3(0, 3.4, 0),
    ]);
    const cross = new THREE.LineSegments(crossGeometry, material.clone());
    this.targetMarker.add(outer, inner, cross);
    outer.userData.isRadiusRing = true;
    this.targetMarker.position.z = 4;
    this.targetMarker.visible = false;
    this.targetMarker.userData.life = 0;
    this.scene.add(this.targetMarker);
  }

  createProjectilePool() {
    return new ObjectPool({
      initialSize: 36,
      create: () => {
        const mesh = new THREE.Mesh(this.shared.projectileGeometry, this.shared.projectileFriendly);
        mesh.visible = false;
        mesh.renderOrder = 4;
        this.scene.add(mesh);
        return mesh;
      },
      reset: (mesh) => {
        mesh.visible = false;
        mesh.scale.setScalar(1);
      },
    });
  }

  createEffectPool() {
    return new ObjectPool({
      initialSize: 14,
      create: () => {
        const group = new THREE.Group();
        const material = new THREE.MeshBasicMaterial({
          color: COLORS.friendly,
          transparent: true,
          opacity: 1,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const ring = new THREE.Mesh(this.shared.ringGeometry, material);
        const core = new THREE.Mesh(new THREE.CircleGeometry(0.7, 14), material.clone());
        group.add(ring, core);
        group.visible = false;
        group.position.z = 5;
        group.userData.materials = [material, core.material];
        this.scene.add(group);
        return group;
      },
      reset: (group) => {
        group.visible = false;
        group.scale.setScalar(1);
      },
    });
  }

  createShipMesh(entity) {
    const group = new THREE.Group();
    const friendly = entity.faction === 'friendly';
    const command = entity.role === 'command';
    const scale = (command ? 1.28 : 1) * (entity.scale ?? 1);

    if (friendly) {
      const friendlyShape = entity.role === 'lancer'
        ? [[0, 4.4], [-1, 0.1], [-1.45, -2.8], [0, -1.6], [1.45, -2.8], [1, 0.1]]
        : entity.role === 'guardian'
          ? [[0, 3.1], [-2.5, 1.1], [-3, -2.2], [0, -1.55], [3, -2.2], [2.5, 1.1]]
          : [[0, 3.8], [-1.5, 0.4], [-2.5, -2.2], [0, -1.3], [2.5, -2.2], [1.5, 0.4]];
      const hull = new THREE.Mesh(
        new THREE.ExtrudeGeometry(
          makeShape(friendlyShape),
          { depth: 0.75, bevelEnabled: true, bevelSize: 0.2, bevelThickness: 0.22, bevelSegments: 1 },
        ),
        command ? this.shared.commandMaterial : this.shared.friendlyMaterial,
      );
      hull.position.z = -0.35;
      group.add(hull);

      const wingWidth = entity.role === 'lancer' ? 3.8 : entity.role === 'guardian' ? 7 : 5.8;
      const wings = new THREE.Mesh(new THREE.BoxGeometry(wingWidth, 0.7, 0.45), this.shared.darkMaterial);
      wings.position.set(0, -0.65, 0.3);
      group.add(wings);

      const core = new THREE.Mesh(new THREE.OctahedronGeometry(command ? 0.7 : 0.48, 0), this.shared.friendlyCoreMaterial);
      core.position.set(0, 0.55, 0.9);
      group.add(core);
    } else {
      const enemyShape = entity.boss
        ? [[0, -4], [-3.8, -2.4], [-5.2, 0.3], [-2.8, 3.4], [0, 2], [2.8, 3.4], [5.2, 0.3], [3.8, -2.4]]
        : entity.type === 'skirmisher'
          ? [[0, -4], [-1.4, 0], [-0.8, 2.8], [0, 1.5], [0.8, 2.8], [1.4, 0]]
          : entity.type === 'bulwark'
            ? [[0, -2.8], [-3.4, -1.2], [-3, 2.2], [0, 1.35], [3, 2.2], [3.4, -1.2]]
            : entity.type === 'artillery'
              ? [[0, -3.1], [-2.8, -0.4], [-2.4, 3], [-0.8, 1.8], [0.8, 1.8], [2.4, 3], [2.8, -0.4]]
              : [[0, -3.2], [-2.5, -0.2], [-1.1, 2.4], [0, 1.35], [1.1, 2.4], [2.5, -0.2]];
      const hull = new THREE.Mesh(
        new THREE.ExtrudeGeometry(
          makeShape(enemyShape),
          { depth: 0.7, bevelEnabled: true, bevelSize: 0.18, bevelThickness: 0.2, bevelSegments: 1 },
        ),
        entity.boss
          ? this.shared.bossMaterial
          : entity.elite ? this.shared.eliteMaterial : this.shared.enemyMaterial,
      );
      hull.position.z = -0.35;
      group.add(hull);
      const core = new THREE.Mesh(new THREE.TetrahedronGeometry(0.65, 0), this.shared.enemyCoreMaterial);
      core.position.set(0, -0.15, 0.85);
      core.rotation.z = Math.PI / 4;
      group.add(core);
      if (entity.boss) {
        const bridge = new THREE.Mesh(new THREE.BoxGeometry(8.5, 0.75, 0.55), this.shared.darkMaterial);
        bridge.position.set(0, 0.15, 0.25);
        group.add(bridge);
      }
    }

    const halo = new THREE.Mesh(
      this.shared.haloGeometry,
      friendly
        ? this.shared.friendlyHaloMaterial
        : entity.boss ? this.shared.bossHaloMaterial : this.shared.enemyHaloMaterial,
    );
    halo.position.z = -0.2;
    halo.scale.setScalar(entity.boss ? 2.2 : command ? 1.45 : entity.elite ? 1.32 : 1);
    group.add(halo);

    let shieldRing = null;
    if (friendly) {
      shieldRing = new THREE.Mesh(this.shared.haloGeometry, this.shared.shieldMaterial);
      shieldRing.position.z = 0.15;
      shieldRing.scale.setScalar(command ? 1.75 : 1.28);
      shieldRing.visible = entity.maxShield > 0;
      group.add(shieldRing);
    }

    const healthGroup = new THREE.Group();
    const healthBack = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 0.34), this.shared.healthBackMaterial);
    const healthFill = new THREE.Mesh(
      new THREE.PlaneGeometry(4.2, 0.2),
      friendly ? this.shared.healthMaterial : this.shared.enemyHealthMaterial,
    );
    healthFill.position.z = 0.02;
    healthGroup.add(healthBack, healthFill);
    healthGroup.position.set(0, friendly ? -3.6 : 3.4, 1.4);
    healthGroup.userData.fill = healthFill;
    group.add(healthGroup);

    group.scale.setScalar(scale);
    group.userData.baseScale = scale;
    group.userData.health = healthGroup;
    group.userData.halo = halo;
    group.userData.shieldRing = shieldRing;
    group.userData.entity = entity;
    this.scene.add(group);
    return group;
  }

  sync(snapshot, deltaSeconds) {
    this.clockTime += deltaSeconds;
    this.syncEntities([...snapshot.friendlies, ...snapshot.enemies]);
    this.syncProjectiles(snapshot.projectiles);
    this.updateEffects(deltaSeconds);
    this.updateTargetMarker(deltaSeconds);

    if (this.stars) {
      this.stars.position.y = -((this.clockTime * 0.24) % 16);
      this.stars.material.opacity = 0.65 + Math.sin(this.clockTime * 0.7) * 0.07;
    }
    if (this.defenseLine) {
      this.defenseLine.material.opacity = 0.32 + Math.sin(this.clockTime * 2.3) * 0.1;
    }

    this.shake = Math.max(0, this.shake - deltaSeconds * 2.7);
    const shakeAmount = this.shake * this.shake;
    this.camera.position.x = this.baseCameraPosition.x
      + (this.screenShakeEnabled ? (Math.random() - 0.5) * shakeAmount : 0);
    this.camera.position.y = this.baseCameraPosition.y
      + (this.screenShakeEnabled ? (Math.random() - 0.5) * shakeAmount : 0);
  }

  syncEntities(entities) {
    const activeIds = new Set();
    for (const entity of entities) {
      activeIds.add(entity.id);
      let group = this.entityMeshes.get(entity.id);
      if (!group) {
        group = this.createShipMesh(entity);
        this.entityMeshes.set(entity.id, group);
      }
      group.position.set(entity.x, entity.y, 0);
      const healthRatio = Math.max(0.001, entity.health / entity.maxHealth);
      const healthFill = group.userData.health.userData.fill;
      healthFill.scale.x = healthRatio;
      healthFill.position.x = -2.1 * (1 - healthRatio);
      group.userData.health.visible = healthRatio < 0.995;
      group.userData.halo.rotation.z += 0.012;
      if (entity.boss) {
        const exposed = entity.exposedRemaining > 0;
        group.userData.halo.material.color.setHex(exposed ? COLORS.friendly : COLORS.boss);
        group.userData.halo.material.opacity = exposed ? 0.58 : 0.28 + Math.sin(this.clockTime * 3) * 0.09;
      }
      if (group.userData.shieldRing) {
        const shieldRatio = entity.maxShield > 0 ? entity.shield / entity.maxShield : 0;
        group.userData.shieldRing.visible = shieldRatio > 0;
        group.userData.shieldRing.rotation.z -= 0.018;
        group.userData.shieldRing.scale.setScalar(
          (entity.role === 'command' ? 1.75 : 1.28) * (0.9 + shieldRatio * 0.1),
        );
      }
      const pulse = 1 + Math.sin(this.clockTime * 3 + (entity.slot ?? 0)) * 0.025;
      group.scale.setScalar(group.userData.baseScale * pulse);
    }

    for (const [id, group] of this.entityMeshes) {
      if (activeIds.has(id)) continue;
      this.scene.remove(group);
      this.disposeGroupGeometry(group);
      this.entityMeshes.delete(id);
    }
  }

  syncProjectiles(projectiles) {
    const activeIds = new Set();
    for (const projectile of projectiles) {
      activeIds.add(projectile.id);
      let mesh = this.projectileMeshes.get(projectile.id);
      if (!mesh) {
        mesh = this.projectilePool.acquire();
        mesh.visible = true;
        mesh.material = projectile.faction === 'friendly'
          ? this.shared.projectileFriendly
          : this.shared.projectileEnemy;
        this.projectileMeshes.set(projectile.id, mesh);
      }
      mesh.position.set(projectile.x, projectile.y, 2.2);
      mesh.rotation.z = Math.atan2(projectile.vy, projectile.vx) - Math.PI / 2;
      mesh.scale.setScalar(projectile.faction === 'friendly' ? 1 : 0.85);
    }

    for (const [id, mesh] of this.projectileMeshes) {
      if (activeIds.has(id)) continue;
      this.projectilePool.release(mesh);
      this.projectileMeshes.delete(id);
    }
  }

  handleEvents(events) {
    for (const event of events) {
      if (event.type === 'impact') {
        this.spawnImpact(event.x, event.y, event.faction === 'friendly' ? COLORS.friendly : COLORS.enemy, event.heavy ? 2 : 1);
      } else if (event.type === 'destroyed') {
        this.spawnImpact(event.x, event.y, event.faction === 'friendly' ? COLORS.friendly : COLORS.enemy, 3.2);
        this.shake = Math.max(this.shake, event.role === 'command' ? 3.5 : 1.6);
      } else if (event.type === 'volleyFired') {
        this.showTarget(event.x, event.y, true, event.radius);
        this.spawnVolleyBeams(event);
        this.shake = Math.max(this.shake, 1.7);
      } else if (event.type === 'volleyRejected') {
        this.showTarget(event.x, event.y, false);
      } else if (event.type === 'breach') {
        this.spawnImpact(event.x, event.y, COLORS.enemy, 2.5);
        this.shake = Math.max(this.shake, 2.2);
      } else if (event.type === 'formationChanged') {
        this.spawnFormationTrails(event.paths);
      } else if (event.type === 'shieldImpact') {
        this.spawnImpact(event.x, event.y, 0x72a7ff, 1.35);
      } else if (event.type === 'friendlyJoined') {
        this.spawnImpact(event.x, event.y, COLORS.command, 1.8);
      } else if (event.type === 'areaImpact') {
        this.spawnImpact(event.x, event.y, 0xff8b5f, Math.max(2, event.radius / 4));
        this.shake = Math.max(this.shake, 2.35);
      } else if (event.type === 'bossExposed') {
        this.spawnImpact(event.x, event.y, COLORS.friendly, 3.8);
        this.shake = Math.max(this.shake, 2.7);
      } else if (event.type === 'bossBarrierImpact') {
        this.spawnImpact(event.x, event.y, COLORS.boss, 0.72);
      }
    }
  }

  spawnImpact(x, y, color, intensity = 1) {
    const group = this.effectPool.acquire();
    group.visible = true;
    group.position.set(x, y, 4);
    group.scale.setScalar(0.5 * intensity);
    group.userData.life = 0.42 + intensity * 0.06;
    group.userData.maxLife = group.userData.life;
    group.userData.growth = 8 + intensity * 2;
    for (const material of group.userData.materials) {
      material.color.setHex(color);
      material.opacity = 1;
    }
    this.effects.push({ type: 'impact', object: group });
  }

  spawnVolleyBeams(event) {
    const material = new THREE.LineBasicMaterial({
      color: COLORS.friendlyCore,
      transparent: true,
      opacity: 0.94,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const points = [];
    for (const source of event.sources) {
      points.push(
        new THREE.Vector3(source.x, source.y, 3.5),
        new THREE.Vector3(event.x, event.y, 3.5),
      );
    }
    const beam = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), material);
    this.scene.add(beam);
    this.effects.push({ type: 'beam', object: beam, life: 0.28, maxLife: 0.28 });
  }

  spawnFormationTrails(paths) {
    const material = new THREE.LineDashedMaterial({
      color: COLORS.friendly,
      transparent: true,
      opacity: 0.42,
      dashSize: 1.2,
      gapSize: 0.9,
      depthWrite: false,
    });
    const points = [];
    for (const path of paths) {
      points.push(
        new THREE.Vector3(path.from.x, path.from.y, 1.2),
        new THREE.Vector3(path.to.x, path.to.y, 1.2),
      );
    }
    const trails = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), material);
    trails.computeLineDistances();
    this.scene.add(trails);
    this.effects.push({ type: 'formation', object: trails, life: 0.9, maxLife: 0.9 });
  }

  updateEffects(dt) {
    const remaining = [];
    for (const effect of this.effects) {
      if (effect.type === 'impact') {
        const group = effect.object;
        group.userData.life -= dt;
        const ratio = Math.max(0, group.userData.life / group.userData.maxLife);
        group.scale.addScalar(group.userData.growth * dt);
        for (const material of group.userData.materials) material.opacity = ratio;
        if (group.userData.life <= 0) {
          this.effectPool.release(group);
        } else {
          remaining.push(effect);
        }
      } else {
        effect.life -= dt;
        effect.object.material.opacity = Math.max(0, effect.life / effect.maxLife);
        if (effect.life <= 0) {
          this.scene.remove(effect.object);
          effect.object.geometry.dispose();
          effect.object.material.dispose();
        } else {
          remaining.push(effect);
        }
      }
    }
    this.effects = remaining;
  }

  showTarget(x, y, ready, radius = 15) {
    this.targetMarker.visible = true;
    this.targetMarker.position.set(x, y, 4);
    this.targetMarker.userData.life = ready ? 1.05 : 0.45;
    this.targetMarker.userData.maxLife = this.targetMarker.userData.life;
    this.targetMarker.userData.ready = ready;
    this.targetMarker.scale.setScalar(ready ? 0.55 : 0.85);
    for (const child of this.targetMarker.children) {
      child.material.color.setHex(ready ? COLORS.friendly : COLORS.enemy);
      child.material.opacity = 0.9;
      if (child.userData.isRadiusRing) child.scale.setScalar(radius);
    }
  }

  updateTargetMarker(dt) {
    if (!this.targetMarker.visible) return;
    this.targetMarker.userData.life -= dt;
    const ratio = Math.max(0, this.targetMarker.userData.life / this.targetMarker.userData.maxLife);
    this.targetMarker.rotation.z += dt * (this.targetMarker.userData.ready ? 3.2 : -2.2);
    this.targetMarker.scale.addScalar(dt * (this.targetMarker.userData.ready ? 1.8 : 0.4));
    for (const child of this.targetMarker.children) child.material.opacity = ratio;
    if (this.targetMarker.userData.life <= 0) this.targetMarker.visible = false;
  }

  render() {
    this.camera.lookAt(0, 0, 0);
    this.renderer.render(this.scene, this.camera);
  }

  screenToWorld(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.battlePlane, this.worldPoint);
    if (!hit) return null;
    return { x: this.worldPoint.x, y: this.worldPoint.y };
  }

  resize() {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    const aspect = width / height;
    const baseHeight = 166;
    const baseWidth = 106;
    const viewWidth = Math.max(baseWidth, baseHeight * aspect);
    const viewHeight = Math.max(baseHeight, baseWidth / aspect);
    this.camera.left = -viewWidth / 2;
    this.camera.right = viewWidth / 2;
    this.camera.top = viewHeight / 2;
    this.camera.bottom = -viewHeight / 2;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
  }

  setScreenShakeEnabled(enabled) {
    this.screenShakeEnabled = Boolean(enabled);
    if (!this.screenShakeEnabled) this.shake = 0;
  }

  resetScene() {
    for (const group of this.entityMeshes.values()) {
      this.scene.remove(group);
      this.disposeGroupGeometry(group);
    }
    this.entityMeshes.clear();
    for (const mesh of this.projectileMeshes.values()) this.projectilePool.release(mesh);
    this.projectileMeshes.clear();
    for (const effect of this.effects) {
      if (effect.type === 'impact') {
        this.effectPool.release(effect.object);
      } else {
        this.scene.remove(effect.object);
        effect.object.geometry.dispose();
        effect.object.material.dispose();
      }
    }
    this.effects = [];
    this.shake = 0;
    this.targetMarker.visible = false;
  }

  disposeGroupGeometry(group) {
    group.traverse((child) => {
      if (child.isMesh && ![
        this.shared.haloGeometry,
        this.shared.projectileGeometry,
        this.shared.ringGeometry,
      ].includes(child.geometry)) {
        child.geometry.dispose();
      }
    });
  }
}
