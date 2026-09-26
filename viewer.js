import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const area = document.getElementById('canvas-area');
const loading = document.getElementById('loading');
const progress = document.getElementById('progress');
const error = document.getElementById('error');
const label = document.getElementById('view-label');
const buttons = [...document.querySelectorAll('[data-view]')];
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe9eeea);
const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 10);
const target = new THREE.Vector3(0, 0.052, 0);
const initialCamera = new THREE.Vector3(0.08, 0.13, 0.29);
camera.position.copy(initialCamera);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
area.prepend(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(target);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 0.15;
controls.maxDistance = 0.75;
controls.maxPolarAngle = Math.PI * 0.91;
controls.update();

scene.add(new THREE.HemisphereLight(0xffffff, 0xb7c5bb, 1.6));
function light(position, power) {
  const lamp = new THREE.DirectionalLight(0xffffff, power);
  lamp.position.set(...position);
  scene.add(lamp);
}
light([1.5, 3, 2], 2.0);
light([-2, 1, -1.5], 0.8);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(20, 20),
  new THREE.MeshStandardMaterial({ color: 0xe9eeea, roughness: 1 })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.002;
scene.add(floor);

let model;
let mode = 'exterior';
const original = new Map();
const internalNames = new Set(['Upper_shell', 'Face_lens', 'Face_outer_bezel', 'Face_light_baffle', 'Face_blackout_film', 'Touch_cap', 'Touch_cap_tape', 'Touch_copper_electrode']);

function frameMode() {
  if (!model) return;
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const radius = box.getBoundingSphere(new THREE.Sphere()).radius;
  const verticalHalfFov = THREE.MathUtils.degToRad(camera.fov / 2);
  const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * camera.aspect);
  const distance = radius / Math.sin(Math.min(verticalHalfFov, horizontalHalfFov)) * 1.12;
  const direction = initialCamera.clone().sub(target).normalize();
  camera.position.copy(center).addScaledVector(direction, distance);
  controls.maxDistance = Math.max(0.75, distance * 2.5);
  controls.target.copy(center);
  controls.update();
}
function displacement(object) {
  const name = object.name;
  const group = object.userData.part_group;
  if (['Upper_shell', 'Touch_cap', 'Touch_cap_tape', 'Touch_copper_electrode'].includes(name)) return new THREE.Vector3(0, 0.115, 0);
  if (name === 'Face_lens') return new THREE.Vector3(0, 0.06, 0.07);
  if (group === 'head') {
    return new THREE.Vector3(0, 0.045, 0.055);
  }
  if (name === 'Battery_tray') return new THREE.Vector3(0, 0.025, 0);
  if (name === 'Adafruit_2011_2000mAh') return new THREE.Vector3(0, 0.045, 0);
  if (group === 'electronics' || group === 'power' || name === 'Electronics_rack') return new THREE.Vector3(0, 0.07, 0);
  return new THREE.Vector3();
}
function setMode(next) {
  mode = next;
  buttons.forEach(button => {
    const active = button.dataset.view === next;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  label.textContent = { exterior: '外观', interior: '内部', exploded: '拆解' }[next];
  if (!model) return;
  model.traverse(object => {
    if (!object.isMesh) return;
    const position = original.get(object);
    if (!position) return;
    object.position.copy(position);
    object.visible = next !== 'interior' || !internalNames.has(object.name);
    if (next === 'exploded') object.position.add(displacement(object));
  });
  model.updateMatrixWorld(true);
  frameMode();
  scheduleRender();
}
buttons.forEach(button => button.addEventListener('click', () => setMode(button.dataset.view)));
document.getElementById('reset').addEventListener('click', () => {
  frameMode();
});

async function loadModel() {
  try {
    const response = await fetch('./model.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Model metadata: HTTP ${response.status}`);
    const metadata = await response.json();
    document.title = `团团 · 3D 模型 v${metadata.version}`;
    document.getElementById('model-version').textContent = `桌面机器人 · v${metadata.version}`;
    document.getElementById('dimension').textContent = `${metadata.dimensions_mm.map(Math.round).join(' × ')} mm`;
    document.getElementById('model-summary').textContent = `${metadata.status} · ${metadata.parts_count} 个部件 · ${metadata.printed_parts_count} 个打印件`;
    document.getElementById('model-updated').textContent = `更新于 ${new Date(metadata.updated_at).toLocaleString('zh-CN')}`;
    const result = metadata.validation;
    const fit = result.interferences ? `${result.interferences} 组装配干涉待复核` : '静态装配干涉检查通过';
    const eyes = result.smile_eye_blocked_rays === 0 ? '笑眼区域光路采样通过' : '笑眼区域光路待复核';
    const edge = result.display_blocked_rays ? '屏幕边缘在部分角度存在遮挡，尚待实物确认' : '整屏光路采样通过';
    document.getElementById('model-validation').textContent = `打印网格${result.printed_meshes_passed ? '检查通过' : '待修正'}；${fit}；${eyes}；${edge}。`;
    const modelUrl = `./${metadata.model_file}?sha=${metadata.model_sha256}`;
    document.getElementById('download-model').href = modelUrl;
    const gltf = await new GLTFLoader().loadAsync(modelUrl, event => {
      if (event.total) progress.textContent = `${Math.round(event.loaded / event.total * 100)}%`;
    });
    model = gltf.scene;
    scene.add(model);
    model.traverse(object => {
      if (object.isMesh) original.set(object, object.position.clone());
    });
    setMode(mode);
    area.dataset.modelVersion = metadata.version;
    loading.hidden = true;
  } catch (cause) {
    loading.hidden = true;
    error.hidden = false;
    console.error(cause);
  }
}
loadModel();

function resize() {
  const { width, height } = area.getBoundingClientRect();
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
  frameMode();
  scheduleRender();
}
let renderPending = false;
function scheduleRender() {
  if (renderPending) return;
  renderPending = true;
  requestAnimationFrame(() => {
    renderPending = false;
    controls.update();
    renderer.render(scene, camera);
  });
}
controls.addEventListener('change', scheduleRender);
new ResizeObserver(resize).observe(area);
resize();
