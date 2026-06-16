/**
 * 다차원 공간 맵 — Three.js. 서버 /space 응답(SpaceResponse)을 그대로 렌더.
 *  - pca/axes : 3D 큐브 + 축선/그리드 + 좌표 빌보드.
 *  - sim      : 유사도(UMAP) 2D 평면 — 큐브/축 숨기고 k-NN 간선 + 군집 라벨.
 * 멀티채널: 위치(좌표/유사도) · 색(colorBy 형식) · 크기(디테일 스칼라).
 * 궤도 회전(드래그)·줌(휠)·클릭 선택.
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useStore } from '../store.js';
import { api } from '../lib/api.js';
import { labelColor } from '../lib/color.js';
import type { SpaceResponse } from '@imgspace/shared';
import type { TaxonomyResponse } from '../lib/api.js';

const R = 3; // 큐브 반경: 0..1 → -R..R
const w = (s: number) => (s - 0.5) * 2 * R;

interface GL {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  raycaster: THREE.Raycaster;
  pointer: THREE.Vector2;
  decor: THREE.Group; // 큐브·그리드·축선 (3D 모드 전용)
  labels: THREE.Group; // 축 라벨
  edges: THREE.Group; // sim k-NN 간선
  clusterLabels: THREE.Group; // sim 군집 라벨
  sprites: THREE.Group;
  byId: Map<string, THREE.Sprite>;
  raf: number;
}

export function SpaceMap() {
  const mountRef = useRef<HTMLDivElement>(null);
  const glRef = useRef<GL | null>(null);

  const space = useStore((s) => s.space);
  const colorBy = useStore((s) => s.colorBy);
  const selectedId = useStore((s) => s.selectedId);
  const taxonomy = useStore((s) => s.taxonomy);
  const select = useStore((s) => s.select);

  const selectRef = useRef(select);
  selectRef.current = select;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  // ── 씬 1회 초기화 ──
  useEffect(() => {
    const mount = mountRef.current!;
    const W = mount.clientWidth || 640;
    const H = mount.clientHeight || 480;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0e1116);
    const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 100);
    camera.position.set(5.5, 4.2, 7);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(W, H);
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.5;
    controls.minDistance = 4;
    controls.maxDistance = 20;
    controls.addEventListener('start', () => {
      controls.autoRotate = false;
    });

    // 3D 데코(큐브 + 그리드 + 축선) — sim 모드에서 통째로 숨긴다.
    const decor = new THREE.Group();
    decor.add(
      new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(2 * R, 2 * R, 2 * R)),
        new THREE.LineBasicMaterial({ color: 0x2a3340 }),
      ),
    );
    const grid = new THREE.GridHelper(2 * R, 6, 0x2a3340, 0x222a33);
    grid.position.y = -R;
    decor.add(grid);
    const axis = (to: THREE.Vector3, c: number) => {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-R, -R, -R), to]);
      decor.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: c })));
    };
    axis(new THREE.Vector3(R, -R, -R), 0xe2716a);
    axis(new THREE.Vector3(-R, R, -R), 0x5fd693);
    axis(new THREE.Vector3(-R, -R, R), 0x7cc4ff);
    scene.add(decor);

    const labels = new THREE.Group();
    const edges = new THREE.Group();
    const clusterLabels = new THREE.Group();
    const sprites = new THREE.Group();
    scene.add(labels, edges, clusterLabels, sprites);

    const gl: GL = {
      scene, camera, renderer, controls,
      raycaster: new THREE.Raycaster(),
      pointer: new THREE.Vector2(),
      decor, labels, edges, clusterLabels, sprites,
      byId: new Map(),
      raf: 0,
    };
    glRef.current = gl;

    // 클릭 선택(드래그와 구분)
    let dx = 0, dy = 0, moved = false;
    const onDown = (e: PointerEvent) => {
      dx = e.clientX; dy = e.clientY; moved = false;
    };
    const onMove = (e: PointerEvent) => {
      if (Math.abs(e.clientX - dx) > 4 || Math.abs(e.clientY - dy) > 4) moved = true;
    };
    const onUp = (e: PointerEvent) => {
      if (moved) return;
      const rect = renderer.domElement.getBoundingClientRect();
      gl.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      gl.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      gl.raycaster.setFromCamera(gl.pointer, camera);
      const hit = gl.raycaster.intersectObjects(sprites.children, false)[0];
      const id = hit?.object.userData.id as string | undefined;
      if (id) selectRef.current(id);
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerup', onUp);

    const ro = new ResizeObserver(() => {
      const w2 = mount.clientWidth || W;
      const h2 = mount.clientHeight || H;
      camera.aspect = w2 / h2;
      camera.updateProjectionMatrix();
      renderer.setSize(w2, h2);
    });
    ro.observe(mount);

    const loop = () => {
      gl.raf = requestAnimationFrame(loop);
      controls.update();
      renderer.render(scene, camera);
    };
    loop();

    const st = useStore.getState();
    if (st.space) {
      rebuild(gl, st.space, st.colorBy, st.taxonomy);
      applySelection(gl, st.selectedId);
    }

    return () => {
      cancelAnimationFrame(gl.raf);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('pointerup', onUp);
      controls.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
      glRef.current = null;
    };
  }, []);

  // 공간/색 갱신 → 전체 재구성
  useEffect(() => {
    const gl = glRef.current;
    if (!gl || !space) return;
    rebuild(gl, space, colorBy, taxonomy);
    applySelection(gl, selectedIdRef.current);
  }, [space, colorBy, taxonomy]);

  // 선택 강조
  useEffect(() => {
    const gl = glRef.current;
    if (gl) applySelection(gl, selectedId);
  }, [selectedId]);

  const empty = (space?.points.length ?? 0) === 0;

  return (
    <div className="map-wrap">
      <div className="gl-mount" ref={mountRef} />
      {empty && <div className="map-hint">아직 분석된 이미지가 없습니다. 왼쪽에서 이미지를 추가하세요.</div>}
      <div className="gl-hint">{space?.mode === 'sim' ? '드래그 이동 · 휠 줌 · 거리=닮음' : '드래그 회전 · 휠 줌'}</div>
    </div>
  );
}

// ─────────────────────────────────────────────
function clearGroup(g: THREE.Group) {
  for (let i = g.children.length - 1; i >= 0; i--) {
    const c = g.children[i]!;
    g.remove(c);
    const obj = c as THREE.Mesh | THREE.Sprite | THREE.LineSegments;
    const mat = obj.material as THREE.Material | (THREE.Material & { map?: THREE.Texture });
    if (mat) {
      if ('map' in mat && mat.map) (mat.map as THREE.Texture).dispose();
      mat.dispose();
    }
    const geo = (obj as THREE.LineSegments).geometry as THREE.BufferGeometry | undefined;
    geo?.dispose?.();
  }
}

function rebuild(gl: GL, space: SpaceResponse, colorBy: string, taxonomy: TaxonomyResponse | null) {
  const sim = space.mode === 'sim';
  gl.decor.visible = !sim;
  gl.labels.visible = !sim;
  buildLabels(gl, space, taxonomy);
  buildSprites(gl, space, colorBy);
  buildEdges(gl, space);
  buildClusterLabels(gl, space);
}

function buildLabels(gl: GL, space: SpaceResponse, taxonomy: TaxonomyResponse | null) {
  clearGroup(gl.labels);
  if (space.mode === 'sim') return;
  const scalarLabel = (k: string) => taxonomy?.scalar.find((d) => d.key === k)?.label ?? k;
  const text = (axis: string, n: number) => (axis === 'pca' ? `주성분 ${n}` : scalarLabel(axis));
  gl.labels.add(makeLabel(text(space.xAxis, 1), '#e2716a', new THREE.Vector3(R + 0.9, -R, -R)));
  gl.labels.add(makeLabel(text(space.yAxis, 2), '#5fd693', new THREE.Vector3(-R, R + 0.6, -R)));
  gl.labels.add(makeLabel(text(space.zAxis, 3), '#7cc4ff', new THREE.Vector3(-R, -R, R + 0.9)));
}

/** 크기 = 디테일 스칼라(0.5~1.1). */
function sizeOf(scores: Record<string, number>): number {
  return 0.5 + (scores.detail ?? 0.5) * 0.6;
}

