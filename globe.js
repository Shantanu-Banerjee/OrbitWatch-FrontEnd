// =============================================
// ORBITWATCH - globe.js  (ENHANCED EDITION)
//
// NEW FEATURES:
//   - Orbital shell ring visualization (LEO/MEO/GEO toggles)
//   - Risk layer on/off toggles (High/Med/Low)
//   - Orbital path lines for selected object (click)
//   - ISS focus button
//   - Reset view button
//   - Globe controls wired to HTML buttons
//   - Improved detail panel with orbital period + velocity
// =============================================

Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiIzZDU1YmZiNC03MjVhLTRkOGUtYmJiOS0zMDRmZmU2OWMyMDMiLCJpZCI6Mzk0NDA4LCJpYXQiOjE3NzIwNDgwNDh9.Sei95b4qmJI-Vy3-FGiQbZ6sXJdqKpYrfUy2oXXtew8';

let viewer       = null;
let isRotating   = true;
let liveLoopId   = null;
let entityMap    = {};     // noradId → Cesium entity
let pathEntity   = null;   // current orbital path polyline
let showPaths    = false;  // toggle state

// Risk layer visibility state
const riskLayerVisible = { high: true, medium: true, low: true };

// =============================================
// TOOLTIP ELEMENT
// =============================================
function createTooltip() {
    const tooltip = document.createElement('div');
    tooltip.id = 'debrisTooltip';
    tooltip.style.cssText = `
        position: fixed;
        display: none;
        background: rgba(10, 22, 40, 0.95);
        border: 1px solid #00d4ff;
        border-radius: 10px;
        padding: 14px 18px;
        color: #e8f4fd;
        font-family: 'Share Tech Mono', monospace;
        font-size: 13px;
        line-height: 1.8;
        pointer-events: none;
        z-index: 9999;
        min-width: 230px;
        box-shadow: 0 0 20px rgba(0, 212, 255, 0.3);
        transition: opacity 0.15s ease;
    `;
    document.body.appendChild(tooltip);
    return tooltip;
}

