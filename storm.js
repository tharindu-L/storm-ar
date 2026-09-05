'use strict';

// ── Config ────
const CFG = {
    // Open-Meteo: Colombo, Sri Lanka as default field location
    // Researchers can modify lat/lon at runtime via URL params
    weatherLat: parseFloat(new URLSearchParams(location.search).get('lat') ?? '6.9271'),
    weatherLon: parseFloat(new URLSearchParams(location.search).get('lon') ?? '79.8612'),
    weatherCity: new URLSearchParams(location.search).get('city') ?? 'Colombo',

    // USGS last 24h M1.0+ worldwide
    usgsUrl: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',

    openMeteoUrl(lat, lon) {
        return `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
            `&current=temperature_2m,weathercode,windspeed_10m,winddirection_10m&timezone=auto`;
    },

    updateIntervalMs: 30_000,

    // quake-grid layout
    gridCols: 5,
    gridRows: 5,
    cellSize: 0.3,          // metres per cell
    sphereScale: 0.04,      // radius = magnitude * scale
    depthShallow: 30,       // km
    depthMid: 70,
};

// ── State ─────
const STATE = {
    mode: 'marker',         // 'marker' | 'markerless'
    weather: null,
    quakes: [],
    gridAnchored: false,
    xrSession: null,
    xrHitTestSource: null,
    xrRefSpace: null,
    reticlePose: null,
};

// ── WMO weather-code → condition string ──────
const WMO_CODES = {
    0: 'CLEAR SKY', 1: 'MAINLY CLEAR', 2: 'PARTLY CLOUDY', 3: 'OVERCAST',
    45: 'FOGGY', 48: 'RIME FOG',
    51: 'LIGHT DRIZZLE', 53: 'DRIZZLE', 55: 'HEAVY DRIZZLE',
    61: 'LIGHT RAIN', 63: 'RAIN', 65: 'HEAVY RAIN',
    71: 'LIGHT SNOW', 73: 'SNOW', 75: 'HEAVY SNOW', 77: 'SNOW GRAINS',
    80: 'LIGHT SHOWERS', 81: 'SHOWERS', 82: 'HEAVY SHOWERS',
    85: 'SNOW SHOWERS', 86: 'HEAVY SNOW SHOWERS',
    95: 'THUNDERSTORM', 96: 'TSTORM + HAIL', 99: 'TSTORM + HEAVY HAIL',
};

function wmoToIcon(code) {
    if (code === 0 || code === 1) return 'sun';
    if (code >= 2 && code <= 48) return 'cloud';
    return 'rain';
}

function wmoToString(code) {
    return WMO_CODES[code] ?? `CODE ${code}`;
}

function setLocationLabel(cityName) {
    const input = document.getElementById('location-search');
    if (input) input.value = cityName || CFG.weatherCity;
}

async function searchLocation() {
    const input = document.getElementById('location-search');
    const query = (input?.value || '').trim();
    if (!query) {
        document.getElementById('mode-label').textContent = 'SEARCH — ENTER A CITY OR COUNTRY';
        return;
    }

    try {
        const geocodeUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=en&format=json`;
        const res = await fetch(geocodeUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const json = await res.json();
        const result = json.results && json.results[0];

        if (!result) {
            document.getElementById('mode-label').textContent = 'SEARCH — LOCATION NOT FOUND';
            return;
        }

        CFG.weatherLat = Number(result.latitude);
        CFG.weatherLon = Number(result.longitude);
        CFG.weatherCity = result.name || 'Unknown';
        setLocationLabel(CFG.weatherCity);
        document.getElementById('mode-label').textContent = `SEARCH — ${CFG.weatherCity.toUpperCase()} READY`;
        await fetchWeather();
    } catch (err) {
        console.error('[STORM] Location search failed:', err.message);
        document.getElementById('mode-label').textContent = 'SEARCH — FAILED TO RESOLVE LOCATION';
    }
}

// Wind direction degrees → compass
function degToCompass(deg) {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return dirs[Math.round(deg / 45) % 8];
}

// ── Data Fetch ───────
async function fetchWeather() {
    try {
        const url = CFG.openMeteoUrl(CFG.weatherLat, CFG.weatherLon);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const cur = json.current;
        STATE.weather = {
            temp: Math.round(cur.temperature_2m),
            code: cur.weathercode,
            wind: Math.round(cur.windspeed_10m),
            windDir: Math.round(cur.winddirection_10m),
        };
        updateWeatherHUD();
        updateWeatherGlobe();
    } catch (err) {
        console.error('[STORM] Weather fetch failed:', err.message);
        document.getElementById('w-cond').textContent = 'FETCH ERROR';
    }
}

async function fetchQuakes() {
    try {
        const res = await fetch(CFG.usgsUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        STATE.quakes = (json.features ?? []).slice(0, CFG.gridCols * CFG.gridRows);
        updateQuakeHUD();
        if (STATE.gridAnchored) {
            if (STATE.mode === 'markerless' && _xrGridGroup) _buildQuakeGridXR(window.THREE);
            else if (document.getElementById('quake-grid-root')) buildQuakeGrid();
        }
    } catch (err) {
        console.error('[STORM] Quake fetch failed:', err.message);
        document.getElementById('q-place').textContent = 'FETCH ERROR';
    }
}

async function fetchAll() {
    await Promise.all([fetchWeather(), fetchQuakes()]);
    const now = new Date();
    document.getElementById('last-update').textContent =
        `LAST UPDATE: ${now.toLocaleTimeString()}`;
}

// ── HUD Updates ───────
function updateWeatherHUD() {
    const w = STATE.weather;
    if (!w) return;
    document.getElementById('w-temp').textContent = `${w.temp}°C`;
    document.getElementById('w-cond').textContent = `${wmoToString(w.code)} · ${CFG.weatherCity.toUpperCase()}`;
    document.getElementById('w-wind').textContent = `${w.wind} km/h`;
    document.getElementById('w-dir').textContent = degToCompass(w.windDir);
}

function updateQuakeHUD() {
    if (!STATE.quakes.length) return;
    const latest = STATE.quakes[0].properties;
    document.getElementById('q-mag').textContent = `M ${latest.mag.toFixed(1)}`;
    document.getElementById('q-place').textContent = (latest.place ?? 'Unknown').substring(0, 28);
    document.getElementById('q-depth').textContent = `${Math.round(STATE.quakes[0].geometry.coordinates[2])} km`;
    document.getElementById('q-count').textContent = `${STATE.quakes.length} events (24h)`;
}

// ── weather-globe 3D update ───
function updateWeatherGlobe() {
    const w = STATE.weather;
    if (!w) return;
    const icon = wmoToIcon(w.code);
    const isThunderstorm = w.code >= 95;

    document.getElementById('wg-sun').setAttribute('visible', icon === 'sun');
    document.getElementById('wg-cloud').setAttribute('visible', icon === 'cloud');
    document.getElementById('wg-cloud-right').setAttribute('visible', icon === 'cloud');
    document.getElementById('wg-rain').setAttribute('visible', icon === 'rain');
    document.getElementById('wg-lightning').setAttribute('visible', isThunderstorm);

    document.getElementById('wg-temp-label').setAttribute('value', `${w.temp}°C`);
    document.getElementById('wg-cond-label').setAttribute('value', wmoToString(w.code));
}

// ── quake-grid 3D build ──────
function depthColor(depth) {
    if (depth < CFG.depthShallow) return '#00ff44';
    if (depth < CFG.depthMid) return '#ffaa00';
    return '#ff3300';
}

function buildQuakeGrid() {
    const root = document.getElementById('quake-grid-root');
    // Clear previous children
    while (root.firstChild) root.removeChild(root.firstChild);

    const cols = CFG.gridCols;
    const rows = CFG.gridRows;
    const cs = CFG.cellSize;
    const w = cols * cs;
    const h = rows * cs;
    const ox = -w / 2 + cs / 2;
    const oz = -h / 2 + cs / 2;

    // ── Grid lines ──
    for (let i = 0; i <= cols; i++) {
        const x = -w / 2 + i * cs;
        const line = document.createElement('a-box');
        line.setAttribute('color', '#00ff88');
        line.setAttribute('opacity', '0.4');
        line.setAttribute('width', '0.005');
        line.setAttribute('height', '0.005');
        line.setAttribute('depth', `${h}`);
        line.setAttribute('position', `${x} 0 0`);
        line.setAttribute('material', 'color:#00ff88;emissive:#00ff88;emissiveIntensity:0.3;opacity:0.5;transparent:true');
        root.appendChild(line);
    }
    for (let j = 0; j <= rows; j++) {
        const z = -h / 2 + j * cs;
        const line = document.createElement('a-box');
        line.setAttribute('color', '#00ff88');
        line.setAttribute('width', `${w}`);
        line.setAttribute('height', '0.005');
        line.setAttribute('depth', '0.005');
        line.setAttribute('position', `0 0 ${z}`);
        line.setAttribute('material', 'color:#00ff88;emissive:#00ff88;emissiveIntensity:0.3;opacity:0.5;transparent:true');
        root.appendChild(line);
    }

    // ── Floor plane (semi-transparent) ──
    const floor = document.createElement('a-plane');
    floor.setAttribute('rotation', '0 0 0');
    floor.setAttribute('width', `${w}`);
    floor.setAttribute('height', `${h}`);
    floor.setAttribute('color', '#001a0d');
    floor.setAttribute('material', 'opacity:0.35;transparent:true;side:double');
    floor.setAttribute('position', '0 -0.002 0');
    root.appendChild(floor);

    // ── Earthquake spheres ──
    STATE.quakes.forEach((feature, idx) => {
        const props = feature.properties;
        const geo = feature.geometry.coordinates; // [lon, lat, depth]
        const mag = props.mag ?? 1;
        const depth = geo[2] ?? 10;
        const place = (props.place ?? 'Unknown').substring(0, 20);

        const col = Math.floor(idx % cols);
        const row = Math.floor(idx / cols);
        if (row >= rows) return;

        const cx = ox + col * cs;
        const cz = oz + row * cs;
        const r = Math.max(0.015, mag * CFG.sphereScale);

        const sphere = document.createElement('a-sphere');
        sphere.setAttribute('radius', `${r}`);
        sphere.setAttribute('position', `${cx} ${r} ${cz}`);
        sphere.setAttribute('color', depthColor(depth));
        sphere.setAttribute('material',
            `emissive:${depthColor(depth)};emissiveIntensity:0.45;metalness:0.2;roughness:0.5`);

        // pulse animation — larger quakes pulse slower
        const pulseDur = Math.max(600, 2000 - mag * 150);
        sphere.innerHTML = `
      <a-animation attribute="scale"
        from="1 1 1" to="1.18 1.18 1.18"
        dur="${pulseDur}"
        direction="alternate"
        repeat="indefinite"
        easing="easeInOutSine">
      </a-animation>`;

        // label
        const label = document.createElement('a-text');
        label.setAttribute('value', `M${mag.toFixed(1)}\n${Math.round(depth)}km`);
        label.setAttribute('align', 'center');
        label.setAttribute('color', '#ffffff');
        label.setAttribute('width', '0.6');
        label.setAttribute('position', `0 ${r * 2 + 0.04} 0`);
        label.setAttribute('look-at', '[camera]');
        sphere.appendChild(label);

        root.appendChild(sphere);
    });

    root.setAttribute('visible', 'true');
}

// ── Mode Toggle ───────
function toggleMode() {
    if (STATE.mode === 'marker') {
        setMode('markerless');
    } else {
        setMode('marker');
    }
}

function setMode(mode) {
    STATE.mode = mode;
    const sceneMarker = document.getElementById('scene-marker');
    const sceneMarkerless = document.getElementById('scene-markerless');
    const modeLabel = document.getElementById('mode-label');
    const toggleBtn = document.getElementById('mode-toggle');
    const tapHint = document.getElementById('tap-hint');
    const legend = document.getElementById('quake-legend');

    if (mode === 'marker') {
        document.documentElement.classList.remove('xr-active');
        sceneMarkerless.style.display = 'none';
        modeLabel.textContent = 'MODE: WEATHER-GLOBE — AIM AT HIRO MARKER';
        toggleBtn.textContent = '⇄ QUAKE-GRID';
        tapHint.style.display = 'none';
        legend.style.display = 'none';
        STATE.gridAnchored = false;
        document.getElementById('enter-ar-btn').style.display = 'none';

        cleanupMarkerless();
        resumeMarkerPipeline();
        sceneMarker.style.display = '';
    } else {
        // Stop AR.js camera + A-Frame GL *before* WebXR can start.
        // Dual camera / dual WebGL is what freezes Chrome on Android.
        pauseMarkerPipeline();
        sceneMarker.style.display = 'none';
        sceneMarkerless.style.display = '';
        modeLabel.textContent = 'MODE: QUAKE-GRID — TAP TO ANCHOR';
        toggleBtn.textContent = '⇄ WEATHER-GLOBE';
        tapHint.style.display = 'none';
        legend.style.display = 'block';

        initMarkerless();
    }
}

// ── Markerless — WebXR immersive-ar + hit-test (Three.js) ──

let _xrSession = null;
let _xrHitSrc = null;
let _xrHitPending = false;
let _xrRenderer = null;
let _xrScene = null;
let _xrCamera = null;
let _xrReticle = null;
let _xrGridGroup = null;
let _xrLastPose = null;
let _xrFieldAnim = null;
let _threeReady = false;

function pauseMarkerPipeline() {
    const scene = document.getElementById('scene-marker');
    if (scene) {
        try {
            if (scene.renderer && scene.renderer.xr) scene.renderer.xr.enabled = false;
            if (scene.isPlaying && typeof scene.pause === 'function') scene.pause();
        } catch (err) {
            console.warn('[STORM] pause marker scene:', err);
        }
    }

    document.querySelectorAll('video').forEach((video) => {
        try {
            video.pause();
            if (video.srcObject && video.srcObject.getTracks) {
                video.srcObject.getTracks().forEach((track) => track.stop());
            }
            video.srcObject = null;
            video.style.display = 'none';
        } catch (err) {
            console.warn('[STORM] stop AR.js video:', err);
        }
    });
}

function resumeMarkerPipeline() {
    document.querySelectorAll('video').forEach((video) => {
        video.style.display = '';
    });

    const scene = document.getElementById('scene-marker');
    if (!scene) return;

    try {
        if (scene.isPlaying === false && typeof scene.play === 'function') scene.play();
    } catch (err) {
        console.warn('[STORM] resume marker scene:', err);
    }

    try {
        const sys = scene.systems && scene.systems.arjs;
        const arSession = sys && sys._arSession;
        const source = arSession && (arSession.arSource || arSession.source);
        if (source && typeof source.init === 'function') {
            const video = source.domElement;
            const dead = !video || !video.srcObject;
            if (dead) {
                source.init(() => {
                    if (typeof source.onResize === 'function') source.onResize();
                });
            } else if (video) {
                video.style.display = '';
            }
        }
    } catch (err) {
        console.warn('[STORM] AR.js camera restart:', err);
    }
}

function ensureThreeReady() {
    if (window.THREE) {
        _threeReady = true;
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/three@0.125.2/build/three.min.js';
        s.onload = () => { _threeReady = true; resolve(); };
        s.onerror = reject;
        document.head.appendChild(s);
    });
}

async function initMarkerless() {
    const label = document.getElementById('mode-label');
    const hint = document.getElementById('tap-hint');
    const enterBtn = document.getElementById('enter-ar-btn');

    hint.style.display = 'none';
    enterBtn.style.display = 'none';
    label.textContent = 'CHECKING WEBXR SUPPORT…';

    if (!navigator.xr) {
        label.textContent = 'WEBXR NOT AVAILABLE — OPEN IN CHROME ON ANDROID';
        return;
    }

    const supported = await navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
    if (!supported) {
        label.textContent = 'IMMERSIVE-AR NOT SUPPORTED — ARCORE REQUIRED';
        return;
    }

    try {
        await ensureThreeReady();
    } catch (e) {
        label.textContent = 'FAILED TO LOAD THREE.JS — CHECK CONNECTION';
        return;
    }

    label.textContent = 'READY — TAP ENTER AR BUTTON BELOW';
    enterBtn.style.display = 'block';
}

function _enterARSession() {
    const label = document.getElementById('mode-label');
    const enterBtn = document.getElementById('enter-ar-btn');
    const overlay = document.getElementById('xr-overlay');

    enterBtn.style.display = 'none';
    label.textContent = 'STARTING AR SESSION…';

    if (!_threeReady || !window.THREE) {
        label.textContent = 'THREE.JS NOT READY — SWITCH MODE AND TRY AGAIN';
        enterBtn.style.display = 'block';
        return;
    }

    pauseMarkerPipeline();

    const sessionOptions = {
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['dom-overlay', 'local-floor'],
        domOverlay: { root: overlay }
    };

    navigator.xr.requestSession('immersive-ar', sessionOptions).then((session) => {
        _xrSession = session;
        document.documentElement.classList.add('xr-active');
        _setupXRRenderer(session, window.THREE);
    }).catch((e) => {
        console.warn('[STORM] AR session with overlay failed:', e);
        navigator.xr.requestSession('immersive-ar', {
            requiredFeatures: ['hit-test']
        }).then((session) => {
            _xrSession = session;
            document.documentElement.classList.add('xr-active');
            _setupXRRenderer(session, window.THREE);
        }).catch((err) => {
            document.documentElement.classList.remove('xr-active');
            label.textContent = 'AR SESSION FAILED: ' + err.message;
            enterBtn.style.display = 'block';
        });
    });
}

function _setupXRRenderer(session, THREE) {
    const label = document.getElementById('mode-label');
    const hint = document.getElementById('tap-hint');
    const host = document.getElementById('scene-markerless');

    try {
        if (_xrRenderer) {
            _xrRenderer.setAnimationLoop(null);
            _xrRenderer.dispose();
            _xrRenderer = null;
        }

        host.innerHTML = '';
        _xrRenderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: true,
            xrCompatible: true
        });
        _xrRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        _xrRenderer.setSize(window.innerWidth, window.innerHeight);
        _xrRenderer.xr.enabled = true;
        if (_xrRenderer.xr.setReferenceSpaceType) {
            _xrRenderer.xr.setReferenceSpaceType('local');
        }
        host.appendChild(_xrRenderer.domElement);
        _xrRenderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';

        _xrScene = new THREE.Scene();
        _xrCamera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);
        _xrScene.add(new THREE.AmbientLight(0xffffff, 0.9));
        const sun = new THREE.DirectionalLight(0xffffff, 0.6);
        sun.position.set(1, 3, 2);
        _xrScene.add(sun);

        const ringGeo = new THREE.RingGeometry(0.08, 0.12, 32);
        if (typeof ringGeo.rotateX === 'function') {
            ringGeo.rotateX(-Math.PI / 2);
        } else {
            ringGeo.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
        }
        _xrReticle = new THREE.Mesh(
            ringGeo,
            new THREE.MeshBasicMaterial({ color: 0x00ff88, side: THREE.DoubleSide })
        );
        _xrReticle.matrixAutoUpdate = false;
        _xrReticle.visible = false;
        _xrScene.add(_xrReticle);

        _xrGridGroup = new THREE.Group();
        _xrGridGroup.visible = false;
        _xrScene.add(_xrGridGroup);

        session.addEventListener('select', _onXRSelect);
        session.addEventListener('end', () => {
            _xrSession = null;
            document.documentElement.classList.remove('xr-active');
            label.textContent = 'AR SESSION ENDED — SWITCH MODE TO RESTART';
        });

        const afterSession = () => {
            _xrHitPending = false;
            _xrHitSrc = null;

            session.requestReferenceSpace('viewer').then((viewerSpace) => {
                return session.requestHitTestSource({ space: viewerSpace });
            }).then((src) => {
                _xrHitSrc = src;
            }).catch((e) => console.warn('[STORM] hit-test src failed:', e));

            hint.textContent = 'POINT AT A TABLE OR FLOOR — TAP TO PLACE HOLOGRAM';
            hint.style.display = 'block';
            label.textContent = 'WEBXR ACTIVE — AIM CAMERA AT FLAT SURFACE';

            _xrRenderer.setAnimationLoop((time, frame) => {
                if (frame && _xrHitSrc && !STATE.gridAnchored && _xrReticle) {
                    const refSpace = _xrRenderer.xr.getReferenceSpace && _xrRenderer.xr.getReferenceSpace();
                    if (refSpace) {
                        const hits = frame.getHitTestResults(_xrHitSrc);
                        if (hits.length > 0) {
                            const pose = hits[0].getPose(refSpace);
                            if (pose) {
                                _xrReticle.visible = true;
                                _xrReticle.matrix.fromArray(pose.transform.matrix);
                                _xrLastPose = new THREE.Vector3().setFromMatrixPosition(_xrReticle.matrix);
                            }
                        } else {
                            _xrReticle.visible = false;
                        }
                    }
                }

                if (STATE.gridAnchored) _tickQuakeFieldXR(time);
                _xrRenderer.render(_xrScene, _xrCamera);
            });
        };

        const maybePromise = _xrRenderer.xr.setSession(session);
        Promise.resolve(maybePromise).then(afterSession).catch((e) => {
            label.textContent = 'RENDERER XR SETUP FAILED: ' + e.message;
        });
    } catch (e) {
        label.textContent = 'RENDERER XR SETUP FAILED: ' + e.message;
    }
}

