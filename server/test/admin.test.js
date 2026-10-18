'use strict';
/* =====================================================
   管理后台 API 测试(v4.1,真实 HTTP + 临时库,无测试框架)
   覆盖:静态页公开、401/403 守卫、用户列表附加信息、
   新建用户(2026-09-16:代建号不下发 Cookie、注册关闭时仍可用)、
   设/撤管理员(即时生效 + 最后一个管理员护栏)、
   重置密码(强制下线)、删除账户(级联清数据)。
   运行:node test/admin.test.js
   ===================================================== */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP_DB = path.join(os.tmpdir(), 'wefit-admin-test-' + process.pid + '.db');
try { fs.rmSync(TMP_DB, { force: true }); } catch (e) {}
process.env.DB_PATH = TMP_DB;

const { start } = require('../server');

let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('[PASS] ' + name); }
  else { failed++; console.log('[FAIL] ' + name + (detail ? '  →  ' + detail : '')); }
}

function makeJar(base) {
  const c = { sid: null };
  const req = async (method, p, body) => {
    const headers = {};
    if (c.sid) headers.cookie = 'wefit_sid=' + c.sid;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch(base + p, {
      method, headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const sc = r.headers.get('set-cookie');
    if (sc) { const m = sc.match(/wefit_sid=([^;]*)/); if (m) c.sid = m[1] || null; }
    let json = null; try { json = await r.clone().json(); } catch (e) {}
    const text = await r.text();
    return { status: r.status, json, text };
  };
  return { req, jar: c };
}

async function main() {
  const { server, port, db } = await start({ port: 0, quiet: true });
  const base = 'http://127.0.0.1:' + port;
  const anon = makeJar(base);

  /* T1 后台静态页公开 */
  let r = await anon.req('GET', '/admin');
  ok('T1 /admin→200 HTML(未登录可见,无数据)', r.status === 200 && r.text.includes('管理后台'), 'status=' + r.status);

  /* T2 守卫 */
  r = await anon.req('GET', '/api/admin/users');
  ok('T2a 未登录 admin API→401', r.status === 401);
  r = await anon.req('PUT', '/api/admin/role', { username: 'x', role: 'admin' });
  ok('T2b 未登录设角色→401', r.status === 401);

  /* 注册 alice(admin)与 bob(user) */
  const A = makeJar(base), B = makeJar(base);
  r = await A.req('POST', '/api/register', { username: 'alice', password: 'secret123', name: '陈' });
  ok('T3a alice 注册=admin', r.status === 201 && r.json.role === 'admin');
  r = await B.req('POST', '/api/register', { username: 'bob', password: 'hunter456', name: '阿鲍' });
  ok('T3b bob 注册=user', r.status === 201 && r.json.role === 'user');
  r = await B.req('GET', '/api/admin/users');
  ok('T3c 普通用户 admin API→403', r.status === 403 && r.json.error === 'admin_only');
  r = await B.req('PUT', '/api/system/library', { foods: [], exercises: [] });
  ok('T3d 回归:普通用户改系统库仍→403', r.status === 403);

  /* T3.5 种子防漂移：系统库种子与唯一数据源 seed-data.js 一致（v4.4 起直接 require 同源
   * 深比对——连 per100/muscle 数值一起防漂移；旧写法用正则从文件抠名字，与排版耦合，
   * 且只比对名字：当年两份拷贝的香蕉/苹果 f 数值漂移正是漏网形态） */
  const seedData = require(path.join(__dirname, '..', '..', 'public', 'js', 'seed-data.js'));
  r = await A.req('GET', '/api/system/library');
  const foodEq = seedData.SEED_FOODS.map(f => ({ name: f.name, per100: f.per100, src: seedData.FOOD_SRC_SYS }));
  const exEq = seedData.SEED_EXERCISES.map(e => ({ name: e.name, cat: e.cat, muscle: e.muscle, mode: e.mode }));
  const foodGot = r.json.foods.map(f => ({ name: f.name, per100: f.per100, src: f.src }));
  const exGot = r.json.exercises.map(e => ({ name: e.name, cat: e.cat, muscle: e.muscle, mode: e.mode }));
  ok('T3.5 系统库种子与 seed-data.js 一致(名称+营养值+来源 src+三件套)',
    r.status === 200 && JSON.stringify(foodEq) === JSON.stringify(foodGot)
      && JSON.stringify(exEq) === JSON.stringify(exGot),
    'foods ' + foodGot.length + ' vs ' + foodEq.length + ' / ex ' + exGot.length + ' vs ' + exEq.length);

  /* T3.6 v4.11 动作三件套白名单：cat/mode 非法值丢弃、muscle 取 SEED_MUSCLES、缺键保真 */
  r = await A.req('PUT', '/api/system/library', { foods: [], exercises: [
    { id: 'x1', name: '跑步', cat: '有氧', muscle: '全身', mode: 'time' },
    { id: 'x2', name: '瞎写条目', cat: '不存在的类', muscle: '胸', mode: 'nope' },
    { id: 'x3', name: '裸条目' },
    { id: 'x4', name: '旧课程条目', cat: '课程', muscle: '全身', mode: 'time' },
  ] });
  ok('T3.6a 系统库写入成功', r.status === 200, JSON.stringify(r.json).slice(0, 120));
  r = await A.req('GET', '/api/system/library');
  const sEx = (r.json && r.json.exercises) || [];
  ok('T3.6b 合法三件套原样保留', !!sEx[0] && sEx[0].cat === '有氧' && sEx[0].muscle === '全身' && sEx[0].mode === 'time', JSON.stringify(sEx[0]));
  ok('T3.6c 非法 cat/mode 丢弃、合法 muscle 保留', !!sEx[1] && !('cat' in sEx[1]) && sEx[1].muscle === '胸' && !('mode' in sEx[1]), JSON.stringify(sEx[1]));
  ok('T3.6d 缺三件套→键全缺(不凭空补默认值)', !!sEx[2] && !('cat' in sEx[2]) && !('muscle' in sEx[2]) && !('mode' in sEx[2]), JSON.stringify(sEx[2]));
  /* T3.6e 大类去掉「课程」：白名单不再收 cat='课程'（其余合法键照旧保留） */
  ok('T3.6e 「课程」已非法→cat 丢弃、muscle/mode 保留', !!sEx[3] && !('cat' in sEx[3]) && sEx[3].muscle === '全身' && sEx[3].mode === 'time', JSON.stringify(sEx[3]));
  /* 还原系统库，避免污染后续断言 */
  r = await A.req('PUT', '/api/system/library', {
    foods: seedData.SEED_FOODS.map((f, i) => ({ id: 'sf' + i, name: f.name, per100: f.per100, src: seedData.FOOD_SRC_SYS })),
    exercises: seedData.SEED_EXERCISES.map((e, i) => ({ id: 'se' + i, name: e.name, cat: e.cat, muscle: e.muscle, mode: e.mode })),
  });
  ok('T3.6e 系统库已还原', r.status === 200);
  /* 食物「营养来源」src 随系统库往返：喂进去的 src 原样落库（与 per100 同走 sanitizeLibrary 白名单） */
  r = await A.req('GET', '/api/system/library');
  const sF = (r.json && r.json.foods) || [];
  ok('T3.7 系统库保存往返保留食物来源 src',
    sF.length === seedData.SEED_FOODS.length && sF.every(f => f.src === seedData.FOOD_SRC_SYS),
    JSON.stringify(sF[0] || null));

  /* T4 列表与附加信息 */
  r = await A.req('GET', '/api/admin/users');
  const list = r.json && r.json.users || [];
  ok('T4a 列表含两账户+角色+昵称', r.status === 200 && list.length === 2
    && list[0].username === 'alice' && list[0].role === 'admin' && list[0].name === '陈'
    && list[1].username === 'bob' && list[1].role === 'user', JSON.stringify(list).slice(0, 220));
  /* bob 写一点数据,列表统计应跟进 */
  const bobState = await B.req('GET', '/api/state');
  const bobUid = Object.keys(bobState.json.data.users)[0];
  const tree = bobState.json.data;
  tree.body = undefined;
  tree.users[bobUid].body = [{ date: '2026-09-01', weight: 70 }, { date: '2026-09-02', weight: 69.5 }];
  tree.users[bobUid].meals = { '2026-09-02': { breakfast: [{ id: 'm1', name: '蛋', per100: { kcal: 143 }, g: 100 }], lunch: [], dinner: [], snack: [] } };
  r = await B.req('PUT', '/api/state', { rev: bobState.json.rev, data: tree });
  ok('T4b bob 写入成功', r.status === 200 && r.json.rev === 1);
  r = await A.req('GET', '/api/admin/users');
  const bob = r.json.users.find(u => u.username === 'bob');
  ok('T4c 列表附加信息(计数/rev)', bob.rev === 1 && bob.counts.body === 2 && bob.counts.meals === 1, JSON.stringify(bob));

  /* T5 角色流 */
  r = await A.req('PUT', '/api/admin/role', { username: 'ghost', role: 'admin' });
  ok('T5a 未知用户→404', r.status === 404);
  r = await A.req('PUT', '/api/admin/role', { username: 'alice', role: 'user' });
  ok('T5b 唯一管理员自撤→400 last_admin', r.status === 400 && r.json.error === 'last_admin');
  r = await A.req('PUT', '/api/admin/role', { username: 'bob', role: 'x' });
  ok('T5c 非法角色→400', r.status === 400 && r.json.error === 'invalid_role');
  r = await A.req('PUT', '/api/admin/role', { username: 'bob', role: 'admin' });
  ok('T5d 设 bob 为 admin', r.status === 200 && r.json.ok === true);
  r = await B.req('GET', '/api/admin/users');
  ok('T5e bob 旧会话即时可进后台', r.status === 200 && r.json.users.length === 2);
  r = await A.req('PUT', '/api/admin/role', { username: 'bob', role: 'user' });
  ok('T5f 撤 bob(还剩 alice)成功', r.status === 200);
  r = await B.req('GET', '/api/admin/users');
  ok('T5g bob 立即 403', r.status === 403);
  r = await B.req('GET', '/api/state');
  ok('T5h 被撤者用户端照常(数据还是自己的)', r.status === 200 && r.json.rev === 1);
  r = await A.req('PUT', '/api/admin/role', { username: 'bob', role: 'admin' });
  ok('T5i 再设 bob', r.status === 200);
  r = await A.req('PUT', '/api/admin/role', { username: 'alice', role: 'user' });
  ok('T5j 自撤成功(两 admin 其一自撤)且返回 self 标记', r.status === 200 && r.json.self === true);
  r = await A.req('GET', '/api/admin/users');
  ok('T5k alice 自撤后立即 403', r.status === 403);
  r = await A.req('GET', '/api/me');
  ok('T5l /me 的 role 已更新为 user', r.status === 200 && r.json.role === 'user');
  /* 恢复:bob 把 alice 升回来(自己现在是唯一 admin → alice 撤 bob 会被护栏挡住) */
  r = await B.req('PUT', '/api/admin/role', { username: 'alice', role: 'admin' });
  ok('T5m bob 恢复 alice 为 admin', r.status === 200);

  /* T6 重置密码 */
  r = await A.req('PUT', '/api/admin/password', { username: 'bob', password: '123' });
  ok('T6a 弱密码→400', r.status === 400 && r.json.error === 'invalid_password');
  r = await A.req('PUT', '/api/admin/password', { username: 'ghost', password: 'newpass1' });
  ok('T6b 未知用户→404', r.status === 404);
  r = await A.req('PUT', '/api/admin/password', { username: 'bob', password: 'newpass789' });
  ok('T6c 重置成功+kicked', r.status === 200 && r.json.kicked === true);
  r = await B.req('GET', '/api/state');
  ok('T6d bob 全部旧会话强制下线→401', r.status === 401);
  const B2 = makeJar(base);
  r = await B2.req('POST', '/api/login', { username: 'bob', password: 'hunter456' });
  ok('T6e 旧密码登录→401', r.status === 401);
  r = await B2.req('POST', '/api/login', { username: 'bob', password: 'newpass789' });
  ok('T6f 新密码可登录', r.status === 200);
  r = await B2.req('GET', '/api/state');
  ok('T6g 重新登录后数据仍在(rev 不丢)', r.status === 200 && r.json.rev === 1);

  /* T7 删除账户 */
  r = await A.req('DELETE', '/api/admin/users', { username: 'alice' });
  ok('T7a 删自己→400 cannot_delete_self', r.status === 400 && r.json.error === 'cannot_delete_self');
  r = await A.req('DELETE', '/api/admin/users', { username: 'ghost' });
  ok('T7b 未知用户→404', r.status === 404);
  /* bob 是唯一的其他账户;先撤 bob 再删,顺带验证 admin 也可删普通用户 */
  r = await A.req('DELETE', '/api/admin/users', { username: 'bob' });
  ok('T7c 删除 bob 成功', r.status === 200);
  r = await B2.req('GET', '/api/state');
  ok('T7d 被删者会话立即失效→401', r.status === 401);
  r = await A.req('GET', '/api/admin/users');
  ok('T7e 列表只剩 alice', r.status === 200 && r.json.users.length === 1);
  /* 级联清干净:重注册同名 bob,得到全新空库 */
  const B3 = makeJar(base);
  r = await B3.req('POST', '/api/register', { username: 'bob', password: 'fresh000', name: '新鲍勃' });
  ok('T7f 同名账户可重注册', r.status === 201);
  r = await B3.req('GET', '/api/state');
  ok('T7g 重注册即全新(旧记录未残留)', r.status === 200 && r.json.rev === 0
    && (r.json.data.users[Object.keys(r.json.data.users)[0]].body || []).length === 0, JSON.stringify(r.json).slice(0, 160));
  const uN = db.prepare('SELECT COUNT(*) n FROM users').get().n;
  const cN = db.prepare('SELECT COUNT(*) n FROM body_records').get().n;
  ok('T7h 库级联计数:users=2 且旧身体记录=0', uN === 2 && cN === 0, 'users=' + uN + ' body=' + cN);

  /* T8 新建用户(2026-09-16):管理员代建号,绕过 ALLOW_REGISTER */
  const sidBefore = A.jar.sid;
  r = await A.req('POST', '/api/admin/users', { username: 'carol', password: 'carol123', name: '卡' });
  ok('T8a 管理员新建用户→201 role=user', r.status === 201 && r.json.ok === true && r.json.role === 'user', JSON.stringify(r.json));
  ok('T8b 建号不下发会话 Cookie(管理员会话未被顶替)', A.jar.sid === sidBefore);
  r = await A.req('GET', '/api/me');
  ok('T8c 建号后管理员仍是自己', r.status === 200 && r.json.username === 'alice' && r.json.role === 'admin', JSON.stringify(r.json));
  const C = makeJar(base);
  r = await C.req('POST', '/api/login', { username: 'carol', password: 'carol123' });
  ok('T8d 新账户可登录', r.status === 200 && r.json.role === 'user');
  r = await C.req('GET', '/api/state');
  ok('T8e 新账户是全新空库(rev 0、个人库空、不拷系统库)', r.status === 200 && r.json.rev === 0
    && (r.json.data.users[Object.keys(r.json.data.users)[0]].body || []).length === 0, JSON.stringify(r.json).slice(0, 160));
  r = await A.req('POST', '/api/admin/users', { username: 'carol', password: 'carol123', name: '又卡' });
  ok('T8f 重名→409 username_taken', r.status === 409 && r.json.error === 'username_taken');
  r = await A.req('POST', '/api/admin/users', { username: 'eve', password: '123', name: '夏' });
  ok('T8g 弱密码→400 invalid_credentials', r.status === 400 && r.json.error === 'invalid_credentials', JSON.stringify(r.json));
  r = await A.req('POST', '/api/admin/users', { username: 'eve', password: 'eve12345', name: '' });
  ok('T8h 缺昵称→400', r.status === 400 && r.json.error === 'invalid_credentials');
  r = await A.req('POST', '/api/admin/users', { username: 'e', password: 'eve12345', name: '夏' });
  ok('T8i 非法用户名→400', r.status === 400, 'status=' + r.status);
  r = await anon.req('POST', '/api/admin/users', { username: 'mallory', password: 'mallory1', name: '马' });
  ok('T8j 未登录建号→401', r.status === 401);
  r = await B3.req('POST', '/api/admin/users', { username: 'mallory', password: 'mallory1', name: '马' });
  ok('T8k 普通用户建号→403 admin_only', r.status === 403 && r.json.error === 'admin_only');
  r = await A.req('POST', '/api/admin/users', { username: 'dora', password: 'dora1234', name: '多', role: 'admin' });
  ok('T8l role=admin 建号→201 role=admin', r.status === 201 && r.json.role === 'admin');
  const D = makeJar(base);
  r = await D.req('POST', '/api/login', { username: 'dora', password: 'dora1234' });
  ok('T8m 新建管理员可登录', r.status === 200 && r.json.role === 'admin');
  r = await D.req('GET', '/api/admin/users');
  ok('T8n 新建管理员可进后台', r.status === 200 && (r.json.users || []).length === 4, 'status=' + r.status + ' n=' + ((r.json.users || []).length));
  /* 注册已关时后台建号仍可用(公网部署正是这个组合) */
  process.env.ALLOW_REGISTER = '0';
  r = await anon.req('POST', '/api/register', { username: 'frank', password: 'frank123', name: '弗' });
  ok('T8o 注册关闭→用户端注册 403 register_closed', r.status === 403 && r.json.error === 'register_closed');
  r = await A.req('POST', '/api/admin/users', { username: 'frank', password: 'frank123', name: '弗' });
  ok('T8p 注册关闭时后台仍可建号', r.status === 201 && r.json.role === 'user', 'status=' + r.status + ' ' + JSON.stringify(r.json));
  delete process.env.ALLOW_REGISTER;
  /* T8q 后台页带上建号入口(结构断言:按钮/接口调用被删时测试才看得见) */
  r = await anon.req('GET', '/admin');
  ok('T8q /admin 含「新建用户」入口与建号接口调用', r.status === 200 && r.text.includes('＋ 新建用户') && r.text.includes("'POST', '/admin/users'"), 'status=' + r.status);

  console.log('---');
  console.log(failed === 0 ? '全部通过:' + passed + ' 项断言(管理后台 API)' : '通过 ' + passed + ',失败 ' + failed);
  server.close();
  try { fs.rmSync(TMP_DB, { force: true }); } catch (e) {}
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => { console.error('测试崩溃:', e); process.exit(1); });
