import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

class NodeFileReader {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buffer) => {
      this.result = buffer;
      this.onloadend?.();
    });
  }

  readAsDataURL(blob) {
    blob.arrayBuffer().then((buffer) => {
      const base64 = Buffer.from(buffer).toString("base64");
      this.result = `data:${blob.type || "application/octet-stream"};base64,${base64}`;
      this.onloadend?.();
    });
  }
}

globalThis.FileReader = NodeFileReader;

const outPath = resolve(dirname(fileURLToPath(import.meta.url)), "../public/models/supra.optimized.glb");

// App.jsx lifts the model so its lowest point sits at y = 0.05.
// Build surfaces 0.05 below the studio slot coordinates so they line up after that shift.
const lift = 0.05;
const y = (worldY) => worldY - lift;

function material(name, parameters) {
  const next = new THREE.MeshStandardMaterial(parameters);
  next.name = name;
  return next;
}

const paint = material("Supra_body_paint", {
  color: "#f3f3f0",
  metalness: 0.22,
  roughness: 0.28,
});
const glass = material("Window", {
  color: "#9eb4c4",
  metalness: 0.05,
  roughness: 0.08,
  transparent: true,
  opacity: 0.45,
});
const headlight = material("HeadlightGlass", {
  color: "#e7eef5",
  metalness: 0.1,
  roughness: 0.12,
  transparent: true,
  opacity: 0.7,
});
const running = material("Runninglight", {
  color: "#fff8e8",
  emissive: "#fff8e8",
  emissiveIntensity: 0.7,
  roughness: 0.3,
});
const tail = material("Taillight", {
  color: "#7d0500",
  emissive: "#7d0500",
  emissiveIntensity: 0.35,
  roughness: 0.35,
});
const tire = material("MKV.Tire", { color: "#141412", roughness: 0.86, metalness: 0.02 });
const chrome = material("Chrome", { color: "#d5d5d2", metalness: 0.9, roughness: 0.18 });
const disc = material("BrakeDisc", { color: "#8d8d88", metalness: 0.8, roughness: 0.35 });
const trim = material("BlackGloss", { color: "#161616", metalness: 0.4, roughness: 0.16 });

const supra = new THREE.Group();
supra.name = "Supra";

function add(geometry, surface, position, rotation) {
  const mesh = new THREE.Mesh(geometry, surface);
  if (position) mesh.position.set(...position);
  if (rotation) mesh.rotation.set(...rotation);
  supra.add(mesh);
  return mesh;
}

const upper = [
  [3.16, y(0.3)],
  [3.14, y(0.58)],
  [2.92, y(0.74)],
  [2.45, y(0.96)],
  [1.7, y(1.16)],
  [1.15, y(1.23)],
  [0.55, y(1.18)],
  [0.12, y(1.42)],
  [-0.22, y(1.68)],
  [-0.55, y(1.74)],
  [-0.95, y(1.66)],
  [-1.28, y(1.4)],
  [-1.72, y(1.2)],
  [-2.35, y(1.18)],
  [-2.8, y(1.02)],
  [-3.12, y(0.72)],
  [-3.16, y(0.36)],
];
const outline = new THREE.CatmullRomCurve3(
  upper.map(([x, py]) => new THREE.Vector3(x, py, 0)),
  false,
  "catmullrom",
  0.2,
).getPoints(90);
const side = new THREE.Shape();
side.moveTo(outline[0].x, y(0.2));
outline.forEach((point) => side.lineTo(point.x, point.y));
side.lineTo(outline.at(-1).x, y(0.2));
side.closePath();

for (const [wx, worldY] of [[1.72, 0.4], [-1.48, 0.4]]) {
  const arch = new THREE.Path();
  arch.absarc(wx, y(worldY), 0.4, 0, Math.PI * 2, true);
  side.holes.push(arch);
}

const bodyWidth = 2.56;
const body = new THREE.Mesh(
  new THREE.ExtrudeGeometry(side, { depth: bodyWidth, bevelEnabled: false, curveSegments: 16 }),
  paint,
);
body.name = "body";
body.position.z = -bodyWidth / 2;
body.castShadow = true;
body.receiveShadow = true;
supra.add(body);