function buildSprites(gl: GL, space: SpaceResponse, colorBy: string) {
  clearGroup(gl.sprites);
  gl.byId.clear();
  for (const p of space.points) {
    const border = p.labels[colorBy] ? labelColor(p.labels[colorBy]!) : '#3a4555';
    const base = sizeOf(p.scores);
    const sp = makeSprite(p.id, border, base, new THREE.Vector3(w(p.x), w(p.y), w(p.z)), api.blobUrl(p.blobId));
    gl.sprites.add(sp);
    gl.byId.set(p.id, sp);
  }
}

/** sim 모드 k-NN 간선. */
function buildEdges(gl: GL, space: SpaceResponse) {
  clearGroup(gl.edges);
  if (space.mode !== 'sim' || space.edges.length === 0) return;
  const pts = space.points;
  const verts: number[] = [];
  for (const [a, b] of space.edges) {
    const pa = pts[a];
    const pb = pts[b];
    if (!pa || !pb) continue;
    verts.push(w(pa.x), w(pa.y), w(pa.z), w(pb.x), w(pb.y), w(pb.z));
  }
  if (verts.length === 0) return;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  gl.edges.add(
    new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({ color: 0x3a4555, transparent: true, opacity: 0.5 }),
    ),
  );
}

/** sim 모드 군집 라벨(군집 중심 위). */
function buildClusterLabels(gl: GL, space: SpaceResponse) {
  clearGroup(gl.clusterLabels);
  if (space.mode !== 'sim' || space.clusters.length === 0) return;
  const sum = new Map<number, { x: number; y: number; z: number; n: number }>();
  for (const p of space.points) {
    const s = sum.get(p.clusterId) ?? { x: 0, y: 0, z: 0, n: 0 };
    s.x += p.x; s.y += p.y; s.z += p.z; s.n++;
    sum.set(p.clusterId, s);
  }
  for (const c of space.clusters) {
    const s = sum.get(c.id);
    if (!s || s.n === 0) continue;
    const pos = new THREE.Vector3(w(s.x / s.n), w(s.y / s.n) + 0.9, w(s.z / s.n));
    gl.clusterLabels.add(makeLabel(`${c.label} · ${c.count}`, '#8b98a8', pos));
  }
}

