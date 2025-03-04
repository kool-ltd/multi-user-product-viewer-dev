// app.js

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DragControls } from 'three/addons/controls/DragControls.js';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { InteractionManager } from './InteractionManager.js';
import { setupUIControls, updateToggleUI } from './uiControls.js';

// Ensure your socket.io client library is loaded on the page.
const io = window.io;

class App {
  constructor() {
    // Maps, flags, and initial state.
    this.loadedModels = new Map();
    this.draggableObjects = [];
    this.isARMode = false;
    this.socket = io();
    this.isDragging = false;

    // Determine initial role based on URL parameters.
    const urlParams = new URLSearchParams(window.location.search);
    this.isHost = urlParams.get('role') === 'host';

    // Create the loading overlay.
    this.createLoadingOverlay();

    // Setup loading manager.
    this.loadingManager = new THREE.LoadingManager(() => {
      const overlay = document.getElementById('loading-overlay');
      if (overlay) {
        overlay.style.display = 'none';
      }
    });
    this.loadingManager.onProgress = (url, loaded, total) => {
      const loadingText = document.getElementById('loading-text');
      if (loadingText) {
        loadingText.textContent = `Loading ${Math.round((loaded / total) * 100)}%`;
      }
    };

    // Create loaders.
    this.gltfLoader = new GLTFLoader(this.loadingManager);
    this.rgbeLoader = new RGBELoader(this.loadingManager);

    // Initialize the scene, camera, and renderer.
    this.init();
    this.setupScene();
    this.setupLights();
    this.setupInitialControls();

    // Set up the UI controls from a separate module.
    setupUIControls(this);

    // Setup socket listeners.
    this.setupSocketListeners();

    // Create the interaction manager.
    this.interactionManager = new InteractionManager(
      this.scene,
      this.camera,
      this.renderer,
      this.renderer.domElement
    );

    if (this.isHost) {
      // If the current role is host, register immediately.
      this.socket.emit('register-host');
    }

    // Start the animation loop.
    this.animate();
  }

  setupSocketListeners() {
    // When a viewer’s host request is forwarded to the current host.
    this.socket.on('host-transfer-request', (data) => {
      if (this.isHost) {
        const confirmTransfer = confirm(
          "A viewer has requested to become host. Do you want to relinquish your host role?"
        );
        if (confirmTransfer) {
          this.socket.emit('release-host', { requestId: data.requestId });
        } else {
          this.socket.emit('deny-host', { requestId: data.requestId });
        }
      }
    });
  
    // When a host request is immediately denied (for example, because a host is already active).
    this.socket.on('transfer-denied', (data) => {
      alert("The current host has denied your request to become host.");
      // Cancel any pending request since a denial was issued.
      this.hostRequestPending = false;
      if (this.hostRequestTimer) {
        clearTimeout(this.hostRequestTimer);
        this.hostRequestTimer = null;
      }
    });
  
    // When the host changes, either because someone became host or the host gave up.
    this.socket.on('host-changed', (data) => {
      // data.hostSocketId is the current host's socket (or null if no host is active).
      this.currentHostId = data.hostSocketId;
      // Set role: if hostSocketId exists and equals this client's id, then you are host.
      this.isHost = data.hostSocketId ? (data.hostSocketId === this.socket.id) : false;
      console.log("Host changed; new hostSocketId:", data.hostSocketId, "isHost:", this.isHost);
  
      // Clear the host request pending state (if any).
      this.hostRequestPending = false;
      if (this.hostRequestTimer) {
        clearTimeout(this.hostRequestTimer);
        this.hostRequestTimer = null;
      }
      
      // Update the toggle UI to reflect your new role.
      if (this.toggleUI) {
        updateToggleUI(this, this.toggleUI.viewerButton, this.toggleUI.hostButton, this.isHost);
      }
    });
  
    // When receiving model transform events from the host.
    this.socket.on('model-transform', (modelState) => {
      if (!this.isHost) {
        const object = this.loadedModels.get(modelState.customId);
        if (object) {
          object.position.fromArray(modelState.position);
          object.rotation.fromArray(modelState.rotation);
          object.scale.fromArray(modelState.scale);
        } else {
          console.log(`No matching model found for customId: ${modelState.customId}`);
        }
      }
    });
  
    // When receiving camera update events from the host.
    this.socket.on('camera-update', (cameraState) => {
      if (!this.isHost) {
        this.camera.position.fromArray(cameraState.position);
        this.camera.rotation.fromArray(cameraState.rotation);
        if (this.orbitControls) {
          this.orbitControls.target.fromArray(cameraState.target);
          this.orbitControls.update();
        }
      }
    });
  }

