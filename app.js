// =============================================
// ORBITWATCH - app.js (ENHANCED EDITION)
//
// NEW FEATURES:
//   - Animated stat counter (count-up animation)
//   - Sortable table columns
//   - Pagination (50 rows per page)
//   - Altitude range slider filter
//   - CSV export
//   - Empty state display
//   - Orbital shell counts (LEO/MEO/GEO/HEO)
//   - Close approach detection & alerts
//   - Debris growth chart (Chart.js)
//   - Dark/Light theme toggle
//   - Result count display
// =============================================

// =============================================
// GLOBAL STATE
// =============================================
let debrisData   = [];
let filteredData = [];
let sortState    = { col: null, dir: 'asc' };
let currentPage  = 1;
const PAGE_SIZE  = 50;
let altMinVal    = 0;
let altMaxVal    = 60000;
let isDarkTheme  = true;

// =============================================
// MAIN INITIALIZATION
// =============================================
document.addEventListener('DOMContentLoaded', function() {
    console.log("OrbitWatch Enhanced app starting...");

    setupEventListeners();
    initDebrisGrowthChart();
    startUTCLiveClock();

    window.addEventListener('debrisDataLoaded', function(event) {
        console.log("Debris data loaded!");
        debrisData   = event.detail;
        filteredData = [...debrisData];

        updateStatistics();
        updateShellCounts();
        if (typeof plotDebrisOnGlobe === 'function') plotDebrisOnGlobe(filteredData);
        displayDebrisTable(filteredData);
        detectCloseApproaches();
        hideLoadingMessage();
    });

    // Data already available check
    if (typeof window.debrisData !== 'undefined') {
        debrisData   = window.debrisData;
        filteredData = [...debrisData];
        updateStatistics();
        updateShellCounts();
        if (typeof plotDebrisOnGlobe === 'function') plotDebrisOnGlobe(filteredData);
        displayDebrisTable(filteredData);
        detectCloseApproaches();
        hideLoadingMessage();
    }
});

// =============================================
// SETUP EVENT LISTENERS
// =============================================
function setupEventListeners() {
    // Search
    const searchInput = document.getElementById('searchInput');
    if (searchInput) searchInput.addEventListener('input', filterAndDisplayData);

    // Risk filter
    const riskFilter = document.getElementById('riskFilter');
    if (riskFilter) riskFilter.addEventListener('change', filterAndDisplayData);

    // Altitude sliders
    const altMin = document.getElementById('altSliderMin');
    const altMax = document.getElementById('altSliderMax');

    if (altMin) {
        altMin.addEventListener('input', function() {
            altMinVal = parseInt(this.value);
            if (altMinVal > altMaxVal - 100) {
                altMinVal = altMaxVal - 100;
                this.value = altMinVal;
            }
            document.getElementById('altMin').textContent = altMinVal.toLocaleString();
            filterAndDisplayData();
        });
    }

    if (altMax) {
        altMax.addEventListener('input', function() {
            altMaxVal = parseInt(this.value);
            if (altMaxVal < altMinVal + 100) {
                altMaxVal = altMinVal + 100;
                this.value = altMaxVal;
            }
            document.getElementById('altMax').textContent = altMaxVal.toLocaleString();
            filterAndDisplayData();
        });
    }

    // Theme toggle
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', toggleTheme);
    }
}

// =============================================
// FILTER AND DISPLAY
// =============================================
function filterAndDisplayData() {
    const searchTerm = (document.getElementById('searchInput').value || '').toLowerCase();
    const riskFilter = document.getElementById('riskFilter').value;

    filteredData = debrisData.filter(function(debris) {
        const matchesSearch = debris.name.toLowerCase().includes(searchTerm) ||
                             debris.noradId.toString().includes(searchTerm);
        const matchesRisk   = riskFilter === 'all' || debris.riskLevel === riskFilter;
        const matchesAlt    = debris.altitude >= altMinVal && debris.altitude <= altMaxVal;
        return matchesSearch && matchesRisk && matchesAlt;
    });

    // Re-apply sort
    if (sortState.col) applySortToData();

    currentPage = 1;

    if (typeof plotDebrisOnGlobe === 'function') plotDebrisOnGlobe(filteredData);
    displayDebrisTable(filteredData);
    updateResultCount();
}