function _onXRSelect() {
    if (STATE.gridAnchored || !_xrGridGroup) return;
    STATE.gridAnchored = true;

    const THREE = window.THREE;
    let placePos;
    if (_xrLastPose) {
        placePos = _xrLastPose.clone();
    } else {
        const camPos = new THREE.Vector3();
        _xrCamera.getWorldPosition(camPos);
        const forward = new THREE.Vector3(0, 0, -1.5).applyQuaternion(_xrCamera.quaternion);
        placePos = camPos.add(forward);
        placePos.y -= 0.3;
    }

    _xrGridGroup.position.copy(placePos);
    _xrGridGroup.visible = true;
    if (_xrReticle) _xrReticle.visible = false;

    _buildQuakeGridXR(THREE);

    document.getElementById('tap-hint').style.display = 'none';
    document.getElementById('mode-label').textContent = 'SEISMIC HOLOGRAM ANCHORED — WALK AROUND IT';
}

function _xrCssHex(hex) {
    return '#' + hex.toString(16).padStart(6, '0');
}

function _xrSetAttr(geo, name, attr) {
    if (geo.setAttribute) geo.setAttribute(name, attr);
    else if (geo.addAttribute) geo.addAttribute(name, attr);
}

function _xrMakeTextSprite(THREE, lines, accentHex, scaleX, scaleY) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 512, 256);

    // Draw background box
    ctx.fillStyle = 'rgba(0, 12, 8, 0.78)';
    ctx.strokeStyle = _xrCssHex(accentHex);
    ctx.lineWidth = 6;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(16, 16, 480, 224, 18);
    else ctx.rect(16, 16, 480, 224);
    ctx.fill();
    ctx.stroke();

    // Setup text alignment
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const usable = lines.filter(Boolean);
    usable.forEach((line, i) => {
        // Slightly adjust vertical spacing
        const y = 128 - ((usable.length - 1) * 40) / 2 + i * 48;

        ctx.fillStyle = i === 0 ? '#ffffff' : _xrCssHex(accentHex);

        // FIX 1: Reduce base font sizes so they fit naturally (46px and 26px)
        ctx.font = i === 0 ? 'bold 46px monospace' : '26px monospace';

        // FIX 2: Add a maxWidth of 440px. 
        ctx.fillText(String(line).slice(0, 35), 256, y, 440);
    });

    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        depthTest: false,
        opacity: 0.95
    }));
    sprite.scale.set(scaleX, scaleY, 1);
    sprite.center.set(0.5, 0);
    return sprite;
}

