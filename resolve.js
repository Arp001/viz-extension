/**
 * Gauge Chart — Shared Resolution & Validation Logic
 *
 * This file is loaded by BOTH the main gauge page (gauge.js / gauge.html) and the
 * configuration dialog (config.js / config.html). It centralises the logic that
 * turns the user's configuration (which may reference worksheet fields and
 * relative boundaries) into concrete numeric values:
 *
 *   • aggregateColumn()  — aggregate one column of a Tableau summary data table.
 *                          This is the SAME pattern already used for the Value
 *                          Field in gauge.js, reused here for Max and Goal fields.
 *   • resolveMax()       — resolve the gauge scale maximum (fixed or field).
 *   • resolveGoal()      — resolve the shared Goal reference value (field).
 *   • resolveRangeStart()— resolve a single range's start boundary for the
 *                          selected mode (fixed / % of Max / % of Goal / Goal).
 *   • resolveRanges()    — produce concrete {from,to,color,label} ranges where
 *                          each range ends where the next begins and the last
 *                          ends at Max.
 *   • validateResolved() — run pre-apply checks and return warnings.
 *   • migrateRange()     — upgrade a legacy {from,to} range to the new model.
 *
 * Exposed on the global object as `window.GaugeResolve`.
 */
(function (global) {
  'use strict';

  // ─── Column Aggregation ────────────────────────────────────────────
  // Mirrors the Value Field aggregation logic in gauge.js. Supports
  // SUM, AVG, MIN, MAX, FIRST and COUNT. Returns null when there is no
  // usable data so callers can fall back to a default / raise a warning.
  function aggregateColumn(dataTable, colIdx, agg) {
    if (!dataTable || colIdx == null || colIdx < 0) return null;

    if (agg === 'COUNT') {
      return dataTable.data.filter(function (row) {
        var cell = row[colIdx];
        if (!cell) return false;
        var v = cell.value;
        return v !== null && v !== undefined && v !== '' && v !== '%null%';
      }).length;
    }

    var values = dataTable.data
      .map(function (row) { return parseFloat(row[colIdx].value); })
      .filter(function (v) { return !isNaN(v); });
    if (values.length === 0) return null;

    switch (agg) {
      case 'SUM':   return d3sum(values);
      case 'AVG':   return d3mean(values);
      case 'MIN':   return Math.min.apply(null, values);
      case 'MAX':   return Math.max.apply(null, values);
      case 'FIRST': return values[0];
      case 'COUNT': return values.length;
      default:      return d3sum(values);
    }
  }

  // Lightweight sum/mean so this file works even if d3 isn't loaded
  // (e.g. inside the config dialog, which does not include d3).
  function d3sum(arr) {
    var s = 0;
    for (var i = 0; i < arr.length; i++) s += arr[i];
    return s;
  }
  function d3mean(arr) {
    return arr.length ? d3sum(arr) / arr.length : null;
  }

  function colIndex(dataTable, fieldName) {
    if (!dataTable || !fieldName) return -1;
    return dataTable.columns.findIndex(function (c) { return c.fieldName === fieldName; });
  }

  // ─── Max Resolution ────────────────────────────────────────────────
  // Returns { value, ok, source }. When maxMode === 'field', computes the
  // aggregation of the chosen field; otherwise uses the fixed maxValue.
  function resolveMax(config, dataTable) {
    if (config.maxMode === 'field' && config.maxField) {
      var idx = colIndex(dataTable, config.maxField);
      if (idx === -1) {
        return { value: config.maxValue, ok: false, source: 'field',
                 reason: 'Max field "' + config.maxField + '" not found in worksheet.' };
      }
      var v = aggregateColumn(dataTable, idx, config.maxAggregation || 'MAX');
      if (v === null || !isFinite(v)) {
        return { value: config.maxValue, ok: false, source: 'field',
                 reason: 'Max field aggregation produced no usable value.' };
      }
      return { value: v, ok: true, source: 'field' };
    }
    var fixed = parseFloat(config.maxValue);
    return { value: isFinite(fixed) ? fixed : 100, ok: isFinite(fixed), source: 'fixed' };
  }

  // ─── Goal Resolution ───────────────────────────────────────────────
  // Returns { value (number|null), ok, configured }. The Goal is optional;
  // when no field is configured, value is null and configured is false.
  function resolveGoal(config, dataTable) {
    if (!config.goalField) {
      return { value: null, ok: true, configured: false };
    }
    var idx = colIndex(dataTable, config.goalField);
    if (idx === -1) {
      return { value: null, ok: false, configured: true,
               reason: 'Goal field "' + config.goalField + '" not found in worksheet.' };
    }
    var v = aggregateColumn(dataTable, idx, config.goalAggregation || 'SUM');
    if (v === null || !isFinite(v)) {
      return { value: null, ok: false, configured: true,
               reason: 'Goal field aggregation produced no usable value.' };
    }
    return { value: v, ok: true, configured: true };
  }

  // ─── Range Start Resolution ────────────────────────────────────────
  // startMode: 'fixed' | 'pctMax' | 'pctGoal' | 'goal'
  //   fixed   → startValue is an absolute number
  //   pctMax  → startValue is a percentage (0–100) of Max
  //   pctGoal → startValue is a percentage (0–100) of Goal
  //   goal    → start equals the Goal value (no startValue used)
  function resolveRangeStart(range, maxValue, goalValue) {
    var mode = range.startMode || 'fixed';
    var sv = parseFloat(range.startValue);
    switch (mode) {
      case 'pctMax':
        return (isFinite(sv) ? sv : 0) / 100 * maxValue;
      case 'pctGoal':
        if (goalValue === null || goalValue === undefined || !isFinite(goalValue)) return NaN;
        return (isFinite(sv) ? sv : 0) / 100 * goalValue;
      case 'goal':
        if (goalValue === null || goalValue === undefined || !isFinite(goalValue)) return NaN;
        return goalValue;
      case 'fixed':
      default:
        return isFinite(sv) ? sv : 0;
    }
  }

  // ─── Full Range Resolution ─────────────────────────────────────────
  // Produces concrete render-ready ranges in the SAME array order the user
  // defined them. Each range's `to` is the next range's `from`; the last
  // range's `to` is Max. `from` of the first range is whatever the user set.
  function resolveRanges(ranges, minValue, maxValue, goalValue) {
    var defs = (ranges || []).map(function (r) {
      return {
        label: r.label || '',
        color: r.color || '#4a90d9',
        startMode: r.startMode || 'fixed',
        startValue: r.startValue,
        from: resolveRangeStart(r, maxValue, goalValue),
      };
    });
    for (var i = 0; i < defs.length; i++) {
      defs[i].to = (i < defs.length - 1) ? defs[i + 1].from : maxValue;
    }
    return defs;
  }

  // ─── Validation ────────────────────────────────────────────────────
  // Returns { warnings: [string], resolved: {min,max,goal,goalConfigured,ranges} }
  function validateResolved(config, dataTable) {
    var warnings = [];
    var minValue = parseFloat(config.minValue);
    if (!isFinite(minValue)) minValue = 0;

    var maxR = resolveMax(config, dataTable);
    var goalR = resolveGoal(config, dataTable);

    if (!maxR.ok && maxR.reason) warnings.push(maxR.reason);
    if (!goalR.ok && goalR.reason) warnings.push(goalR.reason);

    var maxValue = maxR.value;
    var goalValue = goalR.value;

    if (!isFinite(maxValue)) {
      warnings.push('Max value is not a valid number.');
    }
    if (isFinite(maxValue) && isFinite(minValue) && maxValue <= minValue) {
      warnings.push('Max value (' + fmt(maxValue) + ') must be greater than Min value (' + fmt(minValue) + ').');
    }

    // Goal vs Max
    if (goalR.configured && goalValue !== null && isFinite(goalValue) && isFinite(maxValue) && goalValue > maxValue) {
      warnings.push('Goal value (' + fmt(goalValue) + ') exceeds Max value (' + fmt(maxValue) + ').');
    }

    var resolved = resolveRanges(config.ranges, minValue, maxValue, goalValue);

    // Per-range checks
    resolved.forEach(function (r, i) {
      var name = r.label || ('Range ' + (i + 1));
      if (!isFinite(r.from)) {
        if ((r.startMode === 'pctGoal' || r.startMode === 'goal') && (goalValue === null || !isFinite(goalValue))) {
          warnings.push('"' + name + '" uses a Goal-based start, but no valid Goal value is available.');
        } else {
          warnings.push('"' + name + '" has an invalid start value.');
        }
      } else if (isFinite(maxValue) && r.from > maxValue) {
        warnings.push('"' + name + '" start (' + fmt(r.from) + ') exceeds Max value (' + fmt(maxValue) + ').');
      } else if (isFinite(minValue) && r.from < minValue) {
        warnings.push('"' + name + '" start (' + fmt(r.from) + ') is below Min value (' + fmt(minValue) + ').');
      }
    });

    // Order / overlap check — starts must be strictly increasing.
    for (var i = 1; i < resolved.length; i++) {
      var prev = resolved[i - 1].from;
      var cur = resolved[i].from;
      if (isFinite(prev) && isFinite(cur)) {
        if (cur < prev) {
          warnings.push('Ranges are out of order: "' +
            (resolved[i].label || ('Range ' + (i + 1))) + '" starts before the previous range.');
        } else if (cur === prev) {
          warnings.push('Ranges overlap: "' +
            (resolved[i].label || ('Range ' + (i + 1))) + '" starts at the same value as the previous range (zero-width band).');
        }
      }
    }

    if (resolved.length === 0) {
      warnings.push('No ranges defined — add at least one range.');
    }

    return {
      warnings: warnings,
      resolved: {
        min: minValue,
        max: maxValue,
        maxSource: maxR.source,
        goal: goalValue,
        goalConfigured: goalR.configured,
        ranges: resolved,
      },
    };
  }

  function fmt(v) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    // Compact, readable formatting without depending on d3.
    var n = Number(v);
    if (Math.abs(n) >= 1000 || Number.isInteger(n)) {
      return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
    }
    return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }

  // ─── Legacy Migration ──────────────────────────────────────────────
  // Old ranges were {from, to, color, label}. Convert to the new model
  // {label, color, startMode:'fixed', startValue:from}. New-model ranges
  // pass through unchanged.
  function migrateRange(r) {
    if (!r) return { label: '', color: '#4a90d9', startMode: 'fixed', startValue: 0 };
    if (r.startMode) {
      return {
        label: r.label || '',
        color: r.color || '#4a90d9',
        startMode: r.startMode,
        startValue: (r.startValue === undefined || r.startValue === null) ? 0 : r.startValue,
      };
    }
    return {
      label: r.label || '',
      color: r.color || '#4a90d9',
      startMode: 'fixed',
      startValue: (r.from === undefined || r.from === null) ? 0 : r.from,
    };
  }

  function migrateRanges(ranges) {
    return (ranges || []).map(migrateRange);
  }

  global.GaugeResolve = {
    aggregateColumn: aggregateColumn,
    colIndex: colIndex,
    resolveMax: resolveMax,
    resolveGoal: resolveGoal,
    resolveRangeStart: resolveRangeStart,
    resolveRanges: resolveRanges,
    validateResolved: validateResolved,
    migrateRange: migrateRange,
    migrateRanges: migrateRanges,
    fmt: fmt,
  };

})(typeof window !== 'undefined' ? window : this);