const cabin = new THREE.Shape();
[
  [0.28, y(1.22)],
  [-0.08, y(1.5)],
  [-0.42, y(1.66)],
  [-1.02, y(1.58)],
  [-1.32, y(1.34)],
  [-1.05, y(1.24)],
].forEach(([px, py], index) => (index ? cabin.lineTo(px, py) : cabin.moveTo(px, py)));
cabin.closePath();
add(
  new THREE.ExtrudeGeometry(cabin, { depth: 1.55, bevelEnabled: false, curveSegments: 8 }),
  glass,
  [0, 0.02, -0.775],
);

add(new THREE.BoxGeometry(0.42, 0.16, 1.15), headlight, [3.02, y(0.62), 0.62]);
add(new THREE.BoxGeometry(0.42, 0.16, 1.15), headlight, [3.02, y(0.62), -0.62]);
add(new THREE.BoxGeometry(0.16, 0.06, 0.7), running, [3.08, y(0.74), 0.72]);
add(new THREE.BoxGeometry(0.16, 0.06, 0.7), running, [3.08, y(0.74), -0.72]);
add(new THREE.BoxGeometry(0.12, 0.16, 1.35), tail, [-3.12, y(0.78), 0.55]);
add(new THREE.BoxGeometry(0.12, 0.16, 1.35), tail, [-3.12, y(0.78), -0.55]);
add(new THREE.BoxGeometry(1.15, 0.08, bodyWidth + 0.04), trim, [-2.15, y(1.24), 0]);
add(new THREE.BoxGeometry(0.16, 0.12, 0.22), paint, [0.55, y(1.28), 1.22]);
add(new THREE.BoxGeometry(0.16, 0.12, 0.22), paint, [0.55, y(1.28), -1.22]);

function wheel(x, z) {
  const tireMesh = add(new THREE.CylinderGeometry(0.38, 0.38, 0.3, 28), tire, [x, y(0.4), z], [Math.PI / 2, 0, 0]);
  tireMesh.castShadow = true;
  add(new THREE.CylinderGeometry(0.22, 0.22, 0.32, 20), chrome, [x, y(0.4), z], [Math.PI / 2, 0, 0]);
  add(new THREE.CylinderGeometry(0.16, 0.16, 0.34, 16), disc, [x, y(0.4), z], [Math.PI / 2, 0, 0]);
}

wheel(1.72, 1.12);
wheel(1.72, -1.12);
wheel(-1.48, 1.16);
wheel(-1.48, -1.16);

function fitLikeStudio(object) {
  object.position.set(0, 0, 0);
  object.rotation.set(0, 0, 0);
  object.scale.set(1, 1, 1);
  object.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(object);
  const rawSize = box.getSize(new THREE.Vector3());
  if (rawSize.z > rawSize.x) object.rotation.y = Math.PI / 2;
  object.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  object.scale.setScalar(6.35 / Math.max(size.x, size.z));
  object.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  object.position.set(-center.x, 0.05 - box.min.y, -center.z);
  object.updateMatrixWorld(true);
}

fitLikeStudio(supra);
supra.updateMatrixWorld(true);
supra.traverse((object) => {
  if (!object.isMesh) return;
  object.geometry = object.geometry.clone();
  object.geometry.applyMatrix4(object.matrixWorld);
});
supra.traverse((object) => {
  object.position.set(0, 0, 0);
  object.rotation.set(0, 0, 0);
  object.scale.set(1, 1, 1);
});
supra.updateMatrixWorld(true);
const bounds = new THREE.Box3().setFromObject(supra);
const size = bounds.getSize(new THREE.Vector3());
console.log("fitted bounds", {
  min: bounds.min.toArray().map((value) => Number(value.toFixed(3))),
  max: bounds.max.toArray().map((value) => Number(value.toFixed(3))),
  size: size.toArray().map((value) => Number(value.toFixed(3))),
});

const exporter = new GLTFExporter();
const glb = await exporter.parseAsync(supra, { binary: true });
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, Buffer.from(glb));
console.log(`wrote ${outPath} (${Buffer.from(glb).length} bytes)`);
