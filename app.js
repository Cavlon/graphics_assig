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
    DEBUG_RED: 0xff0000,
    DEBUG_ORANGE: 0xf2ad0d,
    DEBUG_YELLOW: 0xe4eb70,
    TREE_BROWN: 0x8b4513,
    LEAF_GREEN: 0x2e8b57,
    GRASS_LIGHT: 0x2ecc71,
    SKY_BLUE: 0x87ceeb,
}

const STATE = {
    wireframe: false,
    show_points: false,
    show_chunks: false,
}

////////////////////////////////////////////////////////////////////////////
// CAMERA
////////////////////////////////////////////////////////////////////////////
const orbitControls = new OrbitControls(camera, renderer.domElement);
orbitControls.enableDamping = true;
orbitControls.dampingFactor = 0.05;

window.addEventListener('keydown', (event) => {
    switch (event.key) {
        case 'x': 
            STATE.wireframe = !STATE.wireframe;
            scene.traverse((object) => {
                if (object instanceof THREE.Mesh) {
                    if (object.material) {
                        object.material.wireframe = STATE.wireframe;
                    }
                }
            });
            break;
        case 'c':
            STATE.show_points = !STATE.show_points;
            controlPointsMesh.visible = STATE.show_points;
            break;
        case 'z':
            STATE.show_chunks = !STATE.show_chunks;

            for (let i = 0; i < TERRAIN_CONFIG.chunks.length; i++) {
                let orangeMat = grassMat.clone();
                let yellowMat = grassMat.clone();

                orangeMat.color.set(COLORS.DEBUG_ORANGE);
                yellowMat.color.set(COLORS.DEBUG_YELLOW);

                TERRAIN_CONFIG.chunks[i].levels.forEach(level => {
                    const obj = level.object;

                    if (STATE.show_chunks) {
                        if (i % 2 == 0) {
                            obj.material = orangeMat;
                        } else {
                            obj.material = yellowMat;
                        }
                    } else {
                        obj.material = grassMat;
                    }
                })
            }
            break;
    }
})

camera.position.set(0, 20, 50);
camera.lookAt(scene.position);

////////////////////////////////////////////////////////////////////////////
// TERRAIN
////////////////////////////////////////////////////////////////////////////
function generateKnots(degree, numPoints) {
    /*
        Generates unclamped knots, taken from lecture example code
    */
    const n = numPoints - 1;
    const p = degree;
    const knots = [];

    const len = n + p + 2;
    for(let i=0; i<len; i++) knots.push(i / (len - 1));

    return knots;
}

function generateChunkControlPoints(dimension, heightData, mapDim, globalXOffset, globalZOffset, weightScale, minHeight=-4, maxHeight=4, pushPoints = true) {
    /*
        Uses heightmap data to create control points for a chunk with the given heights
    */
    const chunkControlPoints = []
    for (let i = 0; i < dimension; i++) {
        const row = [];
        const xOffset = globalXOffset + i

        for (let j = 0; j < dimension; j++) {
            const zOffset = j + globalZOffset

            // find the index of the corresponding heightmap pixel
            const ind = (xOffset + zOffset * mapDim) * 4;

            // find how high this pixel is
            const heightRatio = heightData[ind] / 255;

            const weight = 1 + heightRatio * weightScale;
        
            const x = i;
            const y = minHeight + (maxHeight - minHeight) * heightRatio;    // interpolate the height of this control point using the ratio
            const z = j;
            
            const point = new THREE.Vector4(x, y, z, weight);
            row.push(point);
            if (pushPoints) TERRAIN_CONFIG.controlPoints.push(point);
        }
        chunkControlPoints.push(row);
    }
    return chunkControlPoints;
}

function generateTerrainMesh(data, degree, chunkDim, mapDim, knots, lods, pushPoints=true, tearBlock=false) {
    /*
        Generates the terrain mesh as a parametric b-spline surface from a heightmap
    */
    const terrain = new THREE.Group();

    // create each chunk
    for (let z = 0; z < TERRAIN_CONFIG.chunkCount; z++) {
        const zOffset = z * (chunkDim - 3);
        for (let x = 0; x < TERRAIN_CONFIG.chunkCount; x++) {
            const xOffset = x * (chunkDim - 3);

            // generate the chunk's control points according to the heightmap
            const chunkControlPoints = generateChunkControlPoints(chunkDim, data, mapDim, xOffset, zOffset, 1, -2, 5, pushPoints);

            // create the parametric suface according to the control points
            const nurbsSurface = new NURBSSurface(degree, degree, knots, knots, chunkControlPoints);
            const lod = new THREE.LOD();

            if (tearBlock) {
                // add the low res terrain under the main terrain to catch tears
                const culledChunk = new THREE.Object3D();
                lod.addLevel(culledChunk, 0);

                const geometry = new ParametricGeometry((u, v, target) => mapInternalSurface(u, v, target, nurbsSurface, knots[degree], knots[chunkDim]), 1, 1)

                // create rings of visible chunks around boundaries and cull the others since they won't be visible
                for (let i = 1; i < lods.length; i++) {
                    const chunk = new THREE.Mesh(geometry, grassMat);
                    lod.addLevel(chunk, lods[i][1]);
                    lod.addLevel(culledChunk, lods[i][1]+20);
                }
            } else {
                // create all the levels of detail
                for (let i = 0; i < lods.length; i++) {
                    const geometry = new ParametricGeometry((u, v, target) => mapInternalSurface(u, v, target, nurbsSurface, knots[degree], knots[chunkDim]), lods[i][0], lods[i][0])
                    const chunk = new THREE.Mesh(geometry, grassMat);
                    lod.addLevel(chunk, lods[i][1]);
                }
                TERRAIN_CONFIG.chunks.push(lod);
            }

            // position the chunk
            lod.position.set(xOffset, 0, zOffset);
            terrain.add(lod);
        }
    }
    return terrain;
}