// =============================================
// SORT TABLE
// =============================================
function sortTable(col) {
    // Toggle direction
    if (sortState.col === col) {
        sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
    } else {
        sortState.col = col;
        sortState.dir = 'asc';
    }

    // Update header arrows
    document.querySelectorAll('.sort-arrow').forEach(a => a.textContent = '↕');
    document.querySelectorAll('th.sortable').forEach(th => {
        th.classList.remove('sorted-asc', 'sorted-desc');
    });

    const arrowEl = document.getElementById('sort-' + col);
    const thEl = document.querySelector(`th[data-col="${col}"]`);
    if (arrowEl) arrowEl.textContent = sortState.dir === 'asc' ? '↑' : '↓';
    if (thEl) thEl.classList.add('sorted-' + sortState.dir);

    applySortToData();
    currentPage = 1;
    displayDebrisTable(filteredData);
}

function applySortToData() {
    const col = sortState.col;
    const dir = sortState.dir;
    const riskOrder = { high: 0, medium: 1, low: 2 };

    filteredData.sort((a, b) => {
        let va = a[col];
        let vb = b[col];

        if (col === 'riskLevel') {
            va = riskOrder[va] ?? 99;
            vb = riskOrder[vb] ?? 99;
        } else if (col === 'name') {
            va = va.toLowerCase();
            vb = vb.toLowerCase();
        } else {
            va = parseFloat(va) || 0;
            vb = parseFloat(vb) || 0;
        }

        if (va < vb) return dir === 'asc' ? -1 : 1;
        if (va > vb) return dir === 'asc' ?  1 : -1;
        return 0;
    });
}

// =============================================
// UPDATE STATISTICS (with animated counter)
// =============================================
function updateStatistics() {
    const totalCount = debrisData.length;
    const highRisk   = debrisData.filter(d => d.riskLevel === 'high').length;
    const leoCount   = debrisData.filter(d => d.altitude < 2000).length;

    animateCounter('total-count',      totalCount);
    animateCounter('high-risk-count',  highRisk);
    animateCounter('altitude-count',   leoCount);
    // close-approach-count updated separately
}

function animateCounter(elementId, target) {
    const el = document.getElementById(elementId);
    if (!el) return;

    const duration = 1200;
    const start    = 0;
    const startTime = performance.now();

    function update(now) {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        // Ease out cubic
        const eased = 1 - Math.pow(1 - progress, 3);
        const current = Math.round(start + (target - start) * eased);
        el.textContent = current.toLocaleString();

        if (progress < 1) {
            requestAnimationFrame(update);
        } else {
            el.textContent = target.toLocaleString();
        }
    }

    requestAnimationFrame(update);
}

// =============================================
// UPDATE ORBITAL SHELL COUNTS
// =============================================
function updateShellCounts() {
    const leo = debrisData.filter(d => d.altitude < 2000).length;
    const meo = debrisData.filter(d => d.altitude >= 2000  && d.altitude < 35786).length;
    const geo = debrisData.filter(d => d.altitude >= 35786 && d.altitude <= 36786).length;
    const heo = debrisData.filter(d => d.altitude > 36786).length;

    const set = (id, val) => {
        const el = document.getElementById(id);
        if (el) animateCounterSimple(el, val);
    };

    set('shell-leo-count', leo);
    set('shell-meo-count', meo);
    set('shell-geo-count', geo);
    set('shell-heo-count', heo);
}

