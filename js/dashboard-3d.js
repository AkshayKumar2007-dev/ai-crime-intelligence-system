/* ============================================================
   CrimeIntel AI — 3D Crime Cityscape with Time Filter
   Three.js scene: buildings per city (height = case volume,
   color = worst severity) + floating case spheres.
   A time slider filters cases by createdAt hour (0–23).
   Toggle 2D/3D via #toggle-3d. Built from cases array.
   ============================================================ */

let scene3d = null;
let renderer3d = null;
let camera3d = null;
let controls3d = null;
let caseSpheres = [];
let cityBuildings = [];
let animFrameId = null;
let currently3d = false;

// Time filter state
let allCasesRaw = [];          // full unfiltered cases
let activeHour = 23;          // 0–23, or 24 = "All Hours"
const HOUR_ALL = 24;
let hourCache = [];            // precomputed { case, hour } entries

const SEV_COLORS = {
  CRITICAL: 0xff3b5c,
  HIGH: 0xff8c42,
  MEDIUM: 0xffd60a,
  LOW: 0x06d6a0,
};

const SEV_GLOW = {
  CRITICAL: 0xff3b5c,
  HIGH: 0xff8c42,
  MEDIUM: 0xffd60a,
  LOW: 0x06d6a0,
};

const HOUR_LABEL = [
  '12 AM', '1 AM', '2 AM', '3 AM', '4 AM', '5 AM',
  '6 AM', '7 AM', '8 AM', '9 AM', '10 AM', '11 AM',
  '12 PM', '1 PM', '2 PM', '3 PM', '4 PM', '5 PM',
  '6 PM', '7 PM', '8 PM', '9 PM', '10 PM', '11 PM',
];

function latLngToPosition(lat, lng, radius = 180) {
  const x = (lng - 68) * (radius / 18);
  const z = (24 - lat) * (radius / 18) * 1.5;
  return { x, z };
}

function getWorstSeverity(cases) {
  const order = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
  let worst = 'LOW';
  cases.forEach(c => {
    const s = c.severity || 'LOW';
    if (order[s] > order[worst]) worst = s;
  });
  return worst;
}

function caseHour(c) {
  if (!c.createdAt) return 0;
  const d = new Date(c.createdAt);
  if (isNaN(d.getTime())) return 0;
  return d.getHours();
}

function precomputeHours(cases) {
  hourCache = cases.map(c => ({ c, hour: caseHour(c) }));
}

/** Filter cases by the active hour setting */
function filteredCases() {
  if (activeHour === HOUR_ALL) return hourCache.map(e => e.c).filter(c => c.city && c.lat && c.lng);
  return hourCache.filter(e => e.hour === activeHour).map(e => e.c).filter(c => c.city && c.lat && c.lng);
}

/** Get the set of cities present in the filtered set */
function filteredCities(filtered) {
  const cities = {};
  filtered.forEach(c => { cities[c.city] = (cities[c.city] || 0) + 1; });
  return cities;
}

