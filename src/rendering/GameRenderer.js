import * as THREE from 'three';
import { ARENA } from '../config/balance.js';
import { RENDER_COLORS, RENDERING } from '../config/rendering.js';
import { ObjectPool } from './ObjectPool.js';

export function formatDamageAmount(amount) {
  return Math.max(1, Math.round(Number(amount) || 0)).toLocaleString('en-US');
}

function makeShape(points) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let index = 1; index < points.length; index += 1) {
    shape.lineTo(points[index][0], points[index][1]);
  }
  shape.closePath();
  return shape;
}

function createHullContour(points, sharedMaterial, { z, scale, renderOrder }) {
  const material = sharedMaterial.clone();
  material.userData.disposeWithShip = true;
  const contour = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(
      points.map(([x, y]) => new THREE.Vector3(x, y, 0)),
    ),
    material,
  );
  contour.position.z = z;
  contour.scale.setScalar(scale);
  contour.renderOrder = renderOrder;
  contour.userData.baseOpacity = material.opacity;
  return contour;
}

function createMaterial(color, options = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: options.emissive ?? color,
    emissiveIntensity: options.emissiveIntensity ?? RENDERING.material.emissiveIntensity,
    metalness: options.metalness ?? RENDERING.material.metalness,
    roughness: options.roughness ?? RENDERING.material.roughness,
    flatShading: options.flatShading ?? false,
    transparent: options.transparent ?? false,
    opacity: options.opacity ?? 1,
    depthWrite: options.depthWrite ?? true,
  });
}

export class GameRenderer {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(RENDER_COLORS.background);
    this.scene.fog = new THREE.FogExp2(RENDER_COLORS.background, RENDERING.scene.fogDensity);

