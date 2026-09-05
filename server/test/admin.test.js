'use strict';
/* =====================================================
   管理后台 API 测试(v4.1,真实 HTTP + 临时库,无测试框架)
   覆盖:静态页公开、401/403 守卫、用户列表附加信息、
   设/撤管理员(即时生效 + 最后一个管理员护栏)、
   重置密码(强制下线)、删除账户(级联清数据)。
   运行:node test/admin.test.js
   ===================================================== */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP_DB = path.join(os.tmpdir(), 'jjhealth-admin-test-' + process.pid + '.db');
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

  /* T3.5 种子防漂移：服务端系统库种子必须与前端 SEED_* 常量一致（两处双份维护） */
  const appSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'app.js'), 'utf8');
  const namesFrom = block => {
    const m = appSrc.match(new RegExp('const ' + block + ' = \\[([\\s\\S]*?)\\n\\];'));
    return m ? [...m[1].matchAll(/name:'([^']+)'/g)].map(x => x[1]) : null;
  };
  const fNames = namesFrom('SEED_FOODS'), eNames = namesFrom('SEED_EXERCISES');
  r = await A.req('GET', '/api/system/library');
  ok('T3.5 系统库种子与前端 SEED_* 一致', fNames && eNames && r.status === 200
    && JSON.stringify(fNames) === JSON.stringify(r.json.foods.map(f => f.name))
    && JSON.stringify(eNames) === JSON.stringify(r.json.exercises.map(e => e.name)),
    'foods ' + (fNames || []).length + ' vs ' + r.json.foods.length + ' / ex ' + (eNames || []).length + ' vs ' + r.json.exercises.length);

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

  console.log('---');
  console.log(failed === 0 ? '全部通过:' + passed + ' 项断言(管理后台 API)' : '通过 ' + passed + ',失败 ' + failed);
  server.close();
  try { fs.rmSync(TMP_DB, { force: true }); } catch (e) {}
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => { console.error('测试崩溃:', e); process.exit(1); });
