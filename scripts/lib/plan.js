'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { cleanDiagnosisOrOpName } = require('./clean.js');
const { genPatientName, genWindowDate, genInpatientId } = require('./idgen.js');

/**
 * 根据全量未满项与时间窗构建执行计划
 * @param {Array|Object} unmetInput 全量未满行列表 [{name, quota, done, gap, pct}, ...] 或 { disease: [...], operation: [...] }
 * @param {Object|string} windowInput 时间窗 {start, end} 或 '2026-08-01~2026-10-31'
 * @param {number|string} targetCount 目标录入数量（若未指定或 'full'，则填满全部缺口）
 * @param {Object} options 扩展选项 {dept, kind, rules, blacklist, usedIds, usedNames, allowAlpha, root}
 * @returns {Object} 计划对象
 */
function buildExecutionPlan(unmetInput = [], windowInput = {}, targetCount = null, options = {}) {
  let windowObj = { start: '', end: '' };
  if (typeof windowInput === 'string') {
    const parts = windowInput.split(/[~至到]/).map(s => s.trim());
    if (parts.length === 2) {
      windowObj = { start: parts[0], end: parts[1] };
    }
  } else if (windowInput && typeof windowInput === 'object') {
    windowObj = { start: windowInput.start || '', end: windowInput.end || '' };
  }

  const usedIds = options.usedIds || new Set();
  const usedNames = options.usedNames || new Set();
  const rules = options.rules || null;
  const blacklist = options.blacklist || null;
  const kind = options.kind || 'disease';

  let rows = [];
  if (Array.isArray(unmetInput)) {
    rows = unmetInput;
  } else if (unmetInput && typeof unmetInput === 'object') {
    const dis = (unmetInput.disease || []).map(r => ({ ...r, kind: 'disease' }));
    const op = (unmetInput.operation || []).map(r => ({ ...r, kind: 'operation' }));
    rows = [...dis, ...op];
  }

  const totalGap = rows.reduce((sum, r) => {
    const g = r.gap != null ? r.gap : Math.max(0, r.quota - (r.done || 0));
    return sum + g;
  }, 0);

  let quotaRemaining = (targetCount === null || targetCount === undefined || targetCount === 'full')
    ? totalGap
    : Math.min(Number(targetCount), totalGap);

  const items = [];

  for (const row of rows) {
    if (quotaRemaining <= 0) break;
    const rowGap = row.gap != null ? row.gap : Math.max(0, row.quota - (r.done || 0));
    const allocate = Math.min(rowGap, quotaRemaining);
    for (let i = 0; i < allocate; i++) {
      const seq = items.length + 1;
      const date = genWindowDate(windowObj.start, windowObj.end);
      const name = genPatientName(usedNames);
      const id = genInpatientId(usedIds, rules, blacklist, {
        allowAlpha: options.allowAlpha,
        root: options.root
      });
      const cleanName = cleanDiagnosisOrOpName(row.name);
      items.push({
        seq,
        kind: row.kind || kind,
        rowName: row.name,
        cleanedName: cleanName,
        date,
        name,
        id,
        diagOrOp: cleanName,
        completed: false
      });
    }
    quotaRemaining -= allocate;
  }

  return {
    planId: `plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
    dept: options.dept || '未指定科室',
    window: windowObj,
    totalItems: items.length,
    items
  };
}

/**
 * 渲染配额统计 Markdown 表格
 * @param {Array|Object} scan 扫描结果
 * @param {Object} plan buildExecutionPlan 生成的计划对象
 * @returns {string} Markdown 文本
 */
function renderQuotaSummary(scan, plan) {
  let disease = [];
  let operation = [];

  if (Array.isArray(scan)) {
    disease = scan.filter(r => r.kind !== 'operation');
    operation = scan.filter(r => r.kind === 'operation');
  } else if (scan && typeof scan === 'object') {
    disease = scan.disease || [];
    operation = scan.operation || [];
  }

  const lines = [];
  lines.push('### 规培轮转手册配额完成统计与补录计划');
  lines.push('');
  lines.push('| 类别 | 项目 | 应完成 | 已完成 | 本轮补满 | 完成后 |');
  lines.push('| :---: | :--- | :---: | :---: | :---: | :---: |');

  let disQuota = 0;
  let disDone = 0;
  let disGap = 0;

  for (const item of disease) {
    const q = item.quota || 0;
    const d = item.done || 0;
    const g = item.gap != null ? item.gap : Math.max(0, q - d);
    disQuota += q;
    disDone += d;
    disGap += g;
    const clean = cleanDiagnosisOrOpName(item.name);
    const label = clean !== item.name ? `${clean}（原始：${item.name}）` : item.name;
    lines.push(`| 病种 | ${label} | ${q} | ${d} | ${g} | 100% |`);
  }

  let opQuota = 0;
  let opDone = 0;
  let opGap = 0;

  for (const item of operation) {
    const q = item.quota || 0;
    const d = item.done || 0;
    const g = item.gap != null ? item.gap : Math.max(0, q - d);
    opQuota += q;
    opDone += d;
    opGap += g;
    const clean = cleanDiagnosisOrOpName(item.name);
    const label = clean !== item.name ? `${clean}（原始：${item.name}）` : item.name;
    lines.push(`| 操作 | ${label} | ${q} | ${d} | ${g} | 100% |`);
  }

  const totalQuota = disQuota + opQuota;
  const totalDone = disDone + opDone;
  const totalGap = disGap + opGap;

  lines.push(`| **小计** | **病种小计** | **${disQuota}** | **${disDone}** | **${disGap}** | **100%** |`);
  lines.push(`| **小计** | **操作小计** | **${opQuota}** | **${opDone}** | **${opGap}** | **100%** |`);
  lines.push(`| **合计** | **全科室合计** | **${totalQuota}** | **${totalDone}** | **${totalGap}** | **100%** |`);
  lines.push('');

  return lines.join('\n');
}

/**
 * 渲染终端 Markdown 预审明细表格
 * @param {Object} plan buildExecutionPlan 生成的计划对象
 * @returns {string} Markdown 文本
 */
function renderPlanMarkdown(plan) {
  const lines = [];
  lines.push(`### 规培手册待填数据预审明细表 (共 ${plan.totalItems} 条)`);
  lines.push(`科室: ${plan.dept} | 轮转时间窗: ${plan.window.start} ~ ${plan.window.end} | 计划生成时间: ${plan.createdAt}`);
  lines.push('');
  lines.push('| 序号 | 类别 | 主表定位项 | 注入表单名称 | 填入日期 | 患者姓名 | 生成住院号 |');
  lines.push('| :---: | :---: | :--- | :--- | :---: | :---: | :--- |');
  for (const it of plan.items) {
    const kindLabel = it.kind === 'operation' ? '操作' : '病种';
    const displayProject = it.cleanedName || it.rowName;
    lines.push(`| ${it.seq} | ${kindLabel} | ${it.rowName} | ${displayProject} | ${it.date} | ${it.name} | ${it.id} |`);
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * 保存预审计划至指定缓存目录，生成 plan.json 与 plan.csv
 * @param {Object} plan buildExecutionPlan 生成的计划对象
 * @param {string} cacheDir 缓存目录路径
 * @returns {Object} { jsonPath, csvPath }
 */
function savePlanArtifacts(plan, cacheDir) {
  if (!cacheDir) return { jsonPath: null, csvPath: null };
  fs.mkdirSync(cacheDir, { recursive: true });
  const jsonPath = path.join(cacheDir, 'plan.json');
  const csvPath = path.join(cacheDir, 'plan.csv');

  fs.writeFileSync(jsonPath, JSON.stringify(plan, null, 2) + '\n', 'utf8');

  const csvRows = ['序号,类别,原始项目,清洗后项目,填入日期,患者姓名,生成住院号,主要诊断或操作'];
  for (const it of plan.items) {
    const kindLabel = it.kind === 'operation' ? '操作' : '病种';
    const escapeCsv = (str) => {
      const s = String(str || '');
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };
    csvRows.push([
      it.seq,
      escapeCsv(kindLabel),
      escapeCsv(it.rowName),
      escapeCsv(it.cleanedName || it.rowName),
      escapeCsv(it.date),
      escapeCsv(it.name),
      escapeCsv(it.id),
      escapeCsv(it.diagOrOp || it.cleanedName || it.rowName)
    ].join(','));
  }
  fs.writeFileSync(csvPath, csvRows.join('\n') + '\n', 'utf8');
  return { jsonPath, csvPath };
}

module.exports = {
  buildExecutionPlan,
  renderQuotaSummary,
  renderPlanMarkdown,
  savePlanArtifacts
};