    this.camera = new THREE.OrthographicCamera(
      ...RENDERING.scene.cameraFrustum,
      RENDERING.scene.cameraNear,
      RENDERING.scene.cameraFar,
    );
    this.camera.position.set(...RENDERING.scene.cameraPosition);
    this.camera.lookAt(0, 0, 0);
    this.baseCameraPosition = this.camera.position.clone();

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, RENDERING.scene.maxPixelRatio));
    this.renderer.setSize(container.clientWidth, container.clientHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = RENDERING.scene.toneMappingExposure;
    container.appendChild(this.renderer.domElement);

    this.clockTime = 0;
    this.shake = 0;
    this.screenShakeEnabled = true;
    this.entityMeshes = new Map();
    this.projectileMeshes = new Map();
    this.effects = [];
    this.combatBounds = { ...ARENA, halfWidth: ARENA.maxX };
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.battlePlane = new THREE.Plane(new THREE.Vector3(...RENDERING.scene.battlePlaneNormal), 0);
    this.worldPoint = new THREE.Vector3();

    this.shared = this.createSharedResources();
    this.projectilePool = this.createProjectilePool();
    this.effectPool = this.createEffectPool();
    this.gunPulsePool = this.createGunPulsePool();
    this.damageNumberPool = this.createDamageNumberPool();
    this.createEnvironment();
    this.createTargetMarker();
    this.resize();
  }

  createSharedResources() {
    const hullOptions = {
      emissiveIntensity: RENDERING.material.hullEmissiveIntensity,
      metalness: RENDERING.material.hullMetalness,
      roughness: RENDERING.material.hullRoughness,
      flatShading: true,
    };
    const armorOptions = {
      emissiveIntensity: RENDERING.material.armorEmissiveIntensity,
      metalness: RENDERING.material.armorMetalness,
      roughness: RENDERING.material.armorRoughness,
      flatShading: true,
    };
    const glowMaterial = (color) => new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: RENDERING.material.engineGlowOpacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const contourMaterial = (color, opacity) => new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return {
      friendlyMaterial: createMaterial(RENDER_COLORS.friendlyHull, {
        ...hullOptions,
        emissive: RENDER_COLORS.friendly,
        emissiveIntensity: RENDERING.material.friendlyHullEmissiveIntensity,
      }),
      friendlyArmorMaterial: createMaterial(RENDER_COLORS.friendlyArmor, armorOptions),
      friendlyCoreMaterial: new THREE.MeshBasicMaterial({ color: RENDER_COLORS.friendlyCore }),
      friendlyAccentMaterial: new THREE.MeshBasicMaterial({ color: RENDER_COLORS.friendly }),
      commandMaterial: createMaterial(RENDER_COLORS.commandHull, {
        ...hullOptions,
        emissive: RENDER_COLORS.command,
        emissiveIntensity: RENDERING.material.commandHullEmissiveIntensity,
      }),
      commandArmorMaterial: createMaterial(RENDER_COLORS.commandArmor, armorOptions),
      commandAccentMaterial: new THREE.MeshBasicMaterial({ color: RENDER_COLORS.command }),
      enemyMaterial: createMaterial(RENDER_COLORS.enemyHull, {
        ...hullOptions,
        emissive: RENDER_COLORS.enemy,
        emissiveIntensity: RENDERING.material.enemyHullEmissiveIntensity,
      }),
      enemyArmorMaterial: createMaterial(RENDER_COLORS.enemyArmor, armorOptions),
      eliteMaterial: createMaterial(RENDER_COLORS.eliteHull, {
        ...hullOptions,
        emissive: RENDER_COLORS.elite,
        emissiveIntensity: RENDERING.material.eliteHullEmissiveIntensity,
      }),
      eliteArmorMaterial: createMaterial(RENDER_COLORS.eliteArmor, armorOptions),
      eliteAccentMaterial: new THREE.MeshBasicMaterial({ color: RENDER_COLORS.elite }),
      bossMaterial: createMaterial(RENDER_COLORS.bossHull, {
        ...hullOptions,
        emissive: RENDER_COLORS.boss,
        emissiveIntensity: RENDERING.material.bossHullEmissiveIntensity,
      }),
      bossArmorMaterial: createMaterial(RENDER_COLORS.bossArmor, armorOptions),
      bossAccentMaterial: new THREE.MeshBasicMaterial({ color: RENDER_COLORS.boss }),
      enemyCoreMaterial: new THREE.MeshBasicMaterial({ color: RENDER_COLORS.enemyCore }),
      canopyMaterial: createMaterial(RENDER_COLORS.canopy, {
        emissive: RENDER_COLORS.friendlyCore,
        emissiveIntensity: RENDERING.material.canopyEmissiveIntensity,
        metalness: RENDERING.material.canopyMetalness,
        roughness: RENDERING.material.canopyRoughness,
      }),
      enemyCanopyMaterial: createMaterial(RENDER_COLORS.enemyCanopy, {
        emissive: RENDER_COLORS.enemyCore,
        emissiveIntensity: RENDERING.material.canopyEmissiveIntensity,
        metalness: RENDERING.material.canopyMetalness,
        roughness: RENDERING.material.canopyRoughness,
      }),
      engineFriendlyMaterial: glowMaterial(RENDER_COLORS.engineFriendly),
      engineCommandMaterial: glowMaterial(RENDER_COLORS.engineCommand),
      engineEnemyMaterial: glowMaterial(RENDER_COLORS.engineEnemy),
      engineEliteMaterial: glowMaterial(RENDER_COLORS.engineElite),
      engineBossMaterial: glowMaterial(RENDER_COLORS.engineBoss),
      enemyContourMaterial: contourMaterial(
        RENDER_COLORS.enemy,
        RENDERING.material.enemyContourOpacity,
      ),
      eliteContourMaterial: contourMaterial(
        RENDER_COLORS.elite,
        RENDERING.material.eliteContourOpacity,
      ),
      bossContourMaterial: contourMaterial(
        RENDER_COLORS.boss,
        RENDERING.material.bossContourOpacity,
      ),
      shieldMaterial: contourMaterial(RENDER_COLORS.shield, RENDERING.material.shieldOpacity),
      darkMaterial: createMaterial(RENDER_COLORS.darkHull, { emissiveIntensity: RENDERING.material.darkEmissiveIntensity }),
      healthMaterial: new THREE.MeshBasicMaterial({ color: RENDER_COLORS.friendly }),
      enemyHealthMaterial: new THREE.MeshBasicMaterial({ color: RENDER_COLORS.enemy }),
      healthBackMaterial: new THREE.MeshBasicMaterial({
        color: RENDER_COLORS.healthBack,
        transparent: true,
        opacity: RENDERING.material.healthBackOpacity,
      }),
      projectileFriendly: new THREE.MeshBasicMaterial({ color: RENDER_COLORS.friendlyCore }),
      projectileEnemy: new THREE.MeshBasicMaterial({ color: RENDER_COLORS.enemyCore }),
      projectileGeometry: new THREE.CapsuleGeometry(...RENDERING.geometry.projectile),
      ringGeometry: new THREE.RingGeometry(...RENDERING.geometry.impactRing),
      chargeNodeGeometry: new THREE.CircleGeometry(...RENDERING.geometry.chargeNode),
      canopyGeometry: new THREE.SphereGeometry(
        RENDERING.ships.canopyRadius,
        ...RENDERING.ships.canopySegments,
      ),
      enginePodGeometry: new THREE.CapsuleGeometry(...RENDERING.ships.enginePod),
      engineGlowGeometry: new THREE.CircleGeometry(...RENDERING.ships.engineGlow),
      navLightGeometry: new THREE.CircleGeometry(...RENDERING.ships.navLight),
      pulsePlaneGeometry: new THREE.PlaneGeometry(1, 1),
    };
  }

  createEnvironment() {
    const ambient = new THREE.AmbientLight(RENDER_COLORS.ambientLight, RENDERING.environment.ambientLightIntensity);
    const key = new THREE.DirectionalLight(RENDER_COLORS.keyLight, RENDERING.environment.keyLightIntensity);
    key.position.set(...RENDERING.environment.keyLightPosition);
    const rim = new THREE.DirectionalLight(RENDER_COLORS.rimLight, RENDERING.environment.rimLightIntensity);
    rim.position.set(...RENDERING.environment.rimLightPosition);
    this.scene.add(ambient, key, rim);

    const grid = new THREE.GridHelper(
      RENDERING.environment.gridSize,
      RENDERING.environment.gridDivisions,
      RENDER_COLORS.grid,
      RENDER_COLORS.grid,
    );
    grid.rotation.x = Math.PI / 2;
    grid.position.set(0, 0, RENDERING.environment.gridZ);
    grid.material.transparent = true;
    grid.material.opacity = RENDERING.environment.gridOpacity;
    this.scene.add(grid);

    const lineGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(ARENA.minX, ARENA.defenseLineY, RENDERING.environment.defenseLineZ),
      new THREE.Vector3(ARENA.maxX, ARENA.defenseLineY, RENDERING.environment.defenseLineZ),
    ]);
    this.defenseLine = new THREE.Line(
      lineGeometry,
      new THREE.LineBasicMaterial({
        color: RENDER_COLORS.friendly,
        transparent: true,
        opacity: RENDERING.environment.defenseLineOpacity,
      }),
    );
    this.scene.add(this.defenseLine);

    const starCount = RENDERING.environment.stars.count;
    const positions = new Float32Array(starCount * 3);
    const sizes = new Float32Array(starCount);
    let seed = RENDERING.environment.stars.seed;
    const random = () => {
      seed = (seed * RENDERING.environment.stars.multiplier) % RENDERING.environment.stars.modulus;
      return (seed - 1) / RENDERING.environment.stars.normalizer;
    };
    for (let index = 0; index < starCount; index += 1) {
      positions[index * 3] = (random() - 0.5) * RENDERING.environment.stars.width;
      positions[index * 3 + 1] = (random() - 0.5) * RENDERING.environment.stars.height;
      positions[index * 3 + 2] = RENDERING.environment.stars.frontZ - random() * RENDERING.environment.stars.depth;
      sizes[index] = RENDERING.environment.stars.minimumPointSize + random();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    this.stars = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color: RENDER_COLORS.stars,
        size: RENDERING.environment.stars.materialSize,
        transparent: true,
        opacity: RENDERING.environment.stars.opacity,
        sizeAttenuation: true,
      }),
    );
    this.scene.add(this.stars);

    const haze = new THREE.Mesh(
      new THREE.PlaneGeometry(...RENDERING.environment.hazeSize),
      new THREE.MeshBasicMaterial({
        color: RENDER_COLORS.haze,
        transparent: true,
        opacity: RENDERING.environment.hazeOpacity,
        depthWrite: false,
      }),
    );
    haze.position.set(...RENDERING.environment.hazePosition);
    haze.rotation.z = RENDERING.environment.hazeRotation;
    this.scene.add(haze);
  }

  createTargetMarker() {
    this.targetMarker = new THREE.Group();
    const material = new THREE.MeshBasicMaterial({
      color: RENDER_COLORS.friendly,
      transparent: true,
      opacity: RENDERING.targetMarker.opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const outer = new THREE.Mesh(
      new THREE.RingGeometry(
        ...RENDERING.targetMarker.outerRing,
        1,
        0,
        Math.PI * RENDERING.targetMarker.outerArcRatio,
      ),
      material,
    );
    const inner = new THREE.Mesh(
      new THREE.RingGeometry(...RENDERING.targetMarker.innerRing),
      material.clone(),
    );
    const { crossOuter, crossInner } = RENDERING.targetMarker;
    const crossGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-crossOuter, 0, 0), new THREE.Vector3(-crossInner, 0, 0),
      new THREE.Vector3(crossOuter, 0, 0), new THREE.Vector3(crossInner, 0, 0),
      new THREE.Vector3(0, -crossOuter, 0), new THREE.Vector3(0, -crossInner, 0),
      new THREE.Vector3(0, crossOuter, 0), new THREE.Vector3(0, crossInner, 0),
    ]);
    const cross = new THREE.LineSegments(crossGeometry, material.clone());
    this.targetMarker.add(outer, inner, cross);
    outer.userData.isRadiusRing = true;
    this.targetMarker.position.z = RENDERING.targetMarker.z;
    this.targetMarker.visible = false;
    this.targetMarker.userData.life = 0;
    this.scene.add(this.targetMarker);
  }

  createProjectilePool() {
    return new ObjectPool({
      initialSize: RENDERING.pools.projectiles,
      create: () => {
        const mesh = new THREE.Mesh(this.shared.projectileGeometry, this.shared.projectileFriendly);
        mesh.visible = false;
        mesh.renderOrder = RENDERING.layers.projectileRenderOrder;
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
      initialSize: RENDERING.pools.impacts,
      create: () => {
        const group = new THREE.Group();
        const material = new THREE.MeshBasicMaterial({
          color: RENDER_COLORS.friendly,
          transparent: true,
          opacity: 1,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const ring = new THREE.Mesh(this.shared.ringGeometry, material);
        const core = new THREE.Mesh(new THREE.CircleGeometry(...RENDERING.geometry.impactCore), material.clone());
        group.add(ring, core);
        group.visible = false;
        group.position.z = RENDERING.layers.effectZ;
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

  createGunPulsePool() {
    return new ObjectPool({
      initialSize: RENDERING.pools.gunPulses,
      create: () => {
        const group = new THREE.Group();
        const materials = RENDER_COLORS.gunPulse.map((color, index) => new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: RENDERING.gunPulse.initialMaterialOpacities[index],
          blending: THREE.AdditiveBlending,
          depthTest: false,
          depthWrite: false,
          side: THREE.DoubleSide,
        }));
        const wake = new THREE.Mesh(this.shared.pulsePlaneGeometry, materials[0]);
        const tracer = new THREE.Mesh(this.shared.pulsePlaneGeometry, materials[1]);
        const packet = new THREE.Mesh(this.shared.pulsePlaneGeometry, materials[2]);
        for (const visual of [wake, tracer, packet]) {
          visual.frustumCulled = false;
          visual.renderOrder = RENDERING.layers.gunPulseRenderOrder;
        }
        group.add(wake, tracer, packet);
        group.userData = { materials, wake, tracer, packet, length: 1 };
        group.visible = false;
        this.scene.add(group);
        return group;
      },
      reset: (group) => {
        group.visible = false;
        group.scale.set(1, 1, 1);
        group.userData.packet.position.set(0, 0, 0);
      },
    });
  }

  createDamageNumberPool() {
    return new ObjectPool({
      initialSize: RENDERING.pools.damageNumbers,
      create: () => {
        const canvas = document.createElement('canvas');
        canvas.width = RENDERING.damageNumber.canvasWidth;
        canvas.height = RENDERING.damageNumber.canvasHeight;
        const context = canvas.getContext('2d');
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearFilter;
        const material = new THREE.SpriteMaterial({
          map: texture,
          transparent: true,
          opacity: 1,
          depthTest: false,
          depthWrite: false,
        });
        const sprite = new THREE.Sprite(material);
        sprite.visible = false;
        sprite.renderOrder = RENDERING.layers.damageNumberRenderOrder;
        sprite.userData = { canvas, context, texture };
        this.scene.add(sprite);
        return sprite;
      },
      reset: (sprite) => {
        sprite.visible = false;
        sprite.material.opacity = 1;
        sprite.scale.set(1, 1, 1);
      },
    });
  }

  createShipMesh(entity) {
    const group = new THREE.Group();
    const friendly = entity.faction === 'friendly';
    const command = entity.role === 'command';
    const scale = (command ? RENDERING.ships.commandScale : 1) * (entity.scale ?? 1);

    const profileId = entity.boss ? 'boss' : friendly ? entity.role : entity.type;
    const profile = RENDERING.ships.profiles[profileId]
      ?? RENDERING.ships.profiles[friendly ? 'escort' : 'raider'];
    const shapePoints = RENDERING.ships.shapes[profileId]
      ?? RENDERING.ships.shapes[friendly ? 'escort' : 'raider'];
    const hullExtrusion = friendly
      ? RENDERING.ships.friendlyHullExtrusion
      : RENDERING.ships.enemyHullExtrusion;
    const palette = command
      ? {
          hull: this.shared.commandMaterial,
          armor: this.shared.commandArmorMaterial,
          accent: this.shared.commandAccentMaterial,
          canopy: this.shared.canopyMaterial,
          engine: this.shared.engineCommandMaterial,
        }
      : friendly
        ? {
            hull: this.shared.friendlyMaterial,
            armor: this.shared.friendlyArmorMaterial,
            accent: this.shared.friendlyAccentMaterial,
            canopy: this.shared.canopyMaterial,
            engine: this.shared.engineFriendlyMaterial,
          }
        : entity.boss
          ? {
              hull: this.shared.bossMaterial,
              armor: this.shared.bossArmorMaterial,
              accent: this.shared.bossAccentMaterial,
              canopy: this.shared.enemyCanopyMaterial,
              engine: this.shared.engineBossMaterial,
            }
          : entity.elite
            ? {
                hull: this.shared.eliteMaterial,
                armor: this.shared.eliteArmorMaterial,
                accent: this.shared.eliteAccentMaterial,
                canopy: this.shared.enemyCanopyMaterial,
                engine: this.shared.engineEliteMaterial,
              }
            : {
                hull: this.shared.enemyMaterial,
                armor: this.shared.enemyArmorMaterial,
                accent: this.shared.enemyCoreMaterial,
                canopy: this.shared.enemyCanopyMaterial,
                engine: this.shared.engineEnemyMaterial,
              };

    const hull = new THREE.Mesh(
      new THREE.ExtrudeGeometry(
        makeShape(shapePoints),
        { ...hullExtrusion, bevelEnabled: true },
      ),
      palette.hull,
    );
    hull.position.z = RENDERING.ships.hullZ;
    group.add(hull);

    const dorsalArmor = new THREE.Mesh(
      new THREE.ExtrudeGeometry(
        makeShape(shapePoints),
        { ...RENDERING.ships.armorExtrusion, bevelEnabled: true },
      ),
      palette.armor,
    );
    dorsalArmor.scale.set(...profile.armorScale);
    dorsalArmor.position.set(0, profile.armorY, RENDERING.ships.armorZ);
    group.add(dorsalArmor);

    for (const side of [-1, 1]) {
      const sideArmor = new THREE.Mesh(
        new THREE.BoxGeometry(...RENDERING.ships.sideArmorSize),
        palette.armor,
      );
      sideArmor.scale.y = profile.sideArmorLength;
      sideArmor.position.set(
        side * profile.sideArmorX,
        profile.sideArmorY,
        RENDERING.ships.sideArmorZ,
      );
      sideArmor.rotation.z = side * profile.sideArmorAngle;
      group.add(sideArmor);
    }

    const keel = new THREE.Mesh(
      new THREE.BoxGeometry(...RENDERING.ships.keelSize),
      palette.accent,
    );
    keel.scale.y = profile.keelLength;
    keel.position.set(0, profile.keelY, RENDERING.ships.keelZ);
    group.add(keel);

    const canopy = new THREE.Mesh(this.shared.canopyGeometry, palette.canopy);
    canopy.scale.set(...profile.cockpitScale);
    canopy.position.set(0, profile.cockpitY, RENDERING.ships.canopyZ);
    group.add(canopy);

    const engineGlows = [];
    for (const engineX of profile.engineX) {
      const enginePod = new THREE.Mesh(this.shared.enginePodGeometry, this.shared.darkMaterial);
      enginePod.position.set(engineX, profile.engineY, RENDERING.ships.enginePodZ);
      group.add(enginePod);

      const engineGlow = new THREE.Mesh(this.shared.engineGlowGeometry, palette.engine);
      engineGlow.scale.set(...RENDERING.ships.engineGlowScale);
      engineGlow.position.set(engineX, profile.engineGlowY, RENDERING.ships.engineGlowZ);
      engineGlow.userData.baseScale = [...RENDERING.ships.engineGlowScale];
      engineGlows.push(engineGlow);
      group.add(engineGlow);
    }

    for (const side of [-1, 1]) {
      const navLight = new THREE.Mesh(this.shared.navLightGeometry, palette.accent);
      navLight.position.set(
        side * profile.sideArmorX * RENDERING.ships.navLightXScale,
        RENDERING.ships.navLightY,
        RENDERING.ships.navLightZ,
      );
      group.add(navLight);
    }

    let turret = null;
    if (command) {
      turret = new THREE.Group();
      const turretBase = new THREE.Mesh(
        new THREE.CylinderGeometry(
          RENDERING.ships.turret.baseRadius,
          RENDERING.ships.turret.baseRadius,
          RENDERING.ships.turret.baseHeight,
          RENDERING.ships.turret.baseSegments,
        ),
        palette.armor,
      );
      turretBase.rotation.x = Math.PI / 2;
      turretBase.position.z = RENDERING.ships.turret.baseZ;
      const barrels = [-1, 1].map((side) => {
        const barrel = new THREE.Group();
        const housing = new THREE.Mesh(
          new THREE.BoxGeometry(...RENDERING.ships.turret.barrelSize),
          this.shared.darkMaterial,
        );
        const muzzle = new THREE.Mesh(
          new THREE.BoxGeometry(...RENDERING.ships.turret.muzzleSize),
          this.shared.commandAccentMaterial,
        );
        muzzle.position.y = RENDERING.ships.turret.muzzleY;
        barrel.position.set(
          side * RENDERING.ships.turret.barrelX,
          RENDERING.ships.turret.barrelY,
          RENDERING.ships.turret.barrelZ,
        );
        barrel.add(housing, muzzle);
        return barrel;
      });
      turret.add(turretBase, ...barrels);
      turret.userData.barrels = barrels;
      turret.userData.recoil = 0;
      group.add(turret);
    }

    if (entity.boss) {
      const bridge = new THREE.Mesh(
        new THREE.BoxGeometry(...RENDERING.ships.bossBridgeSize),
        palette.armor,
      );
      bridge.position.set(...RENDERING.ships.bossBridgePosition);
      group.add(bridge);
    }

    const contourMaterial = friendly
      ? this.shared.shieldMaterial
      : entity.boss
        ? this.shared.bossContourMaterial
        : entity.elite ? this.shared.eliteContourMaterial : this.shared.enemyContourMaterial;
    const contourConfig = friendly
      ? RENDERING.ships.shieldOutline
      : RENDERING.ships.hostileOutline;
    const hullContour = createHullContour(shapePoints, contourMaterial, contourConfig);
    hullContour.visible = friendly ? entity.maxShield > 0 : true;
    group.add(hullContour);

    let healthGroup = null;
    let chargeGroup = null;
    if (command) {
      chargeGroup = new THREE.Group();
      const nodeCount = RENDERING.ships.chargeNodeCount;
      for (let index = 0; index < nodeCount; index += 1) {
        const angle = (index / nodeCount) * Math.PI * 2 + Math.PI / 2;
        const material = new THREE.MeshBasicMaterial({
          color: RENDER_COLORS.friendly,
          transparent: true,
          opacity: RENDERING.ships.chargeNodeOpacity,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        material.userData.disposeWithShip = true;
        const node = new THREE.Mesh(this.shared.chargeNodeGeometry, material);
        node.position.set(
          Math.cos(angle) * RENDERING.ships.chargeNodeRadius,
          Math.sin(angle) * RENDERING.ships.chargeNodeRadius,
          RENDERING.ships.chargeNodeZ,
        );
        chargeGroup.add(node);
      }
      group.add(chargeGroup);
    } else {
      healthGroup = new THREE.Group();
      const healthBack = new THREE.Mesh(
        new THREE.PlaneGeometry(...RENDERING.ships.healthBackSize),
        this.shared.healthBackMaterial,
      );
      const healthFill = new THREE.Mesh(
        new THREE.PlaneGeometry(...RENDERING.ships.healthFillSize),
        friendly ? this.shared.healthMaterial : this.shared.enemyHealthMaterial,
      );
      healthFill.position.z = RENDERING.ships.healthFillZ;
      healthGroup.add(healthBack, healthFill);
      healthGroup.position.set(
        0,
        friendly ? RENDERING.ships.healthY.friendly : RENDERING.ships.healthY.enemy,
        RENDERING.ships.healthZ,
      );
      healthGroup.userData.fill = healthFill;
      group.add(healthGroup);
    }

    group.scale.setScalar(scale);
    group.userData.baseScale = scale;
    group.userData.health = healthGroup;
    group.userData.chargeGroup = chargeGroup;
    group.userData.hullContour = hullContour;
    group.userData.turret = turret;
    group.userData.engineGlows = engineGlows;
    group.userData.entity = entity;
    this.scene.add(group);
    return group;
  }

  sync(snapshot, deltaSeconds) {
    this.clockTime += deltaSeconds;
    this.syncEntities([...snapshot.friendlies, ...snapshot.enemies], snapshot.flagshipGun, deltaSeconds);
    this.syncProjectiles(snapshot.projectiles);
    this.updateEffects(deltaSeconds);
    this.updateTargetMarker(deltaSeconds);

    if (this.stars) {
      this.stars.position.y = -((this.clockTime * RENDERING.animation.starScrollSpeed)
        % RENDERING.animation.starScrollSpan);
      this.stars.material.opacity = RENDERING.animation.starBaseOpacity
        + Math.sin(this.clockTime * RENDERING.animation.starPulseSpeed)
        * RENDERING.animation.starPulseOpacity;
    }
    if (this.defenseLine) {
      this.defenseLine.material.opacity = RENDERING.animation.defenseLineBaseOpacity
        + Math.sin(this.clockTime * RENDERING.animation.defenseLinePulseSpeed)
        * RENDERING.animation.defenseLinePulseOpacity;
    }

    this.shake = Math.max(0, this.shake - deltaSeconds * RENDERING.animation.shakeDecay);
    const shakeAmount = this.shake * this.shake;
    this.camera.position.x = this.baseCameraPosition.x
      + (this.screenShakeEnabled ? (Math.random() - 0.5) * shakeAmount : 0);
    this.camera.position.y = this.baseCameraPosition.y
      + (this.screenShakeEnabled ? (Math.random() - 0.5) * shakeAmount : 0);
  }

  syncEntities(entities, flagshipGun = {}, deltaSeconds = 0) {
    const energyRatio = flagshipGun.energyRatio ?? 0;
    const activeIds = new Set();
    for (const entity of entities) {
      activeIds.add(entity.id);
      let group = this.entityMeshes.get(entity.id);
      if (!group) {
        group = this.createShipMesh(entity);
        this.entityMeshes.set(entity.id, group);
      }
      group.position.set(entity.x, entity.y, 0);
      const healthRatio = Math.max(RENDERING.ships.minimumHealthRatio, entity.health / entity.maxHealth);
      if (group.userData.health) {
        const healthFill = group.userData.health.userData.fill;
        healthFill.scale.x = healthRatio;
        healthFill.position.x = -RENDERING.ships.healthFillHalfWidth * (1 - healthRatio);
        group.userData.health.visible = healthRatio < RENDERING.ships.healthVisibilityThreshold;
      }
      if (group.userData.chargeGroup) {
        const litNodes = Math.round(Math.max(0, Math.min(1, energyRatio)) * group.userData.chargeGroup.children.length);
        group.userData.chargeGroup.children.forEach((node, index) => {
          const charged = index < litNodes;
          node.material.color.setHex(flagshipGun.firing ? RENDER_COLORS.command : RENDER_COLORS.friendly);
          node.material.opacity = charged
            ? RENDERING.entityAnimation.chargedNodeOpacity
            : RENDERING.entityAnimation.emptyNodeOpacity;
          node.scale.setScalar(
            charged
              ? RENDERING.entityAnimation.chargedNodeScale
              : RENDERING.entityAnimation.emptyNodeScale,
          );
        });
        group.userData.chargeGroup.rotation.z -= flagshipGun.firing
          ? RENDERING.entityAnimation.firingChargeRotation
          : RENDERING.entityAnimation.idleChargeRotation
            + energyRatio * RENDERING.entityAnimation.energyChargeRotation;
        this.shared.commandMaterial.emissiveIntensity = RENDERING.entityAnimation.commandEmissiveBase
          + energyRatio * RENDERING.entityAnimation.commandEmissiveEnergy
          + (flagshipGun.firing ? RENDERING.entityAnimation.commandEmissiveFiring : 0);
      }
      if (group.userData.turret) {
        const aim = flagshipGun.aim ?? { x: entity.x, y: entity.y + 1 };
        group.userData.turret.rotation.z = Math.atan2(aim.y - entity.y, aim.x - entity.x) - Math.PI / 2;
        group.userData.turret.userData.recoil = Math.max(
          0,
          group.userData.turret.userData.recoil
            - deltaSeconds * RENDERING.ships.turret.recoilRecovery,
        );
        const recoil = group.userData.turret.userData.recoil;
        group.userData.turret.userData.barrels.forEach((barrel, index) => {
          const activeBarrel = (flagshipGun.pulseIndex ?? 0) % 2 === index;
          barrel.position.y = RENDERING.ships.turret.barrelY
            - (activeBarrel ? recoil * RENDERING.ships.turret.recoilDistance : 0);
        });
      }
      if (entity.boss) {
        const exposed = entity.exposedRemaining > 0;
        group.userData.hullContour.material.color.setHex(
          exposed ? RENDER_COLORS.friendly : RENDER_COLORS.boss,
        );
        group.userData.hullContour.material.opacity = exposed
          ? RENDERING.entityAnimation.bossExposedOpacity
          : RENDERING.entityAnimation.bossBaseOpacity
            + Math.sin(this.clockTime * RENDERING.entityAnimation.bossPulseSpeed)
            * RENDERING.entityAnimation.bossPulseOpacity;
      }
      if (entity.faction === 'friendly') {
        const shieldRatio = entity.maxShield > 0
          ? Math.max(0, Math.min(1, entity.shield / entity.maxShield))
          : 0;
        const shieldPulse = Math.sin(
          this.clockTime * RENDERING.entityAnimation.shieldPulseSpeed + (entity.slot ?? 0),
        ) * RENDERING.entityAnimation.shieldPulseScale * shieldRatio;
        group.userData.hullContour.visible = shieldRatio > 0;
        group.userData.hullContour.scale.setScalar(
          RENDERING.ships.shieldOutline.scale
          * (RENDERING.entityAnimation.shieldMinimumScale
            + shieldRatio * RENDERING.entityAnimation.shieldEnergyScale
            + shieldPulse),
        );
        group.userData.hullContour.material.opacity
          = group.userData.hullContour.userData.baseOpacity
          * (RENDERING.entityAnimation.shieldMinimumOpacity
            + shieldRatio * RENDERING.entityAnimation.shieldEnergyOpacity);
      }
      group.userData.engineGlows.forEach((engineGlow, index) => {
        const enginePulse = 1 + Math.sin(
          this.clockTime * RENDERING.entityAnimation.enginePulseSpeed
            + index * RENDERING.entityAnimation.enginePulsePhase
            + (entity.slot ?? 0),
        ) * RENDERING.entityAnimation.enginePulseAmount;
        const [baseX, baseY, baseZ] = engineGlow.userData.baseScale;
        engineGlow.scale.set(
          baseX * enginePulse,
          baseY * (enginePulse + RENDERING.entityAnimation.enginePulseElongation),
          baseZ,
        );
      });
      const readyPulse = entity.role === 'command'
        && energyRatio >= RENDERING.entityAnimation.readyEnergyThreshold
        ? Math.sin(this.clockTime * RENDERING.entityAnimation.readyPulseSpeed)
          * RENDERING.entityAnimation.readyPulseScale
        : 0;
      const pulse = 1
        + Math.sin(this.clockTime * RENDERING.entityAnimation.idlePulseSpeed + (entity.slot ?? 0))
        * RENDERING.entityAnimation.idlePulseScale
        + readyPulse;
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
      mesh.position.set(projectile.x, projectile.y, RENDERING.layers.projectileZ);
      mesh.rotation.z = Math.atan2(projectile.vy, projectile.vx) - Math.PI / 2;
      mesh.scale.setScalar(
        projectile.faction === 'friendly' ? 1 : RENDERING.projectile.enemyScale,
      );
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
        this.spawnImpact(
          event.x,
          event.y,
          event.faction === 'friendly' ? RENDER_COLORS.friendly : RENDER_COLORS.enemy,
          event.heavy ? RENDERING.eventEffects.impactHeavy : RENDERING.eventEffects.impactNormal,
        );
      } else if (event.type === 'destroyed') {
        this.spawnImpact(
          event.x,
          event.y,
          event.faction === 'friendly' ? RENDER_COLORS.friendly : RENDER_COLORS.enemy,
          RENDERING.eventEffects.destroyedImpact,
        );
        this.shake = Math.max(
          this.shake,
          event.role === 'command'
            ? RENDERING.eventEffects.commandDestroyedShake
            : RENDERING.eventEffects.destroyedShake,
        );
      } else if (event.type === 'flagshipGunStarted') {
        this.showTarget(event.x, event.y, true, RENDERING.eventEffects.gunStartedTargetRadius);
        this.shake = Math.max(this.shake, RENDERING.eventEffects.gunStartedShake);
      } else if (event.type === 'flagshipGunPulse') {
        this.spawnFlagshipGunPulse(event);
        this.showTarget(event.aim.x, event.aim.y, true, RENDERING.eventEffects.gunPulseTargetRadius);
        this.shake = Math.max(
          this.shake,
          event.critical
            ? RENDERING.eventEffects.gunCriticalShake
            : event.hitId ? RENDERING.eventEffects.gunHitShake : RENDERING.eventEffects.gunMissShake,
        );
      } else if (event.type === 'damaged') {
        this.spawnDamageNumber(event);
      } else if (event.type === 'flagshipGunAimChanged' && Number.isFinite(event.x)) {
        this.showTarget(event.x, event.y, true, RENDERING.eventEffects.aimTargetRadius);
      } else if (event.type === 'flagshipGunRejected') {
        this.showTarget(event.x, event.y, false);
      } else if (event.type === 'flagshipGunReady') {
        this.spawnImpact(event.x, event.y, RENDER_COLORS.command, RENDERING.eventEffects.gunReadyImpact);
      } else if (event.type === 'breach') {
        this.spawnImpact(event.x, event.y, RENDER_COLORS.enemy, RENDERING.eventEffects.breachImpact);
        this.shake = Math.max(this.shake, RENDERING.eventEffects.breachShake);
      } else if (event.type === 'formationChanged') {
        this.spawnFormationTrails(event.paths);
      } else if (event.type === 'shieldImpact') {
        this.spawnImpact(event.x, event.y, RENDER_COLORS.shield, RENDERING.eventEffects.shieldImpact);
        this.spawnDamageNumber({ ...event, amount: event.absorbed, faction: 'friendly', shield: true });
      } else if (event.type === 'friendlyJoined') {
        this.spawnImpact(event.x, event.y, RENDER_COLORS.command, RENDERING.eventEffects.friendlyJoinedImpact);
      } else if (event.type === 'areaImpact') {
        this.spawnImpact(
          event.x,
          event.y,
          RENDER_COLORS.areaImpact,
          Math.max(
            RENDERING.eventEffects.minimumAreaImpact,
            event.radius / RENDERING.eventEffects.areaImpactRadiusDivisor,
          ),
        );
        this.shake = Math.max(this.shake, RENDERING.eventEffects.areaImpactShake);
      } else if (event.type === 'bossExposed') {
        this.spawnImpact(event.x, event.y, RENDER_COLORS.friendly, RENDERING.eventEffects.bossExposedImpact);
        this.shake = Math.max(this.shake, RENDERING.eventEffects.bossExposedShake);
      } else if (event.type === 'bossBarrierImpact') {
        this.spawnImpact(event.x, event.y, RENDER_COLORS.boss, RENDERING.eventEffects.bossBarrierImpact);
      }
    }
  }

  spawnImpact(x, y, color, intensity = 1) {
    const group = this.effectPool.acquire();
    group.visible = true;
    group.position.set(x, y, RENDERING.impact.z);
    group.scale.setScalar(RENDERING.impact.initialScale * intensity);
    group.userData.life = RENDERING.impact.baseLife + intensity * RENDERING.impact.lifePerIntensity;
    group.userData.maxLife = group.userData.life;
    group.userData.growth = RENDERING.impact.baseGrowth
      + intensity * RENDERING.impact.growthPerIntensity;
    for (const material of group.userData.materials) {
      material.color.setHex(color);
      material.opacity = 1;
    }
    this.effects.push({ type: 'impact', object: group });
  }

  spawnDamageNumber({ x, y, amount, faction, critical = false, shield = false }) {
    if (!Number.isFinite(amount) || amount <= 0) return;
    const sprite = this.damageNumberPool.acquire();
    const { canvas, context, texture } = sprite.userData;
    const label = formatDamageAmount(amount);
    const fillColor = critical
      ? RENDER_COLORS.damageText.critical
      : shield
        ? RENDER_COLORS.damageText.shield
        : faction === 'enemy' ? RENDER_COLORS.damageText.enemy : RENDER_COLORS.damageText.friendly;
    const strokeColor = critical
      ? RENDER_COLORS.damageText.criticalStroke
      : RENDER_COLORS.damageText.stroke;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.save();
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = `${critical
      ? RENDERING.damageNumber.criticalFontWeight
      : RENDERING.damageNumber.fontWeight} ${critical
      ? RENDERING.damageNumber.criticalFontSize
      : RENDERING.damageNumber.fontSize}px ${RENDERING.damageNumber.fontFamily}`;
    context.lineJoin = 'round';
    context.lineWidth = critical
      ? RENDERING.damageNumber.criticalLineWidth
      : RENDERING.damageNumber.lineWidth;
    context.strokeStyle = strokeColor;
    context.fillStyle = fillColor;
    context.shadowColor = fillColor;
    context.shadowBlur = critical
      ? RENDERING.damageNumber.criticalShadowBlur
      : RENDERING.damageNumber.shadowBlur;
    context.strokeText(label, canvas.width / 2, canvas.height / 2);
    context.fillText(label, canvas.width / 2, canvas.height / 2);
    context.restore();
    texture.needsUpdate = true;

    this.damageNumberSequence = (this.damageNumberSequence ?? 0) + 1;
    const lane = RENDERING.damageNumber.laneOffsets[
      this.damageNumberSequence % RENDERING.damageNumber.laneOffsets.length
    ];
    const baseWidth = critical
      ? RENDERING.damageNumber.criticalWidth
      : RENDERING.damageNumber.width;
    const baseHeight = critical
      ? RENDERING.damageNumber.criticalHeight
      : RENDERING.damageNumber.height;
    sprite.visible = true;
    sprite.position.set(
      x + lane * RENDERING.damageNumber.laneSpacing,
      y + (critical ? RENDERING.damageNumber.criticalYOffset : RENDERING.damageNumber.yOffset),
      RENDERING.layers.damageNumberZ,
    );
    sprite.scale.set(
      baseWidth * RENDERING.damageNumber.initialScale,
      baseHeight * RENDERING.damageNumber.initialScale,
      1,
    );
    this.effects.push({
      type: 'damageNumber',
      object: sprite,
      life: critical ? RENDERING.damageNumber.criticalLife : RENDERING.damageNumber.life,
      maxLife: critical ? RENDERING.damageNumber.criticalLife : RENDERING.damageNumber.life,
      riseSpeed: critical
        ? RENDERING.damageNumber.criticalRiseSpeed
        : RENDERING.damageNumber.riseSpeed,
      drift: lane * RENDERING.damageNumber.driftSpeed,
      baseWidth,
      baseHeight,
      critical,
    });
  }

  spawnFlagshipGunPulse(event) {
    const dx = event.x - event.source.x;
    const dy = event.y - event.source.y;
    const length = Math.max(RENDERING.gunPulse.minimumLength, Math.hypot(dx, dy));
    const group = this.gunPulsePool.acquire();
    group.visible = true;
    const energyStrength = Math.sqrt(Math.max(0, Math.min(1, event.energyFraction ?? 1)));
    const power = Math.max(
      RENDERING.gunPulse.minimumPower,
      Math.min(RENDERING.gunPulse.maximumPower, (event.damageMultiplier ?? 1) * energyStrength),
    );
    const widthScale = (RENDERING.gunPulse.baseWidthScale + power * RENDERING.gunPulse.powerWidthScale)
      * (event.critical ? RENDERING.gunPulse.criticalWidthScale : 1);
    const colors = event.critical
      ? RENDER_COLORS.criticalGunPulse
      : RENDER_COLORS.gunPulse;
    group.userData.materials.forEach((material, index) => material.color.setHex(colors[index]));
    const lateralOffset = event.pulseIndex % 2 === 0
      ? RENDERING.gunPulse.barrelOffset
      : -RENDERING.gunPulse.barrelOffset;
    const offsetX = (-dy / length) * lateralOffset;
    const offsetY = (dx / length) * lateralOffset;
    group.position.set(
      (event.source.x + event.x) / 2 + offsetX,
      (event.source.y + event.y) / 2 + offsetY,
      RENDERING.layers.gunPulseZ,
    );
    group.rotation.z = Math.atan2(dy, dx) - Math.PI / 2;
    group.userData.length = length;
    group.userData.trailLength = Math.min(
      RENDERING.gunPulse.maximumTrailLength,
      length * RENDERING.gunPulse.trailLengthRatio,
    );
    group.userData.wake.scale.set(RENDERING.gunPulse.wakeWidth * widthScale, length, 1);
    group.userData.tracer.scale.set(
      RENDERING.gunPulse.tracerWidth * widthScale,
      group.userData.trailLength,
      1,
    );
    group.userData.packet.scale.set(
      RENDERING.gunPulse.packetWidth * widthScale,
      Math.min(RENDERING.gunPulse.maximumPacketLength, length * RENDERING.gunPulse.packetLengthRatio),
      1,
    );
    group.userData.tracer.position.y = -length / 2;
    group.userData.packet.position.y = -length / 2;
    group.userData.baseOpacities = [
      Math.min(
        RENDERING.gunPulse.wakeOpacityMaximum,
        RENDERING.gunPulse.wakeOpacityBase + power * RENDERING.gunPulse.wakeOpacityPower,
      ),
      Math.min(
        RENDERING.gunPulse.tracerOpacityMaximum,
        RENDERING.gunPulse.tracerOpacityBase + power * RENDERING.gunPulse.tracerOpacityPower,
      ),
      Math.min(1, RENDERING.gunPulse.packetOpacityBase + power * RENDERING.gunPulse.packetOpacityPower),
    ];
    group.userData.materials.forEach((material, index) => {
      material.opacity = group.userData.baseOpacities[index];
    });
    this.effects.push({
      type: 'gunPulse',
      object: group,
      life: RENDERING.gunPulse.life,
      maxLife: RENDERING.gunPulse.life,
    });
    const command = [...this.entityMeshes.values()].find((mesh) => mesh.userData.entity?.role === 'command');
    if (command?.userData.turret) command.userData.turret.userData.recoil = 1;
    this.spawnImpact(event.source.x, event.source.y, RENDER_COLORS.command, RENDERING.gunPulse.sourceImpact);
    if (event.hitId) {
      this.spawnImpact(
        event.x,
        event.y,
        event.critical ? RENDER_COLORS.criticalImpact : RENDER_COLORS.friendly,
        event.critical
          ? RENDERING.gunPulse.criticalImpactBase + power * RENDERING.gunPulse.criticalImpactPower
          : RENDERING.gunPulse.hitImpactBase + power * RENDERING.gunPulse.hitImpactPower,
      );
    }
  }

  spawnFormationTrails(paths) {
    const material = new THREE.LineDashedMaterial({
      color: RENDER_COLORS.friendly,
      transparent: true,
      opacity: RENDERING.formationTrail.opacity,
      dashSize: RENDERING.formationTrail.dashSize,
      gapSize: RENDERING.formationTrail.gapSize,
      depthWrite: false,
    });
    const points = [];
    for (const path of paths) {
      points.push(
        new THREE.Vector3(path.from.x, path.from.y, RENDERING.formationTrail.z),
        new THREE.Vector3(path.to.x, path.to.y, RENDERING.formationTrail.z),
      );
    }
    const trails = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), material);
    trails.computeLineDistances();
    this.scene.add(trails);
    this.effects.push({
      type: 'formation',
      object: trails,
      life: RENDERING.formationTrail.life,
      maxLife: RENDERING.formationTrail.life,
    });
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
      } else if (effect.type === 'gunPulse') {
        effect.life -= dt;
        const ratio = Math.max(0, effect.life / effect.maxLife);
        const progress = 1 - ratio;
        effect.object.userData.materials.forEach((material, index) => {
          material.opacity = ratio * effect.object.userData.baseOpacities[index];
        });
        const packetY = -effect.object.userData.length / 2
          + effect.object.userData.length
          * Math.min(1, progress * RENDERING.gunPulse.packetTravelSpeed);
        effect.object.userData.packet.position.y = packetY;
        effect.object.userData.tracer.position.y = packetY
          - effect.object.userData.trailLength * RENDERING.gunPulse.tracerLag;
        effect.object.scale.x = 1 + progress * RENDERING.gunPulse.spreadGrowth;
        if (effect.life <= 0) {
          this.gunPulsePool.release(effect.object);
        } else {
          remaining.push(effect);
        }
      } else if (effect.type === 'damageNumber') {
        effect.life -= dt;
        const ratio = Math.max(0, effect.life / effect.maxLife);
        const progress = 1 - ratio;
        const pop = progress < RENDERING.damageNumber.popDurationRatio
          ? RENDERING.damageNumber.initialScale
            + progress / RENDERING.damageNumber.popDurationRatio
            * (1 - RENDERING.damageNumber.initialScale)
          : 1;
        const emphasis = effect.critical
          ? 1 + Math.sin(progress * Math.PI) * RENDERING.damageNumber.criticalEmphasis
          : 1;
        effect.object.position.x += effect.drift * dt;
        effect.object.position.y += effect.riseSpeed * dt;
        effect.object.scale.set(
          effect.baseWidth * pop * emphasis,
          effect.baseHeight * pop * emphasis,
          1,
        );
        effect.object.material.opacity = Math.min(1, ratio * RENDERING.damageNumber.fadeMultiplier);
        if (effect.life <= 0) {
          this.damageNumberPool.release(effect.object);
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

  showTarget(x, y, ready, radius = RENDERING.targetMarker.defaultRadius) {
    this.targetMarker.visible = true;
    this.targetMarker.position.set(x, y, RENDERING.targetMarker.z);
    this.targetMarker.userData.life = ready
      ? RENDERING.targetMarker.readyLife
      : RENDERING.targetMarker.rejectedLife;
    this.targetMarker.userData.maxLife = this.targetMarker.userData.life;
    this.targetMarker.userData.ready = ready;
    this.targetMarker.scale.setScalar(
      ready ? RENDERING.targetMarker.readyScale : RENDERING.targetMarker.rejectedScale,
    );
    for (const child of this.targetMarker.children) {
      child.material.color.setHex(ready ? RENDER_COLORS.friendly : RENDER_COLORS.enemy);
      child.material.opacity = RENDERING.targetMarker.opacity;
      if (child.userData.isRadiusRing) child.scale.setScalar(radius);
    }
  }

  updateTargetMarker(dt) {
    if (!this.targetMarker.visible) return;
    this.targetMarker.userData.life -= dt;
    const ratio = Math.max(0, this.targetMarker.userData.life / this.targetMarker.userData.maxLife);
    this.targetMarker.rotation.z += dt * (this.targetMarker.userData.ready
      ? RENDERING.targetMarker.readyRotationSpeed
      : RENDERING.targetMarker.rejectedRotationSpeed);
    this.targetMarker.scale.addScalar(dt * (this.targetMarker.userData.ready
      ? RENDERING.targetMarker.readyGrowth
      : RENDERING.targetMarker.rejectedGrowth));
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

  worldToScreen(x, y, z = 0) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const point = new THREE.Vector3(x, y, z).project(this.camera);
    return {
      x: rect.left + (point.x + 1) * rect.width * 0.5,
      y: rect.top + (1 - point.y) * rect.height * 0.5,
    };
  }

  resize() {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    const aspect = width / height;
    const viewHeight = RENDERING.viewport.viewHeight;
    const viewWidth = viewHeight * aspect;
    const verticalCenter = RENDERING.viewport.verticalCenter;
    const halfWidth = Math.max(
      RENDERING.viewport.minimumHalfWidth,
      Math.min(
        RENDERING.viewport.maximumHalfWidth,
        viewWidth / 2 - RENDERING.viewport.horizontalPadding,
      ),
    );
    const compactLandscape = height <= RENDERING.viewport.compactMaximumHeight
      && aspect > RENDERING.viewport.compactMinimumAspect;
    this.combatBounds = {
      ...ARENA,
      minX: -halfWidth,
      maxX: halfWidth,
      width: halfWidth * 2,
      halfWidth,
      fleetOffsetY: compactLandscape ? RENDERING.viewport.compactFleetOffsetY : 0,
    };
    this.camera.left = -viewWidth / 2;
    this.camera.right = viewWidth / 2;
    this.camera.top = viewHeight / 2 + verticalCenter;
    this.camera.bottom = -viewHeight / 2 + verticalCenter;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(
      window.devicePixelRatio || 1,
      RENDERING.scene.maxPixelRatio,
    ));
    this.renderer.setSize(width, height, false);
    if (this.defenseLine) {
      const position = this.defenseLine.geometry.getAttribute('position');
      position.setXYZ(0, -halfWidth, ARENA.defenseLineY, RENDERING.environment.defenseLineZ);
      position.setXYZ(1, halfWidth, ARENA.defenseLineY, RENDERING.environment.defenseLineZ);
      position.needsUpdate = true;
    }
    return { ...this.combatBounds };
  }

  getCombatBounds() {
    return { ...this.combatBounds };
  }

  setScreenShakeEnabled(enabled) {
    this.screenShakeEnabled = Boolean(enabled);
    if (!this.screenShakeEnabled) this.shake = 0;
  }

  disposeTransientEffect(object) {
    this.scene.remove(object);
    object.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
    });
    for (const material of object.userData.materials ?? []) material.dispose();
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
      } else if (effect.type === 'gunPulse') {
        this.gunPulsePool.release(effect.object);
      } else if (effect.type === 'damageNumber') {
        this.damageNumberPool.release(effect.object);
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
      if (child.geometry && ![
        this.shared.projectileGeometry,
        this.shared.ringGeometry,
        this.shared.chargeNodeGeometry,
        this.shared.canopyGeometry,
        this.shared.enginePodGeometry,
        this.shared.engineGlowGeometry,
        this.shared.navLightGeometry,
      ].includes(child.geometry)) {
        child.geometry.dispose();
      }
      if (child.material?.userData?.disposeWithShip) child.material.dispose();
    });
  }
}
