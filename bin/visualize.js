import pg from 'pg';
import fs from 'fs';
import path from 'path';
import os from 'os';
import open from 'open';
import chalk from 'chalk';

const { Client } = pg;

/**
 * Execute a SQL query and return results
 */
async function executeQuery(connectionConfig, query) {
  const client = new Client(connectionConfig);
  
  try {
    await client.connect();
    const result = await client.query(query);
    return result.rows;
  } finally {
    await client.end();
  }
}

/**
 * Detect appropriate chart type based on data structure
 */
function detectChartType(rows) {
  if (rows.length === 0) return 'table';
  
  const keys = Object.keys(rows[0]);
  
  if (keys.length === 2) {
    const secondCol = rows[0][keys[1]];
    if (isNumericValue(secondCol)) {
      return 'bar';
    }
  }
  
  const numericCols = keys.filter(k => isNumericValue(rows[0][k]));
  if (numericCols.length > 1) {
    return 'line';
  }
  
  return 'bar';
}

/**
 * Prepare data for Chart.js
 */
function prepareChartData(rows, chartType) {
  if (rows.length === 0) {
    return { labels: [], datasets: [] };
  }

  const keys = Object.keys(rows[0]);
  
  if (keys.length === 2) {
    const labelKey = keys[0];
    const valueKey = keys[1];
    
    return {
      labels: rows.map(row => String(row[labelKey])),
      datasets: [{
        label: valueKey,
        data: rows.map(row => parseNumericValue(row[valueKey]) || 0),
        backgroundColor: [
          'rgba(99, 102, 241, 0.7)',
          'rgba(168, 85, 247, 0.7)',
          'rgba(236, 72, 153, 0.7)',
          'rgba(34, 211, 238, 0.7)',
          'rgba(74, 222, 128, 0.7)',
          'rgba(251, 191, 36, 0.7)',
          'rgba(248, 113, 113, 0.7)',
          'rgba(96, 165, 250, 0.7)',
        ],
        borderColor: [
          'rgba(99, 102, 241, 1)',
          'rgba(168, 85, 247, 1)',
          'rgba(236, 72, 153, 1)',
          'rgba(34, 211, 238, 1)',
          'rgba(74, 222, 128, 1)',
          'rgba(251, 191, 36, 1)',
          'rgba(248, 113, 113, 1)',
          'rgba(96, 165, 250, 1)',
        ],
        borderWidth: 2
      }]
    };
  } else {
    const labelKey = keys[0];
    const dataKeys = keys.slice(1).filter(k => isNumericValue(rows[0][k]));
    
    const colors = [
      { bg: 'rgba(99, 102, 241, 0.7)', border: 'rgba(99, 102, 241, 1)' },
      { bg: 'rgba(168, 85, 247, 0.7)', border: 'rgba(168, 85, 247, 1)' },
      { bg: 'rgba(236, 72, 153, 0.7)', border: 'rgba(236, 72, 153, 1)' },
      { bg: 'rgba(34, 211, 238, 0.7)', border: 'rgba(34, 211, 238, 1)' },
      { bg: 'rgba(74, 222, 128, 0.7)', border: 'rgba(74, 222, 128, 1)' },
    ];
    
    return {
      labels: rows.map(row => String(row[labelKey])),
      datasets: dataKeys.map((key, idx) => ({
        label: key,
        data: rows.map(row => parseNumericValue(row[key]) || 0),
        backgroundColor: colors[idx % colors.length].bg,
        borderColor: colors[idx % colors.length].border,
        borderWidth: 2,
        fill: chartType === 'line' ? false : true,
        tension: 0.4
      }))
    };
  }
}

/**
 * Calculate statistics for numeric columns
 */
