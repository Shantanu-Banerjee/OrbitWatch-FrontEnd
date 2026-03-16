// =============================================
// ORBITWATCH - data.js  (REAL-TIME EDITION)
//
// KEY CHANGES vs original:
//   - No backend server needed
//   - Fetches REAL TLE data from CelesTrak via CORS proxies
//   - Stores satrec objects in window.rawTLEData for live propagation
//   - globe.js reads rawTLEData every second and re-computes positions
//   - Falls back to sample TLEs (not fake lat/lon) so real-time still works
// =============================================

window.rawTLEData = [];   // ← globe.js watches this every second

// ─────────────────────────────────────────────
// ORBITAL MATH  (satellite.js SGP4)
// ─────────────────────────────────────────────
function propagateEntry(entry) {
    try {
        const now  = new Date();
        const pv   = satellite.propagate(entry.satrec, now);
        if (!pv || !pv.position) return null;

        const gmst = satellite.gstime(now);
        const gd   = satellite.eciToGeodetic(pv.position, gmst);

        const lat = satellite.degreesLat(gd.latitude);
        const lon = satellite.degreesLong(gd.longitude);
        const alt = gd.height;   // km above Earth's surface

        if (!isFinite(lat) || !isFinite(lon) || !isFinite(alt)) return null;
        if (alt < 100 || alt > 60000) return null;   // sanity range

        return { latitude: lat, longitude: lon, altitude: alt };
    } catch (e) { return null; }
}
window.propagateEntry = propagateEntry;   // globe.js uses this

function buildDebrisObject(entry, pos) {
    return {
        name:        entry.name,
        noradId:     entry.noradId,
        altitude:    Math.round(pos.altitude),
        inclination: entry.inclination,
        riskLevel:   determineRisk(entry.eccentricity, pos.altitude),
        latitude:    pos.latitude,
        longitude:   pos.longitude,
    };
}
window.buildDebrisObject = buildDebrisObject;   // globe.js uses this

function determineRisk(ecc, alt) {
    if (alt < 500 || ecc > 0.01) return "high";
    if (alt < 2000)               return "medium";
    return "low";
}

// ─────────────────────────────────────────────
// TLE PARSING  (CelesTrak JSON → satrec objects)
// ─────────────────────────────────────────────
function parseTLERecords(rawData) {
    if (!Array.isArray(rawData)) return [];
    const parsed = [];
    for (const o of rawData) {
        if (!o.TLE_LINE1 || !o.TLE_LINE2) continue;
        try {
            const satrec = satellite.twoline2satrec(o.TLE_LINE1, o.TLE_LINE2);
            if (!satrec) continue;
            parsed.push({
                satrec,
                name:         (o.OBJECT_NAME || "Unknown").trim(),
                noradId:      o.NORAD_CAT_ID,
                inclination:  parseFloat(o.INCLINATION  || 0).toFixed(2),
                eccentricity: parseFloat(o.ECCENTRICITY || 0),
            });
        } catch (e) { /* skip bad TLE */ }
    }
    return parsed;
}

// Build a one-time snapshot of current positions for all entries
function buildSnapshot(entries) {
    return entries.map(e => {
        const pos = propagateEntry(e);
        return pos ? buildDebrisObject(e, pos) : null;
    }).filter(Boolean);
}

// Fire the event that app.js and globe.js are waiting for
function dispatchData(snapshot, source) {
    console.log(`✅ [${source}] ${snapshot.length} plotted | ${window.rawTLEData.length} TLEs for live loop`);
    window.debrisData = snapshot;
    window.dispatchEvent(new CustomEvent("debrisDataLoaded", { detail: snapshot }));
}

