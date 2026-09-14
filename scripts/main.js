import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let P = globalThis.__GSPB__;
if (!P || !P.root) {
  const fs = require('node:fs');
  const path = require('node:path');
  const fallbackParams = path.join(process.env.HOME || '', '.cache/gspb-AI/params.json');
  if (fs.existsSync(fallbackParams)) {
    try {
      P = JSON.parse(fs.readFileSync(fallbackParams, 'utf8'));
    } catch (e) {}
  }
}

if (!P || !P.root) {
  console.error('gspb: 请通过 bin/gspb 运行');
  process.exit(2);
}

try {
  const session = require(P.root + '/scripts/lib/session.js');

  if (P.mode === 'login') {
    const { getTaskAndPage, ensureLogin } = session;
    const { task, page } = await getTaskAndPage();
    await ensureLogin(task, page, { ...P, interactiveOnly: true });
    process.exit(0);
  } else if (P.mode === 'plan') {
    await session.runPlan(P);
  } else if (P.mode === 'fill') {
    await session.runFill(P);
  } else if (P.mode === 'verify') {
    await session.runVerify(P);
  } else {
    console.error(`gspb: 未知运行模式 [${P.mode}]`);
    process.exit(2);
  }
} catch (err) {
  console.error(`gspb: ${err.message || err}`);
  process.exit(1);
}