function calculateStatistics(rows) {
  if (rows.length === 0) return {};
  
  const keys = Object.keys(rows[0]);
  // Use improved numeric detection
  const numericCols = keys.filter(k => {
    for (let i = 0; i < Math.min(5, rows.length); i++) {
      if (isNumericValue(rows[i]?.[k])) return true;
    }
    return false;
  });
  
  const stats = {};
  
  numericCols.forEach(col => {
    const values = rows.map(row => parseNumericValue(row[col])).filter(v => !isNaN(v));
    const sorted = [...values].sort((a, b) => a - b);
    
    const sum = values.reduce((acc, val) => acc + val, 0);
    const avg = sum / values.length;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const median = sorted[Math.floor(sorted.length / 2)];
    const range = max - min;
    
    // Calculate standard deviation
    const variance = values.reduce((acc, val) => acc + Math.pow(val - avg, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    
    // Coefficient of variation (CV) - measure of relative variability
    const cv = (stdDev / avg) * 100;
    
    // Percentiles
    const p25 = sorted[Math.floor(sorted.length * 0.25)];
    const p75 = sorted[Math.floor(sorted.length * 0.75)];
    const iqr = p75 - p25; // Interquartile range
    
    // Detect anomalies (values beyond 2 standard deviations)
    const anomalyValues = values.filter(v => Math.abs(v - avg) > 2 * stdDev);
    const anomalies = anomalyValues.length;
    
    // Detect drops (decrease > 20% from previous value)
    let drops = 0;
    let spikes = 0;
    const dropDetails = [];
    const spikeDetails = [];
    
    for (let i = 1; i < values.length; i++) {
      if (values[i - 1] > 0) {
        const changePercent = ((values[i] - values[i - 1]) / values[i - 1]) * 100;
        if (changePercent < -20) {
          drops++;
          dropDetails.push({ index: i, from: values[i-1], to: values[i], change: changePercent.toFixed(1) });
        }
        if (changePercent > 50) {
          spikes++;
          spikeDetails.push({ index: i, from: values[i-1], to: values[i], change: changePercent.toFixed(1) });
        }
      }
    }
    
    // Trend analysis (simple linear regression slope)
    let trend = 'stable';
    if (values.length > 2) {
      const n = values.length;
      const sumX = (n * (n - 1)) / 2;
      const sumY = sum;
      const sumXY = values.reduce((acc, val, i) => acc + (i * val), 0);
      const sumXX = (n * (n - 1) * (2 * n - 1)) / 6;
      const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
      const slopePercent = (slope / avg) * 100;
      
      if (slopePercent > 5) trend = 'increasing';
      else if (slopePercent < -5) trend = 'decreasing';
    }
    
    stats[col] = {
      sum,
      avg,
      min,
      max,
      median,
      range,
      stdDev,
      cv,
      p25,
      p75,
      iqr,
      anomalies,
      anomalyValues,
      drops,
      dropDetails,
      spikes,
      spikeDetails,
      trend,
      count: values.length,
      values
    };
  });
  
  return stats;
}

/**
 * Check if a value can be treated as numeric (handles currency, strings, etc.)
 */
function isNumericValue(value) {
  if (typeof value === 'number') return true;
  if (typeof value === 'string') {
    // Strip common currency symbols and formatting
    const cleaned = value.replace(/[$€£¥₹,\s]/g, '').trim();
    return cleaned !== '' && !isNaN(parseFloat(cleaned)) && isFinite(parseFloat(cleaned));
  }
  return false;
}

/**
 * Parse a value to a number (handles currency, strings, etc.)
 */
function parseNumericValue(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[$€£¥₹,\s]/g, '').trim();
    return parseFloat(cleaned);
  }
  return NaN;
}

/**
 * Generate HTML with Chart.js visualization
 */