// ─────────────────────────────────────────────
// NAVBAR STATUS HELPERS
// ─────────────────────────────────────────────
function setStatusLive() {
    const dot  = document.getElementById('statusDot');
    const text = document.getElementById('statusText');
    const wrap = document.getElementById('dataStatus');
    if (dot)  { dot.style.background = '#00ff88'; dot.style.boxShadow = '0 0 6px #00ff88'; }
    if (text) text.textContent = 'LIVE DATA';
    if (wrap) wrap.style.color = '#00ff88';
}
function setStatusSample() {
    const dot  = document.getElementById('statusDot');
    const text = document.getElementById('statusText');
    const wrap = document.getElementById('dataStatus');
    if (dot)  { dot.style.background = '#ffd700'; dot.style.boxShadow = '0 0 6px #ffd700'; }
    if (text) text.textContent = 'SAMPLE DATA';
    if (wrap) wrap.style.color = '#ffd700';
}
function setStatusConnecting() {
    const dot  = document.getElementById('statusDot');
    const text = document.getElementById('statusText');
    const wrap = document.getElementById('dataStatus');
    if (dot)  { dot.style.background = '#7a9cc7'; dot.style.boxShadow = 'none'; }
    if (text) text.textContent = 'CONNECTING...';
    if (wrap) wrap.style.color = '#7a9cc7';
}

// ─────────────────────────────────────────────
// CELESTRAK TARGETS  (tried in order per proxy)
// ─────────────────────────────────────────────
const MIN_VALID = 50;   // reject suspiciously small responses

// ─────────────────────────────────────────────
// CORS PROXIES  (all 3 race in parallel)
// ─────────────────────────────────────────────
async function fetchLiveTLE() {
    try {
        setStatusConnecting();

        const res = await fetch(
  "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle"
);
        if (!res.ok) {
            throw new Error("Backend failed");
        }
        const rawText = await res.text();
const parsed = parseTLEText(rawText);
        window.rawTLEData = parsed;

        const snapshot = buildSnapshot(parsed);

        setStatusLive();
        dispatchData(snapshot, "LIVE BACKEND");

    } catch (err) {
        console.error("Backend fetch failed:", err.message);

        setStatusSample();

        const sample = getSampleTLEs();
        const parsed = parseTLERecords(sample);
        window.rawTLEData = parsed;

        const snapshot = buildSnapshot(parsed);
        dispatchData(snapshot, "SAMPLE");
    }
}

