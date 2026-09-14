'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  SCAN_ALL_DEPARTMENT_GAPS,
  CLICK_DESKTOP,
  READ_EDIT_INNER,
  CLOSE_INNER_DIALOG,
  READ_IDENTITY,
  IS_LOGIN_PAGE,
  READ_LIST_ROWS,
  CLICK_ROW_ACTION,
  FILL_EDIT_FORM,
  CLICK_INNER_SUBMIT,
  IS_INNER_DIALOG_OPEN,
  GET_ROW_DONE_COUNT
} = require('./scan.js');
const {
  buildExecutionPlan,
  renderQuotaSummary,
  renderPlanMarkdown,
  savePlanArtifacts
} = require('./plan.js');

const LOGIN_GUIDE_TEXT = `────────────────────────────────────────────────
需要你先在浏览器里登录（系统有安全防护，AI 无法代填账号密码）

1. 我已经为你打开了登录页：
   https://kygl.pkuszh.com.cn/_jp/
2. 在浏览器窗口里输入「用户名」+「密码」+「验证码」，点「登录」按钮
   （没有密码？点页面上的「手机号登录」，用短信验证码登录）
3. 登录成功、能看到系统首页后，回到这里告诉我「已登录」
────────────────────────────────────────────────`;

/**
 * 加载站点适配器配置
 * @param {string} root 根目录
 * @returns {Object} 配置对象
 */