  onWindowResize() {
    if (this.camera && this.renderer) {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
  }

  init() {
    this.container = document.getElementById('scene-container');
    this.scene = new THREE.Scene();

    // Create a group for your product parts.
    this.productGroup = new THREE.Group();
    this.scene.add(this.productGroup);

    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.camera.position.set(0, 0, 3);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.xr.enabled = true;
    this.container.appendChild(this.renderer.domElement);

    window.addEventListener('resize', this.onWindowResize.bind(this));
  }

  setupScene() {
    this.scene.background = new THREE.Color(0xcccccc);
    this.rgbeLoader.load(
      'https://raw.githubusercontent.com/kool-ltd/product-viewer/main/assets/brown_photostudio_02_4k.hdr',
      (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping;
        this.scene.environment = texture;
        this.renderer.physicallyCorrectLights = true;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 0.7;
        this.renderer.outputEncoding = THREE.sRGBEncoding;
      }
    );
  }

  setupLights() {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(5, 5, 5);
    this.scene.add(directionalLight);
  }

  setupInitialControls() {
    this.orbitControls = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.05;
    this.orbitControls.addEventListener('change', () => {
      if (this.isHost) {
        const cameraState = {
          position: this.camera.position.toArray(),
          rotation: this.camera.rotation.toArray(),
          target: this.orbitControls.target.toArray()
        };
        console.log("Host emitting camera-update:", cameraState);
        this.socket.emit('camera-update', cameraState);
      }
    });

    this.dragControls = new DragControls(this.draggableObjects, this.camera, this.renderer.domElement);
    this.dragControls.enabled = true;
    this.setupControlsEventListeners();

    // Let DragControls handle touch events.
    this.renderer.domElement.addEventListener('touchstart', (event) => {});
  }

  setupControlsEventListeners() {
    this.dragControls.addEventListener('dragstart', () => {
      this.orbitControls.enabled = false;
      this.isDragging = true;
    });

    this.dragControls.addEventListener('dragend', () => {
      this.orbitControls.enabled = true;
      this.isDragging = false;
    });

    this.dragControls.addEventListener('drag', (event) => {
      const object = event.object;
      if (object.userData.originalScale) {
        object.scale.copy(object.userData.originalScale);
      }
      if (this.isHost) {
        const modelState = {
          customId: object.name,
          position: object.position.toArray(),
          rotation: object.rotation.toArray(),
          scale: object.scale.toArray()
        };
        console.log("Host emitting model-transform:", modelState);
        this.socket.emit('model-transform', modelState);
      }
    });
  }

  updateDragControls() {
    const draggableObjects = Array.from(this.loadedModels.values());
    if (this.dragControls) {
      this.dragControls.dispose();
    }
    this.dragControls = new DragControls(draggableObjects, this.camera, this.renderer.domElement);
    this.setupControlsEventListeners();
  }

  clearExistingModels() {
    this.loadedModels.forEach(model => {
      this.productGroup.remove(model);
    });
    this.loadedModels.clear();
    this.draggableObjects.length = 0;
    this.updateDragControls();
    if (this.isHost) {
      this.socket.emit('models-cleared');
    }
  }

  loadModel(url, name) {
    this.gltfLoader.load(
      url,
      (gltf) => {
        const model = gltf.scene;
        const container = new THREE.Group();
        container.name = name;
        container.userData.isDraggable = true;
        container.add(model);

        // Custom raycast for container.
        container.raycast = function (raycaster, intersects) {
          const box = new THREE.Box3().setFromObject(container);
          if (!box.isEmpty()) {
            const intersectionPoint = new THREE.Vector3();
            if (raycaster.ray.intersectBox(box, intersectionPoint)) {
              const distance = raycaster.ray.origin.distanceTo(intersectionPoint);
              intersects.push({
                distance: distance,
                point: intersectionPoint.clone(),
                object: container
              });
            }
          }
        };

        this.draggableObjects.push(container);
        this.productGroup.add(container);
        this.loadedModels.set(name, container);
        this.updateDragControls();
        this.fitCameraToScene();

        if (this.isHost) {
          this.socket.emit('model-loaded', { url, name });
        }

        console.log(`Loaded model: ${name}`);
      },
      (xhr) => {
        console.log(`${name} ${(xhr.loaded / xhr.total * 100).toFixed(2)}% loaded`);
      },
      (error) => {
        console.error(`Error loading model ${name}:`, error);
      }
    );
  }

  fitCameraToScene() {
    const box = new THREE.Box3().setFromObject(this.productGroup);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = this.camera.fov * (Math.PI / 180);
    let cameraZ = Math.abs(maxDim / Math.tan(fov / 2));
    cameraZ *= 1.2;
    this.camera.position.set(center.x, center.y, center.z + cameraZ);
    this.orbitControls.target.copy(center);
    this.camera.updateProjectionMatrix();
    this.orbitControls.update();
  }

  async loadDefaultProduct() {
    const parts = [
      { name: 'blade', file: 'kool-mandoline-blade.glb' },
      { name: 'frame', file: 'kool-mandoline-frame.glb' },
      { name: 'handguard', file: 'kool-mandoline-handguard.glb' },
      { name: 'handle', file: 'kool-mandoline-handletpe.glb' }
    ];

    this.clearExistingModels();

    for (const part of parts) {
      await new Promise((resolve, reject) => {
        this.gltfLoader.load(
          `assets/${part.file}`,
          (gltf) => {
            const model = gltf.scene;
            const container = new THREE.Group();
            container.name = part.name;
            container.userData.isDraggable = true;
            container.add(model);

            container.raycast = function (raycaster, intersects) {
              const box = new THREE.Box3().setFromObject(container);
              if (!box.isEmpty()) {
                const intersectionPoint = new THREE.Vector3();
                if (raycaster.ray.intersectBox(box, intersectionPoint)) {
                  const distance = raycaster.ray.origin.distanceTo(intersectionPoint);
                  intersects.push({
                    distance: distance,
                    point: intersectionPoint.clone(),
                    object: container
                  });
                }
              }
            };

            this.draggableObjects.push(container);
            this.productGroup.add(container);
            this.loadedModels.set(part.name, container);
            this.updateDragControls();
            this.fitCameraToScene();

            if (this.isHost) {
              this.socket.emit('model-loaded', { url: `assets/${part.file}`, name: part.name });
            }

            resolve();
          },
          undefined,
          (error) => {
            console.error(`Error loading model ${part.file}:`, error);
            reject(error);
          }
        );
      });
    }
    setTimeout(() => {
      this.interactionManager.setDraggableObjects(Array.from(this.loadedModels.values()));
    }, 1000);
  }

  animate() {
    this.renderer.setAnimationLoop(() => {
      if (!this.isDragging) {
        this.orbitControls.update();
      }
      this.interactionManager.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  createLoadingOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'loading-overlay';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.backgroundColor = '#cccccc';
    overlay.style.display = 'flex';
    overlay.style.flexDirection = 'column';
    overlay.style.justifyContent = 'center';
    overlay.style.alignItems = 'center';
    overlay.style.zIndex = '9999';
    overlay.innerHTML = `
      <div id="loading-spinner" style="
          border: 11px solid #d00024; 
          border-top: 11px solid #f3f3f3; 
          border-radius: 50%; 
          width: 84px; 
          height: 84px; 
          animation: spin 2s linear infinite;
      "></div>
      <div id="loading-text" style="color: #333; margin-top: 20px; font-size: 14px; font-family: sans-serif;">
          Loading...
      </div>
    `;
    const style = document.createElement('style');
    style.textContent = `
      @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
    document.body.appendChild(overlay);
  }
}

const app = new App();
app.loadDefaultProduct();

export default app;