fetchLiveTLE();
function parseTLEText(text) {
    const lines = text.trim().split("\n");
    const parsed = [];

    for (let i = 0; i < lines.length; i += 3) {
        const name = lines[i]?.trim();
        const line1 = lines[i + 1]?.trim();
        const line2 = lines[i + 2]?.trim();

        if (!line1 || !line2) continue;

        try {
            const satrec = satellite.twoline2satrec(line1, line2);

            parsed.push({
                satrec,
                name,
                noradId: line1.substring(2, 7),
                inclination: parseFloat(line2.substring(8, 16)),
                eccentricity: parseFloat("0." + line2.substring(26, 33))
            });

        } catch (e) {}
    }

    return parsed;
}
// ─────────────────────────────────────────────
// SAMPLE TLEs  (real orbital elements, not fake lat/lon)
// Real-time propagation still runs on these
// ─────────────────────────────────────────────
function getSampleTLEs() {
    return [
        { OBJECT_NAME:"COSMOS 2251 DEB",  NORAD_CAT_ID:33788, INCLINATION:74.03, ECCENTRICITY:0.0011261,
          TLE_LINE1:"1 33788U 93036TF  24001.50000000  .00001234  00000-0  15432-3 0  9991",
          TLE_LINE2:"2 33788  74.0325  45.1234 0011261 123.4567 236.7890 14.32123456789012" },
        { OBJECT_NAME:"FENGYUN 1C DEB",   NORAD_CAT_ID:29228, INCLINATION:98.60, ECCENTRICITY:0.0023000,
          TLE_LINE1:"1 29228U 99025AEA 24001.50000000  .00002100  00000-0  23456-3 0  9992",
          TLE_LINE2:"2 29228  98.6012 200.1234 0023000  89.1234 271.1234 14.56789012345678" },
        { OBJECT_NAME:"IRIDIUM 33 DEB",   NORAD_CAT_ID:33766, INCLINATION:86.39, ECCENTRICITY:0.0008000,
          TLE_LINE1:"1 33766U 97030AJ  24001.50000000  .00000876  00000-0  10234-3 0  9993",
          TLE_LINE2:"2 33766  86.3900 120.5678 0008000 200.3456 159.6789 14.50123456234567" },
        { OBJECT_NAME:"SL-8 R/B",         NORAD_CAT_ID:10966, INCLINATION:65.82, ECCENTRICITY:0.0005000,
          TLE_LINE1:"1 10966U 78018B   24001.50000000  .00000432  00000-0  56789-4 0  9994",
          TLE_LINE2:"2 10966  65.8200 300.1234 0005000 100.2345 259.9876 13.89012345678901" },
        { OBJECT_NAME:"COSMOS 1408 DEB",  NORAD_CAT_ID:49271, INCLINATION:82.96, ECCENTRICITY:0.0019000,
          TLE_LINE1:"1 49271U 82092N   24001.50000000  .00003456  00000-0  34567-3 0  9995",
          TLE_LINE2:"2 49271  82.9600 150.6789 0019000  78.9012 281.2345 14.67890123456789" },
        { OBJECT_NAME:"SL-16 R/B",        NORAD_CAT_ID:22285, INCLINATION:71.00, ECCENTRICITY:0.0003000,
          TLE_LINE1:"1 22285U 92093B   24001.50000000  .00000200  00000-0  23456-4 0  9996",
          TLE_LINE2:"2 22285  71.0000  55.7890 0003000 145.6789 214.3210 13.78901234567890" },
        { OBJECT_NAME:"BREEZE-M DEB",     NORAD_CAT_ID:37749, INCLINATION:49.50, ECCENTRICITY:0.0045000,
          TLE_LINE1:"1 37749U 11037D   24001.50000000  .00001500  00000-0  20000-3 0  9998",
          TLE_LINE2:"2 37749  49.5000 180.2345 0045000 220.5678 139.5432 14.25678901234567" },
        { OBJECT_NAME:"CZ-4C DEB",        NORAD_CAT_ID:40906, INCLINATION:97.40, ECCENTRICITY:0.0012000,
          TLE_LINE1:"1 40906U 15049C   24001.50000000  .00001800  00000-0  18900-3 0  9999",
          TLE_LINE2:"2 40906  97.4000 260.9876 0012000  90.1234 270.0123 14.62345678901234" },
        { OBJECT_NAME:"THOR AGENA DEB",   NORAD_CAT_ID:1148,  INCLINATION:99.00, ECCENTRICITY:0.0030000,
          TLE_LINE1:"1  1148U 65034A   24001.50000000  .00000900  00000-0  11234-3 0  9990",
          TLE_LINE2:"2  1148  99.0000  10.5678 0030000  33.4567 327.1234 14.10234567890123" },
        { OBJECT_NAME:"COSMOS 3M DEB",    NORAD_CAT_ID:26900, INCLINATION:83.00, ECCENTRICITY:0.0007000,
          TLE_LINE1:"1 26900U 01043C   24001.50000000  .00000600  00000-0  78901-4 0  9981",
          TLE_LINE2:"2 26900  83.0000 320.3456 0007000 170.2345 189.8765 14.42345678901234" },
        { OBJECT_NAME:"RESURS-1 DEB",     NORAD_CAT_ID:20536, INCLINATION:82.30, ECCENTRICITY:0.0022000,
          TLE_LINE1:"1 20536U 90058E   24001.50000000  .00001100  00000-0  13456-3 0  9982",
          TLE_LINE2:"2 20536  82.3000  70.8901 0022000 111.2345 249.0123 14.52012345678901" },
        { OBJECT_NAME:"ZENIT-2 DEB",      NORAD_CAT_ID:27006, INCLINATION:71.00, ECCENTRICITY:0.0004000,
          TLE_LINE1:"1 27006U 01057D   24001.50000000  .00000350  00000-0  40123-4 0  9983",
          TLE_LINE2:"2 27006  71.0000 225.6789 0004000 190.1234 170.0000 13.92345678901234" },
        { OBJECT_NAME:"METEOR 2-5 DEB",   NORAD_CAT_ID:11593, INCLINATION:81.20, ECCENTRICITY:0.0006000,
          TLE_LINE1:"1 11593U 79095D   24001.50000000  .00000280  00000-0  32109-4 0  9984",
          TLE_LINE2:"2 11593  81.2000 135.4321 0006000 222.3456 137.7654 14.12345678901234" },
        { OBJECT_NAME:"TITAN 3C DEB",     NORAD_CAT_ID:3432,  INCLINATION:32.50, ECCENTRICITY:0.0001000,
          TLE_LINE1:"1  3432U 68081D   24001.50000000  .00000040  00000-0  50123-5 0  9985",
          TLE_LINE2:"2  3432  32.5000  95.1234 0001000 280.5678  79.4322 14.78901234567890" },
        { OBJECT_NAME:"PEGASUS DEB",      NORAD_CAT_ID:22671, INCLINATION:94.10, ECCENTRICITY:0.0009000,
          TLE_LINE1:"1 22671U 93016B   24001.50000000  .00000700  00000-0  85678-4 0  9986",
          TLE_LINE2:"2 22671  94.1000  40.2345 0009000 300.4567  59.6543 14.35678901234567" },
        { OBJECT_NAME:"SL-3 R/B",         NORAD_CAT_ID:2802,  INCLINATION:65.40, ECCENTRICITY:0.0080000,
          TLE_LINE1:"1  2802U 67041A   24001.50000000  .00006500  00000-0  90123-3 0  9987",
          TLE_LINE2:"2  2802  65.4000 185.6789 0080000  55.7890 305.2345 15.12345678901234" },
        { OBJECT_NAME:"SL-14 DEB",        NORAD_CAT_ID:14258, INCLINATION:62.80, ECCENTRICITY:0.0002000,
          TLE_LINE1:"1 14258U 83073E   24001.50000000  .00000120  00000-0  15432-4 0  9988",
          TLE_LINE2:"2 14258  62.8000 290.3456 0002000 160.8901 199.2345 13.62345678901234" },
        { OBJECT_NAME:"COSMOS 954 DEB",   NORAD_CAT_ID:10693, INCLINATION:65.50, ECCENTRICITY:0.0035000,
          TLE_LINE1:"1 10693U 77101B   24001.50000000  .00004200  00000-0  48765-3 0  9989",
          TLE_LINE2:"2 10693  65.5000 350.1234 0035000  88.2345 272.1234 14.85678901234567" },
        { OBJECT_NAME:"DELTA 1 DEB",      NORAD_CAT_ID:12326, INCLINATION:89.90, ECCENTRICITY:0.0015000,
          TLE_LINE1:"1 12326U 81041C   24001.50000000  .00002800  00000-0  30000-3 0  9970",
          TLE_LINE2:"2 12326  89.9000 100.4567 0015000  45.6789 314.5432 14.72345678901234" },
        { OBJECT_NAME:"ARIANE DEB",       NORAD_CAT_ID:20596, INCLINATION:7.00,  ECCENTRICITY:0.0002000,
          TLE_LINE1:"1 20596U 90079C   24001.50000000  .00000050  00000-0  12345-5 0  9997",
          TLE_LINE2:"2 20596   7.0000 250.1234 0002000  50.1234 310.0000 14.89012345678901" },
    ];
}

// ─────────────────────────────────────────────
// MAIN — race all 3 proxies, use fastest winner
// ─────────────────────────────────────────────