function generateHTML(rows, query, chartType = null, analyzeColumn = null) {
  const detectedType = chartType || detectChartType(rows);
  const chartData = prepareChartData(rows, detectedType);
  const statistics = calculateStatistics(rows);
  
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  // Improved numeric detection: check first few rows for numeric values (handles currency, string numbers)
  const numericColumns = columns.filter(col => {
    // Check first 5 rows to determine if column is numeric
    for (let i = 0; i < Math.min(5, rows.length); i++) {
      if (isNumericValue(rows[i]?.[col])) return true;
    }
    return false;
  });
  
  // Determine which column to analyze initially
  const defaultAnalyzeColumn = analyzeColumn && numericColumns.includes(analyzeColumn) 
    ? analyzeColumn 
    : numericColumns[0] || null;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>DB Query Analytics Dashboard</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
    <script src="https://unpkg.com/lucide@latest"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-primary: #0f172a;
            --bg-secondary: #1e293b;
            --bg-tertiary: #334155;
            --text-primary: #f1f5f9;
            --text-secondary: #94a3b8;
            --text-muted: #64748b;
            --accent-purple: #a855f7;
            --accent-blue: #3b82f6;
            --accent-cyan: #22d3ee;
            --accent-green: #22c55e;
            --accent-yellow: #eab308;
            --accent-red: #ef4444;
            --accent-pink: #ec4899;
            --gradient-1: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            --gradient-2: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
            --gradient-3: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
            --gradient-4: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%);
            --shadow-lg: 0 10px 40px rgba(0, 0, 0, 0.4);
            --shadow-glow: 0 0 30px rgba(168, 85, 247, 0.3);
        }
        
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            background: var(--bg-primary);
            color: var(--text-primary);
            min-height: 100vh;
            line-height: 1.6;
        }
        
        .header {
            background: var(--gradient-1);
            padding: 20px 32px;
            position: sticky;
            top: 0;
            z-index: 100;
            box-shadow: var(--shadow-lg);
        }
        
        .header-content {
            max-width: 1600px;
            margin: 0 auto;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .header h1 {
            font-size: 22px;
            font-weight: 700;
            display: flex;
            align-items: center;
            gap: 12px;
        }
        
        .header-actions {
            display: flex;
            gap: 12px;
        }
        
        .container {
            max-width: 1600px;
            margin: 0 auto;
            padding: 32px;
        }
        
        .section {
            background: var(--bg-secondary);
            border-radius: 16px;
            padding: 24px;
            margin-bottom: 24px;
            border: 1px solid var(--bg-tertiary);
            transition: all 0.3s ease;
        }
        
        .section:hover {
            border-color: rgba(168, 85, 247, 0.3);
            box-shadow: var(--shadow-glow);
        }
        
        .section-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            flex-wrap: wrap;
            gap: 16px;
        }
        
        .section-title {
            font-size: 18px;
            font-weight: 700;
            display: flex;
            align-items: center;
            gap: 10px;
            color: var(--text-primary);
        }
        
        .section-title i {
            color: var(--accent-purple);
        }
        
        /* Query Info */
        .query-box {
            background: var(--bg-primary);
            padding: 16px 20px;
            border-radius: 12px;
            border: 1px solid var(--bg-tertiary);
            font-family: 'Monaco', 'Menlo', monospace;
            font-size: 13px;
            color: var(--accent-cyan);
            white-space: pre-wrap;
            word-break: break-all;
            line-height: 1.8;
        }
        
        /* Stats Grid */
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 16px;
            margin-bottom: 24px;
        }
        
        .stat-card {
            background: var(--gradient-1);
            padding: 20px;
            border-radius: 12px;
            position: relative;
            overflow: hidden;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        
        .stat-card::before {
            content: '';
            position: absolute;
            top: 0;
            right: 0;
            width: 80px;
            height: 80px;
            background: rgba(255,255,255,0.1);
            border-radius: 50%;
            transform: translate(20px, -20px);
        }
        
        .stat-card:hover {
            transform: translateY(-4px);
            box-shadow: var(--shadow-glow);
        }
        
        .stat-card:nth-child(2) { background: var(--gradient-2); }
        .stat-card:nth-child(3) { background: var(--gradient-3); }
        .stat-card:nth-child(4) { background: var(--gradient-4); }
        
        .stat-card h4 {
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 1.5px;
            opacity: 0.9;
            margin-bottom: 8px;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        
        .stat-card .value {
            font-size: 28px;
            font-weight: 800;
        }
        
        /* Column Selector for Analytics */
        .analytics-controls {
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
            align-items: center;
        }
        
        .column-pill {
            padding: 10px 20px;
            background: var(--bg-primary);
            border: 2px solid var(--bg-tertiary);
            border-radius: 50px;
            cursor: pointer;
            font-weight: 600;
            font-size: 13px;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            gap: 8px;
            color: var(--text-secondary);
        }
        
        .column-pill:hover {
            border-color: var(--accent-purple);
            color: var(--text-primary);
        }
        
        .column-pill.active {
            background: var(--gradient-1);
            border-color: transparent;
            color: white;
            box-shadow: 0 4px 15px rgba(168, 85, 247, 0.4);
        }
        
        .column-pill i {
            width: 16px;
            height: 16px;
        }
        
        /* Analytics Cards */
        .analytics-dashboard {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 20px;
            margin-top: 24px;
        }
        
        .analytics-card {
            background: var(--bg-primary);
            border-radius: 12px;
            padding: 20px;
            border: 1px solid var(--bg-tertiary);
            transition: all 0.3s;
        }
        
        .analytics-card:hover {
            border-color: rgba(168, 85, 247, 0.3);
            transform: translateY(-2px);
        }
        
        .analytics-card-header {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 16px;
        }
        
        .analytics-card-icon {
            width: 44px;
            height: 44px;
            border-radius: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
        }
        
        .analytics-card-icon.purple { background: var(--gradient-1); }
        .analytics-card-icon.pink { background: var(--gradient-2); }
        .analytics-card-icon.blue { background: var(--gradient-3); }
        .analytics-card-icon.green { background: var(--gradient-4); }
        
        .analytics-card-title {
            font-size: 14px;
            color: var(--text-secondary);
            font-weight: 500;
        }
        
        .analytics-card-value {
            font-size: 32px;
            font-weight: 800;
            color: var(--text-primary);
        }
        
        .analytics-card-subtitle {
            font-size: 12px;
            color: var(--text-muted);
            margin-top: 4px;
        }
        
        .analytics-card-footer {
            margin-top: 16px;
            padding-top: 16px;
            border-top: 1px solid var(--bg-tertiary);
            display: flex;
            justify-content: space-between;
            font-size: 12px;
        }
        
        .analytics-label {
            color: var(--text-muted);
        }
        
        .analytics-value {
            font-weight: 600;
            color: var(--text-secondary);
        }
        
        /* Trend Badge */
        .trend-badge {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 4px 10px;
            border-radius: 20px;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
        }
        
        .trend-badge.up {
            background: rgba(34, 197, 94, 0.2);
            color: var(--accent-green);
        }
        
        .trend-badge.down {
            background: rgba(239, 68, 68, 0.2);
            color: var(--accent-red);
        }
        
        .trend-badge.stable {
            background: rgba(148, 163, 184, 0.2);
            color: var(--text-secondary);
        }
        
        /* Insights Panel */
        .insights-panel {
            background: linear-gradient(135deg, rgba(168, 85, 247, 0.1) 0%, rgba(59, 130, 246, 0.1) 100%);
            border: 1px solid rgba(168, 85, 247, 0.3);
            border-radius: 12px;
            padding: 20px;
            margin-top: 24px;
        }
        
        .insights-title {
            font-size: 14px;
            font-weight: 700;
            color: var(--accent-purple);
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 16px;
        }
        
        .insight-item {
            display: flex;
            align-items: flex-start;
            gap: 12px;
            padding: 12px 0;
            border-bottom: 1px solid rgba(148, 163, 184, 0.1);
        }
        
        .insight-item:last-child {
            border-bottom: none;
        }
        
        .insight-icon {
            width: 32px;
            height: 32px;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
        }
        
        .insight-icon.warning {
            background: rgba(234, 179, 8, 0.2);
            color: var(--accent-yellow);
        }
        
        .insight-icon.danger {
            background: rgba(239, 68, 68, 0.2);
            color: var(--accent-red);
        }
        
        .insight-icon.success {
            background: rgba(34, 197, 94, 0.2);
            color: var(--accent-green);
        }
        
        .insight-icon.info {
            background: rgba(59, 130, 246, 0.2);
            color: var(--accent-blue);
        }
        
        .insight-content h4 {
            font-size: 13px;
            font-weight: 600;
            color: var(--text-primary);
            margin-bottom: 4px;
        }
        
        .insight-content p {
            font-size: 12px;
            color: var(--text-muted);
            line-height: 1.5;
        }
        
        /* Chart Controls */
        .chart-controls {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
        }
        
        .btn {
            padding: 10px 18px;
            border: none;
            background: var(--bg-tertiary);
            color: var(--text-secondary);
            border-radius: 8px;
            cursor: pointer;
            font-weight: 600;
            font-size: 13px;
            transition: all 0.2s;
            display: inline-flex;
            align-items: center;
            gap: 8px;
        }
        
        .btn:hover {
            background: rgba(168, 85, 247, 0.2);
            color: var(--text-primary);
        }
        
        .btn.active {
            background: var(--gradient-1);
            color: white;
            box-shadow: 0 4px 15px rgba(168, 85, 247, 0.3);
        }
        
        .btn-primary {
            background: var(--gradient-1);
            color: white;
        }
        
        .btn-primary:hover {
            box-shadow: 0 4px 15px rgba(168, 85, 247, 0.4);
            transform: translateY(-1px);
        }
        
        /* Chart Container */
        .chart-wrapper {
            background: var(--bg-primary);
            border-radius: 12px;
            padding: 20px;
            margin-top: 20px;
            border: 1px solid var(--bg-tertiary);
        }
        
        canvas {
            max-height: 400px;
        }
        
        /* Table Styles */
        .table-controls {
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 16px;
        }
        
        .control-group {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
        }
        
        .column-selector {
            background: var(--bg-primary);
            border: 1px solid var(--bg-tertiary);
            border-radius: 12px;
            padding: 20px;
            margin: 16px 0;
        }
        
        .column-selector-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 16px;
        }
        
        .column-list {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
            gap: 8px;
        }
        
        .column-checkbox {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 10px;
            border-radius: 8px;
            cursor: pointer;
            transition: background 0.2s;
        }
        
        .column-checkbox:hover {
            background: var(--bg-tertiary);
        }
        
        .column-checkbox input[type="checkbox"] {
            width: 18px;
            height: 18px;
            accent-color: var(--accent-purple);
        }
        
        .table-container {
            overflow-x: auto;
            border-radius: 12px;
            border: 1px solid var(--bg-tertiary);
            margin-top: 16px;
        }
        
        table {
            width: 100%;
            border-collapse: collapse;
        }
        
        th, td {
            padding: 14px 16px;
            text-align: left;
            border-bottom: 1px solid var(--bg-tertiary);
        }
        
        th {
            background: var(--bg-primary);
            font-weight: 600;
            color: var(--text-secondary);
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 1px;
            position: sticky;
            top: 0;
        }
        
        td {
            font-size: 13px;
            color: var(--text-primary);
        }
        
        tr:hover {
            background: rgba(168, 85, 247, 0.05);
        }
        
        .btn-close {
            background: none;
            border: none;
            color: var(--text-muted);
            font-size: 24px;
            cursor: pointer;
            padding: 4px 8px;
            border-radius: 4px;
            transition: all 0.2s;
        }
        
        .btn-close:hover {
            background: var(--bg-tertiary);
            color: var(--text-primary);
        }
        
        /* Empty state */
        .empty-state {
            text-align: center;
            padding: 60px 20px;
            color: var(--text-muted);
        }
        
        .empty-state i {
            margin-bottom: 16px;
            opacity: 0.5;
        }
        
        @media (max-width: 768px) {
            .container { padding: 16px; }
            .header { padding: 16px; }
            .analytics-dashboard { grid-template-columns: 1fr; }
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-content">
            <h1>
                <i data-lucide="database" style="width: 24px; height: 24px;"></i>
                DB Query Analytics
            </h1>
            <div class="header-actions">
                <button class="btn btn-primary" onclick="exportToCSV()">
                    <i data-lucide="download" style="width: 16px; height: 16px;"></i>
                    Export CSV
                </button>
                <button class="btn btn-primary" onclick="exportToJSON()">
                    <i data-lucide="file-json" style="width: 16px; height: 16px;"></i>
                    Export JSON
                </button>
            </div>
        </div>
    </div>
    
    <div class="container">
        <!-- Query Section -->
        <div class="section">
            <div class="section-header">
                <div class="section-title">
                    <i data-lucide="terminal" style="width: 20px; height: 20px;"></i>
                    SQL Query
                </div>
            </div>
            <div class="query-box">${query.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
        </div>

        <!-- Quick Stats -->
        <div class="stats-grid">
            <div class="stat-card">
                <h4><i data-lucide="rows" style="width: 14px; height: 14px;"></i> Total Rows</h4>
                <div class="value">${rows.length.toLocaleString()}</div>
            </div>
            <div class="stat-card">
                <h4><i data-lucide="columns" style="width: 14px; height: 14px;"></i> Columns</h4>
                <div class="value">${columns.length}</div>
            </div>
            <div class="stat-card">
                <h4><i data-lucide="hash" style="width: 14px; height: 14px;"></i> Numeric Fields</h4>
                <div class="value">${numericColumns.length}</div>
            </div>
            <div class="stat-card">
                <h4><i data-lucide="text" style="width: 14px; height: 14px;"></i> Text Fields</h4>
                <div class="value">${columns.length - numericColumns.length}</div>
            </div>
        </div>

        ${numericColumns.length > 0 ? `
        <!-- Analytics Section -->
        <div class="section">
            <div class="section-header">
                <div class="section-title">
                    <i data-lucide="bar-chart-3" style="width: 20px; height: 20px;"></i>
                    Statistical Analysis
                </div>
                <div class="analytics-controls">
                    ${numericColumns.map((col, idx) => `
                        <button class="column-pill ${col === defaultAnalyzeColumn ? 'active' : ''}" onclick="selectColumn('${col}')" data-column="${col}">
                            <i data-lucide="activity" style="width: 14px; height: 14px;"></i>
                            ${col}
                        </button>
                    `).join('')}
                </div>
            </div>
            
            <div id="analyticsContainer">
                <!-- Analytics cards will be rendered here -->
            </div>
        </div>
        ` : ''}

        ${rows.length > 0 ? `
        <!-- Chart Section -->
        <div class="section">
            <div class="section-header">
                <div class="section-title">
                    <i data-lucide="pie-chart" style="width: 20px; height: 20px;"></i>
                    Visualization
                </div>
                <div class="chart-controls">
                    <button class="btn active" onclick="changeChartType('bar')" id="btn-bar">
                        <i data-lucide="bar-chart" style="width: 16px; height: 16px;"></i> Bar
                    </button>
                    <button class="btn" onclick="changeChartType('line')" id="btn-line">
                        <i data-lucide="trending-up" style="width: 16px; height: 16px;"></i> Line
                    </button>
                    <button class="btn" onclick="changeChartType('pie')" id="btn-pie">
                        <i data-lucide="pie-chart" style="width: 16px; height: 16px;"></i> Pie
                    </button>
                    <button class="btn" onclick="changeChartType('doughnut')" id="btn-doughnut">
                        <i data-lucide="circle-dot" style="width: 16px; height: 16px;"></i> Doughnut
                    </button>
                    <button class="btn" onclick="changeChartType('radar')" id="btn-radar">
                        <i data-lucide="radar" style="width: 16px; height: 16px;"></i> Radar
                    </button>
                </div>
            </div>
            <div class="chart-wrapper">
                <canvas id="myChart"></canvas>
            </div>
        </div>
        ` : ''}

        <!-- Data Table Section -->
        <div class="section">
            <div class="table-controls">
                <div class="section-title">
                    <i data-lucide="table" style="width: 20px; height: 20px;"></i>
                    Data Table
                </div>
                <div class="control-group">
                    <button class="btn" onclick="toggleColumnSelector()">
                        <i data-lucide="settings-2" style="width: 16px; height: 16px;"></i>
                        Manage Columns
                    </button>
                </div>
            </div>
            
            <div class="column-selector" id="columnSelector" style="display: none;">
                <div class="column-selector-header">
                    <span style="font-weight: 600; color: var(--text-primary);">Select Columns to Display</span>
                    <button class="btn-close" onclick="toggleColumnSelector()">×</button>
                </div>
                <div class="column-list">
                    ${columns.map(col => `
                        <label class="column-checkbox">
                            <input type="checkbox" value="${col}" checked onchange="toggleColumn('${col}', this.checked)">
                            <span>${col}</span>
                        </label>
                    `).join('')}
                </div>
            </div>
            
            ${rows.length > 0 ? `
            <div class="table-container">
                <table id="dataTable">
                    <thead>
                        <tr>
                            ${columns.map(key => `<th data-column="${key}">${key}</th>`).join('')}
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.map(row => `
                            <tr>
                                ${columns.map(key => `<td data-column="${key}">${row[key] !== null && row[key] !== undefined ? row[key] : '-'}</td>`).join('')}
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
            ` : `
            <div class="empty-state">
                <i data-lucide="inbox" style="width: 48px; height: 48px;"></i>
                <p>No data returned from query</p>
            </div>
            `}
        </div>
    </div>

    <script>
        // Initialize Lucide icons
        lucide.createIcons();
        
        // Helper to parse numeric values (handles currency symbols)
        function parseNumericValue(value) {
            if (typeof value === 'number') return value;
            if (typeof value === 'string') {
                const cleaned = value.replace(/[$€£¥₹,\\s]/g, '').trim();
                return parseFloat(cleaned);
            }
            return NaN;
        }
        
        const rawData = ${JSON.stringify(rows)};
        const chartData = ${JSON.stringify(chartData)};
        const statistics = ${JSON.stringify(statistics)};
        const allColumns = ${JSON.stringify(columns)};
        const numericColumns = ${JSON.stringify(numericColumns)};
        const defaultAnalyzeCol = ${JSON.stringify(defaultAnalyzeColumn)};
        
        let currentChart = null;
        let currentType = '${detectedType}';
        let visibleColumns = new Set(allColumns);
        let selectedAnalyticsColumn = defaultAnalyzeCol;

        // Render analytics for selected column
        function renderAnalytics(column) {
            const container = document.getElementById('analyticsContainer');
            if (!container || !column || !statistics[column]) return;
            
            const stats = statistics[column];
            const values = stats.values || [];
            
            // Generate insights
            const insights = [];
            
            if (stats.trend === 'increasing') {
                insights.push({
                    type: 'success',
                    icon: 'trending-up',
                    title: 'Upward Trend Detected',
                    desc: 'Values show a consistent increasing pattern over the dataset.'
                });
            } else if (stats.trend === 'decreasing') {
                insights.push({
                    type: 'warning',
                    icon: 'trending-down',
                    title: 'Downward Trend Detected',
                    desc: 'Values show a consistent decreasing pattern. Consider investigating.'
                });
            }
            
            if (stats.anomalies > 0) {
                insights.push({
                    type: 'danger',
                    icon: 'alert-triangle',
                    title: stats.anomalies + ' Anomal' + (stats.anomalies === 1 ? 'y' : 'ies') + ' Detected',
                    desc: 'Found values that deviate more than 2 standard deviations from the mean.'
                });
            }
            
            if (stats.drops > 0) {
                insights.push({
                    type: 'warning',
                    icon: 'arrow-down-circle',
                    title: stats.drops + ' Significant Drop' + (stats.drops === 1 ? '' : 's'),
                    desc: 'Detected decreases greater than 20% between consecutive values.'
                });
            }
            
            if (stats.spikes > 0) {
                insights.push({
                    type: 'info',
                    icon: 'arrow-up-circle',
                    title: stats.spikes + ' Spike' + (stats.spikes === 1 ? '' : 's') + ' Detected',
                    desc: 'Found increases greater than 50% between consecutive values.'
                });
            }
            
            if (stats.cv > 50) {
                insights.push({
                    type: 'warning',
                    icon: 'activity',
                    title: 'High Variability',
                    desc: 'Coefficient of Variation is ' + stats.cv.toFixed(1) + '%, indicating high data dispersion.'
                });
            } else if (stats.cv < 10) {
                insights.push({
                    type: 'success',
                    icon: 'check-circle',
                    title: 'Stable Values',
                    desc: 'Low variability (CV: ' + stats.cv.toFixed(1) + '%) suggests consistent data.'
                });
            }
            
            const trendClass = stats.trend === 'increasing' ? 'up' : stats.trend === 'decreasing' ? 'down' : 'stable';
            const trendIcon = stats.trend === 'increasing' ? 'trending-up' : stats.trend === 'decreasing' ? 'trending-down' : 'minus';
            
            container.innerHTML = \`
                <div class="analytics-dashboard">
                    <div class="analytics-card">
                        <div class="analytics-card-header">
                            <div class="analytics-card-icon purple">
                                <i data-lucide="sigma" style="width: 20px; height: 20px;"></i>
                            </div>
                            <div>
                                <div class="analytics-card-title">Total Sum</div>
                                <div class="analytics-card-value">\${formatNumber(stats.sum)}</div>
                            </div>
                        </div>
                        <div class="analytics-card-footer">
                            <div><span class="analytics-label">Count:</span> <span class="analytics-value">\${stats.count}</span></div>
                            <div class="trend-badge \${trendClass}">
                                <i data-lucide="\${trendIcon}" style="width: 12px; height: 12px;"></i>
                                \${stats.trend}
                            </div>
                        </div>
                    </div>
                    
                    <div class="analytics-card">
                        <div class="analytics-card-header">
                            <div class="analytics-card-icon pink">
                                <i data-lucide="calculator" style="width: 20px; height: 20px;"></i>
                            </div>
                            <div>
                                <div class="analytics-card-title">Average</div>
                                <div class="analytics-card-value">\${formatNumber(stats.avg)}</div>
                            </div>
                        </div>
                        <div class="analytics-card-footer">
                            <div><span class="analytics-label">Median:</span> <span class="analytics-value">\${formatNumber(stats.median)}</span></div>
                            <div><span class="analytics-label">Std Dev:</span> <span class="analytics-value">\${formatNumber(stats.stdDev)}</span></div>
                        </div>
                    </div>
                    
                    <div class="analytics-card">
                        <div class="analytics-card-header">
                            <div class="analytics-card-icon blue">
                                <i data-lucide="arrow-down-up" style="width: 20px; height: 20px;"></i>
                            </div>
                            <div>
                                <div class="analytics-card-title">Range</div>
                                <div class="analytics-card-value">\${formatNumber(stats.range)}</div>
                            </div>
                        </div>
                        <div class="analytics-card-footer">
                            <div><span class="analytics-label">Min:</span> <span class="analytics-value">\${formatNumber(stats.min)}</span></div>
                            <div><span class="analytics-label">Max:</span> <span class="analytics-value">\${formatNumber(stats.max)}</span></div>
                        </div>
                    </div>
                    
                    <div class="analytics-card">
                        <div class="analytics-card-header">
                            <div class="analytics-card-icon green">
                                <i data-lucide="percent" style="width: 20px; height: 20px;"></i>
                            </div>
                            <div>
                                <div class="analytics-card-title">Percentiles</div>
                                <div class="analytics-card-value">IQR: \${formatNumber(stats.iqr)}</div>
                            </div>
                        </div>
                        <div class="analytics-card-footer">
                            <div><span class="analytics-label">P25:</span> <span class="analytics-value">\${formatNumber(stats.p25)}</span></div>
                            <div><span class="analytics-label">P75:</span> <span class="analytics-value">\${formatNumber(stats.p75)}</span></div>
                        </div>
                    </div>
                </div>
                
                \${insights.length > 0 ? \`
                <div class="insights-panel">
                    <div class="insights-title">
                        <i data-lucide="lightbulb" style="width: 18px; height: 18px;"></i>
                        AI Insights for "\${column}"
                    </div>
                    \${insights.map(insight => \`
                        <div class="insight-item">
                            <div class="insight-icon \${insight.type}">
                                <i data-lucide="\${insight.icon}" style="width: 16px; height: 16px;"></i>
                            </div>
                            <div class="insight-content">
                                <h4>\${insight.title}</h4>
                                <p>\${insight.desc}</p>
                            </div>
                        </div>
                    \`).join('')}
                </div>
                \` : ''}
            \`;
            
            // Re-initialize icons for dynamic content
            lucide.createIcons();
        }
        
        function selectColumn(column) {
            selectedAnalyticsColumn = column;
            
            // Update pill states
            document.querySelectorAll('.column-pill').forEach(pill => {
                pill.classList.remove('active');
                if (pill.dataset.column === column) {
                    pill.classList.add('active');
                }
            });
            
            renderAnalytics(column);
        }
        
        function formatNumber(num) {
            if (typeof num === 'string') num = parseFloat(num);
            if (isNaN(num)) return '-';
            if (Math.abs(num) >= 1000000) return (num / 1000000).toFixed(2) + 'M';
            if (Math.abs(num) >= 1000) return (num / 1000).toFixed(2) + 'K';
            return num.toFixed(2);
        }

        function createChart(type) {
            const ctx = document.getElementById('myChart');
            if (!ctx) return;
            
            if (currentChart) {
                currentChart.destroy();
            }

            const config = {
                type: type,
                data: chartData,
                options: {
                    responsive: true,
                    maintainAspectRatio: true,
                    plugins: {
                        legend: {
                            display: true,
                            position: 'top',
                            labels: {
                                color: '#94a3b8',
                                font: { size: 12, weight: '600' },
                                padding: 20,
                                usePointStyle: true
                            }
                        }
                    },
                    scales: type === 'pie' || type === 'doughnut' || type === 'radar' ? {} : {
                        y: {
                            beginAtZero: true,
                            ticks: { color: '#64748b' },
                            grid: { color: '#334155' }
                        },
                        x: {
                            ticks: { color: '#64748b' },
                            grid: { color: '#334155' }
                        }
                    }
                }
            };

            currentChart = new Chart(ctx, config);
        }

        function changeChartType(type) {
            currentType = type;
            createChart(type);
            
            document.querySelectorAll('.chart-controls .btn').forEach(btn => {
                btn.classList.remove('active');
            });
            document.getElementById('btn-' + type)?.classList.add('active');
        }

        function toggleColumnSelector() {
            const selector = document.getElementById('columnSelector');
            selector.style.display = selector.style.display === 'none' ? 'block' : 'none';
        }

        function toggleColumn(column, visible) {
            if (visible) {
                visibleColumns.add(column);
            } else {
                visibleColumns.delete(column);
            }
            
            document.querySelectorAll('[data-column="' + column + '"]').forEach(el => {
                el.style.display = visible ? '' : 'none';
            });
        }

        function exportToCSV() {
            const visibleCols = Array.from(visibleColumns);
            let csv = visibleCols.join(',') + '\\n';
            
            rawData.forEach(row => {
                const values = visibleCols.map(col => {
                    const val = row[col];
                    if (val === null || val === undefined) return '';
                    if (typeof val === 'string' && (val.includes(',') || val.includes('"'))) {
                        return '"' + val.replace(/"/g, '""') + '"';
                    }
                    return val;
                });
                csv += values.join(',') + '\\n';
            });
            
            downloadFile(csv, 'query_results_' + Date.now() + '.csv', 'text/csv');
        }

        function exportToJSON() {
            const visibleCols = Array.from(visibleColumns);
            const filtered = rawData.map(row => {
                const obj = {};
                visibleCols.forEach(col => obj[col] = row[col]);
                return obj;
            });
            
            downloadFile(JSON.stringify(filtered, null, 2), 'query_results_' + Date.now() + '.json', 'application/json');
        }
        
        function downloadFile(content, filename, type) {
            const blob = new Blob([content], { type });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            window.URL.revokeObjectURL(url);
        }

        // Initialize
        ${rows.length > 0 ? 'createChart(currentType);' : ''}
        ${numericColumns.length > 0 ? 'renderAnalytics(selectedAnalyticsColumn);' : ''}
    </script>
</body>
</html>
  `;
}

/**
 * Main function to visualize query results
 */
export async function visualizeQuery(connectionConfig, query, chartType = null, analyzeColumn = null) {
  try {
    console.log(chalk.cyan('📊 Executing query...'));
    const rows = await executeQuery(connectionConfig, query);
    
    console.log(chalk.green(`✅ Query executed successfully. Rows: ${rows.length}`));
    
    if (analyzeColumn) {
      console.log(chalk.cyan(`🎯 Analyzing column: ${analyzeColumn}`));
    }
    
    const html = generateHTML(rows, query, chartType, analyzeColumn);
    const tempFile = path.join(os.tmpdir(), `query-viz-${Date.now()}.html`);
    
    fs.writeFileSync(tempFile, html);
    console.log(chalk.cyan(`📈 Opening visualization in browser...`));
    
    await open(tempFile);
    
    return { rows, tempFile };
  } catch (error) {
    console.error(chalk.red(`❌ Error: ${error.message}`));
    throw error;
  }
}
