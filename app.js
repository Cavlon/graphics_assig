import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {NURBSSurface} from 'three/addons/curves/NURBSSurface.js';
import {ParametricGeometry} from 'three/addons/geometries/ParametricGeometry.js';

////////////////////////////////////////////////////////////////////////////
// SETUP
////////////////////////////////////////////////////////////////////////////
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const COLORS = {
    WHITE: 0xffffff,
    TREE_BROWN: 0x8b4513,
    LEAF_GREEN: 0x2e8b57,
    GRASS_LIGHT: 0x2ecc71,
    SKY_BLUE: 0x87ceeb,
}

////////////////////////////////////////////////////////////////////////////
// CAMERA
////////////////////////////////////////////////////////////////////////////
const orbitControls = new OrbitControls(camera, renderer.domElement);
orbitControls.enableDamping = true;
orbitControls.dampingFactor = 0.05;

const controls = {
    moveSpeed: 1,
    direction: {left: false, right: false, forward: false, backward: false, up: false, down: false},
}

window.addEventListener('keydown', (event) => {
    switch (event.key) {
        case 'a': controls.direction.left = true; break;
        case 'd': controls.direction.right = true; break;
        case 'w': controls.direction.forward = true; break;
        case 's': controls.direction.backward = true; break;
        case 'e': controls.direction.up = true; break;
        case 'q': controls.direction.down = true; break;
    }
})

window.addEventListener('keyup', (event) => {
    switch (event.key) {
        case 'a': controls.direction.left = false; break;
        case 'd': controls.direction.right = false; break;
        case 'w': controls.direction.forward = false; break;
        case 's': controls.direction.backward = false; break;
        case 'e': controls.direction.up = false; break;
        case 'q': controls.direction.down = false; break;
    }
})

function updateCamera() {
    if (controls.direction.left) camera.position.x -= controls.moveSpeed;
    if (controls.direction.right) camera.position.x += controls.moveSpeed;
    if (controls.direction.forward) camera.position.z -= controls.moveSpeed;
    if (controls.direction.backward) camera.position.z += controls.moveSpeed;
    if (controls.direction.up) camera.position.y += controls.moveSpeed;
    if (controls.direction.down) camera.position.y -= controls.moveSpeed;
    orbitControls.update();
}

camera.position.set(0, 10, 20);
camera.lookAt(scene.position);

////////////////////////////////////////////////////////////////////////////
// LANDSCAPE
////////////////////////////////////////////////////////////////////////////
function generateKnots(degree, numPoints) {
    if (numPoints <= 0) return [];
    const n = numPoints - 1; // Last control point index
    const p = degree;
    const knots = [];

    // Repeat start knot (p+1) times (e.g., [0, 0, 0, 0...])
    for(let i=0; i<=p; i++) knots.push(0);
    
    // Internal knots (uniformly spaced)
    const count = n - p; 
    if (count > 0) {
        for(let i=1; i<=count; i++) knots.push(i / (count + 1));
    }
    
    // Repeat end knot (p+1) times (e.g., ...1, 1, 1, 1])
    for(let i=0; i<=p; i++) knots.push(1);

    return knots;
}

function generatePatchControlPoints(dimension, heightData, minHeight=-4, maxHeight=4) {
    const controlPoints = []
    for (let i = 0; i < dimension; i++) {
        const row = [];
        for (let j = 0; j < dimension; j++) {

            const ind = (i + j * 16) * 4;
            const heightRatio = heightData[ind] / 255;
        
            const x = i - (dimension-1) / 2;
            const y = minHeight + (maxHeight - minHeight) * heightRatio;
            const z = j - (dimension-1) / 2;
            
            row.push(new THREE.Vector4(x, y, z, 1));
        }
        controlPoints.push(row);
    }
    return controlPoints;
}

const patchDim = 16;
const degree = 3; 

const imgLoader = new THREE.ImageLoader();
imgLoader.load('heightmap.png', (image) => processHeightmap(image, degree, patchDim, 1.5));

function processHeightmap(heightmap, degree, dimension, scale=1) {
    const ctx = document.createElement('canvas').getContext('2d');
    const {width, height} = heightmap;
    ctx.canvas.width = width;
    ctx.canvas.height = height;
    ctx.drawImage(heightmap, 0, 0);
    const {data} = ctx.getImageData(0, 0, width, height);

    const knotsU = generateKnots(degree, width);
    const knotsV = generateKnots(degree, width);
    const controlPoints = generatePatchControlPoints(width, data, scale);

    const nurbsSurface = new NURBSSurface(degree, degree, knotsU, knotsV, controlPoints);

    const geometry = new ParametricGeometry((u, v, target) => nurbsSurface.getPoint(u, v, target), 50, 50);
    const material = new THREE.MeshStandardMaterial({ color: COLORS.GRASS_LIGHT, side: THREE.DoubleSide, wireframe: false });
    const terrain = new THREE.Mesh(geometry, material);

    terrain.scale.set(scale, scale, scale);
    terrain.position.y -= 2;

    scene.add(terrain);
}

////////////////////////////////////////////////////////////////////////////
// MISC EFFECTS
////////////////////////////////////////////////////////////////////////////
const sun = new THREE.DirectionalLight(COLORS.WHITE, 1.5);
sun.position.set(50, 100, 50);
scene.add(sun);
scene.add(new THREE.AmbientLight(0x606060));

scene.background = new THREE.Color(COLORS.SKY_BLUE);
scene.fog = new THREE.FogExp2(0x87CEEB, 0.005); 

////////////////////////////////////////////////////////////////////////////
// ANIMATION LOOP
////////////////////////////////////////////////////////////////////////////
function animate() {
    requestAnimationFrame(animate);
    updateCamera();
    renderer.render(scene, camera);
}

animate();