function _xrCircleLine(THREE, radius, y, color, opacity) {
    const pts = [];
    for (let i = 0; i <= 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * radius, y, Math.sin(a) * radius));
    }
    const mat = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: opacity == null ? 0.55 : opacity
    });
    return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
}

function _tickQuakeFieldXR(timeMs) {
    if (!_xrFieldAnim) return;
    const t = (timeMs || 0) * 0.001;
    const anim = _xrFieldAnim;

    if (anim.beacon) anim.beacon.rotation.y = t * 0.7;
    if (anim.halo) {
        anim.halo.rotation.z = t * 0.35;
        anim.halo.rotation.x = Math.PI / 2 + Math.sin(t * 0.8) * 0.08;
    }
    if (anim.scan) {
        const s = 1 + (t % 2.4) / 2.4 * 1.35;
        anim.scan.scale.set(s, 1, s);
        if (anim.scan.material) anim.scan.material.opacity = Math.max(0.04, 0.45 - s * 0.18);
    }
    if (anim.corePulse) {
        const p = 1 + Math.sin(t * 3.2) * 0.08;
        anim.corePulse.scale.set(p, p, p);
    }

    if (anim.wave && anim.wave.geometry) {
        const pos = anim.wave.geometry.attributes && anim.wave.geometry.attributes.position;
        if (pos) {
            const n = pos.count;
            for (let i = 0; i < n; i++) {
                pos.setY(i, 0.02 + Math.sin(t * 9 + i * 0.45) * 0.012 * (0.4 + Math.sin(t * 1.7) * 0.3));
            }
            pos.needsUpdate = true;
        }
    }

    anim.nodes.forEach((node) => {
        const pulse = 0.88 + Math.sin(t * (2.2 + node.mag * 0.15) + node.phase) * 0.12;
        if (node.beam) {
            node.beam.scale.y = node.beamH * pulse;
            node.beam.position.y = (node.beamH * pulse) / 2;
        }
        if (node.crystal) {
            node.crystal.rotation.y = t * (1.1 + node.mag * 0.25);
            node.crystal.position.y = node.beamH * pulse + node.crystalR;
        }
        if (node.ring) {
            const cycle = ((t * 0.7 + node.phase) % 1.8) / 1.8;
            const rs = 1 + cycle * 2.2;
            node.ring.scale.set(rs, 1, rs);
            if (node.ring.material) node.ring.material.opacity = Math.max(0, 0.5 * (1 - cycle));
        }
        if (node.glow) {
            const g = 1 + Math.sin(t * 4 + node.phase) * 0.18;
            node.glow.scale.setScalar(node.glowR * g);
            node.glow.position.y = node.beamH * pulse + node.crystalR;
            if (node.glow.material) node.glow.material.opacity = 0.12 + Math.sin(t * 4 + node.phase) * 0.06;
        }
    });
}

