/**
 * Semi-Circular Gauge Chart — Tableau Dashboard Extension
 * Uses D3.js for rendering and Tableau Extensions API for data integration.
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
    arcThickness: 30,          // percent of radius
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

  let config = { ...DEFAULT_CONFIG, ranges: DEFAULT_CONFIG.ranges.map(r => ({ ...r })) };
  let currentValue = 0;
  let worksheetObj = null;

  // ─── Helpers ───────────────────────────────────────────────────────

  /** Deep-clone config (ranges are arrays of objects). */
  function cloneConfig(c) {
    return { ...c, ranges: c.ranges.map(r => ({ ...r })) };
  }

  /** Format a number according to the chosen format. */
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

  /** Convert a value within [min,max] to an angle in [-π/2, π/2] (i.e. 0–180°). */
  function valueToAngle(val) {
    const ratio = Math.max(0, Math.min(1, (val - config.minValue) / (config.maxValue - config.minValue || 1)));
    return -Math.PI / 2 + ratio * Math.PI;                     // left → right
  }

  // ─── D3 Gauge Renderer ────────────────────────────────────────────

  function renderGauge(animateNeedle) {
    const container = document.getElementById('gauge-svg-wrapper');
    const fullW = container.clientWidth || 300;
    const fullH = container.clientHeight || 200;

    // The semicircle needs roughly 2:1 aspect — fit within available space
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
    const cy = gaugeH * 0.75;              // lower center to give room for title

    const g = svg.append('g').attr('transform', `translate(${cx},${cy})`);

    // --- Background track ---
    const bgArc = d3.arc()
      .innerRadius(innerRadius)
      .outerRadius(radius)
      .startAngle(-Math.PI / 2)
      .endAngle(Math.PI / 2)
      .cornerRadius(3);

    g.append('path')
      .attr('d', bgArc())
      .attr('fill', config.trackColor);

    // --- Colored range arcs ---
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

      // Tooltip
      if (config.enableTooltip) {
        segment.on('mouseenter', function (event) {
          showTooltip(event, range.label || `Range ${idx + 1}`, `${formatValue(range.from)} – ${formatValue(range.to)}`, '');
        })
        .on('mousemove', function (event) { moveTooltip(event); })
        .on('mouseleave', hideTooltip);
      }

      // Click-to-filter
      if (config.enableFilter) {
        segment.on('click', function () {
          filterByRange(range);
        });
      }
    });

    // --- Tick marks ---
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

    // --- Min / Max labels ---
    if (config.showLabels) {
      g.append('text')
        .attr('class', 'gauge-min-label')
        .attr('x', -radius - 6)
        .attr('y', 18)
        .attr('text-anchor', 'end')
        .text(formatValue(config.minValue));

      g.append('text')
        .attr('class', 'gauge-max-label')
        .attr('x', radius + 6)
        .attr('y', 18)
        .attr('text-anchor', 'start')
        .text(formatValue(config.maxValue));
    }

    // --- Range labels on arc ---
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

    // --- Needle ---
    const needleLen = radius * 0.92;
    const needleAngle = valueToAngle(currentValue);
    const needleGroup = g.append('g')
      .attr('class', 'gauge-needle');

    if (config.enableTooltip) {
      needleGroup.on('mouseenter', function (event) {
        const rangeInfo = findRangeForValue(currentValue);
        showTooltip(event, config.title || 'Value', formatValue(currentValue), rangeInfo ? rangeInfo.label : '');
      })
      .on('mousemove', function (event) { moveTooltip(event); })
      .on('mouseleave', hideTooltip);
    }

    // Needle shape: thin triangle
    const nw = 4;  // half-width at base
    needleGroup.append('polygon')
      .attr('points', `0,${-needleLen} ${-nw},0 ${nw},0`)
      .attr('fill', config.needleColor);

    // Needle center circle
    needleGroup.append('circle')
      .attr('r', 7)
      .attr('fill', config.needleColor);

    // Animate from min to current
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

    // --- Center value ---
    g.append('text')
      .attr('class', 'gauge-value-text')
      .attr('y', -12)
      .attr('text-anchor', 'middle')
      .attr('font-size', `${config.valueFontSize}px`)
      .attr('fill', config.valueColor)
      .text(formatValue(currentValue));

    // --- Title & subtitle ---
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

      // Apply a range filter on other worksheets via the dashboard
      const dashboard = tableau.extensions.dashboardContent.dashboard;
      const promises = dashboard.worksheets
        .filter(ws => ws.name !== config.worksheet)   // filter OTHER worksheets
        .map(ws =>
          ws.applyRangeFilterAsync(fieldName, {
            min: range.from,
            max: range.to,
          }).catch(() => { /* field may not exist on this sheet */ })
        );
      await Promise.all(promises);
    } catch (err) {
      console.warn('Filter error:', err);
    }
  }

  // ─── Data Fetch ────────────────────────────────────────────────────

  async function fetchDataAndRender(animate) {
    if (!config.worksheet || !config.measure) {
      showError('No worksheet or measure selected. Right-click → Configure.');
      return;
    }

    try {
      const dashboard = tableau.extensions.dashboardContent.dashboard;
      worksheetObj = dashboard.worksheets.find(ws => ws.name === config.worksheet);
      if (!worksheetObj) {
        showError(`Worksheet "${config.worksheet}" not found.`);
        return;
      }

      const dataTable = await worksheetObj.getSummaryDataAsync();
      const columns = dataTable.columns;
      const colIdx = columns.findIndex(c => c.fieldName === config.measure);

      if (colIdx === -1) {
        showError(`Measure "${config.measure}" not found in worksheet.`);
        return;
      }

      // Aggregate
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
      console.error('Data fetch error:', err);
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

  // ─── Persist / Load Settings ───────────────────────────────────────

  function saveSettings() {
    tableau.extensions.settings.set('gaugeConfig', JSON.stringify(config));
    return tableau.extensions.settings.saveAsync();
  }

  function loadSettings() {
    const raw = tableau.extensions.settings.get('gaugeConfig');
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        config = { ...DEFAULT_CONFIG, ...parsed, ranges: (parsed.ranges || DEFAULT_CONFIG.ranges).map(r => ({ ...r })) };
      } catch (e) {
        console.warn('Failed to parse saved settings', e);
      }
    }
  }

  // ─── Configuration Dialog ─────────────────────────────────────────

  function openConfigDialog() {
    const dialog = document.getElementById('config-dialog');
    dialog.classList.add('active');
    populateConfigForm();
  }

  function closeConfigDialog() {
    document.getElementById('config-dialog').classList.remove('active');
  }

  async function populateConfigForm() {
    // Populate worksheet dropdown
    const wsSelect = document.getElementById('cfg-worksheet');
    wsSelect.innerHTML = '<option value="">— Select worksheet —</option>';
    const dashboard = tableau.extensions.dashboardContent.dashboard;
    dashboard.worksheets.forEach(ws => {
      const opt = document.createElement('option');
      opt.value = ws.name;
      opt.textContent = ws.name;
      if (ws.name === config.worksheet) opt.selected = true;
      wsSelect.appendChild(opt);
    });

    // Populate measure dropdown based on selected worksheet
    await populateMeasures();

    // Fill form values
    document.getElementById('cfg-aggregation').value = config.aggregation;
    document.getElementById('cfg-min').value = config.minValue;
    document.getElementById('cfg-max').value = config.maxValue;
    document.getElementById('cfg-title').value = config.title;
    document.getElementById('cfg-subtitle').value = config.subtitle;
    document.getElementById('cfg-needle-color').value = config.needleColor;
    document.getElementById('cfg-track-color').value = config.trackColor;
    document.getElementById('cfg-value-fontsize').value = config.valueFontSize;
    document.getElementById('cfg-value-color').value = config.valueColor;
    document.getElementById('cfg-arc-thickness').value = config.arcThickness;
    document.getElementById('arc-thickness-display').textContent = config.arcThickness + '%';
    document.getElementById('cfg-value-format').value = config.valueFormat;
    document.getElementById('cfg-currency-symbol').value = config.currencySymbol;
    document.getElementById('cfg-show-labels').checked = config.showLabels;
    document.getElementById('cfg-show-ticks').checked = config.showTicks;
    document.getElementById('cfg-show-range-labels').checked = config.showRangeLabels;
    document.getElementById('cfg-enable-filter').checked = config.enableFilter;
    document.getElementById('cfg-enable-tooltip').checked = config.enableTooltip;
    document.getElementById('cfg-animate').checked = config.animate;

    // Ranges
    renderRangeList();
  }

  async function populateMeasures() {
    const wsName = document.getElementById('cfg-worksheet').value;
    const measureSelect = document.getElementById('cfg-measure');
    const filterSelect = document.getElementById('cfg-filter-field');
    measureSelect.innerHTML = '<option value="">— Select measure —</option>';
    filterSelect.innerHTML = '<option value="">— Same as measure —</option>';

    if (!wsName) return;

    try {
      const dashboard = tableau.extensions.dashboardContent.dashboard;
      const ws = dashboard.worksheets.find(w => w.name === wsName);
      if (!ws) return;

      const dataTable = await ws.getSummaryDataAsync();
      dataTable.columns.forEach(col => {
        const opt1 = document.createElement('option');
        opt1.value = col.fieldName;
        opt1.textContent = col.fieldName;
        if (col.fieldName === config.measure) opt1.selected = true;
        measureSelect.appendChild(opt1);

        const opt2 = document.createElement('option');
        opt2.value = col.fieldName;
        opt2.textContent = col.fieldName;
        if (col.fieldName === config.filterField) opt2.selected = true;
        filterSelect.appendChild(opt2);
      });
    } catch (e) {
      console.warn('Could not fetch columns', e);
    }
  }

  // --- Range list UI ---
  function renderRangeList() {
    const list = document.getElementById('range-list');
    list.innerHTML = '';
    config.ranges.forEach((range, idx) => {
      const item = document.createElement('div');
      item.className = 'range-item';
      item.innerHTML = `
        <input type="color" class="range-color" data-idx="${idx}" value="${range.color}" title="Color" />
        <input type="number" class="range-from" data-idx="${idx}" value="${range.from}" placeholder="From" title="From" />
        <span style="color:#999;">–</span>
        <input type="number" class="range-to" data-idx="${idx}" value="${range.to}" placeholder="To" title="To" />
        <input type="text" class="range-label-input" data-idx="${idx}" value="${range.label || ''}" placeholder="Label" title="Label" />
        <button class="remove-range-btn" data-idx="${idx}" title="Remove">&times;</button>
      `;
      list.appendChild(item);
    });
  }

  function readConfigFromForm() {
    config.worksheet = document.getElementById('cfg-worksheet').value;
    config.measure = document.getElementById('cfg-measure').value;
    config.aggregation = document.getElementById('cfg-aggregation').value;
    config.minValue = parseFloat(document.getElementById('cfg-min').value) || 0;
    config.maxValue = parseFloat(document.getElementById('cfg-max').value) || 100;
    config.title = document.getElementById('cfg-title').value;
    config.subtitle = document.getElementById('cfg-subtitle').value;
    config.needleColor = document.getElementById('cfg-needle-color').value;
    config.trackColor = document.getElementById('cfg-track-color').value;
    config.valueFontSize = parseInt(document.getElementById('cfg-value-fontsize').value, 10) || 28;
    config.valueColor = document.getElementById('cfg-value-color').value;
    config.arcThickness = parseInt(document.getElementById('cfg-arc-thickness').value, 10) || 30;
    config.valueFormat = document.getElementById('cfg-value-format').value;
    config.currencySymbol = document.getElementById('cfg-currency-symbol').value || '$';
    config.showLabels = document.getElementById('cfg-show-labels').checked;
    config.showTicks = document.getElementById('cfg-show-ticks').checked;
    config.showRangeLabels = document.getElementById('cfg-show-range-labels').checked;
    config.enableFilter = document.getElementById('cfg-enable-filter').checked;
    config.filterField = document.getElementById('cfg-filter-field').value;
    config.enableTooltip = document.getElementById('cfg-enable-tooltip').checked;
    config.animate = document.getElementById('cfg-animate').checked;

    // Read ranges from DOM
    config.ranges = [];
    document.querySelectorAll('.range-item').forEach(item => {
      const idx = item.querySelector('.range-color').dataset.idx;
      config.ranges.push({
        from: parseFloat(item.querySelector('.range-from').value) || 0,
        to: parseFloat(item.querySelector('.range-to').value) || 0,
        color: item.querySelector('.range-color').value,
        label: item.querySelector('.range-label-input').value,
      });
    });
  }

  // ─── Event Wiring ──────────────────────────────────────────────────

  function wireEvents() {
    // Tabs
    document.querySelectorAll('.config-tab').forEach(tab => {
      tab.addEventListener('click', function () {
        document.querySelectorAll('.config-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.config-tab-content').forEach(c => c.classList.remove('active'));
        this.classList.add('active');
        document.getElementById(this.dataset.tab).classList.add('active');
      });
    });

    // Worksheet change → refresh measures
    document.getElementById('cfg-worksheet').addEventListener('change', populateMeasures);

    // Arc thickness slider
    document.getElementById('cfg-arc-thickness').addEventListener('input', function () {
      document.getElementById('arc-thickness-display').textContent = this.value + '%';
    });

    // Add range
    document.getElementById('add-range-btn').addEventListener('click', function () {
      const last = config.ranges[config.ranges.length - 1];
      config.ranges.push({
        from: last ? last.to : 0,
        to: last ? last.to + 10 : 10,
        color: '#4a90d9',
        label: '',
      });
      renderRangeList();
    });

    // Remove range (delegated)
    document.getElementById('range-list').addEventListener('click', function (e) {
      if (e.target.classList.contains('remove-range-btn')) {
        const idx = parseInt(e.target.dataset.idx, 10);
        // Read current values first
        readRangesFromDom();
        config.ranges.splice(idx, 1);
        renderRangeList();
      }
    });

    // Save
    document.getElementById('config-save-btn').addEventListener('click', async function () {
      readConfigFromForm();
      await saveSettings();
      closeConfigDialog();
      showLoading();
      await fetchDataAndRender(true);
    });

    // Cancel / Close
    document.getElementById('config-cancel-btn').addEventListener('click', closeConfigDialog);
    document.getElementById('config-close-btn').addEventListener('click', closeConfigDialog);

    // Resize
    let resizeTimer;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => renderGauge(false), 150);
    });
  }

  function readRangesFromDom() {
    config.ranges = [];
    document.querySelectorAll('.range-item').forEach(item => {
      config.ranges.push({
        from: parseFloat(item.querySelector('.range-from').value) || 0,
        to: parseFloat(item.querySelector('.range-to').value) || 0,
        color: item.querySelector('.range-color').value,
        label: item.querySelector('.range-label-input').value,
      });
    });
  }

  // ─── Data Change Listener ─────────────────────────────────────────

  function listenForDataChanges() {
    if (!worksheetObj) return;
    // Unregister previous listeners by storing handler
    worksheetObj.addEventListener(tableau.TableauEventType.FilterChanged, () => {
      fetchDataAndRender(false);
    });
    worksheetObj.addEventListener(tableau.TableauEventType.MarkSelectionChanged, () => {
      fetchDataAndRender(false);
    });
  }

  // ─── Initialization ───────────────────────────────────────────────

  async function initExtension() {
    showLoading();

    try {
      await tableau.extensions.initializeAsync({ configure: openConfigDialog });

      loadSettings();

      if (config.worksheet && config.measure) {
        await fetchDataAndRender(true);
        listenForDataChanges();
      } else {
        hideLoading();
        showError('Extension not configured. Right-click → Configure to get started.');
      }

    } catch (err) {
      console.error('Init error:', err);
      hideLoading();
      showError('Initialization failed: ' + err.message);
    }
  }

  // ─── Boot ──────────────────────────────────────────────────────────

  wireEvents();

  // Check if Tableau Extensions API is available
  if (typeof tableau !== 'undefined' && tableau.extensions) {
    initExtension();
  } else {
    // Running outside Tableau — show a demo gauge
    hideLoading();
    currentValue = 72;
    config.title = 'Demo Gauge';
    config.subtitle = 'Not connected to Tableau';
    renderGauge(true);
    console.info('Tableau Extensions API not found. Rendering demo gauge.');
  }

})();
