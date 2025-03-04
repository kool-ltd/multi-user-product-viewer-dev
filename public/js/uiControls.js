// uiControls.js
import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';

export function setupUIControls(app) {
  // Create a container for UI controls.
  const controlsContainer = document.createElement('div');
  controlsContainer.style.position = 'fixed';
  controlsContainer.style.top = '10px';
  controlsContainer.style.left = '10px';
  controlsContainer.style.zIndex = '1000';
  controlsContainer.style.display = 'flex';
  controlsContainer.style.alignItems = 'center';
  controlsContainer.style.gap = '10px';

  // ------------------------------
  // Viewer/Host Toggle
  // ------------------------------
  const toggleContainer = document.createElement('div');
  toggleContainer.style.display = 'inline-flex';
  toggleContainer.style.padding = '4px';
  toggleContainer.style.borderRadius = '9999px';
  toggleContainer.style.backgroundColor = '#d00024';

  // Create "Viewer" button.
  const viewerButton = document.createElement('button');
  viewerButton.textContent = 'Viewer';
  viewerButton.style.padding = '5px 15px';
  viewerButton.style.border = 'none';
  viewerButton.style.outline = 'none';
  viewerButton.style.borderRadius = '9999px';
  viewerButton.style.cursor = 'pointer';
  viewerButton.style.transition = 'background-color 0.3s ease, color 0.3s ease';

  // Create "Host" button.
  const hostButton = document.createElement('button');
  hostButton.textContent = 'Host';
  hostButton.style.padding = '5px 15px';
  hostButton.style.border = 'none';
  hostButton.style.outline = 'none';
  hostButton.style.borderRadius = '9999px';
  hostButton.style.cursor = 'pointer';
  hostButton.style.transition = 'background-color 0.3s ease, color 0.3s ease';

  // Initial styling.
  updateToggleUI(app, viewerButton, hostButton, app.isHost);

  // When clicking "Viewer":
  viewerButton.addEventListener('click', () => {
    if (app.isHost) {
      const confirmQuit = confirm("Do you want to relinquish your host role and become a viewer?");
      if (confirmQuit) {
        app.socket.emit('give-up-host');
        // The server will then emit a "host-changed" event.
      }
    }
    // If already viewer, no action is needed.
  });

  // When clicking "Host":
  hostButton.addEventListener('click', () => {
    if (!app.isHost) {
      app.socket.emit('request-host');
      // Wait for the "host-changed" event to update the UI.
    }
  });

  toggleContainer.appendChild(viewerButton);
  toggleContainer.appendChild(hostButton);
  controlsContainer.appendChild(toggleContainer);

  // Store references to toggle buttons on the app instance so that
  // other parts of the code (e.g., socket events) can update their style.
  app.toggleUI = { viewerButton, hostButton };

  // ------------------------------
  // Upload Button (Matching the style)
  // ------------------------------
  const uploadButton = document.createElement('button');
  uploadButton.textContent = 'Upload Model';
  uploadButton.style.padding = '8px 24px';
  uploadButton.style.border = 'none';
  uploadButton.style.outline = 'none';
  uploadButton.style.borderRadius = '9999px';
  uploadButton.style.backgroundColor = '#d00024';
  uploadButton.style.color = 'white';
  uploadButton.style.cursor = 'pointer';
  uploadButton.style.transition = 'background-color 0.3s ease, color 0.3s ease';

  uploadButton.addEventListener('mouseover', () => {
    uploadButton.style.backgroundColor = '#b0001d';
  });
  uploadButton.addEventListener('mouseout', () => {
    uploadButton.style.backgroundColor = '#d00024';
  });

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.glb,.gltf';
  fileInput.style.display = 'none';
  fileInput.multiple = true;
  fileInput.onchange = (event) => {
    app.clearExistingModels();
    const files = event.target.files;
    for (let file of files) {
      const url = URL.createObjectURL(file);
      const name = file.name.replace('.glb', '').replace('.gltf', '');
      app.loadModel(url, name);
      if (app.isHost) {
        app.socket.emit('model-loaded', { url, name });
      }
    }
  };

  uploadButton.onclick = () => fileInput.click();

  controlsContainer.appendChild(uploadButton);
  controlsContainer.appendChild(fileInput);

  // ------------------------------
  // Optional: AR Button (if supported)
  // ------------------------------
  if ('xr' in navigator) {
    const arButton = ARButton.createButton(app.renderer, {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay'],
      domOverlay: { root: document.body }
    });
    arButton.style.position = 'fixed';
    controlsContainer.appendChild(arButton);

    app.renderer.xr.addEventListener('sessionstart', () => {
      console.log("AR session started");
      app.isARMode = true;
      app.scene.background = null;
      app.renderer.setClearColor(0x000000, 0);
      if (app.isHost) {
        app.socket.emit('ar-session-start');
      }
    });
    app.renderer.xr.addEventListener('sessionend', () => {
      console.log("AR session ended");
      app.isARMode = false;
      app.scene.background = new THREE.Color(0xcccccc);
      app.renderer.setClearColor(0xcccccc, 1);
      if (app.isHost) {
        app.socket.emit('ar-session-end');
      }
    });
  }

  document.body.appendChild(controlsContainer);
}

// Helper to update the toggle UI based on the current host flag.
export function updateToggleUI(app, viewerButton, hostButton, isHost) {
  if (isHost) {
    hostButton.style.backgroundColor = 'white';
    hostButton.style.color = '#d00024';
    viewerButton.style.backgroundColor = 'transparent';
    viewerButton.style.color = 'white';
  } else {
    viewerButton.style.backgroundColor = 'white';
    viewerButton.style.color = '#d00024';
    hostButton.style.backgroundColor = 'transparent';
    hostButton.style.color = 'white';
  }
}