/** Build or rebuild scene objects from filtered cases */
function buildScene(cases, animate = false) {
  if (!scene3d) return;

  const cities = filteredCities(cases);

  // ---- Update city buildings ----
  const existingCityMap = new Map();
  cityBuildings.forEach(obj => {
    if (obj.userData && obj.userData.city) {
      existingCityMap.set(obj.userData.city, obj);
    }
  });

  // Remove cities no longer in filter
  for (const [city, obj] of existingCityMap) {
    if (!cities[city]) {
      scene3d.remove(obj.mesh);
      if (obj.label) scene3d.remove(obj.label);
      if (obj.countBadge) scene3d.remove(obj.countBadge);
      obj.mesh.geometry.dispose();
      obj.mesh.material.dispose();
      obj.label.material.map?.dispose();
      obj.label.material.dispose();
      obj.countBadge.material.map?.dispose();
      obj.countBadge.material.dispose();
      cityBuildings = cityBuildings.filter(o => o !== obj);
      existingCityMap.delete(city);
    }
  }

  // Add/update cities
  Object.entries(cities).forEach(([city, count], idx) => {
    const existing = existingCityMap.get(city);
    const cityCases = cases.filter(c => c.city === city);
    const posCity = cityPositions[city] || { x: (idx % 5 - 2) * 18, z: Math.floor(idx / 5) * 18 };
    const severity = getWorstSeverity(cityCases);
    const color = SEV_COLORS[severity] || 0x4488aa;
    const targetHeight = Math.max(4, count * 2.4);

    if (existing) {
      // Animate height transition
      const mesh = existing.mesh;
      const startH = mesh.scale.y * (existing._baseHeight || 4);
      const dur = animate ? 400 : 0;
      if (dur > 0) {
        animateHeight(mesh, startH, targetHeight, dur);
      } else {
        mesh.scale.y = targetHeight / (existing._baseHeight || 4);
      }
      mesh.material.color.setHex(color);
      mesh.material.emissive.setHex(color);
      // Update label
      updateLabelText(existing.label, city.toUpperCase());
      updateLabelText(existing.countBadge, `${count}`);
      existing._baseHeight = targetHeight;
    } else {
      // New city
      const baseH = targetHeight;
      const geo = new THREE.BoxGeometry(18, 1, 18);
      const mat = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.4,
        metalness: 0.2,
        emissive: color,
        emissiveIntensity: 0.08,
        transparent: true,
        opacity: 0.92,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(posCity.x, 0.5, posCity.z);
      mesh.scale.y = 0.01;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData = { city, _baseHeight: baseH };
      scene3d.add(mesh);

      if (animate) {
        animateHeight(mesh, 0.01, 1, 500);
      } else {
        mesh.scale.y = targetHeight / 4;
      }
      mesh.userData._baseHeight = targetHeight;

      cityBuildings.push({ mesh, label: null, countBadge: null, city });

      // City name label
      const canvas = document.createElement('canvas');
      canvas.width = 256; canvas.height = 64;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'rgba(5,10,20,0.75)';
      ctx.fillRect(0, 0, 256, 64);
      ctx.fillStyle = '#e8edf5';
      ctx.font = 'bold 24px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(city.toUpperCase(), 128, 38);
      const tex = new THREE.CanvasTexture(canvas);
      tex.minFilter = THREE.LinearFilter;
      const labelMat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
      const sprite = new THREE.Sprite(labelMat);
      sprite.position.set(posCity.x, targetHeight + 8, posCity.z);
      sprite.scale.set(24, 6, 1);
      sprite.userData.city = city;
      scene3d.add(sprite);

      // Count badge
      const cntCanvas = document.createElement('canvas');
      cntCanvas.width = 128; cntCanvas.height = 64;
      const cctx = cntCanvas.getContext('2d');
      cctx.fillStyle = 'rgba(5,10,20,0.85)';
      cctx.fillRect(0, 0, 128, 64);
      cctx.fillStyle = '#00d4ff';
      cctx.font = 'bold 28px JetBrains Mono, monospace';
      cctx.textAlign = 'center';
      cctx.fillText(`${count}`, 64, 42);
      cctx.fillStyle = 'rgba(255,255,255,0.4)';
      cctx.font = '12px Inter, sans-serif';
      cctx.fillText('cases', 64, 58);
      const cntTex = new THREE.CanvasTexture(cntCanvas);
      cntTex.minFilter = THREE.LinearFilter;
      const cntMat = new THREE.SpriteMaterial({ map: cntTex, transparent: true, depthTest: false });
      const cntSprite = new THREE.Sprite(cntMat);
      cntSprite.position.set(posCity.x, targetHeight + 18, posCity.z);
      cntSprite.scale.set(14, 7, 1);
      scene3d.add(cntSprite);

      cityBuildings.push({ mesh, label: sprite, countBadge: cntSprite, city });
      cityPositions[city] = posCity;
    }
  });

  // ---- Update case spheres ----
  // Build set of currently-shown case ids
  const shownIds = new Set(cases.map(c => c.id));

  // Remove spheres not in filter
  for (let i = caseSpheres.length - 1; i >= 0; i--) {
    const s = caseSpheres[i];
    if (!shownIds.has(s.userData.case.id)) {
      scene3d.remove(s);
      s.geometry.dispose();
      s.material.dispose();
      caseSpheres.splice(i, 1);
    }
  }

  // Add spheres for new cases
  cases.forEach((c, i) => {
    if (caseSpheres.some(s => s.userData.case.id === c.id)) return;
    const posCity = cityPositions[c.city] || { x: 0, z: 0 };
    const severity = c.severity || 'LOW';
    const color = SEV_COLORS[severity] || 0x4488aa;
    const sizeBase = 0.8 + (severity === 'CRITICAL' ? 0.6 : severity === 'HIGH' ? 0.3 : 0);
    const geo = new THREE.SphereGeometry(sizeBase, 16, 16);
    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: severity === 'CRITICAL' ? 0.5 : 0.25,
      roughness: 0.2,
      metalness: 0.3,
      transparent: true,
      opacity: 0,
    });
    const sphere = new THREE.Mesh(geo, mat);
    const angle = (i / Math.max(cities[c.city] || 1, 1)) * Math.PI * 2;
    const radius = 6 + (severity === 'CRITICAL' ? 2 : 0);
    sphere.position.set(
      posCity.x + Math.cos(angle) * radius,
      3 + (i % 6) * 1.2,
      posCity.z + Math.sin(angle) * radius
    );
    sphere.userData = {
      case: c,
      floatOffset: Math.random() * Math.PI * 2,
      baseY: sphere.position.y,
      targetOpacity: 1,
    };
    scene3d.add(sphere);
    caseSpheres.push(sphere);

    if (animate) {
      animateOpacity(sphere, 0, 1, 400);
    } else {
      sphere.material.opacity = 1;
    }
  });

  // Update time info display
  updateTimeInfo(cases);
}

