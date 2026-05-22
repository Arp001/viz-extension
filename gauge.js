/**
 * Gauge Chart — Tableau Dashboard Extension (Main Page)
 *
 * Supports three gauge types:
 *   - semi:          Semi-Circular (180°) — classic half-circle gauge
 *   - three-quarter: Three-Quarter Circle (270°) — gap at bottom
 *   - linear:        Linear Horizontal — bar with vertical marker
 *
 * Uses D3.js for rendering and Tableau Extensions API for data integration.
 * Configuration is handled via a SEPARATE popup dialog (config.html) opened
 * through tableau.extensions.ui.displayDialogAsync().
 *
 * ANGLE CONVENTION (D3 arc):
 *   0 = 12 o'clock (top), angles increase clockwise.
 *   Internally D3 uses x = sin(a), y = -cos(a) to place arc points.
 *   Needle SVG rotate() also treats 0° as up and positive as CW.
 *   Tick/label positions must use: x = r*sin(a), y = -r*cos(a)
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
    // Gauge type: 'semi' | 'three-quarter' | 'linear'
    gaugeType: 'semi',
    // Smooth gradient transitions between color bands
    useGradient: false,
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

  function getEffectivePercentMode() {
    const mode = config.percentageMode || 'off';
    if (mode !== 'auto') return mode;
    if (config.maxValue <= 1 && config.minValue >= 0) return 'pct0to1';
    if (config.maxValue <= 100 && config.minValue >= 0 && config.maxValue > 1) return 'pct0to100';
    return 'off';
  }

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

  // ─── Angle Helpers ─────────────────────────────────────────────────

  function semiAngle(val) {
    return -Math.PI / 2 + valueRatio(val) * Math.PI;
  }

  function threeQuarterAngle(val) {
    const startA = -(3 / 4) * Math.PI;
    const sweep  = (3 / 2) * Math.PI;
    return startA + valueRatio(val) * sweep;
  }

  function valueToAngle(val) {
    const type = config.gaugeType || 'semi';
    switch (type) {
      case 'three-quarter': return threeQuarterAngle(val);
      default:              return semiAngle(val);
    }
  }

  function getAngleRange() {
    const type = config.gaugeType || 'semi';
    switch (type) {
      case 'three-quarter': return { start: threeQuarterAngle(config.minValue), end: threeQuarterAngle(config.maxValue) };
      default:              return { start: semiAngle(config.minValue), end: semiAngle(config.maxValue) };
    }
  }

  function angleToXY(angle, r) {
    return {
      x: r * Math.sin(angle),
      y: -r * Math.cos(angle),
    };
  }

  // ─── Gradient Helpers ──────────────────────────────────────────────

  /**
   * Build a sorted array of { position (0-1), color } stops for gradient rendering.
   * Creates smooth transition zones (~5% width) at each boundary between adjacent ranges.
   *
   * Example with 3 ranges (0-33 red, 33-66 yellow, 66-100 green):
   *   0% → red, 30.5% → red, 35.5% → yellow, 63.5% → yellow, 68.5% → green, 100% → green
   */
  function buildGradientStops() {
    const ranges = config.ranges;
    if (!ranges || ranges.length === 0) return [];

    const stops = [];
    const span = config.maxValue - config.minValue || 1;
    const blendHalf = 0.025;  // 2.5% each side = 5% total transition width

    // Start with the first range's beginning
    const firstFrom = Math.max(0, (Math.max(ranges[0].from, config.minValue) - config.minValue) / span);
    stops.push({ pos: firstFrom, color: ranges[0].color });

    // For each boundary between adjacent ranges, add a transition zone
    for (let i = 1; i < ranges.length; i++) {
      const prevColor = ranges[i - 1].color;
      const nextColor = ranges[i].color;
      const boundaryPos = Math.max(0, Math.min(1, (Math.max(ranges[i].from, config.minValue) - config.minValue) / span));

      const blendStart = Math.max(0, boundaryPos - blendHalf);
      const blendEnd   = Math.min(1, boundaryPos + blendHalf);

      stops.push({ pos: blendStart, color: prevColor });
      stops.push({ pos: blendEnd, color: nextColor });
    }

    // End with the last range's end
    const lastTo = Math.min(1, (Math.min(ranges[ranges.length - 1].to, config.maxValue) - config.minValue) / span);
    stops.push({ pos: lastTo, color: ranges[ranges.length - 1].color });

    return stops;
  }

  /**
   * Given gradient stops and a position (0-1), interpolate the color.
   */
  function interpolateGradientColor(stops, pos) {
    if (stops.length === 0) return '#999';
    if (pos <= stops[0].pos) return stops[0].color;
    if (pos >= stops[stops.length - 1].pos) return stops[stops.length - 1].color;

    for (let i = 0; i < stops.length - 1; i++) {
      if (pos >= stops[i].pos && pos <= stops[i + 1].pos) {
        const t = (pos - stops[i].pos) / (stops[i + 1].pos - stops[i].pos || 1);
        return d3.interpolateRgb(stops[i].color, stops[i + 1].color)(t);
      }
    }
    return stops[stops.length - 1].color;
  }

  // ─── Render Dispatcher ─────────────────────────────────────────────

  function renderGauge(animateNeedle) {
    const type = config.gaugeType || 'semi';
    if (type === 'linear') {
      renderLinearGauge(animateNeedle);
    } else {
      renderCircularGauge(animateNeedle);
    }
    document.getElementById('gauge-title').textContent = config.title || '';
    document.getElementById('gauge-subtitle').textContent = config.subtitle || '';
  }

  // ═══════════════════════════════════════════════════════════════════
  //  CIRCULAR GAUGE RENDERER (semi, three-quarter)
  // ═══════════════════════════════════════════════════════════════════

  function renderCircularGauge(animateNeedle) {
    const container = document.getElementById('gauge-svg-wrapper');
    const fullW = container.clientWidth || 300;
    const fullH = container.clientHeight || 200;
    const type = config.gaugeType || 'semi';

    let gaugeW = fullW;
    let gaugeH = fullH;
    let radius, cx, cy;
    const innerRatio = 1 - config.arcThickness / 100;

    if (type === 'semi') {
      radius = Math.min(gaugeW / 2, gaugeH) * 0.82;
      cx = gaugeW / 2;
      cy = gaugeH * 0.75;
    } else if (type === 'three-quarter') {
      radius = Math.min(gaugeW / 2, gaugeH / 2) * 0.78;
      cx = gaugeW / 2;
      cy = gaugeH * 0.48;
    }

    const innerRadius = radius * innerRatio;
    const angles = getAngleRange();

    const svg = d3.select('#gauge-svg')
      .attr('width', gaugeW)
      .attr('height', gaugeH);
    svg.selectAll('*').remove();

    const g = svg.append('g').attr('transform', `translate(${cx},${cy})`);

    // ── Background track arc ──
    const bgArc = d3.arc()
      .innerRadius(innerRadius)
      .outerRadius(radius)
      .startAngle(angles.start)
      .endAngle(angles.end)
      .cornerRadius(3);
    g.append('path').attr('d', bgArc()).attr('fill', config.trackColor);

    // ── Colored range arcs ──
    if (config.useGradient) {
      // GRADIENT MODE: render many thin arc slices with interpolated colors
      renderCircularGradientArcs(g, innerRadius, radius, angles);
    } else {
      // HARD STOP MODE: render discrete range arcs
      renderCircularHardArcs(g, innerRadius, radius);
    }

    // ── Tick marks ──
    if (config.showTicks) {
      const numTicks = (type === 'three-quarter') ? 9 : 10;
      for (let i = 0; i <= numTicks; i++) {
        const val = config.minValue + (config.maxValue - config.minValue) * (i / numTicks);
        const angle = valueToAngle(val);
        const isMajor = (type === 'three-quarter') ? (i % 3 === 0) : (i % 5 === 0);
        const len = isMajor ? 10 : 5;
        const p1 = angleToXY(angle, radius + 2);
        const p2 = angleToXY(angle, radius + 2 + len);
        g.append('line')
          .attr('x1', p1.x).attr('y1', p1.y)
          .attr('x2', p2.x).attr('y2', p2.y)
          .attr('stroke', '#999')
          .attr('stroke-width', isMajor ? 1.5 : 0.8);
      }
    }

    // ── Min / Max labels ──
    if (config.showLabels) {
      if (type === 'semi') {
        const minPos = angleToXY(semiAngle(config.minValue), radius + 6);
        const maxPos = angleToXY(semiAngle(config.maxValue), radius + 6);
        g.append('text').attr('class', 'gauge-min-label')
          .attr('x', minPos.x - 4).attr('y', minPos.y + 14)
          .attr('text-anchor', 'end')
          .text(formatValue(config.minValue));
        g.append('text').attr('class', 'gauge-max-label')
          .attr('x', maxPos.x + 4).attr('y', maxPos.y + 14)
          .attr('text-anchor', 'start')
          .text(formatValue(config.maxValue));
      } else if (type === 'three-quarter') {
        const labelR = radius + 18;
        const sA = threeQuarterAngle(config.minValue);
        const eA = threeQuarterAngle(config.maxValue);
        const minPos = angleToXY(sA, labelR);
        const maxPos = angleToXY(eA, labelR);
        g.append('text').attr('class', 'gauge-min-label')
          .attr('x', minPos.x).attr('y', minPos.y)
          .attr('text-anchor', 'end')
          .attr('dominant-baseline', 'hanging')
          .text(formatValue(config.minValue));
        g.append('text').attr('class', 'gauge-max-label')
          .attr('x', maxPos.x).attr('y', maxPos.y)
          .attr('text-anchor', 'start')
          .attr('dominant-baseline', 'hanging')
          .text(formatValue(config.maxValue));
      }
    }

    // ── Range labels on arc ──
    if (config.showRangeLabels) {
      config.ranges.forEach(range => {
        const midVal = (Math.max(range.from, config.minValue) + Math.min(range.to, config.maxValue)) / 2;
        const angle = valueToAngle(midVal);
        const labelR = (innerRadius + radius) / 2;
        const pos = angleToXY(angle, labelR);
        g.append('text')
          .attr('x', pos.x)
          .attr('y', pos.y)
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'central')
          .attr('font-size', '10px')
          .attr('fill', '#fff')
          .attr('font-weight', '600')
          .attr('pointer-events', 'none')
          .text(range.label || '');
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
      const startAngleDeg = (valueToAngle(config.minValue) * 180) / Math.PI;
      const endAngleDeg   = (needleAngle * 180) / Math.PI;
      needleGroup
        .attr('transform', `rotate(${startAngleDeg})`)
        .transition()
        .duration(1200)
        .ease(d3.easeElasticOut.amplitude(1).period(0.6))
        .attr('transform', `rotate(${endAngleDeg})`);
    } else {
      needleGroup.attr('transform', `rotate(${(needleAngle * 180) / Math.PI})`);
    }

    // ── Center value text ──
    // Use .style('fill') instead of .attr('fill') to ensure CSS doesn't override
    const valueText = g.append('text')
      .attr('class', 'gauge-value-text')
      .attr('text-anchor', 'middle')
      .attr('font-size', `${config.valueFontSize}px`)
      .style('fill', config.valueColor)
      .text(formatValue(currentValue));

    if (type === 'semi') {
      valueText.attr('y', -12);
    } else if (type === 'three-quarter') {
      valueText.attr('y', 8);
    }
  }

  // ── Circular Hard-Stop Arcs (default) ──

  function renderCircularHardArcs(g, innerRadius, radius) {
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
  }

  // ── Circular Gradient Arcs ──

  function renderCircularGradientArcs(g, innerRadius, radius, angles) {
    const stops = buildGradientStops();
    if (stops.length === 0) return;

    const numSlices = 120;  // number of thin arc slices for smooth gradient
    const totalAngle = angles.end - angles.start;
    const arcGen = d3.arc()
      .innerRadius(innerRadius)
      .outerRadius(radius);

    for (let i = 0; i < numSlices; i++) {
      const t0 = i / numSlices;
      const t1 = (i + 1) / numSlices;
      const color = interpolateGradientColor(stops, (t0 + t1) / 2);
      const startAngle = angles.start + t0 * totalAngle;
      const endAngle   = angles.start + t1 * totalAngle;

      const slice = g.append('path')
        .attr('d', arcGen({ startAngle, endAngle }))
        .attr('fill', color)
        .attr('stroke', color)       // tiny stroke to prevent hairline gaps
        .attr('stroke-width', 0.5);

      // Attach tooltip/filter based on which range this slice falls into
      const sliceVal = config.minValue + ((t0 + t1) / 2) * (config.maxValue - config.minValue);
      const rangeInfo = findRangeForValue(sliceVal);

      if (config.enableTooltip && rangeInfo) {
        slice
          .attr('class', 'gauge-arc-segment')
          .on('mouseenter', function (event) {
            showTooltip(event, rangeInfo.label || 'Range',
              `${formatValue(rangeInfo.from)} – ${formatValue(rangeInfo.to)}`, '');
          })
          .on('mousemove', function (event) { moveTooltip(event); })
          .on('mouseleave', hideTooltip);
      }
      if (config.enableFilter && rangeInfo) {
        slice.on('click', function () { filterByRange(rangeInfo); });
      }
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
    if (config.useGradient) {
      renderLinearGradientBar(svg, g, marginLeft, barY, barW, barH, barRadius);
    } else {
      renderLinearHardSegments(g, marginLeft, barY, barW, barH, barRadius);
    }

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
    const markerGroup = g.append('g').attr('class', 'gauge-needle linear-marker');

    markerGroup.append('line')
      .attr('x1', markerX).attr('y1', barY - 6)
      .attr('x2', markerX).attr('y2', barY + barH + 6)
      .attr('stroke', config.needleColor)
      .attr('stroke-width', 3)
      .attr('stroke-linecap', 'round');

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
    // Use .style('fill') to override any CSS class rules
    g.append('text')
      .attr('class', 'gauge-value-text')
      .attr('x', markerX)
      .attr('y', barY - triSize - 12)
      .attr('text-anchor', 'middle')
      .attr('font-size', `${config.valueFontSize}px`)
      .style('fill', config.valueColor)
      .text(formatValue(currentValue));
  }

  // ── Linear Hard-Stop Segments (default) ──

  function renderLinearHardSegments(g, marginLeft, barY, barW, barH, barRadius) {
    config.ranges.forEach((range, idx) => {
      const rFrom = Math.max(range.from, config.minValue);
      const rTo   = Math.min(range.to, config.maxValue);
      if (rTo <= rFrom) return;

      const x1 = marginLeft + valueRatio(rFrom) * barW;
      const x2 = marginLeft + valueRatio(rTo) * barW;
      const segW = x2 - x1;

      const segment = g.append('rect')
        .attr('class', 'gauge-arc-segment linear-segment')
        .attr('x', x1).attr('y', barY)
        .attr('width', segW).attr('height', barH)
        .attr('fill', range.color)
        .attr('data-index', idx);

      if (rFrom <= config.minValue) {
        segment.attr('rx', barRadius).attr('ry', barRadius);
        if (segW > barRadius * 2) {
          g.append('rect')
            .attr('x', x1 + barRadius).attr('y', barY)
            .attr('width', segW - barRadius).attr('height', barH)
            .attr('fill', range.color).attr('pointer-events', 'none');
        }
      }
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
  }

  // ── Linear Gradient Bar ──

  function renderLinearGradientBar(svg, g, marginLeft, barY, barW, barH, barRadius) {
    const stops = buildGradientStops();
    if (stops.length === 0) return;

    // Create SVG <defs> with a <linearGradient>
    const defs = svg.append('defs');
    const gradientId = 'linear-gauge-gradient-' + Date.now();
    const linearGrad = defs.append('linearGradient')
      .attr('id', gradientId)
      .attr('x1', '0%').attr('y1', '0%')
      .attr('x2', '100%').attr('y2', '0%');

    stops.forEach(stop => {
      linearGrad.append('stop')
        .attr('offset', (stop.pos * 100) + '%')
        .attr('stop-color', stop.color);
    });

    // Render a single rect with the gradient fill, clipped to rounded corners
    const clipId = 'linear-gauge-clip-' + Date.now();
    defs.append('clipPath')
      .attr('id', clipId)
      .append('rect')
      .attr('x', marginLeft).attr('y', barY)
      .attr('width', barW).attr('height', barH)
      .attr('rx', barRadius).attr('ry', barRadius);

    g.append('rect')
      .attr('x', marginLeft).attr('y', barY)
      .attr('width', barW).attr('height', barH)
      .attr('fill', `url(#${gradientId})`)
      .attr('clip-path', `url(#${clipId})`);

    // Invisible overlay rects for tooltip/click interaction per range
    config.ranges.forEach((range, idx) => {
      const rFrom = Math.max(range.from, config.minValue);
      const rTo   = Math.min(range.to, config.maxValue);
      if (rTo <= rFrom) return;

      const x1 = marginLeft + valueRatio(rFrom) * barW;
      const x2 = marginLeft + valueRatio(rTo) * barW;

      const overlay = g.append('rect')
        .attr('x', x1).attr('y', barY)
        .attr('width', x2 - x1).attr('height', barH)
        .attr('fill', 'transparent')
        .attr('class', 'gauge-arc-segment')
        .attr('data-index', idx);

      if (config.enableTooltip) {
        overlay
          .on('mouseenter', function (event) {
            showTooltip(event, range.label || `Range ${idx + 1}`,
              `${formatValue(range.from)} – ${formatValue(range.to)}`, '');
          })
          .on('mousemove', function (event) { moveTooltip(event); })
          .on('mouseleave', hideTooltip);
      }
      if (config.enableFilter) {
        overlay.on('click', function () { filterByRange(range); });
      }
    });
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
            .catch(() => {})
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
        if (parsed.gaugeType === 'full') parsed.gaugeType = 'semi';
        config = { ...DEFAULT_CONFIG, ...parsed, ranges: (parsed.ranges || DEFAULT_CONFIG.ranges).map(r => ({ ...r })) };
        console.log('[Gauge] Settings loaded:', config.worksheet, config.measure, 'type:', config.gaugeType);
      } catch (e) {
        console.warn('[Gauge] Failed to parse saved settings:', e);
      }
    } else {
      console.log('[Gauge] No saved settings found — using defaults.');
    }
  }

  // ─── Configuration Dialog ─────────────────────────────────────────

  function openConfigureDialog() {
    console.log('[Gauge] Configure callback triggered — opening popup dialog...');
    const baseUrl = window.location.href.replace(/\/[^/]*$/, '/');
    const popupUrl = baseUrl + 'config.html';

    tableau.extensions.ui.displayDialogAsync(
      popupUrl, '', { height: 600, width: 580 }
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
        fallbackToDemo();
      } else {
        hideLoading();
        showError('Initialization failed: ' + err.message);
      }
    }
  }

  // ─── Window Resize ─────────────────────────────────────────────────

  let resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => renderGauge(false), 150);
  });

  // ─── Boot ──────────────────────────────────────────────────────────

  function checkApiAndBoot() {
    if (typeof tableau === 'undefined') {
      console.error('[Gauge] ❌ "tableau" object is undefined. API did not load.');
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