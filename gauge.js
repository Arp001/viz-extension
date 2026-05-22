/**
 * Semi-Circular Gauge Chart — Tableau Dashboard Extension (Main Page)
 *
 * Uses D3.js for rendering and Tableau Extensions API for data integration.
 * Configuration is handled via a SEPARATE popup dialog (config.html) opened
 * through tableau.extensions.ui.displayDialogAsync().
 */

(function () {
  'use strict';

  // ─── Default Settings ──────────────────────────────────────────────
  const DEFAULT_CONFIG = {
    worksheet: '',
    measure: '',
    aggregation: 'SUM',
    minValue: 0,
    maxValue: 100,
    title: 'Gauge',
    subtitle: '',
    ranges: [
      { from: 0, to: 33, color: '#dc3545', label: 'Low' },
      { from: 33, to: 66, color: '#ffc107', label: 'Medium' },
      { from: 66, to: 100, color: '#28a745', label: 'High' },
    ],
    needleColor: '#333333',
    trackColor: '#e9ecef',
    valueFontSize: 28,
    valueColor: '#333333',
    arcThickness: 30,
    valueFormat: 'number',
    currencySymbol: '$',
    showLabels: true,
    showTicks: true,
    showRangeLabels: false,
    enableFilter: true,
    filterField: '',
    enableTooltip: true,
    animate: true,
  };

  let config = cloneConfig(DEFAULT_CONFIG);
  let currentValue = 0;
  let worksheetObj = null;
  let unregisterFilterHandler = null;
  let unregisterMarkHandler = null;

  // ─── Helpers ───────────────────────────────────────────────────────

  function cloneConfig(c) {
    return { ...c, ranges: (c.ranges || []).map(r => ({ ...r })) };
  }

  function formatValue(val) {
    const v = Number(val);
    if (isNaN(v)) return '—';
    switch (config.valueFormat) {
      case 'decimal1': return d3.format(',.1f')(v);
      case 'decimal2': return d3.format(',.2f')(v);
      case 'percent':  return d3.format(',.0f')(v) + '%';
      case 'currency': return config.currencySymbol + d3.format(',.0f')(v);
      case 'compact':  return d3.format('.3~s')(v);
      default:         return d3.format(',.0f')(v);
    }
  }

  function valueToAngle(val) {
    const ratio = Math.max(0, Math.min(1, (val - config.minValue) / (config.maxValue - config.minValue || 1)));
    return -Math.PI / 2 + ratio * Math.PI;
  }

  // ─── D3 Gauge Renderer ────────────────────────────────────────────

  function renderGauge(animateNeedle) {
    const container = document.getElementById('gauge-svg-wrapper');
    const fullW = container.clientWidth || 300;
    const fullH = container.clientHeight || 200;

    const gaugeW = fullW;
    const gaugeH = fullH;
    const radius = Math.min(gaugeW / 2, gaugeH) * 0.82;
    const innerRatio = 1 - config.arcThickness / 100;
    const innerRadius = radius * innerRatio;

    const svg = d3.select('#gauge-svg')
      .attr('width', gaugeW)
      .attr('height', gaugeH);

    svg.selectAll('*').remove();

    const cx = gaugeW / 2;
    const cy = gaugeH * 0.75;

    const g = svg.append('g').attr('transform', `translate(${cx},${cy})`);

    // Background track
    const bgArc = d3.arc()
      .innerRadius(innerRadius)
      .outerRadius(radius)
      .startAngle(-Math.PI / 2)
      .endAngle(Math.PI / 2)
      .cornerRadius(3);

    g.append('path').attr('d', bgArc()).attr('fill', config.trackColor);

    // Colored range arcs
    const arcGen = d3.arc()
      .innerRadius(innerRadius)
      .outerRadius(radius)
      .cornerRadius(2);

    config.ranges.forEach((range, idx) => {
      const startAngle = valueToAngle(Math.max(range.from, config.minValue));
      const endAngle = valueToAngle(Math.min(range.to, config.maxValue));
      if (endAngle <= startAngle) return;

      const segment = g.append('path')
        .attr('class', 'gauge-arc-segment')
        .attr('d', arcGen({ startAngle, endAngle }))
        .attr('fill', range.color)
        .attr('data-index', idx);

      if (config.enableTooltip) {
        segment
          .on('mouseenter', function (event) {
            showTooltip(event, range.label || `Range ${idx + 1}`,
              `${formatValue(range.from)} – ${formatValue(range.to)}`, '');
          })
          .on('mousemove', function (event) { moveTooltip(event); })
          .on('mouseleave', hideTooltip);
      }

      if (config.enableFilter) {
        segment.on('click', function () { filterByRange(range); });
      }
    });

    // Tick marks
    if (config.showTicks) {
      const numTicks = 10;
      for (let i = 0; i <= numTicks; i++) {
        const val = config.minValue + (config.maxValue - config.minValue) * (i / numTicks);
        const angle = valueToAngle(val);
        const isMajor = i % 5 === 0;
        const len = isMajor ? 10 : 5;
        const x1 = (radius + 2) * Math.cos(angle);
        const y1 = (radius + 2) * Math.sin(angle);
        const x2 = (radius + 2 + len) * Math.cos(angle);
        const y2 = (radius + 2 + len) * Math.sin(angle);
        g.append('line')
          .attr('x1', x1).attr('y1', y1)
          .attr('x2', x2).attr('y2', y2)
          .attr('stroke', '#999')
          .attr('stroke-width', isMajor ? 1.5 : 0.8);
      }
    }

    // Min / Max labels
    if (config.showLabels) {
      g.append('text')
        .attr('class', 'gauge-min-label')
        .attr('x', -radius - 6).attr('y', 18)
        .attr('text-anchor', 'end')
        .text(formatValue(config.minValue));
      g.append('text')
        .attr('class', 'gauge-max-label')
        .attr('x', radius + 6).attr('y', 18)
        .attr('text-anchor', 'start')
        .text(formatValue(config.maxValue));
    }

    // Range labels on arc
    if (config.showRangeLabels) {
      config.ranges.forEach(range => {
        const midVal = (Math.max(range.from, config.minValue) + Math.min(range.to, config.maxValue)) / 2;
        const angle = valueToAngle(midVal);
        const labelR = (innerRadius + radius) / 2;
        g.append('text')
          .attr('x', labelR * Math.cos(angle))
          .attr('y', labelR * Math.sin(angle))
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'central')
          .attr('font-size', '10px')
          .attr('fill', '#fff')
          .attr('font-weight', '600')
          .attr('pointer-events', 'none')
          .text(range.label || '');
      });
    }

    // Needle
    const needleLen = radius * 0.92;
    const needleAngle = valueToAngle(currentValue);
    const needleGroup = g.append('g').attr('class', 'gauge-needle');

    if (config.enableTooltip) {
      needleGroup
        .on('mouseenter', function (event) {
          const rangeInfo = findRangeForValue(currentValue);
          showTooltip(event, config.title || 'Value', formatValue(currentValue),
            rangeInfo ? rangeInfo.label : '');
        })
        .on('mousemove', function (event) { moveTooltip(event); })
        .on('mouseleave', hideTooltip);
    }

    const nw = 4;
    needleGroup.append('polygon')
      .attr('points', `0,${-needleLen} ${-nw},0 ${nw},0`)
      .attr('fill', config.needleColor);
    needleGroup.append('circle')
      .attr('r', 7)
      .attr('fill', config.needleColor);

    if (animateNeedle && config.animate) {
      const startAngleVal = valueToAngle(config.minValue);
      needleGroup
        .attr('transform', `rotate(${(startAngleVal * 180) / Math.PI})`)
        .transition()
        .duration(1200)
        .ease(d3.easeElasticOut.amplitude(1).period(0.6))
        .attr('transform', `rotate(${(needleAngle * 180) / Math.PI})`);
    } else {
      needleGroup.attr('transform', `rotate(${(needleAngle * 180) / Math.PI})`);
    }

    // Center value
    g.append('text')
      .attr('class', 'gauge-value-text')
      .attr('y', -12)
      .attr('text-anchor', 'middle')
      .attr('font-size', `${config.valueFontSize}px`)
      .attr('fill', config.valueColor)
      .text(formatValue(currentValue));

    // Title & subtitle
    document.getElementById('gauge-title').textContent = config.title || '';
    document.getElementById('gauge-subtitle').textContent = config.subtitle || '';
  }

  function findRangeForValue(val) {
    return config.ranges.find(r => val >= r.from && val < r.to) || config.ranges[config.ranges.length - 1];
  }

  // ─── Tooltip ───────────────────────────────────────────────────────

  function showTooltip(event, label, value, extra) {
    const tt = document.getElementById('gauge-tooltip');
    document.getElementById('tt-label').textContent = label;
    document.getElementById('tt-value').textContent = value;
    document.getElementById('tt-range').textContent = extra;
    tt.classList.add('visible');
    moveTooltip(event);
  }

  function moveTooltip(event) {
    const tt = document.getElementById('gauge-tooltip');
    tt.style.left = (event.clientX + 14) + 'px';
    tt.style.top = (event.clientY - 10) + 'px';
  }

  function hideTooltip() {
    document.getElementById('gauge-tooltip').classList.remove('visible');
  }

  // ─── Filtering ─────────────────────────────────────────────────────

  async function filterByRange(range) {
    if (!worksheetObj) return;
    try {
      const fieldName = config.filterField || config.measure;
      if (!fieldName) return;
      const dashboard = tableau.extensions.dashboardContent.dashboard;
      const promises = dashboard.worksheets
        .filter(ws => ws.name !== config.worksheet)
        .map(ws =>
          ws.applyRangeFilterAsync(fieldName, { min: range.from, max: range.to })
            .catch(() => { /* field may not exist on this sheet */ })
        );
      await Promise.all(promises);
    } catch (err) {
      console.warn('[Gauge] Filter error:', err);
    }
  }

  // ─── Data Fetch ────────────────────────────────────────────────────

  async function fetchDataAndRender(animate) {
    if (!config.worksheet || !config.measure) {
      showError('No worksheet or measure selected. Right-click the extension → Configure.');
      return;
    }

    try {
      const dashboard = tableau.extensions.dashboardContent.dashboard;
      worksheetObj = dashboard.worksheets.find(ws => ws.name === config.worksheet);
      if (!worksheetObj) {
        showError(`Worksheet "${config.worksheet}" not found in the dashboard.`);
        return;
      }

      const dataTable = await worksheetObj.getSummaryDataAsync();
      const columns = dataTable.columns;
      const colIdx = columns.findIndex(c => c.fieldName === config.measure);

      if (colIdx === -1) {
        showError(`Measure "${config.measure}" not found in worksheet.`);
        return;
      }

      const values = dataTable.data.map(row => parseFloat(row[colIdx].value)).filter(v => !isNaN(v));
      if (values.length === 0) {
        currentValue = 0;
      } else {
        switch (config.aggregation) {
          case 'SUM':   currentValue = d3.sum(values); break;
          case 'AVG':   currentValue = d3.mean(values); break;
          case 'MIN':   currentValue = d3.min(values); break;
          case 'MAX':   currentValue = d3.max(values); break;
          case 'FIRST': currentValue = values[0]; break;
          default:      currentValue = d3.sum(values);
        }
      }

      hideError();
      hideLoading();
      renderGauge(animate);

    } catch (err) {
      console.error('[Gauge] Data fetch error:', err);
      showError('Error fetching data: ' + err.message);
    }
  }

  // ─── UI Helpers ────────────────────────────────────────────────────

  function showLoading() {
    document.getElementById('loading-overlay').style.display = 'flex';
  }

  function hideLoading() {
    document.getElementById('loading-overlay').style.display = 'none';
  }

  function showError(msg) {
    hideLoading();
    const el = document.getElementById('error-message');
    document.getElementById('error-text').textContent = msg;
    el.style.display = 'flex';
  }

  function hideError() {
    document.getElementById('error-message').style.display = 'none';
  }

  // ─── Load Settings from Tableau ────────────────────────────────────

  function loadSettings() {
    const raw = tableau.extensions.settings.get('gaugeConfig');
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        config = { ...DEFAULT_CONFIG, ...parsed, ranges: (parsed.ranges || DEFAULT_CONFIG.ranges).map(r => ({ ...r })) };
        console.log('[Gauge] Settings loaded:', config.worksheet, config.measure);
      } catch (e) {
        console.warn('[Gauge] Failed to parse saved settings:', e);
      }
    } else {
      console.log('[Gauge] No saved settings found — using defaults.');
    }
  }

  // ─── Configuration Dialog (Popup via displayDialogAsync) ──────────

  /**
   * Called by Tableau when the user clicks "Configure" from the context menu.
   * Opens config.html as a separate popup dialog window.
   */
  function openConfigureDialog() {
    console.log('[Gauge] Configure callback triggered — opening popup dialog...');

    // Build the URL for the config dialog relative to the main page
    const baseUrl = window.location.href.replace(/\/[^/]*$/, '/');
    const popupUrl = baseUrl + 'config.html';

    console.log('[Gauge] Dialog URL:', popupUrl);

    tableau.extensions.ui.displayDialogAsync(
      popupUrl,
      '',  // initial payload (empty — dialog reads settings directly)
      { height: 600, width: 580 }
    ).then(function (closePayload) {
      // Dialog was closed via closeDialog() — settings were saved
      console.log('[Gauge] Config dialog closed. Payload:', closePayload);
      // Reload settings from the shared settings store
      loadSettings();
      showLoading();
      fetchDataAndRender(true).then(function () {
        listenForDataChanges();
      });
    }).catch(function (error) {
      // User closed the dialog via X button — that's OK
      if (error.errorCode === tableau.ErrorCodes.DialogClosedByUser) {
        console.log('[Gauge] Config dialog closed by user (X button).');
      } else {
        console.error('[Gauge] Error displaying config dialog:', error);
      }
    });
  }

  // ─── Data Change Listener ─────────────────────────────────────────

  function listenForDataChanges() {
    // Remove previous listeners if any
    if (unregisterFilterHandler) {
      unregisterFilterHandler();
      unregisterFilterHandler = null;
    }
    if (unregisterMarkHandler) {
      unregisterMarkHandler();
      unregisterMarkHandler = null;
    }

    if (!worksheetObj) return;

    unregisterFilterHandler = worksheetObj.addEventListener(
      tableau.TableauEventType.FilterChanged,
      () => { fetchDataAndRender(false); }
    );
    unregisterMarkHandler = worksheetObj.addEventListener(
      tableau.TableauEventType.MarkSelectionChanged,
      () => { fetchDataAndRender(false); }
    );
    console.log('[Gauge] Data change listeners registered for worksheet:', config.worksheet);
  }

  // ─── Initialization ───────────────────────────────────────────────

  async function initExtension() {
    showLoading();
    console.log('[Gauge] Initializing extension...');

    try {
      // Register the configure callback — THIS is what Tableau calls
      // when the user right-clicks → Configure
      await tableau.extensions.initializeAsync({ configure: openConfigureDialog });
      console.log('[Gauge] Extension initialized successfully.');

      loadSettings();

      if (config.worksheet && config.measure) {
        await fetchDataAndRender(true);
        listenForDataChanges();
      } else {
        hideLoading();
        showError('Extension not configured yet. Right-click the extension zone → Configure to get started.');
      }

    } catch (err) {
      console.error('[Gauge] Initialization error:', err);
      // If initialization fails, we're likely running outside Tableau (standalone browser)
      // or there's a real configuration issue. Show demo gauge as a graceful fallback.
      if (!err || !err.message || err.message === '' ||
          err.message.includes('not running inside') ||
          err.message.includes('not a Tableau extension') ||
          err.message.includes('Initialization failed')) {
        console.info('[Gauge] Likely running outside Tableau. Falling back to demo mode.');
        fallbackToDemo();
      } else {
        hideLoading();
        showError('Initialization failed: ' + err.message);
      }
    }
  }

  // ─── Window Resize Handler ─────────────────────────────────────────

  let resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => renderGauge(false), 150);
  });

  // ─── Boot ──────────────────────────────────────────────────────────

  /**
   * Detect whether the Tableau Extensions API loaded successfully.
   *
   * IMPORTANT: The API library must be loaded BEFORE this script runs.
   * The correct CDN URL is:
   *   https://cdn.jsdelivr.net/gh/tableau/extensions-api@main/lib/tableau.extensions.1.latest.min.js
   *
   * Common failures:
   *  - Wrong CDN URL (e.g. pointing to a third-party fork that was removed)
   *  - Network/firewall blocking the CDN
   *  - Script load order wrong (gauge.js runs before the API script)
   *  - Running in a standalone browser (not inside Tableau) — this is expected
   */

  function checkApiAndBoot() {
    // Check 1: Does the global `tableau` object exist?
    if (typeof tableau === 'undefined') {
      console.error(
        '[Gauge] ❌ CRITICAL: The global "tableau" object is undefined.\n' +
        '  This means the Tableau Extensions API JavaScript library did NOT load.\n' +
        '  Possible causes:\n' +
        '    1. The <script> tag URL for the API library is wrong or unreachable.\n' +
        '       Expected: https://cdn.jsdelivr.net/gh/tableau/extensions-api@main/lib/tableau.extensions.1.latest.min.js\n' +
        '    2. A network/firewall issue is blocking the CDN (cdn.jsdelivr.net).\n' +
        '    3. The script is in the wrong position in gauge.html (must load BEFORE gauge.js).\n' +
        '    4. You are opening this page in a regular browser (not inside Tableau Desktop).\n' +
        '       → If so, this is normal. A demo gauge will render instead.'
      );
      fallbackToDemo();
      return;
    }

    // Check 2: Does `tableau.extensions` exist?
    if (!tableau.extensions) {
      console.error(
        '[Gauge] ❌ The "tableau" object exists but "tableau.extensions" is undefined.\n' +
        '  This may mean a different Tableau API library was loaded (e.g. the Embedding API v3\n' +
        '  instead of the Extensions API). Ensure gauge.html loads the Extensions API library:\n' +
        '    https://cdn.jsdelivr.net/gh/tableau/extensions-api@main/lib/tableau.extensions.1.latest.min.js'
      );
      fallbackToDemo();
      return;
    }

    // API is available — initialize the extension
    console.log('[Gauge] ✅ Tableau Extensions API detected. Version info:', typeof tableau.extensions.environment !== 'undefined' ? tableau.extensions.environment : 'N/A');
    initExtension();
  }

  function fallbackToDemo() {
    hideLoading();
    currentValue = 72;
    config.title = 'Demo Gauge';
    config.subtitle = 'Not connected to Tableau';
    renderGauge(true);
    console.info('[Gauge] Rendering standalone demo gauge (Tableau API not available).');
  }

  checkApiAndBoot();

})();