function mapInternalSurface(u, v, target, surface, startT, endT) {
    /*
        Only render the surface for the internal control points
    */
    const range = endT - startT;
    const newU = startT + (u * range);
    const newV = startT + (v * range);

    surface.getPoint(newU, newV, target);
}

const TERRAIN_CONFIG = {
    heightmap: 'heightmap2.png',
    chunkCount: 25,
    chunkDim: 8,
    degree: 3,
    terrainScale: 1,
    lod_levels: [[15, 0], [5, 20], [3, 50]],
    controlPoints: [],
    chunks: [],
}

const grassMat = new THREE.MeshStandardMaterial({ color: COLORS.GRASS_LIGHT, side: THREE.BackSide});
let controlPointsMesh;

// load the heightmap and process it
const imgLoader = new THREE.ImageLoader();
imgLoader.load(TERRAIN_CONFIG.heightmap, (image) => generateTerrain(image, TERRAIN_CONFIG.degree, TERRAIN_CONFIG.terrainScale));

function generateTerrain(heightmap, degree, scale=1) {
    /*
        Generates the terrain
    */
    // extract the pixel data from the heightmap
    const ctx = document.createElement('canvas').getContext('2d');
    const {width, height} = heightmap;
    ctx.canvas.width = width;
    ctx.canvas.height = height;
    ctx.drawImage(heightmap, 0, 0);
    const {data} = ctx.getImageData(0, 0, width, height);

    // round the number of chunks per axis to the nearest factor of the map size-3
    while ((width-3) % TERRAIN_CONFIG.chunkCount > 0) {
        if (TERRAIN_CONFIG.chunkCount == 1) break;
        TERRAIN_CONFIG.chunkCount--;
    }

    // calculate the necessary chunk dimension so the number of points matches the map size
    TERRAIN_CONFIG.chunkDim = ((width-3)/TERRAIN_CONFIG.chunkCount)+3;

    // generate the b-spline knots
    const knots = generateKnots(degree, TERRAIN_CONFIG.chunkDim);

    // generate the terrain mesh
    const terrain = generateTerrainMesh(data, degree, TERRAIN_CONFIG.chunkDim, width, knots, TERRAIN_CONFIG.lod_levels);
    terrain.position.set(-(width)/2, 0, -(width)/2);
    terrain.scale.setScalar(scale);
    scene.add(terrain);

    // the lods cause tearing so a low resolution version of the terrain is added underneath to visually hide tears
    const tearBlock = generateTerrainMesh(data, degree, TERRAIN_CONFIG.chunkDim, width, knots, TERRAIN_CONFIG.lod_levels, false, true);
    tearBlock.position.set(-(width)/2, -1, -(width)/2);
    tearBlock.scale.setScalar(scale);
    scene.add(tearBlock);

    // visualise the control points for debugging
    controlPointsMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.2, 3, 2), new THREE.MeshStandardMaterial({color: COLORS.DEBUG_RED}), TERRAIN_CONFIG.controlPoints.length);
    controlPointsMesh.position.set(-width/2, 0, -width/2);
    controlPointsMesh.visible = STATE.show_points;

    // set the positions for each control point
    const dummy = new THREE.Object3D();
    let ind = 0
    for (let z = 0; z < TERRAIN_CONFIG.chunkCount; z++) {
        const zOffset = z * (TERRAIN_CONFIG.chunkDim - 3);
        for (let x = 0; x < TERRAIN_CONFIG.chunkCount; x++) {
            const xOffset = x * (TERRAIN_CONFIG.chunkDim - 3);
            for (let i = 0; i < TERRAIN_CONFIG.chunkDim; i++) {
                for (let j = 0; j < TERRAIN_CONFIG.chunkDim; j++) {
                    const p = TERRAIN_CONFIG.controlPoints[ind];

                    dummy.position.set((p.x + xOffset)*scale, p.y*scale, (p.z+zOffset)*scale);
                    dummy.updateMatrix();

                    controlPointsMesh.setMatrixAt(ind, dummy.matrix);
                    ind++;
                }
            }
        }
    }

    scene.add(controlPointsMesh);
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
    orbitControls.update();

    scene.traverse((object) => {
        if (object instanceof THREE.LOD) {
            object.update(camera);
        }
    });

    renderer.render(scene, camera);
}

animate();