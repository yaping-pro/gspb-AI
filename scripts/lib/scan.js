'use strict';

/**
 * 页面内评估 IIFE 字符串集合（通过 ego-browser / page.evaluate 注入运行）
 */

// 桌面 vxe-table：全科室缺口双表统一扫描器，返回病种与操作全部未满项及汇总缺口。
const SCAN_ALL_DEPARTMENT_GAPS = `(() => {
  const tbs = Array.from(document.querySelectorAll('.vxe-table')).filter(tb => {
    const r = tb.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  const valid = tbs.filter(tb => {
    const headers = Array.from(tb.querySelectorAll('th')).map(h => (h.innerText || '').trim().replace(/\\s+/g, ''));
    const col = (k) => headers.findIndex(h => h.includes(k));
    return col('名称') >= 0 && col('应完成') >= 0 && col('实际完成') >= 0 && col('完成比例') >= 0;
  });
  if (valid.length === 0) return JSON.stringify({ error: 'no-table' });

  const extractUnmet = (tb) => {
    if (!tb) return [];
    const headers = Array.from(tb.querySelectorAll('th')).map(h => (h.innerText || '').trim().replace(/\\s+/g, ''));
    const col = (k) => headers.findIndex(h => h.includes(k));
    const iN = col('名称'), iQ = col('应完成'), iD = col('实际完成'), iP = col('完成比例');
    if ([iN, iQ, iD, iP].some(i => i < 0)) return [];
    const unmet = [];
    for (const tr of Array.from(tb.querySelectorAll('.vxe-body--row'))) {
      const tds = Array.from(tr.querySelectorAll('td')).map(td => (td.innerText || '').trim().replace(/\\s+/g, ' '));
      const name = tds[iN] || '';
      const quota = parseFloat(tds[iQ]);
      const done = parseFloat(tds[iD]) || 0;
      const pctM = (tds[iP] || '').match(/([\\d.]+)%/);
      const pct = pctM ? parseFloat(pctM[1]) : NaN;
      if (!name || isNaN(quota) || quota <= 0 || !(pct < 99.99)) continue;
      const gap = Math.max(0, quota - done);
      unmet.push({ name, quota, done, gap, pct });
    }
    return unmet;
  };

  const disease = extractUnmet(valid[0]);
  const operation = valid.length > 1 ? extractUnmet(valid[1]) : [];
  const totalDiseaseGap = disease.reduce((sum, r) => sum + r.gap, 0);
  const totalOperationGap = operation.reduce((sum, r) => sum + r.gap, 0);
  const totalGap = totalDiseaseGap + totalOperationGap;

  return JSON.stringify({
    disease,
    operation,
    totalDiseaseGap,
    totalOperationGap,
    totalGap
  });
})()`;

// 桌面：点指定行名的行内 手动录入（只开窗，不填）。
const CLICK_DESKTOP = `(name) => {
  for (const tr of Array.from(document.querySelectorAll('.vxe-body--row'))) {
    const tds = Array.from(tr.querySelectorAll('td')).map(td => (td.innerText || '').trim().replace(/\\s+/g, ' '));
    if (tds.some(c => c === name || c.includes(name))) {
      const btn = Array.from(tr.querySelectorAll('button')).find(b => (b.innerText || '').includes('手动录入'));
      if (btn) { btn.click(); return 'clicked'; }
      return 'btn-not-found';
    }
  }
  return 'row-not-found';
}`;

// list 页：按表头文字取目标科室行（时间窗/记录深链发现用），只读。
const SCAN_LIST = `(dept) => {
  const tb = document.querySelector('.vxe-table') || document.querySelector('table');
  if (!tb) return JSON.stringify({ error: 'no-table' });
  const headers = Array.from(tb.querySelectorAll('th')).map(h => (h.innerText || '').trim().replace(/\\s+/g, ''));
  const iDept = headers.findIndex(h => h.includes('轮转科室'));
  const iTime = headers.findIndex(h => h.includes('轮转时间'));
  const iStat = headers.findIndex(h => h.includes('审批'));
  const out = [];
  for (const tr of Array.from(tb.querySelectorAll('.vxe-body--row, tbody tr'))) {
    const tds = Array.from(tr.querySelectorAll('td')).map(td => (td.innerText || '').trim().replace(/\\s+/g, ' '));
    if ((tds[iDept] || '').includes(dept)) out.push({ dept: tds[iDept], window: tds[iTime], status: tds[iStat] });
  }
  return JSON.stringify(out);
}`;