function animateCounterSimple(el, target) {
    const duration = 1000;
    const startTime = performance.now();
    function update(now) {
        const p = Math.min((now - startTime) / duration, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.round(target * eased).toLocaleString();
        if (p < 1) requestAnimationFrame(update);
        else el.textContent = target.toLocaleString();
    }
    requestAnimationFrame(update);
}

// =============================================
// DETECT CLOSE APPROACHES
// Computes Euclidean distance in 3D for objects
// in the same altitude band
// =============================================
function detectCloseApproaches() {
    const THRESHOLD_KM = 200; // flag pairs within 200km (3D great-circle approx)
    const highRisk = debrisData.filter(d => d.riskLevel === 'high' || d.riskLevel === 'medium');
    const pairs    = [];

    // Limit to avoid O(n²) explosion — check first 500 high-risk objects
    const sample = highRisk.slice(0, 500);

    for (let i = 0; i < sample.length; i++) {
        for (let j = i + 1; j < sample.length; j++) {
            const a = sample[i];
            const b = sample[j];

            // Quick altitude pre-filter
            if (Math.abs(a.altitude - b.altitude) > THRESHOLD_KM) continue;

            // Haversine-like distance at given altitude
            const dist = approxDistance3D(a, b);
            if (dist < THRESHOLD_KM) {
                pairs.push({ a, b, dist: Math.round(dist) });
            }
        }
    }

    // Sort by closest
    pairs.sort((x, y) => x.dist - y.dist);
    const topPairs = pairs.slice(0, 10);

    // Update counter
    animateCounter('close-approach-count', topPairs.length);

    // Show alert banner if there are any
    if (topPairs.length > 0) {
        const banner = document.getElementById('alertBanner');
        const alertText = document.getElementById('alertText');
        if (banner && alertText) {
            alertText.textContent = `${topPairs.length} close approach pairs detected within 200km threshold — see monitor below`;
            banner.style.display = 'flex';
        }
    }

    renderCloseApproaches(topPairs);
}

function approxDistance3D(a, b) {
    // Convert to approximate Cartesian (Earth radius + altitude)
    const RE = 6371;
    const toRad = d => d * Math.PI / 180;

    const r1 = RE + a.altitude;
    const r2 = RE + b.altitude;

    const x1 = r1 * Math.cos(toRad(a.latitude)) * Math.cos(toRad(a.longitude));
    const y1 = r1 * Math.cos(toRad(a.latitude)) * Math.sin(toRad(a.longitude));
    const z1 = r1 * Math.sin(toRad(a.latitude));

    const x2 = r2 * Math.cos(toRad(b.latitude)) * Math.cos(toRad(b.longitude));
    const y2 = r2 * Math.cos(toRad(b.latitude)) * Math.sin(toRad(b.longitude));
    const z2 = r2 * Math.sin(toRad(b.latitude));

    return Math.sqrt((x2-x1)**2 + (y2-y1)**2 + (z2-z1)**2);
}

function renderCloseApproaches(pairs) {
    const list = document.getElementById('closeApproachList');
    if (!list) return;

    if (pairs.length === 0) {
        list.innerHTML = `<div style="text-align:center;padding:30px;color:var(--safe-green);letter-spacing:2px;">
            ✅ No close approaches detected in current dataset
        </div>`;
        return;
    }

    list.innerHTML = pairs.map(p => `
        <div class="approach-card" onclick="highlightApproachPair('${p.a.noradId}', '${p.b.noradId}')">
            <div class="approach-obj">
                <strong>${p.a.name}</strong><br>
                <span>NORAD ${p.a.noradId} · ${p.a.altitude}km</span>
            </div>
            <div class="approach-dist">
                <div class="approach-dist-value">~${p.dist} km</div>
                <div class="approach-dist-label">SEPARATION</div>
            </div>
            <div>
                <strong>${p.b.name}</strong><br>
                <span>NORAD ${p.b.noradId} · ${p.b.altitude}km</span>
            </div>
        </div>
    `).join('');
}

function highlightApproachPair(noradA, noradB) {
    // Focus globe on first object and show its panel
    const debrisA = debrisData.find(d => String(d.noradId) === String(noradA));
    if (debrisA) {
        if (typeof focusOnDebris === 'function') focusOnDebris(debrisA);
        if (typeof showDetailPanel === 'function') showDetailPanel(debrisA);
    }
}

// =============================================
// DISPLAY DEBRIS TABLE (with pagination)
// =============================================
function displayDebrisTable(data) {
    const tableBody = document.getElementById('debrisTableBody');
    if (!tableBody) return;

    tableBody.innerHTML = '';

    const emptyState = document.getElementById('emptyState');

    if (data.length === 0) {
        if (emptyState) emptyState.style.display = 'block';
        renderPagination(0);
        return;
    }

    if (emptyState) emptyState.style.display = 'none';

    // Paginate
    const totalPages = Math.ceil(data.length / PAGE_SIZE);
    currentPage = Math.min(currentPage, Math.max(1, totalPages));

    const startIdx = (currentPage - 1) * PAGE_SIZE;
    const endIdx   = Math.min(startIdx + PAGE_SIZE, data.length);
    const pageData = data.slice(startIdx, endIdx);

    pageData.forEach(function(debris) {
        const row = document.createElement('tr');

        row.addEventListener('click', function() {
            if (typeof focusOnDebris === 'function')   focusOnDebris(debris);
            if (typeof showDetailPanel === 'function') showDetailPanel(debris);
        });

        row.style.cursor = 'pointer';
        row.style.transition = 'background-color 0.3s';

        row.innerHTML = `
            <td>${debris.name}</td>
            <td>${debris.noradId}</td>
            <td>${debris.altitude.toLocaleString()}</td>
            <td>${parseFloat(debris.inclination).toFixed(2)}</td>
            <td>
                <span class="risk-badge ${debris.riskLevel}">
                    ${debris.riskLevel.toUpperCase()}
                </span>
            </td>
        `;

        tableBody.appendChild(row);
    });

    renderPagination(data.length);
    updateResultCount();
}

// =============================================
// RENDER PAGINATION
// =============================================
function renderPagination(totalItems) {
    const bar = document.getElementById('paginationBar');
    if (!bar) return;

    const totalPages = Math.ceil(totalItems / PAGE_SIZE);

    if (totalPages <= 1) {
        bar.innerHTML = '';
        return;
    }

    let html = '';

    // Prev
    html += `<button class="page-btn" onclick="goToPage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}>← Prev</button>`;

    // Page numbers (show at most 7 pages around current)
    const startPage = Math.max(1, currentPage - 3);
    const endPage   = Math.min(totalPages, currentPage + 3);

    if (startPage > 1) {
        html += `<button class="page-btn" onclick="goToPage(1)">1</button>`;
        if (startPage > 2) html += `<span class="page-info">…</span>`;
    }

    for (let p = startPage; p <= endPage; p++) {
        html += `<button class="page-btn ${p === currentPage ? 'active' : ''}" onclick="goToPage(${p})">${p}</button>`;
    }

    if (endPage < totalPages) {
        if (endPage < totalPages - 1) html += `<span class="page-info">…</span>`;
        html += `<button class="page-btn" onclick="goToPage(${totalPages})">${totalPages}</button>`;
    }

    // Next
    html += `<button class="page-btn" onclick="goToPage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''}>Next →</button>`;

    // Info
    const startIdx = (currentPage - 1) * PAGE_SIZE + 1;
    const endIdx   = Math.min(currentPage * PAGE_SIZE, totalItems);
    html += `<span class="page-info">${startIdx}–${endIdx} of ${totalItems.toLocaleString()}</span>`;

    bar.innerHTML = html;
}

function goToPage(page) {
    const totalPages = Math.ceil(filteredData.length / PAGE_SIZE);
    if (page < 1 || page > totalPages) return;
    currentPage = page;
    displayDebrisTable(filteredData);
    document.querySelector('.table-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// =============================================
// RESULT COUNT
// =============================================
function updateResultCount() {
    const el = document.getElementById('resultCount');
    if (el) {
        el.textContent = filteredData.length === debrisData.length
            ? `Showing all ${debrisData.length.toLocaleString()} objects`
            : `Showing ${filteredData.length.toLocaleString()} of ${debrisData.length.toLocaleString()} objects`;
    }
}

// =============================================
// CSV EXPORT
// =============================================
function exportCSV() {
    if (!filteredData.length) { alert('No data to export.'); return; }

    const headers = ['Name', 'NORAD ID', 'Altitude (km)', 'Inclination (°)', 'Latitude', 'Longitude', 'Risk Level'];
    const rows = filteredData.map(d => [
        `"${d.name}"`,
        d.noradId,
        d.altitude,
        d.inclination,
        typeof d.latitude  === 'number' ? d.latitude.toFixed(4)  : '',
        typeof d.longitude === 'number' ? d.longitude.toFixed(4) : '',
        d.riskLevel,
    ].join(','));

    const csv  = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);

    const link    = document.createElement('a');
    link.href     = url;
    link.download = `orbitwatch_debris_${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
}

// =============================================
// DARK / LIGHT THEME TOGGLE
// =============================================
function toggleTheme() {
    isDarkTheme = !isDarkTheme;
    document.body.classList.toggle('light-theme', !isDarkTheme);
    const icon = document.getElementById('themeIcon');
    if (icon) icon.textContent = isDarkTheme ? '☀️' : '🌙';

    // Re-render the chart in new theme colors
    if (window.debrisChart) {
        updateChartTheme();
    }
}

// =============================================
// DEBRIS GROWTH CHART (Chart.js)
// =============================================
function initDebrisGrowthChart() {
    const canvas = document.getElementById('debrisGrowthChart');
    if (!canvas || typeof Chart === 'undefined') return;

    // Historical debris count data with key events
    const data = {
        labels: [
            '1957', '1960', '1965', '1970', '1978', '1986', '1996',
            '2007', '2009', '2012', '2015', '2019', '2021', '2023', '2025'
        ],
        datasets: [{
            label: 'Total Tracked Debris',
            data: [
                1, 40, 180, 1750, 4800, 6500, 8500,
                13000, 16000, 17000, 18500, 19200, 25000, 27000, 29000
            ],
            borderColor: '#00d4ff',
            backgroundColor: 'rgba(0, 212, 255, 0.08)',
            borderWidth: 2.5,
            fill: true,
            tension: 0.4,
            pointRadius: 5,
            pointBackgroundColor: '#00d4ff',
            pointBorderColor: '#020818',
            pointBorderWidth: 2,
            pointHoverRadius: 8,
        }],
    };

    // Key event annotations (drawn manually via plugin-free approach)
    const events = [
        { label: 'Sputnik 1', x: '1957' },
        { label: 'Fengyun ASAT', x: '2007' },
        { label: 'Iridium-Cosmos', x: '2009' },
        { label: 'Cosmos 1408 ASAT', x: '2021' },
    ];

    const ctx = canvas.getContext('2d');

    window.debrisChart = new Chart(ctx, {
        type: 'line',
        data: data,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { intersect: false, mode: 'index' },
            plugins: {
                legend: {
                    labels: {
                        color: '#7a9cc7',
                        font: { family: "'Share Tech Mono', monospace", size: 12 },
                        boxWidth: 16,
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(10, 22, 40, 0.95)',
                    borderColor: '#00d4ff',
                    borderWidth: 1,
                    titleColor: '#00d4ff',
                    bodyColor: '#e8f4fd',
                    titleFont: { family: "'Orbitron', sans-serif", size: 12 },
                    bodyFont:  { family: "'Share Tech Mono', monospace", size: 12 },
                    callbacks: {
                        label: ctx => ` ${ctx.raw.toLocaleString()} objects tracked`,
                        afterBody: ctx => {
                            const label = ctx[0].label;
                            const evtMap = {
                                '1957': '🚀 Sputnik 1 — first artificial satellite',
                                '2007': '💥 China ASAT test (Fengyun-1C) — +3,000 objects',
                                '2009': '💥 Iridium 33 × Cosmos 2251 collision — +2,000 objects',
                                '2021': '💥 Russia ASAT test (Cosmos 1408) — +1,500 objects',
                            };
                            return evtMap[label] ? ['', evtMap[label]] : [];
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid:  { color: 'rgba(26, 58, 92, 0.5)' },
                    ticks: { color: '#7a9cc7', font: { family: "'Share Tech Mono', monospace", size: 11 } },
                },
                y: {
                    grid:  { color: 'rgba(26, 58, 92, 0.5)' },
                    ticks: {
                        color: '#7a9cc7',
                        font: { family: "'Share Tech Mono', monospace", size: 11 },
                        callback: v => v >= 1000 ? (v/1000) + 'k' : v,
                    },
                    title: {
                        display: true,
                        text: 'Tracked Objects',
                        color: '#7a9cc7',
                        font: { family: "'Share Tech Mono', monospace", size: 11 },
                    }
                }
            }
        }
    });
}

function updateChartTheme() {
    const chart = window.debrisChart;
    if (!chart) return;
    const textColor = isDarkTheme ? '#7a9cc7' : '#3a5a8c';
    chart.options.scales.x.ticks.color = textColor;
    chart.options.scales.y.ticks.color = textColor;
    chart.options.scales.x.grid.color  = isDarkTheme ? 'rgba(26,58,92,0.5)' : 'rgba(176,200,232,0.5)';
    chart.options.scales.y.grid.color  = isDarkTheme ? 'rgba(26,58,92,0.5)' : 'rgba(176,200,232,0.5)';
    chart.options.plugins.legend.labels.color = textColor;
    chart.update();
}

// =============================================
// HIDE LOADING MESSAGE
// =============================================
function hideLoadingMessage() {
    const loadingMessage = document.getElementById('loadingMessage');
    if (loadingMessage) loadingMessage.style.display = 'none';
}

function showErrorMessage() {
    const errorMessage   = document.getElementById('errorMessage');
    const loadingMessage = document.getElementById('loadingMessage');
    if (errorMessage)   errorMessage.style.display = 'block';
    if (loadingMessage) loadingMessage.style.display = 'none';
}

// =============================================
// UTC LIVE CLOCK
// =============================================
function startUTCLiveClock() {
    function updateClock() {
        const now     = new Date();
        const hours   = String(now.getUTCHours()).padStart(2, '0');
        const minutes = String(now.getUTCMinutes()).padStart(2, '0');
        const seconds = String(now.getUTCSeconds()).padStart(2, '0');
        const el = document.getElementById("utcTime");
        if (el) el.textContent = `UTC ${hours}:${minutes}:${seconds}`;
    }
    updateClock();
    setInterval(updateClock, 1000);
}

// =============================================
// UTILITY
// =============================================
function formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}