function _buildQuakeGridXR(THREE) {
    if (!_xrGridGroup || !THREE) return;
    while (_xrGridGroup.children.length) _xrGridGroup.remove(_xrGridGroup.children[0]);

    const events = (STATE.quakes || []).slice(0, CFG.gridCols * CFG.gridRows);
    const tableR = 0.32;

    const floor = new THREE.Mesh(
        new THREE.CircleGeometry(tableR, 48),
        new THREE.MeshStandardMaterial({
            color: 0x02140c,
            emissive: 0x003322,
            emissiveIntensity: 0.35,
            transparent: true,
            opacity: 0.55,
            roughness: 0.85,
            metalness: 0.1,
            side: THREE.DoubleSide
        })
    );
    floor.rotation.x = -Math.PI / 2;
    _xrGridGroup.add(floor);

    const rim = new THREE.Mesh(
        new THREE.TorusGeometry(tableR, 0.006, 8, 48),
        new THREE.MeshStandardMaterial({
            color: 0x00ff88,
            emissive: 0x00ff88,
            emissiveIntensity: 0.7,
            roughness: 0.3
        })
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.004;
    _xrGridGroup.add(rim);

    const gridMat = new THREE.LineBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.28 });
    for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        _xrGridGroup.add(new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(0, 0.003, 0),
                new THREE.Vector3(Math.cos(a) * tableR, 0.003, Math.sin(a) * tableR)
            ]),
            gridMat
        ));
    }
    [0.1, 0.18, 0.26].forEach((r, i) => {
        _xrGridGroup.add(_xrCircleLine(THREE, r, 0.003, 0x00ff88, 0.22 + i * 0.06));
    });

    const scan = _xrCircleLine(THREE, 0.07, 0.006, 0x88ffcc, 0.4);
    _xrGridGroup.add(scan);

    for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 + Math.PI / 4;
        const px = Math.cos(a) * (tableR - 0.012);
        const pz = Math.sin(a) * (tableR - 0.012);
        const pylon = new THREE.Mesh(
            new THREE.CylinderGeometry(0.004, 0.007, 0.05, 6),
            new THREE.MeshStandardMaterial({
                color: 0x00ff88,
                emissive: 0x00ff88,
                emissiveIntensity: 0.55,
                roughness: 0.4
            })
        );
        pylon.position.set(px, 0.025, pz);
        _xrGridGroup.add(pylon);
        const cap = new THREE.Mesh(
            new THREE.SphereGeometry(0.008, 8, 8),
            new THREE.MeshBasicMaterial({ color: 0xccffee })
        );
        cap.position.set(px, 0.054, pz);
        _xrGridGroup.add(cap);
    }

    const beacon = new THREE.Group();
    const coreGeo = new THREE.IcosahedronGeometry(0.028, 0);
    const core = new THREE.Mesh(
        coreGeo,
        new THREE.MeshStandardMaterial({
            color: 0x66ffcc,
            emissive: 0x118866,
            emissiveIntensity: 0.8,
            metalness: 0.35,
            roughness: 0.25,
            transparent: true,
            opacity: 0.92
        })
    );
    beacon.add(core);
    const wireGeo = THREE.WireframeGeometry
        ? new THREE.WireframeGeometry(new THREE.SphereGeometry(0.042, 10, 8))
        : new THREE.EdgesGeometry(new THREE.SphereGeometry(0.042, 10, 8));
    const globe = new THREE.LineSegments(
        wireGeo,
        new THREE.LineBasicMaterial({ color: 0x88ffdd, transparent: true, opacity: 0.7 })
    );
    beacon.add(globe);
    beacon.position.y = 0.07;
    _xrGridGroup.add(beacon);

    const halo = new THREE.Mesh(
        new THREE.TorusGeometry(0.05, 0.0025, 6, 32),
        new THREE.MeshBasicMaterial({ color: 0x00ffaa, transparent: true, opacity: 0.7 })
    );
    halo.position.y = 0.07;
    _xrGridGroup.add(halo);

    const title = _xrMakeTextSprite(THREE, ['USGS 24H FIELD', `${events.length} EVENTS`], 0x00ff88, 0.22, 0.11);
    title.position.set(0, 0.175, 0);
    _xrGridGroup.add(title);

    const waveCount = 40;
    const waveArr = new Float32Array(waveCount * 3);
    for (let i = 0; i < waveCount; i++) {
        const x = -0.16 + (i / (waveCount - 1)) * 0.32;
        waveArr[i * 3] = x;
        waveArr[i * 3 + 1] = 0.02;
        waveArr[i * 3 + 2] = tableR - 0.02;
    }
    const waveGeo = new THREE.BufferGeometry();
    _xrSetAttr(waveGeo, 'position', new THREE.BufferAttribute(waveArr, 3));
    const wave = new THREE.Line(
        waveGeo,
        new THREE.LineBasicMaterial({ color: 0x66ffaa, transparent: true, opacity: 0.85 })
    );
    _xrGridGroup.add(wave);

    const ranked = events.slice().sort((a, b) => (b.properties.mag || 0) - (a.properties.mag || 0));
    const golden = Math.PI * (3 - Math.sqrt(5));
    const nodes = [];
    const padGeo = new THREE.CylinderGeometry(0.016, 0.016, 0.003, 12);
    const CrystalGeo = THREE.OctahedronGeometry || THREE.IcosahedronGeometry || THREE.SphereGeometry;
    const crystalGeo = new CrystalGeo(1, 0);
    const glowGeo = new THREE.SphereGeometry(1, 10, 10);

    ranked.forEach((feature, idx) => {
        const props = feature.properties || {};
        const coords = feature.geometry && feature.geometry.coordinates ? feature.geometry.coordinates : [0, 0, 10];
        const mag = Math.max(0.1, props.mag ?? 1);
        const depth = coords[2] ?? 10;
        const place = (props.place ?? 'Unknown').replace(/^.+ of /, '');
        const hexColor = depth < CFG.depthShallow ? 0x00ff44 : depth < CFG.depthMid ? 0xffaa00 : 0xff3300;

        const magN = Math.min(1, mag / 7.5);
        const orbit = 0.075 + (1 - magN) * 0.18;
        const theta = idx * golden;
        const x = Math.cos(theta) * orbit;
        const z = Math.sin(theta) * orbit;

        const beamH = 0.035 + magN * 0.11;
        const crystalR = 0.008 + magN * 0.016;
        const station = new THREE.Group();
        station.position.set(x, 0, z);

        const pad = new THREE.Mesh(
            padGeo,
            new THREE.MeshStandardMaterial({
                color: 0x022211,
                emissive: hexColor,
                emissiveIntensity: 0.25,
                roughness: 0.7
            })
        );
        pad.position.y = 0.002;
        station.add(pad);

        const beam = new THREE.Mesh(
            new THREE.CylinderGeometry(0.0018, 0.0045, 1, 8),
            new THREE.MeshStandardMaterial({
                color: hexColor,
                emissive: hexColor,
                emissiveIntensity: 0.85,
                transparent: true,
                opacity: 0.8,
                roughness: 0.2,
                metalness: 0.15
            })
        );
        beam.position.y = beamH / 2;
        beam.scale.y = beamH;
        station.add(beam);

        const crystal = new THREE.Mesh(
            crystalGeo,
            new THREE.MeshStandardMaterial({
                color: hexColor,
                emissive: hexColor,
                emissiveIntensity: 0.9,
                metalness: 0.45,
                roughness: 0.18,
                transparent: true,
                opacity: 0.95
            })
        );
        crystal.scale.setScalar(crystalR);
        crystal.position.y = beamH + crystalR;
        station.add(crystal);

        const glow = new THREE.Mesh(
            glowGeo,
            new THREE.MeshBasicMaterial({
                color: hexColor,
                transparent: true,
                opacity: 0.14,
                depthWrite: false
            })
        );
        glow.scale.setScalar(crystalR * 2.2);
        glow.position.y = beamH + crystalR;
        station.add(glow);

        const ring = new THREE.Mesh(
            new THREE.RingGeometry(0.012, 0.016, 20),
            new THREE.MeshBasicMaterial({
                color: hexColor,
                transparent: true,
                opacity: 0.45,
                side: THREE.DoubleSide,
                depthWrite: false
            })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.004;
        station.add(ring);

        if (idx < 8) {
            const label = _xrMakeTextSprite(
                THREE,
                [`M${mag.toFixed(1)}`, `${Math.round(depth)} km  ${place}`],
                hexColor,
                0.13,
                0.065
            );
            label.position.y = beamH + crystalR * 2 + 0.012;
            station.add(label);
        }

        _xrGridGroup.add(station);
        nodes.push({
            mag,
            phase: idx * 0.47,
            beamH,
            crystalR,
            glowR: crystalR * 2.2,
            beam,
            crystal,
            ring,
            glow
        });
    });

    _xrFieldAnim = { beacon, halo, scan, corePulse: core, wave, nodes };
}