// 桌面主表：点击指定行右侧的实际完成例数按钮，进入明细历史列表。
const ENTER_RECORDS_LIST = `(rowName) => {
  for (const tr of Array.from(document.querySelectorAll('.vxe-body--row'))) {
    const tds = Array.from(tr.querySelectorAll('td')).map(td => (td.innerText || '').trim().replace(/\\s+/g, ' '));
    if (tds.some(c => c === rowName || c.startsWith(rowName))) {
      const btn = Array.from(tr.querySelectorAll('button')).find(b => /^\\d+$/.test((b.innerText || '').trim()));
      if (btn) { btn.click(); return 'entered:' + btn.innerText.trim(); }
      return 'count-btn-missing';
    }
  }
  return 'row-not-found';
}`;

// 明细列表：按旧姓名或住院号定位 tr，点击该行内的 编辑 按钮。
const CLICK_ROW_EDIT = `(oldIdentifier) => {
  for (const tr of Array.from(document.querySelectorAll('tr'))) {
    const t = (tr.innerText || '');
    if (t.includes(oldIdentifier)) {
      const b = Array.from(tr.querySelectorAll('button')).find(x => (x.innerText || '').trim() === '编辑');
      if (!b) return 'no-edit-btn';
      b.scrollIntoView({ block: 'center' });
      b.focus();
      b.click();
      return 'clicked';
    }
  }
  return 'row-not-found';
}`;

// 明细表单：读取当前活动编辑弹窗的姓名与住院号。
const READ_EDIT_INNER = `(() => {
  let top = null;
  for (const d of Array.from(document.querySelectorAll('.v-dialog--active'))) {
    if (d.querySelector('input[placeholder=\"患者姓名\"]')) { top = d; break; }
  }
  if (!top) return JSON.stringify({ error: 'no-inner-dialog' });
  const g = ph => {
    const el = top.querySelector('input[placeholder=\"' + ph + '\"]');
    return el ? el.value : '';
  };
  return JSON.stringify({
    name: g('患者姓名'),
    id: g('住院号'),
    date: g('检查日期') || g('手术/操作日期'),
    diagOrOp: g('主要诊断') || g('手术/操作名称')
  });
})()`;

// 安全关闭：若内层编辑表单在提交后未自动关闭，仅关闭内层的 退出 按钮。
const CLOSE_INNER_DIALOG = `(() => {
  for (const d of Array.from(document.querySelectorAll('.v-dialog--active'))) {
    if (d.querySelector('input[placeholder=\"患者姓名\"]')) {
      const b = Array.from(d.querySelectorAll('button')).find(x => (x.innerText || '').trim() === '退出');
      if (b) { b.click(); return 'inner-closed'; }
    }
  }
  return 'no-inner-to-close';
})()`;

// 身份读取：遍历 div,span，返回首个匹配姓名+工号标记的文本
const READ_IDENTITY = `(() => {
  const re = /^[\\u4e00-\\u9fa5]{2,4}【[A-Za-z0-9_-]+】$/;
  for (const el of Array.from(document.querySelectorAll('div, span, p, a, b, strong'))) {
    const t = (el.textContent || '').trim();
    if (re.test(t)) {
      return t;
    }
  }
  return null;
})()`;

// 登录页判定：合并 onLogin 与 hasIdentity 求值
const IS_LOGIN_PAGE = `(() => {
  const onLogin = location.hash.includes('/login') || location.pathname.includes('/login');
  const re = /^[\\u4e00-\\u9fa5]{2,4}【[A-Za-z0-9_-]+】$/;
  let identity = null;
  for (const el of Array.from(document.querySelectorAll('div, span, p, a, b, strong'))) {
    const t = (el.textContent || '').trim();
    if (re.test(t)) {
      identity = t;
      break;
    }
  }
  const hasLogout = document.body ? document.body.innerText.includes('退出登录') : false;
  return JSON.stringify({
    onLogin,
    hasIdentity: Boolean(identity),
    identity,
    hasLogout
  });
})()`;

// 列表行读取：按表头定位列，返回全部行的科室、时间窗、审批状态及操作按钮
const READ_LIST_ROWS = `(() => {
  const tb = document.querySelector('.vxe-table') || document.querySelector('table');
  if (!tb) return JSON.stringify({ error: 'no-table', rows: [] });
  const headers = Array.from(tb.querySelectorAll('th')).map(h => (h.innerText || h.textContent || '').trim().replace(/\\s+/g, ''));
  const col = (k) => headers.findIndex(h => h.includes(k));
  const iDept = col('轮转科室');
  const iTime = col('轮转时间');
  const iStat = col('审批');
  const rows = [];
  for (const tr of Array.from(tb.querySelectorAll('.vxe-body--row, tbody tr'))) {
    const tds = Array.from(tr.querySelectorAll('td')).map(td => (td.innerText || td.textContent || '').trim().replace(/\\s+/g, ' '));
    if (tds.length === 0) continue;
    const dept = iDept >= 0 ? (tds[iDept] || '') : '';
    const window = iTime >= 0 ? (tds[iTime] || '') : '';
    const status = iStat >= 0 ? (tds[iStat] || '') : '';
    let actionLabel = '';
    const btns = Array.from(tr.querySelectorAll('button, a, span')).filter(el => {
      const txt = (el.innerText || el.textContent || '').trim();
      return txt === '查看' || txt === '录入';
    });
    if (btns.length > 0) {
      actionLabel = (btns[0].innerText || btns[0].textContent || '').trim();
    }
    rows.push({ rowText: tds, dept, window, status, actionLabel });
  }
  return JSON.stringify({ headers, rows });
})()`;

