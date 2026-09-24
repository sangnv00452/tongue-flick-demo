// The 3D lollipop that reacts to each lick: a dent where the tongue hit that springs back, a damped
// wobble, a wet clearcoat that dries over time, and the candy wearing down. All motion is dt-based and
// allocation-free per frame; the dent is a CPU vertex displacement on a ~3k-vertex mesh.
import * as THREE from 'three';

export const TUNING = Object.freeze({
  dentDepth: 0.07, // in candy radii
  dentRadius: 0.55, // falloff radius around the contact point, in candy radii
  dentRecoverPerSec: 5, // exponential recovery rate
  wobbleStiffness: 180,
  wobbleDamping: 9,
  wobbleImpulse: 2.4, // rad/s added per lick
  wetPerLick: 0.22,
  dryPerSec: 0.12,
  wearPerLick: 0.006, // candy shrinks this fraction per lick
  minSize: 0.55,
});

function swirlTexture() {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#ff7eb6';
  g.fillRect(0, 0, size, size);
  const colors = ['#ff4d6d', '#ffd166', '#06d6a0', '#4cc9f0', '#b388ff', '#ff9e00'];
  const cx = size / 2;
  for (let i = 0; i < 720; i++) {
    const a = (i / 720) * Math.PI * 12;
    const r = (i / 720) * cx;
    g.fillStyle = colors[Math.floor(i / 20) % colors.length];
    g.beginPath();
    g.arc(cx + Math.cos(a) * r, cx + Math.sin(a) * r, 10 + (i / 720) * 26, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createLollipop() {
  const group = new THREE.Group();

  const candyGeo = new THREE.SphereGeometry(1, 72, 48);
  candyGeo.scale(1, 1, 0.42); // a flat disc, face toward the camera
  // Planar UVs: the swirl is painted flat onto the disc faces, like a real spiral lollipop.
  const uv = candyGeo.attributes.uv;
  const p = candyGeo.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) * 0.5 + 0.5, p.getY(i) * 0.5 + 0.5);
  uv.needsUpdate = true;
  const base = Float32Array.from(candyGeo.attributes.position.array);
  const candyMat = new THREE.MeshPhysicalMaterial({ map: swirlTexture(), roughness: 0.45, clearcoat: 0.6, clearcoatRoughness: 0.5, sheen: 0.3 });
  const candy = new THREE.Mesh(candyGeo, candyMat);

  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.6, 16), new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.8 }));
  stick.position.y = -2.1;

  const wobble = new THREE.Group();
  wobble.add(candy, stick);
  group.add(wobble);

  // The tongue reaches the candy from below and in front.
  const contact = new THREE.Vector3(0, -0.55, 0.42);
  const tmp = new THREE.Vector3();
  const s = { dent: 0, angle: 0, angularVel: 0, wet: 0, size: 1, licks: 0 };

  function applyDent() {
    const pos = candyGeo.attributes.position;
    const arr = pos.array;
    for (let i = 0; i < arr.length; i += 3) {
      tmp.set(base[i], base[i + 1], base[i + 2]);
      const d = tmp.distanceTo(contact) / TUNING.dentRadius;
      const push = d < 1 ? s.dent * TUNING.dentDepth * (1 - d * d) * (1 - d * d) : 0;
      // Push inward along the surface normal (the direction toward the centre for a sphere-ish disc).
      const k = push / (tmp.length() || 1);
      arr[i] = base[i] - base[i] * k;
      arr[i + 1] = base[i + 1] - base[i + 1] * k;
      arr[i + 2] = base[i + 2] - base[i + 2] * k;
    }
    pos.needsUpdate = true;
    candyGeo.computeVertexNormals();
  }

  return {
    object: group,
    lick() {
      s.licks += 1;
      s.dent = 1;
      s.angularVel += TUNING.wobbleImpulse * (s.licks % 2 ? 1 : -0.8);
      s.wet = Math.min(1, s.wet + TUNING.wetPerLick);
      s.size = Math.max(TUNING.minSize, s.size * (1 - TUNING.wearPerLick));
    },
    update(dt) {
      // Damped spring for the wobble.
      const acc = -TUNING.wobbleStiffness * s.angle - TUNING.wobbleDamping * s.angularVel;
      s.angularVel += acc * dt;
      s.angle += s.angularVel * dt;
      wobble.rotation.x = s.angle * 0.35;
      wobble.rotation.z = s.angle * 0.2;

      if (s.dent > 0.001) {
        s.dent *= Math.exp(-TUNING.dentRecoverPerSec * dt);
        applyDent();
      } else if (s.dent !== 0) {
        s.dent = 0;
        applyDent();
      }

      s.wet = Math.max(0, s.wet - TUNING.dryPerSec * dt);
      candyMat.clearcoat = 0.6 + 0.4 * s.wet;
      candyMat.clearcoatRoughness = 0.5 - 0.45 * s.wet;
      candyMat.roughness = 0.45 - 0.3 * s.wet;
      candy.scale.setScalar(s.size);
    },
    reset() {
      Object.assign(s, { dent: 0, angle: 0, angularVel: 0, wet: 0, size: 1, licks: 0 });
      applyDent();
      candy.scale.setScalar(1);
    },
    state: () => ({ ...s }),
  };
}
