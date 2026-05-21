/**
 * Semi-Circular Gauge Chart — Configuration Dialog
 *
 * This file runs inside the Tableau popup dialog opened via displayDialogAsync().
 * It uses initializeDialogAsync() (NOT initializeAsync) and closeDialog() to
 * communicate with the parent extension (gauge.js).
 */

(function () {
  'use strict';

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

  let config = { ...DEFAULT_CONFIG, ranges: DEFAULT_CONFIG.ranges.map(r => ({ ...r })) };

  // ─── Initialize Dialog ─────────────────────────────────────────────

  console.log('[Config] Dialog script loaded. Initializing...');

  tableau.extensions.initializeDialogAsync().then(function (openPayload) {
    console.log('[Config] Dialog initialized. Payload:', openPayload);

    // Load existing settings
    loadSettings();

    // Populate the form
    populateConfigForm();

    // Wire up UI events
    wireEvents();

  }).catch(function (err) {
    console.error('[Config] Dialog initialization failed:', err);
  });

  // ─── Load / Save Settings ─────────────────────────────────────────

  function loadSettings() {
    const raw = tableau.extensions.settings.get('gaugeConfig');
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        config = { ...DEFAULT_CONFIG, ...parsed, ranges: (parsed.ranges || DEFAULT_CONFIG.ranges).map(r => ({ ...r })) };
        console.log('[Config] Loaded settings:', config.worksheet, config.measure);
      } catch (e) {
        console.warn('[Config] Could not parse saved settings:', e);
      }
    } else {
      console.log('[Config] No existing settings — using defaults.');
    }
  }

  function saveSettings() {
    tableau.extensions.settings.set('gaugeConfig', JSON.stringify(config));
    return tableau.extensions.settings.saveAsync();
  }

  // ─── Populate Form ─────────────────────────────────────────────────

  async function populateConfigForm() {
    // Worksheets
    const wsSelect = document.getElementById('cfg-worksheet');
    wsSelect.innerHTML = '<option value="">— Select worksheet —</option>';

    const dashboard = tableau.extensions.dashboardContent.dashboard;
    console.log('[Config] Dashboard worksheets:', dashboard.worksheets.map(w => w.name));

    dashboard.worksheets.forEach(ws => {
      const opt = document.createElement('option');
      opt.value = ws.name;
      opt.textContent = ws.name;
      if (ws.name === config.worksheet) opt.selected = true;
      wsSelect.appendChild(opt);
    });

    // Measures for currently selected worksheet
    await populateMeasures();

    // Fill all form fields
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
      console.log('[Config] Columns for', wsName + ':', dataTable.columns.map(c => c.fieldName));

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
      console.warn('[Config] Could not fetch columns for', wsName, e);
    }
  }

  // ─── Range List UI ─────────────────────────────────────────────────

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

  // ─── Read Config from Form ─────────────────────────────────────────

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

    // Ranges
    readRangesFromDom();
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
      readRangesFromDom();
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
        readRangesFromDom();
        config.ranges.splice(idx, 1);
        renderRangeList();
      }
    });

    // ─── SAVE: read form → save settings → close dialog ─────────────
    document.getElementById('config-save-btn').addEventListener('click', async function () {
      console.log('[Config] Save button clicked.');
      readConfigFromForm();
      console.log('[Config] Config to save:', JSON.stringify(config));

      try {
        await saveSettings();
        console.log('[Config] Settings saved. Closing dialog...');
        tableau.extensions.ui.closeDialog('saved');
      } catch (err) {
        console.error('[Config] Error saving settings:', err);
        alert('Error saving settings: ' + err.message);
      }
    });

    // ─── CANCEL: close dialog without saving ─────────────────────────
    document.getElementById('config-cancel-btn').addEventListener('click', function () {
      console.log('[Config] Cancel clicked. Closing dialog...');
      tableau.extensions.ui.closeDialog('cancelled');
    });
  }

})();