// 点击列表行对应的操作按钮（查看 / 录入）
const CLICK_ROW_ACTION = `(dept) => {
  const tb = document.querySelector('.vxe-table') || document.querySelector('table');
  if (!tb) return 'no-table';
  const headers = Array.from(tb.querySelectorAll('th')).map(h => (h.innerText || h.textContent || '').trim().replace(/\\s+/g, ''));
  const iDept = headers.findIndex(h => h.includes('轮转科室'));
  for (const tr of Array.from(tb.querySelectorAll('.vxe-body--row, tbody tr'))) {
    const tds = Array.from(tr.querySelectorAll('td')).map(td => (td.innerText || td.textContent || '').trim().replace(/\\s+/g, ' '));
    const match = iDept >= 0 ? (tds[iDept] || '').includes(dept) : tds.some(c => c.includes(dept));
    if (match) {
      const btn = Array.from(tr.querySelectorAll('button, a, span')).find(el => {
        const txt = (el.innerText || el.textContent || '').trim();
        return txt === '查看' || txt === '录入';
      });
      if (btn) {
        btn.click();
        return 'clicked:' + (btn.innerText || btn.textContent || '').trim();
      }
      return 'btn-not-found';
    }
  }
  return 'row-not-found';
}`;

// 填入活动编辑弹窗的四项必填
const FILL_EDIT_FORM = `(formData) => {
  let top = null;
  for (const d of Array.from(document.querySelectorAll('.v-dialog--active'))) {
    if (d.querySelector('input[placeholder=\"患者姓名\"]')) { top = d; break; }
  }
  if (!top) return JSON.stringify({ error: 'no-inner-dialog' });

  const setField = (ph, val) => {
    const el = top.querySelector('input[placeholder=\"' + ph + '\"]');
    if (!el) return false;
    el.focus();
    el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
    return true;
  };

  if (formData.kind === 'operation') {
    setField('手术/操作日期', formData.date);
    setField('患者姓名', formData.name);
    setField('住院号', formData.id);
    setField('手术/操作名称', formData.diagOrOp);
  } else {
    setField('检查日期', formData.date);
    setField('患者姓名', formData.name);
    setField('住院号', formData.id);
    setField('主要诊断', formData.diagOrOp);
  }
  return JSON.stringify({ success: true });
}`;

// 点击活动弹窗内的 提交 按钮
const CLICK_INNER_SUBMIT = `(() => {
  for (const d of Array.from(document.querySelectorAll('.v-dialog--active'))) {
    if (d.querySelector('input[placeholder=\"患者姓名\"]')) {
      const b = Array.from(d.querySelectorAll('button')).find(x => (x.innerText || '').trim() === '提交');
      if (b) { b.click(); return 'submitted'; }
      return 'submit-btn-not-found';
    }
  }
  return 'no-inner-dialog';
})()`;

// 检查活动弹窗是否仍处于打开状态
const IS_INNER_DIALOG_OPEN = `(() => {
  for (const d of Array.from(document.querySelectorAll('.v-dialog--active'))) {
    if (d.querySelector('input[placeholder=\"患者姓名\"]')) return true;
  }
  return false;
})()`;

// 获取指定主表行当前的 实际完成例数
const GET_ROW_DONE_COUNT = `(name) => {
  for (const tr of Array.from(document.querySelectorAll('.vxe-body--row'))) {
    const tds = Array.from(tr.querySelectorAll('td')).map(td => (td.innerText || '').trim().replace(/\\s+/g, ' '));
    if (tds.some(c => c === name || c.includes(name))) {
      const tb = tr.closest('.vxe-table');
      if (tb) {
        const headers = Array.from(tb.querySelectorAll('th')).map(h => (h.innerText || '').trim().replace(/\\s+/g, ''));
        const iD = headers.findIndex(h => h.includes('实际完成'));
        if (iD >= 0 && tds[iD]) {
          return parseFloat(tds[iD]);
        }
      }
    }
  }
  return NaN;
}`;

module.exports = {
  SCAN_ALL_DEPARTMENT_GAPS,
  CLICK_DESKTOP,
  SCAN_LIST,
  ENTER_RECORDS_LIST,
  CLICK_ROW_EDIT,
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
};