/** City position cache so cities stay put across filters */
const cityPositions = {};

/** Animate a mesh's Y scale from start to end over ms */
function animateHeight(mesh, startScaleY, endScaleY, dur) {
  const start = performance.now();
  const baseH = mesh.userData._baseHeight || endScaleY;
  function tick(now) {
    const t = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - t, 3);
    mesh.scale.y = 0.01 + (endScaleY / baseH) * eased;
    if (t < 1) requestAnimationFrame(tick);
    else mesh.scale.y = endScaleY / baseH;
  }
  requestAnimationFrame(tick);
}

/** Animate sphere opacity */
function animateOpacity(sphere, from, to, dur) {
  const start = performance.now();
  function tick(now) {
    const t = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - t, 3);
    sphere.material.opacity = from + (to - from) * eased;
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function updateLabelText(sprite, text) {
  if (!sprite) return;
  const tex = sprite.material.map;
  const canvas = tex.image;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(5,10,20,0.75)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#e8edf5';
  ctx.font = 'bold 24px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text, canvas.width / 2, 38);
  tex.needsUpdate = true;
}

function updateTimeInfo(cases) {
  const label = document.getElementById('active-hour-label');
  const countLabel = document.getElementById('case-count-label');
  if (!label || !countLabel) return;
  if (activeHour === HOUR_ALL) {
    label.textContent = 'All Hours';
  } else {
    label.textContent = HOUR_LABEL[activeHour];
  }
  countLabel.textContent = cases.length;
}

function initScene3d() {
  if (scene3d) {
    // Just make sure visibility is correct
    return;
  }

  const container = document.getElementById('scene-3d');
  const w = container.clientWidth || 800;
  const h = container.clientHeight || 380;

  scene3d = new THREE.Scene();
  scene3d.background = new THREE.Color(0x050810);
  scene3d.fog = new THREE.Fog(0x050810, 180, 450);

  camera3d = new THREE.PerspectiveCamera(45, w / h, 0.1, 700);
  camera3d.position.set(100, 90, 140);

  renderer3d = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer3d.setSize(w, h);
  renderer3d.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer3d.shadowMap.enabled = true;
  renderer3d.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer3d.toneMapping = THREE.ACESFilmicToneMapping;
  renderer3d.toneMappingExposure = 1.1;
  container.appendChild(renderer3d.domElement);

  controls3d = new THREE.OrbitControls(camera3d, renderer3d.domElement);
  controls3d.enableDamping = true;
  controls3d.dampingFactor = 0.08;
  controls3d.minDistance = 30;
  controls3d.maxDistance = 350;
  controls3d.maxPolarAngle = Math.PI / 2.15;
  controls3d.target.set(0, 10, 0);
  controls3d.update();

  // ---- Lights ----
  const ambient = new THREE.AmbientLight(0x304060, 0.6);
  scene3d.add(ambient);

  const hemi = new THREE.HemisphereLight(0x4488ff, 0x002244, 0.4);
  scene3d.add(hemi);

  const dirLight = new THREE.DirectionalLight(0xffeedd, 1.1);
  dirLight.position.set(80, 140, 60);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(1024, 1024);
  dirLight.shadow.camera.left = -140;
  dirLight.shadow.camera.right = 140;
  dirLight.shadow.camera.top = 140;
  dirLight.shadow.camera.bottom = -140;
  dirLight.shadow.camera.near = 1;
  dirLight.shadow.camera.far = 350;
  scene3d.add(dirLight);

  const fillLight = new THREE.DirectionalLight(0x00aaff, 0.35);
  fillLight.position.set(-70, 50, -50);
  scene3d.add(fillLight);

  const rim = new THREE.DirectionalLight(0x7b2fff, 0.3);
  rim.position.set(0, 30, -120);
  scene3d.add(rim);

  // ---- Ground ----
  const groundGeo = new THREE.PlaneGeometry(600, 600);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x080e1a,
    roughness: 0.9,
    metalness: 0.0,
    transparent: true,
    opacity: 0.9,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.5;
  ground.receiveShadow = true;
  scene3d.add(ground);

  // ---- Grid ----
  const grid = new THREE.GridHelper(600, 60, 0x15203a, 0x0d1525);
  grid.position.y = -0.4;
  scene3d.add(grid);

  // ---- Ambient glow ring ----
  const ringGeo = new THREE.RingGeometry(200, 230, 64);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x00d4ff,
    transparent: true,
    opacity: 0.06,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -0.3;
  scene3d.add(ring);

  // Second outer ring
  const ring2Geo = new THREE.RingGeometry(250, 280, 64);
  const ring2Mat = new THREE.MeshBasicMaterial({
    color: 0x7b2fff,
    transparent: true,
    opacity: 0.04,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const ring2 = new THREE.Mesh(ring2Geo, ring2Mat);
  ring2.rotation.x = -Math.PI / 2;
  ring2.position.y = -0.2;
  scene3d.add(ring2);

  // ---- Stars ----
  const starCount = 1000;
  const starGeo = new THREE.BufferGeometry();
  const pos = new Float32Array(starCount * 3);
  const sizes = new Float32Array(starCount);
  for (let i = 0; i < starCount; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 800;
    pos[i * 3 + 1] = Math.random() * 250 + 30;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 800;
    sizes[i] = 0.3 + Math.random() * 0.7;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  starGeo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  const starMat = new THREE.PointsMaterial({
    color: 0x8899ff,
    size: 0.5,
    transparent: true,
    opacity: 0.5,
    sizeAttenuation: true,
  });
  const stars = new THREE.Points(starGeo, starMat);
  stars.name = 'stars';
  scene3d.add(stars);

  // ---- Floating particles ----
  const particleCount = 300;
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(particleCount * 3);
  for (let i = 0; i < particleCount; i++) {
    pPos[i * 3] = (Math.random() - 0.5) * 500;
    pPos[i * 3 + 1] = Math.random() * 80 + 5;
    pPos[i * 3 + 2] = (Math.random() - 0.5) * 500;
  }
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  const pMat = new THREE.PointsMaterial({
    color: 0x00d4ff,
    size: 0.15,
    transparent: true,
    opacity: 0.25,
    sizeAttenuation: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const particles = new THREE.Points(pGeo, pMat);
  particles.name = 'particles';
  scene3d.add(particles);

  // Pre-compute hours from current cases
  precomputeHours(allCases || []);

  // Build initial scene showing all cases
  activeHour = HOUR_ALL;
  buildScene(filteredCases(), false);
  updateSliderRange();
  updateTimeInfo(filteredCases());

  // Sync slider to show "All Hours"
  const slider = document.getElementById('time-slider');
  if (slider) slider.value = HOUR_ALL;

  animate();
}

/** Animate the scene loop */
function animate() {
  animFrameId = requestAnimationFrame(animate);
  if (controls3d) controls3d.update();

  const t = Date.now() * 0.001;

  // Float case spheres
  caseSpheres.forEach((sphere) => {
    const ud = sphere.userData;
    if (ud.baseY !== undefined) {
      sphere.position.y = ud.baseY + Math.sin(t * 0.7 + ud.floatOffset) * 0.6;
    }
    sphere.rotation.x += 0.004;
    sphere.rotation.z += 0.002;
  });

  // Rotate stars slowly
  const stars = scene3d.getObjectByName('stars');
  if (stars) stars.rotation.y += 0.0001;

  // Float particles
  const particles = scene3d.getObjectByName('particles');
  if (particles) {
    const posArr = particles.geometry.attributes.position.array;
    for (let i = 0; i < posArr.length; i += 3) {
      posArr[i + 1] += Math.sin(t + i) * 0.002;
      if (posArr[i + 1] > 90) posArr[i + 1] = 5;
    }
    particles.geometry.attributes.position.needsUpdate = true;
  }

  if (renderer3d && scene3d && camera3d) {
    renderer3d.render(scene3d, camera3d);
  }
}

function resizeScene3d() {
  if (!renderer3d) return;
  const container = document.getElementById('scene-3d');
  const w = container.clientWidth || 800;
  const h = container.clientHeight || 380;
  camera3d.aspect = w / h;
  camera3d.updateProjectionMatrix();
  renderer3d.setSize(w, h);
}

/** Update the slider min/max based on actual hours in the data */
function updateSliderRange() {
  const minEl = document.getElementById('slider-min');
  const maxEl = document.getElementById('slider-max');
  if (!minEl || !maxEl) return;

  const hours = hourCache.map(e => e.hour).filter(h => h >= 0);
  if (hours.length === 0) {
    minEl.textContent = '0';
    maxEl.textContent = '23';
    return;
  }
  const minH = Math.min(...hours);
  const maxH = Math.max(...hours);
  minEl.textContent = HOUR_LABEL[minH];
  maxEl.textContent = HOUR_LABEL[maxH] || '23';
}

/** Handle slider input */
function onSliderInput(val) {
  activeHour = parseInt(val, 10);
  if (isNaN(activeHour) || activeHour < 0) activeHour = HOUR_ALL;
  if (activeHour > 23) activeHour = HOUR_ALL;

  const cases = filteredCases();
  buildScene(cases, true);
}

window.toggle3d = function () {
  const btn = document.getElementById('toggle-3d');
  const sceneContainer = document.getElementById('scene-3d');
  const mapDiv = document.getElementById('crime-map');
  const legend2d = document.getElementById('2d-legend');
  const sliderWrap = document.getElementById('time-slider-wrap');

  if (!currently3d) {
    mapDiv.style.display = 'none';
    legend2d.style.display = 'none';
    sceneContainer.style.display = 'block';
    if (sliderWrap) sliderWrap.style.display = 'block';
    btn.classList.add('active');
    btn.textContent = '2D VIEW';
    initScene3d(); // this builds the scene with all cases
    resizeScene3d();
    currently3d = true;
  } else {
    mapDiv.style.display = 'block';
    legend2d.style.display = 'flex';
    sceneContainer.style.display = 'none';
    if (sliderWrap) sliderWrap.style.display = 'none';
    btn.classList.remove('active');
    btn.textContent = '3D VIEW';
    currently3d = false;
  }
};

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('toggle-3d');
  const slider = document.getElementById('time-slider');
  if (btn) btn.addEventListener('click', window.toggle3d);
  if (slider) {
    slider.addEventListener('input', (e) => onSliderInput(e.target.value));
    // Show the slider only when 3D is active
    sliderWrapStyle = slider.closest('#time-slider-wrap').style;
  }
});

let sliderWrapStyle = null;

window.addEventListener('resize', () => {
  if (currently3d) resizeScene3d();
});

/** Called by dashboard.js when cases are refreshed */
window.refresh3D = function (cases) {
  allCases = cases;
  precomputeHours(cases);
  updateSliderRange();
  if (currently3d) {
    buildScene(activeHour === HOUR_ALL ? filteredCases() : filteredCases(), false);
  }
};