function makeSprite(id: string, border: string, base: number, pos: THREE.Vector3, url: string): THREE.Sprite {
  const mat = new THREE.SpriteMaterial({ color: new THREE.Color(border) });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(base, base, 1);
  sp.position.copy(pos);
  sp.userData = { id, base };
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    mat.map = thumbTexture(img, border);
    mat.color.set('#ffffff');
    mat.needsUpdate = true;
  };
  img.src = url;
  return sp;
}

function thumbTexture(img: HTMLImageElement, border: string): THREE.CanvasTexture {
  const N = 128;
  const c = document.createElement('canvas');
  c.width = N;
  c.height = N;
  const x = c.getContext('2d')!;
  const s = Math.max(N / img.width, N / img.height);
  const dw = img.width * s;
  const dh = img.height * s;
  x.drawImage(img, (N - dw) / 2, (N - dh) / 2, dw, dh);
  x.lineWidth = 10;
  x.strokeStyle = border;
  x.strokeRect(5, 5, N - 10, N - 10);
  return new THREE.CanvasTexture(c);
}

function makeLabel(text: string, color: string, pos: THREE.Vector3): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const x = c.getContext('2d')!;
  x.fillStyle = color;
  x.font = '500 38px Inter, sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(text, 128, 34);
  const sp = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false }),
  );
  sp.scale.set(1.6, 0.4, 1);
  sp.position.copy(pos);
  return sp;
}

function applySelection(gl: GL, sel: string | null) {
  gl.byId.forEach((sp, id) => {
    const base = (sp.userData.base as number) ?? 0.7;
    const s = id === sel ? base * 1.5 : base;
    sp.scale.set(s, s, 1);
    sp.renderOrder = id === sel ? 2 : 0;
  });
}