function cleanupMarkerless() {
    document.documentElement.classList.remove('xr-active');

    if (_xrSession) {
        try { _xrSession.removeEventListener('select', _onXRSelect); } catch (e) { }
        _xrSession.end().catch(() => { });
        _xrSession = null;
    }
    if (_xrRenderer) {
        _xrRenderer.setAnimationLoop(null);
        if (_xrRenderer.domElement && _xrRenderer.domElement.parentNode) {
            _xrRenderer.domElement.parentNode.removeChild(_xrRenderer.domElement);
        }
        _xrRenderer.dispose();
        _xrRenderer = null;
    }

    const host = document.getElementById('scene-markerless');
    if (host) host.innerHTML = '';

    _xrHitSrc = _xrScene = _xrCamera = _xrReticle = _xrGridGroup = _xrLastPose = _xrFieldAnim = null;
    _xrHitPending = false;
    STATE.gridAnchored = false;
}

// ── Boot ─────
(function boot() {
    // Initial fetch
    fetchAll();

    // Polling every 30s
    setInterval(fetchAll, CFG.updateIntervalMs);

    const searchInput = document.getElementById('location-search');
    const searchBtn = document.getElementById('location-search-btn');
    if (searchInput) {
        searchInput.value = CFG.weatherCity || 'Colombo';
        searchInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                searchLocation();
            }
        });
    }
    if (searchBtn) {
        searchBtn.addEventListener('click', searchLocation);
    }

    // Start in marker mode
    setMode('marker');

    // A-Frame marker tracking - update weather-globe on marker found
    window.addEventListener('load', () => {
        const scene = document.getElementById('scene-marker');
        const marker = document.getElementById('hiro-marker');
        if (scene) {
            scene.addEventListener('camera-init', () => {
                document.getElementById('mode-label').textContent = 'CAMERA READY — SEARCHING FOR HIRO MARKER';
            });
            scene.addEventListener('camera-error', () => {
                document.getElementById('mode-label').textContent = 'CAMERA ERROR — CHECK PERMISSION OR CAMERA USE';
            });
        }
        if (marker) {
            marker.addEventListener('markerFound', () => {
                document.getElementById('mode-label').textContent = 'MARKER LOCKED — WEATHER-GLOBE ACTIVE';
            });
            marker.addEventListener('markerLost', () => {
                document.getElementById('mode-label').textContent = 'MODE: WEATHER-GLOBE — AIM AT HIRO MARKER';
            });
        }
    });
})();