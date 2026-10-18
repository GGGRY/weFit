'use strict';
/* =====================================================
   公网部署安全（v4.21，真实 HTTP + 临时库，无测试框架）
   覆盖:
     A. 限速器语义(注入 now：窗口过期/封锁解锁/用户与 IP 两档/成功清零)
     B. Cookie Secure 判定(默认不加 / 伪头不信 / TRUST_PROXY+https 加 / 强制开 / 强制关)
     C. 登出清除 Cookie 属性与下发一致(含 Secure)
     D. ALLOW_REGISTER=0 关注册
     E. 登录失败限速在 HTTP 上的接线(401×N → 429 + Retry-After，锁定期间正确口令也 429，
        且不泄漏会话；同 IP 不同账户不受牵连；TRUST_PROXY 下按 XFF **末段**分桶——
        伪造前缀每次换值仍会触顶，守住「反代追加式写头不可被洗牌」这条)
   运行:node test/auth-https.test.js
   ===================================================== */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP_DB = path.join(os.tmpdir(), 'wefit-auth-https-test-' + process.pid + '.db');
try { fs.rmSync(TMP_DB, { force: true }); } catch (e) {}
process.env.DB_PATH = TMP_DB;
/* 限速参数必须在 require('../server') 之前设好（服务端登录限速是模块级单例） */
process.env.LOGIN_MAX_FAILS = '3';
process.env.LOGIN_MAX_FAILS_IP = '100';
process.env.LOGIN_WINDOW_MS = '60000';
process.env.LOGIN_BLOCK_MS = '60000';
delete process.env.TRUST_PROXY;
delete process.env.COOKIE_SECURE;
delete process.env.ALLOW_REGISTER;

const auth = require('../auth');
const { start } = require('../server');

let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('[PASS] ' + name); }
  else { failed++; console.log('[FAIL] ' + name + (detail ? '  →  ' + detail : '')); }
}