// =============================================
// INITIALIZE THE GLOBE
// =============================================
function initGlobe() {
    console.log("Initializing 3D globe...");

    if (typeof Cesium === 'undefined') {
        console.error("CesiumJS not loaded!");
        document.getElementById('cesiumContainer').innerHTML =
            '<div style="color:white;text-align:center;padding:50px;">Error: CesiumJS failed to load.</div>';
        return;
    }

    if (typeof satellite === 'undefined') {
        console.error("satellite.js (SGP4) not loaded! Real-time propagation won't work.");
    }

    try {
        viewer = new Cesium.Viewer('cesiumContainer', {
            animation:                          false,
            baseLayerPicker:                    false,
            fullscreenButton:                   false,
            geocoder:                           false,
            homeButton:                         false,
            infoBox:                            false,
            sceneModePicker:                    false,
            selectionIndicator:                 false,
            timeline:                           false,
            navigationHelpButton:               false,
            navigationInstructionsInitiallyVisible: false,
        });

        viewer.scene.backgroundColor = Cesium.Color.BLACK;
        viewer.cesiumWidget.creditContainer.style.display = "none";
        viewer.scene.globe.enableLighting = true;
        viewer.clock.shouldAnimate = true;

        viewer.camera.setView({
            destination: Cesium.Cartesian3.fromDegrees(0, 20, 25000000)
        });

        // Create tooltip
        const tooltip = createTooltip();

        // ── MOUSE EVENTS ──
        const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

        handler.setInputAction(function(movement) {
            const picked = viewer.scene.pick(movement.endPosition);

            if (Cesium.defined(picked) && Cesium.defined(picked.id) && picked.id.debrisData) {
                const debris = picked.id.debrisData;
                tooltip.innerHTML = buildTooltipHTML(debris);
                tooltip.style.display = 'block';
                tooltip.style.left = (movement.endPosition.x + 15) + 'px';
                tooltip.style.top  = (movement.endPosition.y - 10) + 'px';
                picked.id.point.pixelSize = getPointSize(debris.riskLevel) * 2.2;
            } else {
                tooltip.style.display = 'none';
                viewer.entities.values.forEach(e => {
                    if (e.debrisData) e.point.pixelSize = getPointSize(e.debrisData.riskLevel);
                });
            }
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

        handler.setInputAction(function(click) {
            const picked = viewer.scene.pick(click.position);
            if (Cesium.defined(picked) && Cesium.defined(picked.id) && picked.id.debrisData) {
                showDetailPanel(picked.id.debrisData);
                focusOnDebris(picked.id.debrisData);
                if (showPaths) drawOrbitalPath(picked.id.debrisData);
            }
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        // Stop rotation on mouse drag
        handler.setInputAction(function() {
            isRotating = false;
            setTimeout(() => { isRotating = true; }, 4000);
        }, Cesium.ScreenSpaceEventType.LEFT_DOWN);

        console.log("Globe initialized!");

    } catch (error) {
        console.error("Globe init error:", error);
        document.getElementById('cesiumContainer').innerHTML = `
            <div style="display:flex;align-items:center;justify-content:center;height:100%;
                        background:#000;color:white;font-family:'Orbitron',monospace;text-align:center;padding:20px;">
                <div>
                    <h2 style="color:#00d4ff;margin-bottom:20px;">🛰️ OrbitWatch</h2>
                    <p>3D Globe Loading Failed</p>
                    <p style="font-size:14px;opacity:0.8;">Check stats and table below</p>
                </div>
            </div>`;
    }
}

// =============================================
// PLOT DEBRIS
// =============================================
function plotDebrisOnGlobe(debrisArray) {
    console.log("Plotting", debrisArray.length, "debris objects...");
    if (!viewer) { console.error("Viewer not ready"); return; }

    // Remove only debris entities (not shell rings)
    const toRemove = viewer.entities.values.filter(e => e.debrisData);
    toRemove.forEach(e => viewer.entities.remove(e));
    entityMap = {};

    debrisArray.forEach(debris => {
        const visible = riskLayerVisible[debris.riskLevel];
        const color  = getRiskColor(debris.riskLevel);
        const cartesian = Cesium.Cartesian3.fromDegrees(
            debris.longitude, debris.latitude, debris.altitude * 1000
        );

        const entity = viewer.entities.add({
            name:     debris.name,
            position: cartesian,
            show:     visible,
            point: {
                pixelSize:   getPointSize(debris.riskLevel),
                color:       color,
                outlineColor: color.withAlpha(0.3),
                outlineWidth: 2,
                scaleByDistance: new Cesium.NearFarScalar(1000000, 1.5, 50000000, 0.5),
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
        });

        entity.debrisData = debris;
        entityMap[debris.noradId] = entity;
    });

    console.log("Entities created:", debrisArray.length);

    const isLiveMode = window.rawTLEData && window.rawTLEData.length > 0;
    if (isLiveMode) {
        console.log("Starting real-time TLE propagation loop...");
        startLiveUpdateLoop();
    }
}

// =============================================
// LIVE UPDATE LOOP
// =============================================
function startLiveUpdateLoop() {
    if (liveLoopId) clearInterval(liveLoopId);

    liveLoopId = setInterval(() => {
        const tleEntries = window.rawTLEData;
        if (!tleEntries || tleEntries.length === 0) return;
        if (!viewer) return;

        tleEntries.forEach(entry => {
            const entity = entityMap[entry.noradId];
            if (!entity) return;

            const pos = window.propagateEntry(entry);
            if (!pos) return;

            entity.position = Cesium.Cartesian3.fromDegrees(
                pos.longitude, pos.latitude, pos.altitude * 1000
            );

            if (entity.debrisData) {
                entity.debrisData.latitude  = pos.latitude;
                entity.debrisData.longitude = pos.longitude;
                entity.debrisData.altitude  = Math.round(pos.altitude);
            }
        });

        refreshDetailPanel();
    }, 1000);
}

// =============================================
// REFRESH DETAIL PANEL
// =============================================
function refreshDetailPanel() {
    const panel = document.getElementById('debrisDetailPanel');
    if (!panel || !panel._noradId) return;

    const entity = entityMap[panel._noradId];
    if (!entity || !entity.debrisData) return;

    const d = entity.debrisData;

    const latEl  = document.getElementById('panel-lat');
    const lonEl  = document.getElementById('panel-lon');
    const altEl  = document.getElementById('panel-alt');
    const liveEl = document.getElementById('panel-live-tag');
    const velEl  = document.getElementById('panel-velocity');

    if (latEl)  latEl.textContent  = d.latitude.toFixed(4)  + '°';
    if (lonEl)  lonEl.textContent  = d.longitude.toFixed(4) + '°';
    if (altEl)  altEl.textContent  = d.altitude             + ' km';
    if (velEl)  velEl.textContent  = calcVelocity(d.altitude).toFixed(2) + ' km/s';
    if (liveEl) liveEl.textContent = '🔴 LIVE — updating every second';
}

// =============================================
// CALCULATE ORBITAL VELOCITY FROM ALTITUDE
// v = sqrt(GM / (R_earth + alt))
// =============================================
function calcVelocity(altKm) {
    const GM = 398600.4418;  // km³/s²
    const RE = 6371;          // km
    return Math.sqrt(GM / (RE + altKm));
}

// =============================================
// CALCULATE ORBITAL PERIOD FROM ALTITUDE
// =============================================
function calcPeriod(altKm) {
    const GM = 398600.4418;
    const RE = 6371;
    const r = RE + altKm;
    const T = 2 * Math.PI * Math.sqrt(r * r * r / GM); // seconds
    const mins = Math.round(T / 60);
    return `${Math.floor(mins/60)}h ${mins%60}m`;
}

// =============================================
// SHOW DETAIL PANEL (enhanced)
// =============================================
function showDetailPanel(debris) {
    const existing = document.getElementById('debrisDetailPanel');
    if (existing) existing.remove();

    const panel = document.createElement('div');
    panel.id = 'debrisDetailPanel';
    panel._noradId = debris.noradId;

    panel.style.cssText = `
        position: fixed;
        top: 80px;
        right: 20px;
        width: 300px;
        background: rgba(10, 22, 40, 0.97);
        border: 1px solid #00d4ff;
        border-radius: 12px;
        padding: 20px;
        color: #e8f4fd;
        font-family: 'Share Tech Mono', monospace;
        font-size: 13px;
        line-height: 2;
        z-index: 9999;
        box-shadow: 0 0 30px rgba(0, 212, 255, 0.2);
        animation: slideIn 0.3s ease;
    `;

    const riskColor = debris.riskLevel === 'high' ? '#ff3d3d'
                    : debris.riskLevel === 'medium' ? '#ffd700' : '#00ff88';
    const riskBg    = debris.riskLevel === 'high' ? 'rgba(255,61,61,0.2)'
                    : debris.riskLevel === 'medium' ? 'rgba(255,215,0,0.2)' : 'rgba(0,255,136,0.2)';
    const riskMsg   = debris.riskLevel === 'high'
        ? '⚠️ Critical — below 500 km. High collision probability.'
        : debris.riskLevel === 'medium'
        ? '⚡ Caution — active satellite region.'
        : '✅ Lower risk — less congested orbit.';

    const velocity = calcVelocity(debris.altitude).toFixed(2);
    const period   = calcPeriod(debris.altitude);
    const shell    = debris.altitude < 2000 ? 'LEO' : debris.altitude < 35786 ? 'MEO' : 'GEO';

    panel.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;">
            <div style="color:#00d4ff;font-size:15px;font-weight:bold;">🛰️ Debris Details</div>
            <button onclick="document.getElementById('debrisDetailPanel').remove()" style="
                background:rgba(255,61,61,0.2);border:1px solid #ff3d3d;color:#ff3d3d;
                border-radius:50%;width:24px;height:24px;cursor:pointer;font-size:14px;line-height:1;">✕</button>
        </div>

        <div style="border-bottom:1px solid #1a3a5c;padding-bottom:12px;margin-bottom:12px;">
            <div style="color:#00d4ff;font-size:14px;font-weight:bold;">${debris.name}</div>
            <div style="font-size:11px;color:#7a9cc7;">Orbital Shell: <span style="color:#e8f4fd">${shell}</span></div>
        </div>

        <div style="display:grid;gap:4px;">
            <div><span style="color:#7a9cc7">NORAD ID &nbsp;:</span> ${debris.noradId}</div>
            <div><span style="color:#7a9cc7">Inclination:</span> ${debris.inclination}°</div>
            <div><span style="color:#7a9cc7">Altitude &nbsp;&nbsp;:</span> <span id="panel-alt">${debris.altitude} km</span></div>
            <div><span style="color:#7a9cc7">Latitude &nbsp;&nbsp;:</span> <span id="panel-lat">${typeof debris.latitude === 'number' ? debris.latitude.toFixed(4) : debris.latitude}°</span></div>
            <div><span style="color:#7a9cc7">Longitude &nbsp;:</span> <span id="panel-lon">${typeof debris.longitude === 'number' ? debris.longitude.toFixed(4) : debris.longitude}°</span></div>
            <div><span style="color:#7a9cc7">Velocity &nbsp;&nbsp;:</span> <span id="panel-velocity">${velocity} km/s</span></div>
            <div><span style="color:#7a9cc7">Period &nbsp;&nbsp;&nbsp;&nbsp;:</span> ${period}</div>
        </div>

        <div style="margin-top:12px;padding-top:12px;border-top:1px solid #1a3a5c;">
            <span style="color:#7a9cc7">Risk Level:</span>
            <span style="
                padding:3px 12px;border-radius:20px;font-weight:bold;margin-left:8px;
                background:${riskBg};color:${riskColor};border:1px solid ${riskColor};">
                ${debris.riskLevel.toUpperCase()}
            </span>
        </div>

        <div style="margin-top:10px;font-size:11px;color:#7a9cc7;">${riskMsg}</div>

        <div style="margin-top:12px;display:flex;gap:8px;">
            <button onclick="focusOnDebris(window._selectedDebris)" style="
                flex:1;background:rgba(0,212,255,0.1);border:1px solid #00d4ff;color:#00d4ff;
                border-radius:6px;padding:6px;cursor:pointer;font-family:'Share Tech Mono',monospace;font-size:11px;">
                📍 Track
            </button>
            <button onclick="drawOrbitalPath(window._selectedDebris)" style="
                flex:1;background:rgba(0,212,255,0.1);border:1px solid #00d4ff;color:#00d4ff;
                border-radius:6px;padding:6px;cursor:pointer;font-family:'Share Tech Mono',monospace;font-size:11px;">
                🛤️ Show Path
            </button>
        </div>

        <div id="panel-live-tag" style="
            margin-top:12px;padding:6px 10px;border-radius:6px;font-size:11px;
            background:rgba(255,61,61,0.15);color:#ff6b6b;border:1px solid rgba(255,61,61,0.3);
            text-align:center;letter-spacing:1px;">
            ${window.rawTLEData && window.rawTLEData.length > 0
                ? '🔴 LIVE — updating every second'
                : '🟡 STATIC — no TLE data loaded'}
        </div>
    `;

    document.body.appendChild(panel);
    window._selectedDebris = debris;

    if (!document.getElementById('panelSlideStyle')) {
        const s = document.createElement('style');
        s.id = 'panelSlideStyle';
        s.textContent = `
            @keyframes slideIn {
                from { opacity:0; transform:translateX(30px); }
                to   { opacity:1; transform:translateX(0); }
            }`;
        document.head.appendChild(s);
    }
}

// =============================================
// DRAW ORBITAL PATH (predicted ground track)
// =============================================
function drawOrbitalPath(debris) {
    if (!viewer || !debris) return;

    // Remove existing path
    if (pathEntity) {
        viewer.entities.remove(pathEntity);
        pathEntity = null;
    }

    // Find the TLE entry for this debris
    const tleEntry = window.rawTLEData && window.rawTLEData.find(
        e => String(e.noradId) === String(debris.noradId)
    );

    if (!tleEntry || !tleEntry.satrec) {
        console.warn("No TLE entry found for path drawing");
        return;
    }

    // Generate positions for next 90 minutes (one orbit ~ typical LEO period)
    const positions = [];
    const now = new Date();
    const stepSeconds = 60; // one point per minute
    const totalMinutes = 95; // ~one full LEO orbit

    for (let i = 0; i <= totalMinutes; i++) {
        const t = new Date(now.getTime() + i * stepSeconds * 1000);
        try {
            const pv = satellite.propagate(tleEntry.satrec, t);
            if (!pv || !pv.position) continue;
            const gmst = satellite.gstime(t);
            const gd   = satellite.eciToGeodetic(pv.position, gmst);
            const lat  = satellite.degreesLat(gd.latitude);
            const lon  = satellite.degreesLong(gd.longitude);
            const alt  = gd.height;
            if (isFinite(lat) && isFinite(lon) && isFinite(alt) && alt > 0) {
                positions.push(Cesium.Cartesian3.fromDegrees(lon, lat, alt * 1000));
            }
        } catch (e) { /* skip bad propagation */ }
    }

    if (positions.length < 2) return;

    pathEntity = viewer.entities.add({
        polyline: {
            positions: positions,
            width: 1.5,
            material: new Cesium.PolylineGlowMaterialProperty({
                glowPower: 0.15,
                color: Cesium.Color.fromCssColorString('#00d4ff').withAlpha(0.6),
            }),
            clampToGround: false,
        }
    });

    console.log(`Drew orbital path with ${positions.length} points`);
}

// =============================================
// TOOLTIP HTML BUILDER
// =============================================
function buildTooltipHTML(debris) {
    const riskColor = debris.riskLevel === 'high' ? '#ff3d3d'
                    : debris.riskLevel === 'medium' ? '#ffd700' : '#00ff88';
    const riskBg    = debris.riskLevel === 'high' ? 'rgba(255,61,61,0.2)'
                    : debris.riskLevel === 'medium' ? 'rgba(255,215,0,0.2)' : 'rgba(0,255,136,0.2)';
    return `
        <div style="color:#00d4ff;font-size:14px;margin-bottom:8px;font-weight:bold;">
            🛰️ ${debris.name}
        </div>
        <div><span style="color:#7a9cc7">NORAD ID:&nbsp;</span>${debris.noradId}</div>
        <div><span style="color:#7a9cc7">Altitude: &nbsp;</span>${debris.altitude} km</div>
        <div><span style="color:#7a9cc7">Velocity: &nbsp;</span>${calcVelocity(debris.altitude).toFixed(2)} km/s</div>
        <div><span style="color:#7a9cc7">Lat/Lon:  &nbsp;</span>
            ${typeof debris.latitude  === 'number' ? debris.latitude.toFixed(2)  : '—'}° /
            ${typeof debris.longitude === 'number' ? debris.longitude.toFixed(2) : '—'}°
        </div>
        <div style="margin-top:8px;">
            <span style="color:#7a9cc7">Risk:</span>
            <span style="padding:2px 10px;border-radius:20px;font-weight:bold;margin-left:5px;
                         background:${riskBg};color:${riskColor};border:1px solid ${riskColor};">
                ${debris.riskLevel.toUpperCase()}
            </span>
        </div>
        <div style="color:#7a9cc7;font-size:11px;margin-top:8px;">Click for full details</div>
    `;
}

// =============================================
// GLOBE CONTROL FUNCTIONS (called from HTML)
// =============================================
function toggleGlobeRotation() {
    isRotating = !isRotating;
    const btn = document.getElementById('btnRotate');
    if (btn) {
        btn.classList.toggle('active', isRotating);
        btn.textContent = isRotating ? '🔄 Auto-Rotate' : '⏸ Paused';
    }
}

function resetGlobeView() {
    if (!viewer) return;
    isRotating = true;
    const btn = document.getElementById('btnRotate');
    if (btn) { btn.classList.add('active'); btn.textContent = '🔄 Auto-Rotate'; }
    viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(0, 20, 25000000),
        duration: 1.5,
    });
}

function focusISS() {
    if (!viewer) return;
    // Find ISS by NORAD ID (25544) or by name
    let issEntity = entityMap['25544'] ||
        Object.values(entityMap).find(e => e.debrisData && e.debrisData.name.includes('ISS'));

    if (issEntity && issEntity.debrisData) {
        focusOnDebris(issEntity.debrisData);
        showDetailPanel(issEntity.debrisData);
    } else {
        // Fly to a low orbit view anyway
        isRotating = false;
        viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(0, 0, 8000000),
            duration: 2,
        });
        setTimeout(() => { isRotating = true; }, 5000);
    }
}

function toggleOrbitalPaths() {
    showPaths = !showPaths;
    const btn = document.getElementById('btnPaths');
    if (btn) btn.classList.toggle('active', showPaths);
    if (!showPaths && pathEntity) {
        viewer.entities.remove(pathEntity);
        pathEntity = null;
    }
}

function toggleRiskLayer(level) {
    riskLayerVisible[level] = !riskLayerVisible[level];
    const visible = riskLayerVisible[level];

    const btnMap = { high: 'btnHigh', medium: 'btnMed', low: 'btnLow' };
    const btn = document.getElementById(btnMap[level]);
    if (btn) btn.classList.toggle('inactive', !visible);

    Object.values(entityMap).forEach(entity => {
        if (entity.debrisData && entity.debrisData.riskLevel === level) {
            entity.show = visible;
        }
    });
}

// =============================================
// HELPERS
// =============================================
function getRiskColor(riskLevel) {
    if (riskLevel === "high")   return Cesium.Color.RED.withAlpha(0.9);
    if (riskLevel === "medium") return Cesium.Color.YELLOW.withAlpha(0.8);
    return Cesium.Color.fromCssColorString('#00ff88').withAlpha(0.7);
}

function getPointSize(riskLevel) {
    if (riskLevel === "high")   return 6;
    if (riskLevel === "medium") return 4;
    return 3;
}

// =============================================
// AUTO ROTATION
// =============================================
function startGlobeRotation() {
    viewer.clock.onTick.addEventListener(function() {
        if (isRotating) {
            viewer.scene.camera.rotateRight(0.0003);
        }
    });
}

// =============================================
// FOCUS CAMERA ON DEBRIS
// =============================================
function focusOnDebris(debris) {
    if (!viewer) return;
    isRotating = false;
    viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
            debris.longitude,
            debris.latitude,
            debris.altitude * 1000 + 2000000
        ),
        duration: 2,
    });
    setTimeout(() => { isRotating = true; }, 5000);
}

// =============================================
// BOOT
// =============================================
initGlobe();
startGlobeRotation();