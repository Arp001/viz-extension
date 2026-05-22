/**
 * Gauge Chart — Tableau Dashboard Extension (Main Page)
 *
 * Supports four gauge types:
 *   - semi:          Semi-Circular (180°) — classic half-circle gauge
 *   - three-quarter: Three-Quarter Circle (270°) — gap at bottom
 *   - full:          Full Circle (360°) — complete ring from 6 o'clock
 *   - linear:        Linear Horizontal — bar with vertical marker
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
    // Gauge type: 'semi' | 'three-quarter' | 'full' | 'linear'
    gaugeType: 'semi',
    // Percentage mode: 'off' | 'auto' | 'pct0to1' | 'pct0to100'
    percentageMode: 'off',
    percentDecimals: 0,
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

  /**
   * Determine the effective percentage mode, resolving 'auto' to a concrete mode.
   */
  function getEffectivePercentMode() {
    const mode = config.percentageMode || 'off';
    if (mode !== 'auto') return mode;
    if (config.maxValue <= 1 && config.minValue >= 0) return 'pct0to1';
    if (config.maxValue <= 100 && config.minValue >= 0 && config.maxValue > 1) return 'pct0to100';
    return 'off';
  }

  /**
   * Convert a raw value to its display value based on percentage mode.
   */
  function getDisplayValue(rawVal) {
    const mode = getEffectivePercentMode();
    if (mode === 'pct0to1') return rawVal * 100;
    return rawVal;
  }

  function formatValue(val) {
    const v = Number(val);
    if (isNaN(v)) return '—';

    const pctMode = getEffectivePercentMode();
    const isPctActive = pctMode === 'pct0to1' || pctMode === 'pct0to100';

    if (isPctActive) {
      const displayVal = (pctMode === 'pct0to1') ? v * 100 : v;
      const decimals = config.percentDecimals || 0;
      return d3.format(`,.${decimals}f`)(displayVal) + '%';
    }

    switch (config.valueFormat) {
      case 'decimal1': return d3.format(',.1f')(v);
      case 'decimal2': return d3.format(',.2f')(v);
      case 'percent':  return d3.format(',.0f')(v) + '%';
      case 'currency': return config.currencySymbol + d3.format(',.0f')(v);
      case 'compact':  return d3.format('.3~s')(v);
      default:         return d3.format(',.0f')(v);
    }
  }

  /** Compute value ratio clamped to [0, 1] */
  function valueRatio(val) {
    return Math.max(0, Math.min(1, (val - config.minValue) / (config.maxValue - config.minValue || 1)));
  }

  // ─── Angle Helpers for Each Gauge Type ─────────────────────────────

  /**
   * Semi-Circular (180°): angles from -π/2 (left) to +π/2 (right)
   */
  function semiAngle(val) {
    return -Math.PI / 2 + valueRatio(val) * Math.PI;
  }

  /**
   * Three-Quarter (270°): angles from 3π/4 (bottom-left) to 9π/4 → normalized.
   * We use startAngle = (3/4)π and sweep = (3/2)π.
   * The gap sits at the bottom center.
   */
  function threeQuarterAngle(val) {
    const startA = (3 / 4) * Math.PI;   // 135° — bottom-left
    const sweep  = (3 / 2) * Math.PI;   // 270°
    return startA + valueRatio(val) * sweep;
  }

  /**
   * Full Circle (360°): start at bottom (π/2, i.e. 6 o'clock) going clockwise.
   * D3 arc angles: 0 = 12 o'clock, π/2 = 3 o'clock.
   * To start at 6 o'clock we use startAngle = π, sweep = 2π.
   * But D3 arcs treat angles as radians clockwise from 12 o'clock.
   * So start = 0 and end = 2π with an offset rotation would work, OR:
   * We use start = -π and end = +π (full circle) and rotate the group by 180°.
   * Actually simpler: start from π (bottom in D3 coords) and go to 3π.
   * But D3 arc treats startAngle/endAngle as D3 convention.
   * Let's use: angle range [-π, +π] and rotate group 180° to start at bottom.
   */
  function fullAngle(val) {
    return -Math.PI + valueRatio(val) * 2 * Math.PI;
  }

  // ─── Generic Angle Dispatcher ──────────────────────────────────────

  function valueToAngle(val) {
    const type = config.gaugeType || 'semi';
    switch (type) {
      case 'three-quarter': return threeQuarterAngle(val);
      case 'full':          return fullAngle(val);
      default:              return semiAngle(val);
    }
  }

  function getAngleRange() {
    const type = config.gaugeType || 'semi';
    switch (type) {
      case 'three-quarter': return { start: threeQuarterAngle(config.minValue), end: threeQuarterAngle(config.maxValue) };
      case 'full':          return { start: fullAngle(config.minValue), end: fullAngle(config.maxValue) };
      default:              return { start: semiAngle(config.minValue), end: semiAngle(config.maxValue) };
    }
  }

  // ─── Render Dispatcher ─────────────────────────────────────────────

  function renderGauge(animateNeedle) {
    const type = config.gaugeType || 'semi';
    if (type === 'linear') {
      renderLinearGauge(animateNeedle);
    } else {
      renderCircularGauge(animateNeedle);
    }
    // Title & subtitle (shared by all types)
    document.getElementById('gauge-title').textContent = config.title || '';
    document.getElementById('gauge-subtitle').textContent = config.subtitle || '';
  }

  // ═══════════════════════════════════════════════════════════════════
  //  CIRCULAR GAUGE RENDERER (semi, three-quarter, full)
  // ═══════════════════════════════════════════════════════════════════

  function renderCircularGauge(animateNeedle) {
    const container = document.getElementById('gauge-svg-wrapper');
    const fullW = container.clientWidth || 300;
    const fullH = container.clientHeight || 200;
    const type = config.gaugeType || 'semi';

    // Compute gauge dimensions based on type
    let gaugeW = fullW;
    let gaugeH = fullH;
    let radius, cx, cy;

    const innerRatio = 1 - config.arcThickness / 100;

    if (type === 'semi') {
      // Semi-circular: wider than tall
      radius = Math.min(gaugeW / 2, gaugeH) * 0.82;
      cx = gaugeW / 2;
      cy = gaugeH * 0.75;
    } else if (type === 'three-quarter') {
      // Three-quarter: nearly square; offset center slightly upward
      radius = Math.min(gaugeW / 2, gaugeH / 2) * 0.78;
      cx = gaugeW / 2;
      cy = gaugeH * 0.50;
    } else {
      // Full circle: use full space
      radius = Math.min(gaugeW / 2, gaugeH / 2) * 0.72;
      cx = gaugeW / 2;
      cy = gaugeH / 2;
    }

    const innerRadius = radius * innerRatio;
    const angles = getAngleRange();

    const svg = d3.select('#gauge-svg')
      .attr('width', gaugeW)
      .attr('height', gaugeH);
    svg.selectAll('*').remove();

    const g = svg.append('g').attr('transform', `translate(${cx},${cy})`);

    // For full circle, rotate so start is at 6 o'clock (bottom)
    if (type === 'full') {
      g.attr('transform', `translate(${cx},${cy}) rotate(180)`);
    }

    // ── Background track arc ──
    const bgArc = d3.arc()
      .innerRadius(innerRadius)
      .outerRadius(radius)
      .startAngle(angles.start)
      .endAngle(angles.end)
      .cornerRadius(3);
    g.append('path').attr('d', bgArc()).attr('fill', config.trackColor);

    // ── Colored range arcs ──
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

    // ── Tick marks ──
    if (config.showTicks) {
      const numTicks = type === 'full' ? 12 : 10;
      for (let i = 0; i <= numTicks; i++) {
        const val = config.minValue + (config.maxValue - config.minValue) * (i / numTicks);
        const angle = valueToAngle(val);
        const isMajor = (type === 'full') ? (i % 3 === 0) : (i % 5 === 0);
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

    // ── Min / Max labels ──
    if (config.showLabels) {
      if (type === 'semi') {
        g.append('text').attr('class', 'gauge-min-label')
          .attr('x', -radius - 6).attr('y', 18).attr('text-anchor', 'end')
          .text(formatValue(config.minValue));
        g.append('text').attr('class', 'gauge-max-label')
          .attr('x', radius + 6).attr('y', 18).attr('text-anchor', 'start')
          .text(formatValue(config.maxValue));
      } else if (type === 'three-quarter') {
        // Labels at start and end of arc
        const sA = threeQuarterAngle(config.minValue);
        const eA = threeQuarterAngle(config.maxValue);
        const labelR = radius + 16;
        g.append('text').attr('class', 'gauge-min-label')
          .attr('x', labelR * Math.cos(sA)).attr('y', labelR * Math.sin(sA))
          .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
          .text(formatValue(config.minValue));
        g.append('text').attr('class', 'gauge-max-label')
          .attr('x', labelR * Math.cos(eA)).attr('y', labelR * Math.sin(eA))
          .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
          .text(formatValue(config.maxValue));
      } else if (type === 'full') {
        // For full circle (rotated 180°), place min label at bottom
        // In the rotated coordinate system, angle -π = bottom (visible top after rotation)
        // We place labels at 4 cardinal points
        const labelR = radius + 16;
        // Top (after rotation = bottom in rotated coords = angle -π + 0 = π → but with 180° rotation appears at top)
        // Simply place min at start angle and max at 3/4 of the way
        const minA = fullAngle(config.minValue); // -π
        const maxA = fullAngle(config.maxValue); // +π
        g.append('text').attr('class', 'gauge-min-label')
          .attr('x', labelR * Math.cos(minA)).attr('y', labelR * Math.sin(minA))
          .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
          .attr('transform', 'rotate(180 ' + (labelR * Math.cos(minA)) + ' ' + (labelR * Math.sin(minA)) + ')')
          .text(formatValue(config.minValue));
        // Place max label just before the end (slightly before min to avoid overlap)
        const maxLabelA = fullAngle(config.maxValue * 0.99);
        g.append('text').attr('class', 'gauge-max-label')
          .attr('x', labelR * Math.cos(maxLabelA)).attr('y', labelR * Math.sin(maxLabelA))
          .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
          .attr('transform', 'rotate(180 ' + (labelR * Math.cos(maxLabelA)) + ' ' + (labelR * Math.sin(maxLabelA)) + ')')
          .text(formatValue(config.maxValue));
      }
    }

    // ── Range labels on arc ──
    if (config.showRangeLabels) {
      config.ranges.forEach(range => {
        const midVal = (Math.max(range.from, config.minValue) + Math.min(range.to, config.maxValue)) / 2;
        const angle = valueToAngle(midVal);
        const labelR = (innerRadius + radius) / 2;
        const textEl = g.append('text')
          .attr('x', labelR * Math.cos(angle))
          .attr('y', labelR * Math.sin(angle))
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'central')
          .attr('font-size', '10px')
          .attr('fill', '#fff')
          .attr('font-weight', '600')
          .attr('pointer-events', 'none')
          .text(range.label || '');
        // Counter-rotate text for full circle so it reads correctly
        if (type === 'full') {
          const tx = labelR * Math.cos(angle);
          const ty = labelR * Math.sin(angle);
          textEl.attr('transform', `rotate(180 ${tx} ${ty})`);
        }
      });
    }

    // ── Needle / Pointer ──
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

    // ── Center value text ──
    // For full circle the group is rotated 180°, so counter-rotate the text
    const valueText = g.append('text')
      .attr('class', 'gauge-value-text')
      .attr('text-anchor', 'middle')
      .attr('font-size', `${config.valueFontSize}px`)
      .attr('fill', config.valueColor)
      .text(formatValue(currentValue));

    if (type === 'semi') {
      valueText.attr('y', -12);
    } else if (type === 'three-quarter') {
      valueText.attr('y', 6);
    } else if (type === 'full') {
      valueText.attr('y', 6).attr('transform', 'rotate(180 0 6)');
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  LINEAR HORIZONTAL GAUGE RENDERER
  // ═══════════════════════════════════════════════════════════════════

  function renderLinearGauge(animateNeedle) {
    const container = document.getElementById('gauge-svg-wrapper');
    const fullW = container.clientWidth || 300;
    const fullH = container.clientHeight || 200;

    const svg = d3.select('#gauge-svg')
      .attr('width', fullW)
      .attr('height', fullH);
    svg.selectAll('*').remove();

    // Layout constants
    const marginLeft = 20;
    const marginRight = 20;
    const barW = fullW - marginLeft - marginRight;
    const barH = Math.min(Math.max(fullH * 0.18, 16), 50);
    const barY = fullH * 0.50;
    const barRadius = barH / 2;

    const g = svg.append('g');

    // ── Background track ──
    g.append('rect')
      .attr('x', marginLeft).attr('y', barY)
      .attr('width', barW).attr('height', barH)
      .attr('rx', barRadius).attr('ry', barRadius)
      .attr('fill', config.trackColor);

    // ── Colored range segments ──
    config.ranges.forEach((range, idx) => {
      const rFrom = Math.max(range.from, config.minValue);
      const rTo   = Math.min(range.to, config.maxValue);
      if (rTo <= rFrom) return;

      const x1 = marginLeft + valueRatio(rFrom) * barW;
      const x2 = marginLeft + valueRatio(rTo) * barW;
      const segW = x2 - x1;

      // Use a clip rect for first/last segments to get rounded ends
      const segment = g.append('rect')
        .attr('class', 'gauge-arc-segment linear-segment')
        .attr('x', x1).attr('y', barY)
        .attr('width', segW).attr('height', barH)
        .attr('fill', range.color)
        .attr('data-index', idx);

      // Round first segment's left corners
      if (rFrom <= config.minValue) {
        segment.attr('rx', barRadius).attr('ry', barRadius);
        // Add a rect to square off the right side
        if (segW > barRadius * 2) {
          g.append('rect')
            .attr('x', x1 + barRadius).attr('y', barY)
            .attr('width', segW - barRadius).attr('height', barH)
            .attr('fill', range.color).attr('pointer-events', 'none');
        }
      }
      // Round last segment's right corners
      if (rTo >= config.maxValue) {
        segment.attr('rx', barRadius).attr('ry', barRadius);
        if (segW > barRadius * 2) {
          g.append('rect')
            .attr('x', x1).attr('y', barY)
            .attr('width', segW - barRadius).attr('height', barH)
            .attr('fill', range.color).attr('pointer-events', 'none');
        }
      }

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

    // ── Range labels below bar ──
    if (config.showRangeLabels) {
      config.ranges.forEach(range => {
        const rFrom = Math.max(range.from, config.minValue);
        const rTo   = Math.min(range.to, config.maxValue);
        if (rTo <= rFrom || !range.label) return;
        const midX = marginLeft + ((valueRatio(rFrom) + valueRatio(rTo)) / 2) * barW;
        g.append('text')
          .attr('x', midX).attr('y', barY + barH + 16)
          .attr('text-anchor', 'middle')
          .attr('font-size', '10px')
          .attr('fill', '#666')
          .attr('pointer-events', 'none')
          .text(range.label);
      });
    }

    // ── Tick marks below bar ──
    if (config.showTicks) {
      const numTicks = 10;
      for (let i = 0; i <= numTicks; i++) {
        const val = config.minValue + (config.maxValue - config.minValue) * (i / numTicks);
        const x = marginLeft + valueRatio(val) * barW;
        const isMajor = i % 5 === 0;
        const len = isMajor ? 8 : 4;
        g.append('line')
          .attr('x1', x).attr('y1', barY + barH + 2)
          .attr('x2', x).attr('y2', barY + barH + 2 + len)
          .attr('stroke', '#999')
          .attr('stroke-width', isMajor ? 1.5 : 0.8);
      }
    }

    // ── Min / Max labels ──
    if (config.showLabels) {
      g.append('text').attr('class', 'gauge-min-label')
        .attr('x', marginLeft).attr('y', barY + barH + 26)
        .attr('text-anchor', 'start').text(formatValue(config.minValue));
      g.append('text').attr('class', 'gauge-max-label')
        .attr('x', marginLeft + barW).attr('y', barY + barH + 26)
        .attr('text-anchor', 'end').text(formatValue(config.maxValue));
    }

    // ── Vertical marker / pointer ──
    const markerX = marginLeft + valueRatio(currentValue) * barW;
    const markerH = barH + 16;
    const markerGroup = g.append('g').attr('class', 'gauge-needle linear-marker');

    // Marker line
    markerGroup.append('line')
      .attr('x1', markerX).attr('y1', barY - 6)
      .attr('x2', markerX).attr('y2', barY + barH + 6)
      .attr('stroke', config.needleColor)
      .attr('stroke-width', 3)
      .attr('stroke-linecap', 'round');

    // Triangle pointer on top
    const triSize = 6;
    markerGroup.append('polygon')
      .attr('points', `${markerX},${barY - 2} ${markerX - triSize},${barY - triSize - 4} ${markerX + triSize},${barY - triSize - 4}`)
      .attr('fill', config.needleColor);

    if (config.enableTooltip) {
      markerGroup
        .on('mouseenter', function (event) {
          const rangeInfo = findRangeForValue(currentValue);
          showTooltip(event, config.title || 'Value', formatValue(currentValue),
            rangeInfo ? rangeInfo.label : '');
        })
        .on('mousemove', function (event) { moveTooltip(event); })
        .on('mouseleave', hideTooltip);
    }

    // Animate marker from left
    if (animateNeedle && config.animate) {
      const startX = marginLeft;
      markerGroup
        .attr('transform', `translate(${startX - markerX}, 0)`)
        .transition()
        .duration(1200)
        .ease(d3.easeElasticOut.amplitude(1).period(0.6))
        .attr('transform', 'translate(0, 0)');
    }

    // ── Value text above marker ──
    g.append('text')
      .attr('class', 'gauge-value-text')
      .attr('x', markerX)
      .attr('y', barY - triSize - 12)
      .attr('text-anchor', 'middle')
      .attr('font-size', `${config.valueFontSize}px`)
      .attr('fill', config.valueColor)
      .text(formatValue(currentValue));
  }

  // ─── Shared Helpers ────────────────────────────────────────────────

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

      // Auto-detect percentage mode logging
      if (config.percentageMode === 'auto') {
        const allInZeroOne = values.every(v => v >= 0 && v <= 1);
        if (allInZeroOne) {
          console.log('[Gauge] Auto-detect: data appears to be 0-1 percentage range.');
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
        console.log('[Gauge] Settings loaded:', config.worksheet, config.measure, 'type:', config.gaugeType);
      } catch (e) {
        console.warn('[Gauge] Failed to parse saved settings:', e);
      }
    } else {
      console.log('[Gauge] No saved settings found — using defaults.');
    }
  }

  // ─── Configuration Dialog (Popup via displayDialogAsync) ──────────

  function openConfigureDialog() {
    console.log('[Gauge] Configure callback triggered — opening popup dialog...');
    const baseUrl = window.location.href.replace(/\/[^/]*$/, '/');
    const popupUrl = baseUrl + 'config.html';
    console.log('[Gauge] Dialog URL:', popupUrl);

    tableau.extensions.ui.displayDialogAsync(
      popupUrl,
      '',
      { height: 600, width: 580 }
    ).then(function (closePayload) {
      console.log('[Gauge] Config dialog closed. Payload:', closePayload);
      loadSettings();
      showLoading();
      fetchDataAndRender(true).then(function () {
        listenForDataChanges();
      });
    }).catch(function (error) {
      if (error.errorCode === tableau.ErrorCodes.DialogClosedByUser) {
        console.log('[Gauge] Config dialog closed by user (X button).');
      } else {
        console.error('[Gauge] Error displaying config dialog:', error);
      }
    });
  }

  // ─── Data Change Listener ─────────────────────────────────────────

  function listenForDataChanges() {
    if (unregisterFilterHandler) { unregisterFilterHandler(); unregisterFilterHandler = null; }
    if (unregisterMarkHandler) { unregisterMarkHandler(); unregisterMarkHandler = null; }
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

  function checkApiAndBoot() {
    if (typeof tableau === 'undefined') {
      console.error('[Gauge] ❌ CRITICAL: "tableau" object is undefined. API did not load.');
      fallbackToDemo();
      return;
    }
    if (!tableau.extensions) {
      console.error('[Gauge] ❌ "tableau.extensions" is undefined. Wrong API library?');
      fallbackToDemo();
      return;
    }
    console.log('[Gauge] ✅ Tableau Extensions API detected.');
    initExtension();
  }

  function fallbackToDemo() {
    hideLoading();
    // Showcase percentage mode: raw value 0.72 displayed as 72%
    currentValue = 0.72;
    config.title = 'Demo Gauge';
    config.subtitle = 'Percentage Mode • Not connected to Tableau';
    config.percentageMode = 'pct0to1';
    config.percentDecimals = 1;
    config.minValue = 0;
    config.maxValue = 1;
    config.ranges = [
      { from: 0, to: 0.33, color: '#dc3545', label: 'Low' },
      { from: 0.33, to: 0.66, color: '#ffc107', label: 'Medium' },
      { from: 0.66, to: 1, color: '#28a745', label: 'High' },
    ];
    renderGauge(true);
    console.info('[Gauge] Rendering standalone demo gauge (Tableau API not available).');
  }

  checkApiAndBoot();

})();