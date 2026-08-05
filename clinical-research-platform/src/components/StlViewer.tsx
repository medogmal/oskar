import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { apiBaseUrl } from '../lib/auth';

type MeasurementPoint = {
  id: string;
  x: number;
  y: number;
  z: number;
};

type StlViewerProps = {
  studyId: string;
  fileId: string;
  fileName: string;
  token: string;
  className?: string;
};

const pointToVector = (point: MeasurementPoint) => new THREE.Vector3(point.x, point.y, point.z);

function StlViewer({ studyId, fileId, fileName, token, className }: StlViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const measurementGroupRef = useRef<THREE.Group | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const frameRef = useRef<number | null>(null);
  const loaderRef = useRef(new STLLoader());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [autoRotate, setAutoRotate] = useState(true);
  const [measurementPoints, setMeasurementPoints] = useState<MeasurementPoint[]>([]);

  const measurements = useMemo(() => {
    if (measurementPoints.length < 2) {
      return { distance: null as number | null, angle: null as number | null };
    }

    const first = pointToVector(measurementPoints[0]);
    const second = pointToVector(measurementPoints[1]);
    const distance = first.distanceTo(second);

    if (measurementPoints.length < 3) {
      return { distance, angle: null as number | null };
    }

    const third = pointToVector(measurementPoints[2]);
    const vectorA = first.clone().sub(second).normalize();
    const vectorB = third.clone().sub(second).normalize();
    const radians = vectorA.angleTo(vectorB);
    return { distance, angle: THREE.MathUtils.radToDeg(radians) };
  }, [measurementPoints]);

  useEffect(() => {
    if (controlsRef.current) {
      controlsRef.current.autoRotate = autoRotate;
    }
  }, [autoRotate]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    setIsLoading(true);
    setError('');
    setMeasurementPoints([]);
    container.innerHTML = '';

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#f8fafc');
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
    camera.position.set(0, 0, 160);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    rendererRef.current = renderer;
    container.appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.8);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.4);
    directionalLight.position.set(40, 80, 120);
    scene.add(ambientLight, directionalLight);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.2;
    controls.screenSpacePanning = true;
    controlsRef.current = controls;

    const measurementGroup = new THREE.Group();
    measurementGroupRef.current = measurementGroup;
    scene.add(measurementGroup);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const resize = () => {
      const width = Math.max(container.clientWidth, 320);
      const height = Math.max(container.clientHeight, 320);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };

    resize();
    resizeObserverRef.current = new ResizeObserver(resize);
    resizeObserverRef.current.observe(container);

    const handleClick = (event: MouseEvent) => {
      if (!meshRef.current) {
        return;
      }

      const bounds = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
      pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);

      const intersections = raycaster.intersectObject(meshRef.current, false);
      if (!intersections[0]) {
        return;
      }

      const hit = intersections[0].point;
      setMeasurementPoints((current) => {
        const nextPoint: MeasurementPoint = {
          id: `point_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          x: hit.x,
          y: hit.y,
          z: hit.z,
        };
        return [...current.slice(-2), nextPoint];
      });
    };

    renderer.domElement.addEventListener('click', handleClick);

    const abortController = new AbortController();
    const loadMesh = async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/studies/${studyId}/files/${fileId}/download`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          signal: abortController.signal,
        });

        if (!response.ok) {
          throw new Error('Unable to load STL file');
        }

        const buffer = await response.arrayBuffer();
        const geometry = loaderRef.current.parse(buffer);
        geometry.computeVertexNormals();
        geometry.center();

        const material = new THREE.MeshStandardMaterial({
          color: new THREE.Color('#0f766e'),
          metalness: 0.12,
          roughness: 0.45,
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);
        meshRef.current = mesh;

        const box = new THREE.Box3().setFromObject(mesh);
        const size = box.getSize(new THREE.Vector3());
        const maxDimension = Math.max(size.x, size.y, size.z) || 1;
        camera.position.set(maxDimension * 0.8, maxDimension * 0.45, maxDimension * 1.4);
        camera.lookAt(0, 0, 0);
        controls.target.set(0, 0, 0);
        controls.update();
      } catch (loadError) {
        if (!abortController.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : 'تعذر تحميل ملف STL الحالي.');
        }
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    void loadMesh();

    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      frameRef.current = window.requestAnimationFrame(animate);
    };

    animate();

    return () => {
      abortController.abort();
      renderer.domElement.removeEventListener('click', handleClick);
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;

      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }

      controls.dispose();
      renderer.dispose();
      scene.traverse((object: THREE.Object3D) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          if (Array.isArray(object.material)) {
            object.material.forEach((material: THREE.Material) => material.dispose());
          } else {
            (object.material as THREE.Material).dispose();
          }
        }
      });

      container.innerHTML = '';
      meshRef.current = null;
      measurementGroupRef.current = null;
      controlsRef.current = null;
      rendererRef.current = null;
      cameraRef.current = null;
      sceneRef.current = null;
    };
  }, [fileId, studyId, token]);

  useEffect(() => {
    const measurementGroup = measurementGroupRef.current;
    if (!measurementGroup) {
      return;
    }

    measurementGroup.clear();
    const markerMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color('#dc2626') });
    const lineMaterial = new THREE.LineBasicMaterial({ color: new THREE.Color('#2563eb') });

    const vectors = measurementPoints.map(pointToVector);
    for (const vector of vectors) {
      const marker = new THREE.Mesh(new THREE.SphereGeometry(1.8, 24, 24), markerMaterial.clone());
      marker.position.copy(vector);
      measurementGroup.add(marker);
    }

    if (vectors.length >= 2) {
      const firstSegmentGeometry = new THREE.BufferGeometry().setFromPoints([vectors[0], vectors[1]]);
      measurementGroup.add(new THREE.Line(firstSegmentGeometry, lineMaterial.clone()));
    }

    if (vectors.length >= 3) {
      const secondSegmentGeometry = new THREE.BufferGeometry().setFromPoints([vectors[1], vectors[2]]);
      measurementGroup.add(new THREE.Line(secondSegmentGeometry, lineMaterial.clone()));
    }
  }, [measurementPoints]);

  return (
    <div className={`rounded-2xl border border-slate-200 bg-white p-4 ${className ?? ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-black text-slate-900">STL Viewer</p>
          <p className="text-xs font-bold text-slate-500">{fileName}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setAutoRotate((current) => !current)}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            {autoRotate ? 'إيقاف الدوران' : 'تشغيل الدوران'}
          </button>
          <button
            type="button"
            onClick={() => setMeasurementPoints([])}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            مسح القياسات
          </button>
        </div>
      </div>

      <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50">
        <div ref={containerRef} className="h-[360px] w-full overflow-hidden rounded-2xl" />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[1.5fr_1fr]">
        <div className="rounded-2xl bg-slate-50 p-3 text-xs text-slate-600">
          <p className="font-black text-slate-800">إرشادات الاستخدام</p>
          <p className="mt-1">اسحب بالماوس للدوران 360 درجة، واستخدم العجلة للتكبير والتصغير.</p>
          <p className="mt-1">انقر على نقطتين لحساب المسافة بينهما، وعلى ثلاث نقاط لحساب الزاوية عند النقطة الثانية.</p>
          {isLoading ? <p className="mt-2 font-bold text-slate-500">جارٍ تحميل النموذج ثلاثي الأبعاد...</p> : null}
          {error ? <p className="mt-2 font-bold text-rose-600">{error}</p> : null}
        </div>

        <div className="rounded-2xl bg-slate-50 p-3 text-xs text-slate-600">
          <p className="font-black text-slate-800">القياسات الحالية</p>
          <p className="mt-2">عدد النقاط المختارة: {measurementPoints.length}/3</p>
          <p className="mt-1">
            المسافة: {measurements.distance !== null ? `${measurements.distance.toFixed(2)} units` : 'اختر نقطتين'}
          </p>
          <p className="mt-1">
            الزاوية: {measurements.angle !== null ? `${measurements.angle.toFixed(2)}°` : 'اختر ثلاث نقاط'}
          </p>
        </div>
      </div>
    </div>
  );
}

export default StlViewer;