function loadKyglConfig(root) {
  const r = root || path.resolve(__dirname, '../..');
  const p = path.join(r, 'adapters/kygl.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/**
 * 获取或创建 gspb-AI 任务空间及默认页面
 * @returns {Promise<{task: Object, page: Object}>}
 */
async function getTaskAndPage() {
  const spaces = await listTaskSpaces();
  const found = spaces.find(s => s.name === 'gspb-AI');
  let task = null;
  if (found) {
    if (found.ownership === 'agentDelegatedToUser') {
      task = await takeOverTaskSpace(found.id);
    } else {
      task = await taskSpace(found.id);
    }
  } else {
    task = await taskSpace('gspb-AI');
  }
  const page = task.page('p1');
  return { task, page };
}

/**
 * 引导与判定登录态
 * @param {Object} task 任务空间
 * @param {Object} page 页面对象
 * @param {Object} options 配置项 { root, interactiveOnly }
 * @returns {Promise<string>} 登录用户身份
 */
async function ensureLogin(task, page, options = {}) {
  const root = options.root || path.resolve(__dirname, '../..');
  const kygl = loadKyglConfig(root);
  const promptDir = path.join(process.env.HOME || '', '.cache/gspb-AI');
  fs.mkdirSync(promptDir, { recursive: true });
  const promptFile = path.join(promptDir, '.login_prompted');

  // 先探查当前页面状态，避免已有登录态时被重置
  let statusStr = await page.evaluate(IS_LOGIN_PAGE);
  let status = { onLogin: false, hasIdentity: false, identity: null, hasLogout: false };
  try { status = JSON.parse(statusStr); } catch (e) {}

  if (!status.hasIdentity && !status.hasLogout && !status.onLogin) {
    await page.goto(kygl.entryUrl);
    await page.waitForTimeout(2000);
    statusStr = await page.evaluate(IS_LOGIN_PAGE);
    try { status = JSON.parse(statusStr); } catch (e) {}
  }

  // 若在门户首页且含「退出登录」标记但无工号，进入学生转手册页获取身份
  if (!status.hasIdentity && status.hasLogout) {
    let listFlowUrl = kygl.listFlow;
    if (!listFlowUrl.startsWith('http')) {
      listFlowUrl = `https://${kygl.domain}${listFlowUrl}`;
    }
    await page.goto(listFlowUrl);
    await page.waitForTimeout(2000);
    const id = await page.evaluate(READ_IDENTITY);
    if (id) {
      status.hasIdentity = true;
      status.identity = id;
    }
  }

  if (status.hasIdentity && status.identity) {
    if (fs.existsSync(promptFile)) {
      try { fs.rmSync(promptFile, { force: true }); } catch (e) {}
    }
    console.log(`已登录：${status.identity}`);
    return status.identity;
  }

  // 未登录分支
  const curUrl = await page.evaluate(() => location.href);
  const alreadyPrompted = fs.existsSync(promptFile);

  console.log(LOGIN_GUIDE_TEXT);

  if (alreadyPrompted) {
    console.error(`仍未检测到登录态（当前 URL：${curUrl}），请确认已完成登录后重试。`);
    process.exit(1);
  } else {
    fs.writeFileSync(promptFile, new Date().toISOString(), 'utf8');
    await task.handOff();
    process.exit(0);
  }
}

/**
 * 解析并进入可写录入页
 * @param {Object} page 页面对象
 * @param {string} dept 目标科室
 * @param {string} listUrl 可选指定列表页 URL
 * @param {string} root 项目根目录
 * @param {string} expectedIdentity 期望的用户身份
 * @returns {Promise<{recordId: string, window: Object, identity: string, dept: string}>}
 */
async function resolveRecord(page, requestedDept, listUrl, root, expectedIdentity) {
  const kygl = loadKyglConfig(root);
  let targetUrl = listUrl || kygl.listFlow;
  if (!targetUrl.startsWith('http')) {
    targetUrl = `https://${kygl.domain}${targetUrl}`;
  }

  await page.goto(targetUrl);

  // 轮询列表行，新路由异步加载约 5~8s
  let allRows = [];
  const pollStart = Date.now();
  const pollTimeout = 20000;

  while (Date.now() - pollStart < pollTimeout) {
    const resStr = await page.evaluate(READ_LIST_ROWS);
    let res = null;
    try { res = JSON.parse(resStr); } catch (e) {}
    if (res && Array.isArray(res.rows) && res.rows.length > 0) {
      allRows = res.rows;
      break;
    }
    await page.waitForTimeout(1000);
  }

  if (!allRows || allRows.length === 0) {
    const curUrl = await page.evaluate(() => location.href);
    throw new Error(`未能获取学生轮转手册列表行（当前 URL: ${curUrl}）`);
  }

  const today = new Date().toISOString().slice(0, 10);
  let matchedRow = null;

  // 1. 若用户显式指定了具体科室：严格校验该科室是否尚未开始轮转、是否处于待提交状态
  if (requestedDept && requestedDept.trim()) {
    const target = requestedDept.trim();
    matchedRow = allRows.find(r => r.dept && r.dept.includes(target));
    if (!matchedRow) {
      const curUrl = await page.evaluate(() => location.href);
      throw new Error(`未在手册列表中找到科室 [${target}]（当前 URL: ${curUrl}）`);
    }

    const [start] = (matchedRow.window || '').split('~').map(s => s.trim());
    if (start && start > today) {
      throw new Error(`❌ 科室 [${matchedRow.dept}] 尚未开始轮转（时间窗: ${matchedRow.window}，当前时间: ${today}）。根据规培管理纪律，严禁提前补录未来科室！`);
    }

    if (!matchedRow.status || !matchedRow.status.includes('待提交')) {
      throw new Error(`❌ 科室 [${matchedRow.dept}] 当前状态为 [${matchedRow.status || '无状态'}]，非待提交状态，已停止。`);
    }
  } else {
    // 2. 若用户未显式指定科室（如直接触发「帮我补录轮转手册」）：智能按时间窗与状态过滤
    const active = [];
    const pastPending = [];
    const futureSkipped = [];

    for (const r of allRows) {
      if (!r.status || !r.status.includes('待提交')) continue;
      const [start, end] = (r.window || '').split('~').map(s => s.trim());
      if (!start || !end) continue;

      if (start > today) {
        // 严格剔除：尚未开始轮转的未来科室
        futureSkipped.push(r);
      } else if (today >= start && today <= end) {
        // 当前正在轮转
        active.push(r);
      } else if (end < today) {
        // 历史已过时间但仍待提交
        pastPending.push(r);
      }
    }

    const uniquePast = [...new Set(pastPending.map(d => d.dept))];
    if (active.length > 0) {
      matchedRow = active[0];
      console.log(`🎯 智能识别到当前正在轮转科室: [${matchedRow.dept}] (时间窗: ${matchedRow.window})`);
      if (uniquePast.length > 0) {
        console.log(`ℹ️ 提示：同时检测到已出科但待补录的历史科室: ${uniquePast.join('、')}（如需补录请指定 --dept <科室>）`);
      }
    } else if (pastPending.length > 0) {
      matchedRow = pastPending[0];
      console.log(`🎯 当前无在转科室，智能选定最近已出科待补录科室: [${matchedRow.dept}] (时间窗: ${matchedRow.window})`);
      if (uniquePast.length > 1) {
        console.log(`ℹ️ 其他待补录历史科室: ${uniquePast.slice(1).join('、')}（如需补录请指定 --dept <科室>）`);
      }
    } else {
      console.log(`✅ 检查完成：当前无需要补录的科室（未来尚未轮转的 ${futureSkipped.length} 个科室已自动排除，其余历史科室均已提交）。`);
      process.exit(0);
    }
  }

  const dept = matchedRow.dept;
  const windowObj = { start: '', end: '' };
  if (matchedRow.window) {
    const parts = matchedRow.window.split('~').map(s => s.trim());
    if (parts.length === 2) {
      windowObj.start = parts[0];
      windowObj.end = parts[1];
    }
  }
  // 点击行内操作按钮（查看 / 录入）
  const clickRes = await page.evaluate(`(${CLICK_ROW_ACTION})(${JSON.stringify(dept)})`);
  if (!clickRes || !clickRes.startsWith('clicked')) {
    throw new Error(`点击科室 [${dept}] 行内操作按钮失败：${clickRes}`);
  }

  // 提取 recordId 并跳转可写路由
  let recordId = null;
  const navStart = Date.now();
  while (Date.now() - navStart < 15000) {
    const curHash = await page.evaluate(() => location.hash);
    if (curHash.includes('/rotaconentflowprocess/')) {
      const m = curHash.match(/\/rotaconentflowprocess\/([A-Za-z0-9_-]+)$/);
      if (m && m[1] && m[1] !== 'list') {
        recordId = m[1];
        break;
      }
    } else if (curHash.includes('/RotaConentMineDept/')) {
      const m = curHash.match(/\/RotaConentMineDept\/([A-Za-z0-9_-]+)$/);
      if (m && m[1] && m[1] !== 'list') {
        recordId = m[1];
        break;
      }
    }
    await page.waitForTimeout(500);
  }

  if (!recordId) {
    const curUrl = await page.evaluate(() => location.href);
    throw new Error(`未能提取 recordId（当前 URL: ${curUrl}）`);
  }

  let writeUrl = `${kygl.detailWritePrefix}${recordId}`;
  if (!writeUrl.startsWith('http')) {
    writeUrl = `https://${kygl.domain}${writeUrl}`;
  }

  const currentHash = await page.evaluate(() => location.hash);
  if (!currentHash.includes(`/RotaConentMineDept/${recordId}`)) {
    await page.goto(writeUrl);
  }

  // 断言进入可写录入页
  const assertStart = Date.now();
  let pageValid = false;
  while (Date.now() - assertStart < 15000) {
    const check = await page.evaluate(() => {
      const tbs = Array.from(document.querySelectorAll('.vxe-table')).filter(tb => {
        const r = tb.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      const btns = Array.from(document.querySelectorAll('*')).filter(el => {
        return el.children.length === 0 && (el.textContent || '').trim() === '手动录入';
      });
      return { tables: tbs.length, manualBtns: btns.length };
    });
    if (check.tables >= 2 && check.manualBtns > 0) {
      pageValid = true;
      break;
    }
    await page.waitForTimeout(500);
  }

  if (!pageValid) {
    const curUrl = await page.evaluate(() => location.href);
    throw new Error(`未进入可写录入页（URL：${curUrl}）`);
  }

  // 校验当前身份
  const curIdentity = await page.evaluate(READ_IDENTITY);
  if (expectedIdentity && curIdentity && curIdentity !== expectedIdentity) {
    throw new Error(`身份不匹配（期望：${expectedIdentity}，实际：${curIdentity}）`);
  }

  return {
    recordId,
    window: windowObj,
    identity: curIdentity || expectedIdentity,
    dept
  };
}

/**
 * 计划构建流程：扫描缺口，生成并落盘预审表，输出 Markdown
 * @param {Object} P 运行参数
 */
async function runPlan(P) {
  const { task, page } = await getTaskAndPage();
  const identity = await ensureLogin(task, page, P);
  const resolved = await resolveRecord(page, P.dept, P.listUrl, P.root, identity);
  const dept = resolved.dept;
  const gapsStr = await page.evaluate(SCAN_ALL_DEPARTMENT_GAPS);
  let scan = null;
  try {
    scan = JSON.parse(gapsStr);
  } catch (e) {
    throw new Error(`解析缺口扫描结果失败: ${gapsStr}`);
  }

  if (!scan || scan.totalGap === 0) {
    console.log('该科室已全部 100% 达标，无需补录。');
    process.exit(0);
  }

  const staffId = (identity.match(/【(.*?)】/) || [])[1] || 'default';
  const cacheDir = path.join(process.env.HOME || '', '.cache/gspb-AI', staffId, resolved.recordId);
  fs.mkdirSync(cacheDir, { recursive: true });

  const progressPath = path.join(cacheDir, 'progress.json');
  const usedIds = new Set();
  const usedNames = new Set();
  if (fs.existsSync(progressPath)) {
    try {
      const prog = JSON.parse(fs.readFileSync(progressPath, 'utf8'));
      if (Array.isArray(prog.history)) {
        for (const h of prog.history) {
          if (h.id) usedIds.add(h.id);
          if (h.name) usedNames.add(h.name);
        }
      }
    } catch (e) {}
  }

  const windowInput = (P.window && P.window.trim()) ? P.window.trim() : resolved.window;
  const plan = buildExecutionPlan(scan, windowInput, 'full', {
    dept,
    usedIds,
    usedNames,
    root: P.root
  });

  // 输出顺序固定为汇总表在前、明细表在后
  console.log(renderQuotaSummary(scan, plan));
  console.log(renderPlanMarkdown(plan));

  const { jsonPath, csvPath } = savePlanArtifacts(plan, cacheDir);
  console.log(`计划文件: ${jsonPath}`);
  console.log(`对账清单: ${csvPath}`);
  console.log(`下一步: 审阅无误后运行  gspb fill --plan ${jsonPath}`);

  if (P.openCsv) {
    try {
      const { exec } = require('node:child_process');
      exec(`open "${csvPath}"`, () => {});
    } catch (e) {
      console.warn('打开 CSV 清单失败:', e.message);
    }
  }

  process.exit(0);
}

/**
 * 录入执行流程：顺序消费计划，填表、比对、提交、回检
 * @param {Object} P 运行参数
 */
async function runFill(P) {
  if (!P.planPath || !fs.existsSync(P.planPath)) {
    console.error('gspb: 缺少 --plan 参数或文件不存在，请先运行 gspb plan 生成计划');
    process.exit(2);
  }

  let plan = null;
  try {
    plan = JSON.parse(fs.readFileSync(P.planPath, 'utf8'));
  } catch (e) {
    console.error(`gspb: 读取计划文件失败: ${e.message}`);
    process.exit(2);
  }

  if (!plan.items || plan.items.some(it => !('cleanedName' in it))) {
    console.error('gspb: 计划文件版本过旧，请重新运行 gspb plan 生成');
    process.exit(2);
  }

  const { task, page } = await getTaskAndPage();
  const identity = await ensureLogin(task, page, P);
  const resolved = await resolveRecord(page, plan.dept, P.listUrl, P.root, identity);

  const staffId = (identity.match(/【(.*?)】/) || [])[1] || 'default';
  const cacheDir = path.dirname(P.planPath);
  const progressPath = path.join(cacheDir, 'progress.json');

  let filledCount = 0;
  for (const item of plan.items) {
    if (item.completed === true) continue;

    // 获取基线实际完成数
    const prevDone = await page.evaluate(`(${GET_ROW_DONE_COUNT})(${JSON.stringify(item.rowName)})`);

    // 点击手动录入
    const clickRes = await page.evaluate(`(${CLICK_DESKTOP})(${JSON.stringify(item.rowName)})`);
    if (clickRes !== 'clicked') {
      throw new Error(`点击 [${item.rowName}] 手动录入失败：${clickRes}`);
    }

    // 等待弹窗就绪
    let dialogReady = false;
    const dialogStart = Date.now();
    while (Date.now() - dialogStart < 10000) {
      const r = await page.evaluate(READ_EDIT_INNER);
      let parsed = null;
      try { parsed = JSON.parse(r); } catch (e) {}
      if (parsed && !parsed.error) {
        dialogReady = true;
        break;
      }
      await page.waitForTimeout(500);
    }
    if (!dialogReady) {
      throw new Error(`打开录入弹窗超时（项目：${item.rowName}）`);
    }

    // 填入四项必填
    const formData = {
      kind: item.kind,
      date: item.date,
      name: item.name,
      id: item.id,
      diagOrOp: item.diagOrOp || item.cleanedName || item.rowName
    };
    await page.evaluate(`(${FILL_EDIT_FORM})(${JSON.stringify(formData)})`);

    // 回读逐字比对
    const readBackStr = await page.evaluate(READ_EDIT_INNER);
    let readBack = {};
    try { readBack = JSON.parse(readBackStr); } catch (e) {}

    const mismatch = (readBack.name !== item.name) ||
                     (readBack.id !== item.id) ||
                     (readBack.date !== item.date) ||
                     (readBack.diagOrOp !== formData.diagOrOp);
    if (mismatch) {
      await page.evaluate(CLOSE_INNER_DIALOG);
      throw new Error(`表单回读校验不一致（项目：${item.rowName}，期望：${JSON.stringify(formData)}，实际：${readBackStr}）`);
    }

    // 打印进度
    if (item.seq === 1 || item.seq % 10 === 0 || item.seq === plan.totalItems) {
      const kindLabel = item.kind === 'operation' ? '操作' : '病种';
      console.log(`[${item.seq}/${plan.totalItems}] ${kindLabel} ${item.cleanedName} | ${item.name} ${item.id} ${item.date}`);
    }

    // 提交
    const subRes = await page.evaluate(CLICK_INNER_SUBMIT);
    if (subRes !== 'submitted') {
      throw new Error(`点击提交失败: ${subRes}`);
    }

    // 等待弹窗关闭
    const closeStart = Date.now();
    while (Date.now() - closeStart < 10000) {
      const isOpen = await page.evaluate(IS_INNER_DIALOG_OPEN);
      if (!isOpen) break;
      await page.waitForTimeout(500);
    }

    // 重新扫描校验实际完成例数 +1
    await page.waitForTimeout(1000);
    const newDone = await page.evaluate(`(${GET_ROW_DONE_COUNT})(${JSON.stringify(item.rowName)})`);
    if (!isNaN(prevDone) && !isNaN(newDone)) {
      if (newDone < prevDone + 1) {
        throw new Error(`提交后实际完成数未增加（项目：${item.rowName}，前值：${prevDone}，当前：${newDone}）`);
      }
    }

    // 标记完成并持久化
    item.completed = true;
    fs.writeFileSync(P.planPath, JSON.stringify(plan, null, 2) + '\n', 'utf8');

    let prog = { history: [] };
    if (fs.existsSync(progressPath)) {
      try { prog = JSON.parse(fs.readFileSync(progressPath, 'utf8')); } catch (e) {}
    }
    if (!prog.history) prog.history = [];
    prog.history.push({
      seq: item.seq,
      kind: item.kind,
      rowName: item.rowName,
      cleanedName: item.cleanedName,
      name: item.name,
      id: item.id,
      date: item.date,
      completedAt: new Date().toISOString()
    });
    fs.writeFileSync(progressPath, JSON.stringify(prog, null, 2) + '\n', 'utf8');
    filledCount++;
  }

  console.log(`补录完成：${plan.totalItems} 条`);
  process.exit(0);
}

/**
 * 校验与对账流程：重新扫描并输出达标情况
 * @param {Object} P 运行参数
 */
async function runVerify(P) {
  const { task, page } = await getTaskAndPage();
  const identity = await ensureLogin(task, page, P);
  const resolved = await resolveRecord(page, P.dept, P.listUrl, P.root, identity);

  const gapsStr = await page.evaluate(SCAN_ALL_DEPARTMENT_GAPS);
  let scan = null;
  try {
    scan = JSON.parse(gapsStr);
  } catch (e) {
    throw new Error(`解析缺口扫描结果失败: ${gapsStr}`);
  }

  console.log(renderQuotaSummary(scan, null));

  if (scan && scan.totalGap === 0) {
    console.log('验收通过：病种与操作均已 100% 达标。');
    if (P.close) {
      await task.finish({ keep: [] });
    }
    process.exit(0);
  } else {
    console.error(`验收未完全通过：剩余未满缺口共 ${scan ? scan.totalGap : '未知'} 条`);
    process.exit(1);
  }
}

module.exports = {
  loadKyglConfig,
  getTaskAndPage,
  ensureLogin,
  resolveRecord,
  runPlan,
  runFill,
  runVerify
};
