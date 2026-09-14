'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CHINESE_SURNAMES = [
  '赵', '钱', '孙', '李', '周', '吴', '郑', '王', '冯', '陈',
  '褚', '卫', '蒋', '沈', '韩', '杨', '朱', '秦', '尤', '许',
  '何', '吕', '施', '张', '孔', '曹', '严', '华', '金', '魏',
  '陶', '姜', '戚', '谢', '邹', '喻', '柏', '水', '窦', '章',
  '云', '苏', '潘', '葛', '奚', '范', '彭', '郎', '鲁', '韦',
  '昌', '马', '苗', '凤', '花', '方', '俞', '任', '袁', '柳',
  '史', '唐', '费', '廉', '岑', '薛', '雷', '贺', '倪', '汤',
  '殷', '罗', '郝', '邬', '安', '常', '乐', '于', '时', '傅',
  '齐', '康', '伍', '余', '元', '卜', '顾', '孟', '黄', '穆',
  '萧', '尹', '姚', '邵', '汪', '祁', '毛', '戴', '宋', '梁'
];

const CHINESE_GIVEN_CHARS = [
  '伟', '芳', '娜', '秀', '英', '敏', '静', '丽', '强', '磊',
  '军', '洋', '勇', '艳', '杰', '娟', '涛', '明', '超', '霞',
  '平', '刚', '玲', '辉', '丹', '萍', '鹏', '华', '红', '玉',
  '晨', '曦', '宇', '浩', '泽', '远', '雅', '宏', '峰', '涵',
  '博', '欣', '怡', '轩', '涵', '俊', '悦', '琳', '睿', '凯',
  '昊', '辰', '婷', '琪', '瑶', '萱', '楠', '帆', '阳', '铭',
  '翔', '航', '毅', '恒', '飞', '龙', '威', '坤', '振', '扬',
  '嘉', '瑞', '鑫', '佳', '琦', '彤', '洁', '颖', '慧', '莹',
  '蕾', '薇', '璐', '晶', '倩', '妍', '茹', '婧', '茜', '琼',
  '岚', '芸', '菲', '萌', '宁', '珂', '雯', '舒', '仪', '婕'
];

/**
 * 随机生成患者姓名
 * @param {Set<string>} usedNames 已使用姓名集合
 * @returns {string} 患者姓名
 */
function genPatientName(usedNames = new Set()) {
  let attempts = 0;
  while (attempts++ < 1000) {
    const surname = CHINESE_SURNAMES[Math.floor(Math.random() * CHINESE_SURNAMES.length)];
    const isDouble = Math.random() > 0.25;
    let given = CHINESE_GIVEN_CHARS[Math.floor(Math.random() * CHINESE_GIVEN_CHARS.length)];
    if (isDouble) {
      given += CHINESE_GIVEN_CHARS[Math.floor(Math.random() * CHINESE_GIVEN_CHARS.length)];
    }
    const name = surname + given;
    if (!usedNames.has(name)) {
      usedNames.add(name);
      return name;
    }
  }
  return '患者' + Math.floor(Math.random() * 10000);
}

/**
 * 在轮转时间窗内随机生成日期 (YYYY-MM-DD)
 * @param {string} startDateStr 起始日期字符串
 * @param {string} endDateStr 结束日期字符串
 * @returns {string} 日期字符串
 */