/* 发请求并回收原始 Set-Cookie（断言 Secure 只能看原始头，不能靠 cookie jar） */
async function req(base, method, p, body, headers) {
  const h = Object.assign({}, headers || {});
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(base + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null; try { json = await r.clone().json(); } catch (e) {}
  await r.text();
  return { status: r.status, json, setCookie: r.headers.get('set-cookie') || '', retryAfter: r.headers.get('retry-after') };
}

/* ---------- A. 限速器语义（注入 now，不靠 sleep） ---------- */
function unitLimiter() {
  const rules = [{ key: 'u:1.1.1.1|bob', max: 3 }, { key: 'i:1.1.1.1', max: 10 }];
  const lim = auth.createLoginLimiter({ windowMs: 1000, blockMs: 5000, maxPerUser: 3, maxPerIP: 10 });
  const t0 = 1000000;
  ok('A1 初始未锁', lim.check(rules, t0) === null);
  ok('A2 前两次失败不锁', lim.fail(rules, t0).length === 0 && lim.fail(rules, t0).length === 0);
  ok('A3 第三次失败即锁', lim.fail(rules, t0).length > 0);
  const c1 = lim.check(rules, t0 + 1000);
  ok('A4 封锁期内 check 返回 retryAfter', !!c1 && c1.retryAfter === 4, JSON.stringify(c1));
  ok('A5 封锁到期后放行', lim.check(rules, t0 + 6000) === null);

  /* 窗口过期 → 计数重新开始（不是永久累计） */
  const lim2 = auth.createLoginLimiter({ windowMs: 1000, blockMs: 5000, maxPerUser: 3, maxPerIP: 10 });
  lim2.fail(rules, t0); lim2.fail(rules, t0);
  ok('A6 窗口内 2 次未锁', lim2.check(rules, t0 + 500) === null);
  ok('A7 越过窗口后单次失败不继承旧计数', lim2.fail(rules, t0 + 2000).length === 0
    && lim2.check(rules, t0 + 2100) === null);

  /* IP 档：不同账户各自未触顶，但同一来源总数触顶即锁 */
  const lim3 = auth.createLoginLimiter({ windowMs: 60000, blockMs: 5000, maxPerUser: 3, maxPerIP: 2 });
  const rA = [{ key: 'u:2.2.2.2|alice', max: 3 }, { key: 'i:2.2.2.2', max: 2 }];
  const rB = [{ key: 'u:2.2.2.2|carol', max: 3 }, { key: 'i:2.2.2.2', max: 2 }];
  lim3.fail(rA, t0);
  ok('A8 IP 档第二次失败即锁（justBlocked 含 i:）', lim3.fail(rB, t0).includes('i:2.2.2.2'));
  ok('A9 第三个账户即使零失败也被 IP 档拦住', !!lim3.check(rB, t0 + 1));

  /* 成功清零：只清本组合，且清完不会再被旧失败判为已锁 */
  const lim4 = auth.createLoginLimiter({ windowMs: 60000, blockMs: 5000, maxPerUser: 2, maxPerIP: 100 });
  const r4 = [{ key: 'u:3.3.3.3|dave', max: 2 }, { key: 'i:3.3.3.3', max: 100 }];
  lim4.fail(r4, t0);
  lim4.reset(r4[0].key);
  ok('A10 成功后再次失败不立刻锁', lim4.fail(r4, t0).length === 0 && lim4.check(r4, t0) === null);

  /* 内存硬上限：同一窗口内涌入大量互不相同的 key 时按插入序淘汰，表不会无界增长 */
  const lim5 = auth.createLoginLimiter({ windowMs: 60000, blockMs: 5000, maxPerUser: 1, maxPerIP: 1000000 });
  const t5 = 2000000;
  for (let i = 0; i < lim5.caps.maxKeys + 200; i++) lim5.fail([{ key: 'u:1.1.1.1|u' + i, max: 1 }], t5);
  ok('A11 限速表条目数有硬上限（防止限速器自己变内存放大器）',
    lim5.size() <= lim5.caps.maxKeys, 'size=' + lim5.size());
}

async function main() {
  unitLimiter();

  const { server, port } = await start({ port: 0, quiet: true });
  const base = 'http://127.0.0.1:' + port;

  /* ---------- B. Cookie Secure 判定 ---------- */
  let r = await req(base, 'POST', '/api/register', { username: 'alice', password: 'secret123', name: '陈' });
  ok('B1 明文 HTTP 注册成功且 Cookie 不含 Secure（保局域网可用）',
    r.status === 201 && /wefit_sid=/.test(r.setCookie) && !/;\s*Secure/i.test(r.setCookie), r.setCookie);

  r = await req(base, 'POST', '/api/register', { username: 'bob', password: 'hunter456', name: '鲍' });
  ok('B2 第二个账户为普通用户', r.status === 201 && r.json.role === 'user');

  r = await req(base, 'POST', '/api/login', { username: 'bob', password: 'hunter456' },
    { 'X-Forwarded-Proto': 'https' });
  ok('B3 未开 TRUST_PROXY 时伪造 X-Forwarded-Proto 无效（仍不加 Secure）',
    r.status === 200 && !/;\s*Secure/i.test(r.setCookie), r.setCookie);

  process.env.TRUST_PROXY = '1';
  r = await req(base, 'POST', '/api/login', { username: 'bob', password: 'hunter456' },
    { 'X-Forwarded-Proto': 'https' });
  ok('B4 TRUST_PROXY=1 + https 头 → 加 Secure', r.status === 200 && /;\s*Secure/i.test(r.setCookie), r.setCookie);

  r = await req(base, 'POST', '/api/login', { username: 'bob', password: 'hunter456' },
    { 'X-Forwarded-Proto': 'http' });
  ok('B5 反代上报 http（明文）时不加 Secure', r.status === 200 && !/;\s*Secure/i.test(r.setCookie), r.setCookie);

  process.env.COOKIE_SECURE = '1';
  r = await req(base, 'POST', '/api/login', { username: 'bob', password: 'hunter456' });
  ok('B6 COOKIE_SECURE=1 强制加 Secure（即使请求是明文）',
    r.status === 200 && /;\s*Secure/i.test(r.setCookie), r.setCookie);

  process.env.COOKIE_SECURE = '0';
  r = await req(base, 'POST', '/api/login', { username: 'bob', password: 'hunter456' },
    { 'X-Forwarded-Proto': 'https' });
  ok('B7 COOKIE_SECURE=0 优先于 TRUST_PROXY 判定（强制不加）',
    r.status === 200 && !/;\s*Secure/i.test(r.setCookie), r.setCookie);

  /* ---------- C. 登出清除 Cookie 属性与下发一致 ---------- */
  process.env.COOKIE_SECURE = '1';
  r = await req(base, 'POST', '/api/login', { username: 'bob', password: 'hunter456' });
  const issued = r.setCookie;
  const sid = (issued.match(/wefit_sid=([^;]*)/) || [])[1];
  ok('C1 强制 Secure 下拿到安全会话', r.status === 200 && !!sid && /;\s*Secure/i.test(issued));
  r = await req(base, 'POST', '/api/logout', {}, { cookie: 'wefit_sid=' + sid, 'X-Forwarded-Proto': 'https' });
  ok('C2 登出清除 Cookie 同样带 Secure + Max-Age=0（否则浏览器可能删不掉）',
    r.status === 200 && /;\s*Secure/i.test(r.setCookie) && /Max-Age=0/.test(r.setCookie), r.setCookie);
  delete process.env.COOKIE_SECURE;
  delete process.env.TRUST_PROXY;

  /* ---------- D. 注册开关 ---------- */
  process.env.ALLOW_REGISTER = '0';
  r = await req(base, 'POST', '/api/register', { username: 'carol', password: 'carol123', name: '卡' });
  ok('D1 ALLOW_REGISTER=0 → 403 register_closed 且不下发 Cookie',
    r.status === 403 && r.json.error === 'register_closed' && !r.setCookie, 'status=' + r.status);
  r = await req(base, 'POST', '/api/login', { username: 'bob', password: 'hunter456' });
  ok('D2 关注册不影响已有账户登录', r.status === 200);
  process.env.ALLOW_REGISTER = '1';
  r = await req(base, 'POST', '/api/register', { username: 'carol', password: 'carol123', name: '卡' });
  ok('D3 恢复开放后注册正常', r.status === 201);
  delete process.env.ALLOW_REGISTER;

  /* ---------- E. 登录失败限速（HTTP 接线） ---------- */
  r = await req(base, 'POST', '/api/register', { username: 'dave', password: 'dave1234', name: '戴' });
  ok('E1 准备账户 dave', r.status === 201);
  const wrong = { username: 'dave', password: 'nope' };
  for (let i = 1; i <= 3; i++) {
    r = await req(base, 'POST', '/api/login', wrong);
    ok('E2' + i + ' 第 ' + i + ' 次错误口令→401', r.status === 401 && r.json.error === 'bad_credentials');
  }
  r = await req(base, 'POST', '/api/login', wrong);
  ok('E3 触顶后→429 + Retry-After，且不泄露账户是否存在',
    r.status === 429 && r.json.error === 'too_many_attempts' && Number(r.retryAfter) >= 1 && !r.setCookie,
    'status=' + r.status + ' retry=' + r.retryAfter + ' cookie=' + r.setCookie);
  r = await req(base, 'POST', '/api/login', { username: 'dave', password: 'dave1234' });
  ok('E4 封锁期内正确口令同样 429（锁的是组合，不是口令正确性）', r.status === 429, 'status=' + r.status);
  r = await req(base, 'POST', '/api/login', { username: 'alice', password: 'secret123' });
  ok('E5 其他账户不受牵连（锁按「来源+账户」分桶）', r.status === 200 && /wefit_sid=/.test(r.setCookie));

  /* E6 TRUST_PROXY=1 时按 XFF 分桶：换一个来源 IP 即不被前面的失败牵连 */
  process.env.TRUST_PROXY = '1';
  r = await req(base, 'POST', '/api/register', { username: 'erin', password: 'erin1234', name: '艾' });
  ok('E6 准备账户 erin', r.status === 201);
  for (let i = 1; i <= 3; i++) await req(base, 'POST', '/api/login', { username: 'erin', password: 'nope' }, { 'X-Forwarded-For': '9.9.9.9' });
  r = await req(base, 'POST', '/api/login', { username: 'erin', password: 'nope' }, { 'X-Forwarded-For': '9.9.9.9' });
  ok('E7 同一 XFF 触顶→429', r.status === 429, 'status=' + r.status);
  r = await req(base, 'POST', '/api/login', { username: 'erin', password: 'erin1234' }, { 'X-Forwarded-For': '8.8.8.8' });
  ok('E8 换来源 IP 后可正常登录（证明按 XFF 分桶而非全局限死）', r.status === 200, 'status=' + r.status);

  /* E9 XFF 伪造前缀（反代追加式写头）：前缀每次换值、末段不变 → 仍按末段分桶并触顶。
   * 这一条专守 P1：若服务端改回取「首段」，随机前缀会把限速桶洗牌，本断言立刻失败。 */
  for (let i = 1; i <= 3; i++) {
    await req(base, 'POST', '/api/login', { username: 'frank', password: 'nope' },
      { 'X-Forwarded-For': '10.0.0.' + i + ', 127.0.0.1' });
  }
  r = await req(base, 'POST', '/api/login', { username: 'frank', password: 'nope' },
    { 'X-Forwarded-For': '10.0.0.99, 127.0.0.1' });
  ok('E9 伪造前缀换值也能触顶（只认 XFF 末段）', r.status === 429, 'status=' + r.status);

  /* E10 末段不同 → 各自分桶（证明不是把前缀当成来源） */
  for (let i = 1; i <= 3; i++) {
    await req(base, 'POST', '/api/login', { username: 'gina', password: 'nope' },
      { 'X-Forwarded-For': '10.0.0.' + i + ', 203.0.113.7' });
  }
  r = await req(base, 'POST', '/api/login', { username: 'gina', password: 'nope' },
    { 'X-Forwarded-For': '10.0.0.98, 203.0.113.7' });
  ok('E10 末段不同的来源各自分桶（互不牵连）', r.status === 429, 'status=' + r.status);

  /* E11 超长用户名（登录名长度不限）：key 截断后仍能稳定累计并触顶 */
  const longName = 'z'.repeat(5000);
  for (let i = 1; i <= 3; i++) {
    await req(base, 'POST', '/api/login', { username: longName, password: 'nope' }, { 'X-Forwarded-For': '7.7.7.7' });
  }
  r = await req(base, 'POST', '/api/login', { username: longName, password: 'nope' }, { 'X-Forwarded-For': '7.7.7.7' });
  ok('E11 超长用户名同样被限速（限速 key 截断后一致）', r.status === 429, 'status=' + r.status);
  delete process.env.TRUST_PROXY;

  /* E12 限速不影响非登录端点 */
  r = await req(base, 'GET', '/api/health');
  ok('E12 /api/health 不受限速影响', r.status === 200 && r.json.ok === true);

  console.log('---');
  console.log(failed === 0 ? '全部通过:' + passed + ' 项断言(公网部署安全)' : '通过 ' + passed + ',失败 ' + failed);
  server.close();
  try { fs.rmSync(TMP_DB, { force: true }); } catch (e) {}
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => { console.error('测试崩溃:', e); process.exit(1); });