function genWindowDate(startDateStr, endDateStr) {
  if (!startDateStr || !endDateStr) {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  }
  const parseD = s => {
    const parts = String(s).trim().replace(/\./g, '-').replace(/\//g, '-').split('-');
    if (parts.length >= 3) {
      return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    }
    return new Date(s);
  };
  const startD = parseD(startDateStr);
  const endD = parseD(endDateStr);
  const s = startD.getTime();
  const e = endD.getTime();
  if (isNaN(s) || isNaN(e) || s > e) {
    return startDateStr;
  }
  const targetTs = s + Math.random() * (e - s);
  const d = new Date(targetTs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

let cachedDefaultRules = null;
let cachedBlacklist = null;

/**
 * 加载默认号段规则
 * @param {Object} options 可选配置 { root: string }
 * @returns {Array} 规则数组
 */
function loadDefaultRules(options = {}) {
  if (cachedDefaultRules) return cachedDefaultRules;
  const root = options.root || path.resolve(__dirname, '../..');
  try {
    const rulesPath = path.join(root, 'adapters/id_rules.json');
    if (fs.existsSync(rulesPath)) {
      const data = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
      cachedDefaultRules = data.rules || data;
      return cachedDefaultRules;
    }
  } catch (e) {
    // ignore
  }

  // 18 个经验号段全量回退定义
  cachedDefaultRules = [
    { prefix: '9169', weight: 44, lens: { '9': 44 } },
    { prefix: '915', weight: 34, lens: { '9': 34 } },
    { prefix: '00', weight: 24, lens: { '11': 20, '12': 4 } },
    { prefix: '913', weight: 22, lens: { '9': 22 } },
    { prefix: '8965', weight: 21, lens: { '10': 21 } },
    { prefix: '912', weight: 20, lens: { '9': 20 } },
    { prefix: '914', weight: 18, lens: { '9': 18 } },
    { prefix: 'M', weight: 11, lens: { '8': 2, '9': 4, '10': 2, '11': 2, '12': 1 } },
    { prefix: '01', weight: 10, lens: { '11': 8, '12': 2 } },
    { prefix: '9168', weight: 7, lens: { '9': 7 } },
    { prefix: '032700', weight: 4, lens: { '11': 4 } },
    { prefix: '90', weight: 3, lens: { '11': 3 } },
    { prefix: '02', weight: 2, lens: { '11': 2 } },
    { prefix: '056900', weight: 2, lens: { '11': 2 } },
    { prefix: '09', weight: 2, lens: { '12': 2 } },
    { prefix: '662200', weight: 2, lens: { '11': 2 } },
    { prefix: '76', weight: 2, lens: { '11': 2 } },
    { prefix: 'J2012', weight: 2, lens: { '10': 2 } }
  ];
  return cachedDefaultRules;
}

/**
 * 加载默认黑名单（若不存在返回空 Set，不报错阻塞）
 * @returns {Set<string>} 黑名单集合
 */
function loadDefaultBlacklist() {
  if (cachedBlacklist) return cachedBlacklist;
  cachedBlacklist = new Set();
  const candidates = [
    process.env.GSPB_BLACKLIST,
    path.join(process.env.HOME || '', '.config/gspb-AI/blacklist.csv')
  ].filter(Boolean);

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf8');
        const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        for (const line of lines) {
          const id = line.split(',')[0].trim();
          if (id && id !== '门诊号码' && id !== '住院号') {
            cachedBlacklist.add(id);
          }
        }
        break;
      }
    } catch (e) {
      // ignore
    }
  }
  return cachedBlacklist;
}

/**
 * 基于聚合号段加权随机生成住院号/门诊号，全量杜绝单调序列与真实样本碰撞。
 * @param {Set<string>} usedSet 当前轮次已用 ID 集合
 * @param {Array|Object} rulesConfig 规则配置
 * @param {Set<string>} blacklistSet 防碰撞黑名单集合
 * @param {Object} options 可选配置 { allowAlpha: boolean, root: string }
 * @returns {string} 生成的住院号
 */
function genInpatientId(usedSet = new Set(), rulesConfig = null, blacklistSet = null, options = {}) {
  const used = (usedSet && typeof usedSet.has === 'function') ? usedSet : new Set();
  const rules = (rulesConfig && (rulesConfig.rules || Array.isArray(rulesConfig)))
    ? (rulesConfig.rules || rulesConfig)
    : loadDefaultRules(options);
  const blacklist = (blacklistSet && typeof blacklistSet.has === 'function')
    ? blacklistSet
    : loadDefaultBlacklist();

  const allowAlpha = options.allowAlpha !== false;
  const filteredRules = allowAlpha ? rules : rules.filter(r => /^\d+$/.test(r.prefix));
  const totalWeight = filteredRules.reduce((sum, r) => sum + r.weight, 0);

  let attempts = 0;
  while (attempts++ < 100) {
    // 1. 按权重选取规则
    let randWeight = Math.random() * totalWeight;
    let selectedRule = filteredRules[0];
    for (const r of filteredRules) {
      randWeight -= r.weight;
      if (randWeight <= 0) {
        selectedRule = r;
        break;
      }
    }

    // 2. 按规则的 lens 分布选取目标长度
    const lenEntries = Object.entries(selectedRule.lens);
    const ruleLensTotal = lenEntries.reduce((sum, [, count]) => sum + count, 0);
    let randLen = Math.random() * ruleLensTotal;
    let targetLen = parseInt(lenEntries[0][0], 10);
    for (const [lenStr, count] of lenEntries) {
      randLen -= count;
      if (randLen <= 0) {
        targetLen = parseInt(lenStr, 10);
        break;
      }
    }

    // 3. 补齐随机数字尾缀
    const prefix = selectedRule.prefix;
    const tailLen = targetLen - prefix.length;
    if (tailLen < 0) continue;

    let tail = '';
    for (let i = 0; i < tailLen; i++) {
      tail += Math.floor(Math.random() * 10);
    }
    const id = prefix + tail;

    // 4. 防碰撞过滤：不得在本次已生成集合中，不得在黑名单中
    if (used.has(id) || blacklist.has(id)) {
      continue;
    }

    used.add(id);
    return id;
  }
  throw new Error('Failed to generate collision-free inpatient ID within 100 attempts');
}

module.exports = {
  CHINESE_SURNAMES,
  CHINESE_GIVEN_CHARS,
  genPatientName,
  genWindowDate,
  loadDefaultRules,
  loadDefaultBlacklist,
  genInpatientId
};
