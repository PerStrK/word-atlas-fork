import { Fragment, useCallback, useEffect, useState } from "react";
import { apiGet, apiPost, auth, login, logout, register, useAuth } from "../lib/auth";
import { syncAfterLogin, syncNow } from "../lib/sync";
import { toast } from "../ui/Toast";

export function AccountPanel() {
  const { user, syncState, registerOpen } = useAuth();
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const doLogin = async () => {
    setErr("");
    setBusy(true);
    try {
      await login(name.trim(), pw);
      setPw("");
      toast(`欢迎回来，${name.trim()}`);
      await syncAfterLogin();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "登录失败。");
    } finally {
      setBusy(false);
    }
  };
  const doRegister = async () => {
    setErr("");
    setBusy(true);
    try {
      await register(name.trim(), pw);
      setPw("");
      toast("注册成功，已自动登录");
      await syncAfterLogin();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "注册失败。");
    } finally {
      setBusy(false);
    }
  };
  const doLogout = async () => {
    await logout();
    toast("已退出登录。本机的学习记录会保留，登录后继续同步。");
  };

  return (
    <section className="panel acct">
      <h3 className="eyebrow">账号与同步</h3>
      {user ? (
        <div className="acct-body">
          <p>
            已登录：<b>{user.username}</b>
            {user.role === "admin" && <span className="acct-badge">管理员</span>}
          </p>
          <p className="muted">
            {syncState === "syncing"
              ? "正在同步…"
              : syncState === "error"
                ? "同步失败（可能断网了）。恢复网络后点「立即同步」，本机记录不会丢。"
                : "进度已同步到服务器。换设备登录同一账号，就能接着学。多台设备同时学习时，以最后保存的为准。"}
          </p>
          <div className="acct-row">
            {syncState === "error" && (
              <button className="btn btn-ghost" onClick={() => void syncNow()}>
                立即同步
              </button>
            )}
            <button className="btn btn-ghost" onClick={() => void doLogout()}>
              退出登录
            </button>
          </div>
        </div>
      ) : (
        <div className="acct-body">
          <p className="muted">登录后，学习进度自动保存到服务器，换手机、换电脑都能接着学。不登录也可以用，进度只存在本机。</p>
          <div className="acct-form">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="账号（字母、数字或下划线）"
              autoComplete="username"
            />
            <input
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder="密码（至少 4 位）"
              autoComplete="current-password"
              onKeyDown={(e) => e.key === "Enter" && name.trim() && pw && void doLogin()}
            />
          </div>
          {err && <p className="warn-text">{err}</p>}
          <div className="acct-row">
            <button className="btn btn-primary" disabled={busy || !name.trim() || !pw} onClick={() => void doLogin()}>
              登录
            </button>
            {registerOpen ? (
              <button className="btn btn-ghost" disabled={busy || !name.trim() || !pw} onClick={() => void doRegister()}>
                注册新账号
              </button>
            ) : (
              <span className="muted">注册已关闭，需要账号请联系管理员。</span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

interface AdminUser {
  username: string;
  role: string;
  disabled: boolean;
  cards: number;
  units: number;
}

function UnitSetter({ username, units, total, onDone }: { username: string; units: number; total: number; onDone: () => void }) {
  const [n, setN] = useState(units);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setN(units);
  }, [units]);
  const apply = async () => {
    setBusy(true);
    try {
      const d = await apiPost("/admin/progress", { username, units: n });
      toast(`已把「${username}」设为学完 ${n} 个单元（共 ${d.cards} 个词）`);
      onDone();
    } catch (e) {
      toast(e instanceof Error ? e.message : "设置失败", "warn");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="acct-row admin-progress">
      <span className="muted">调整进度：已学完</span>
      <select value={n} onChange={(e) => setN(Number(e.target.value))} disabled={busy}>
        {Array.from({ length: total + 1 }, (_, i) => (
          <option key={i} value={i}>
            {i}
          </option>
        ))}
      </select>
      <span className="muted">个单元</span>
      <button className="btn btn-ghost" disabled={busy || n === units} onClick={() => void apply()}>
        设定进度
      </button>
    </div>
  );
}

export function AdminPanel() {
  const { user, registerOpen } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [unitTotal, setUnitTotal] = useState(9);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await apiGet("/admin/users");
      setUsers(d.users as AdminUser[]);
      if (typeof d.unitTotal === "number") setUnitTotal(d.unitTotal);
    } catch {
      /* not admin or offline */
    }
  }, []);

  useEffect(() => {
    if (user?.role === "admin") void load();
  }, [user, load]);

  if (!user || user.role !== "admin") return null;

  const setOpen = async (open: boolean) => {
    setBusy(true);
    try {
      await apiPost("/admin/register-open", { open });
      auth.setRegisterOpen(open);
      toast(open ? "注册已开放" : "注册已关闭");
    } catch (e) {
      toast(e instanceof Error ? e.message : "设置失败", "warn");
    } finally {
      setBusy(false);
    }
  };

  const act = async (username: string, action: string, password?: string) => {
    setBusy(true);
    try {
      await apiPost("/admin/user", { username, action, password });
      toast("已更新");
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "操作失败", "warn");
    } finally {
      setBusy(false);
    }
  };

  const resetPw = (username: string) => {
    const pw = window.prompt(`给「${username}」设置新密码（至少 4 位）：`);
    if (pw) void act(username, "reset", pw);
  };
  const del = (username: string) => {
    if (window.confirm(`确定删除账号「${username}」？他的学习进度会一起删除，无法恢复。`))
      void act(username, "delete");
  };

  return (
    <section className="panel acct">
      <h3 className="eyebrow">管理后台</h3>
      <div className="acct-body">
        <label className="field toggle">
          <b>开放注册</b>
          <input type="checkbox" role="switch" checked={registerOpen} disabled={busy} onChange={(e) => void setOpen(e.target.checked)} />
          <span className="switch" aria-hidden="true" />
        </label>
        <p className="muted">关闭后，新用户不能再自助注册账号（已有账号不受影响）。</p>
        <div className="admin-users">
          {users.map((u) => (
            <Fragment key={u.username}>
              <div className="admin-user">
                <div>
                  <b>{u.username}</b>
                  {u.role === "admin" && <span className="acct-badge">管理员</span>}
                  {u.disabled && <span className="acct-badge is-off">已停用</span>}
                  <small className="muted">
                    已学 {u.cards} 词 · 已学完 {u.units} 单元
                  </small>
                </div>
                {u.username !== user.username && (
                  <div className="acct-row">
                    {u.disabled ? (
                      <button className="btn btn-ghost" disabled={busy} onClick={() => void act(u.username, "enable")}>
                        启用
                      </button>
                    ) : (
                      <button className="btn btn-ghost" disabled={busy} onClick={() => void act(u.username, "disable")}>
                        停用
                      </button>
                    )}
                    <button className="btn btn-ghost" disabled={busy} onClick={() => resetPw(u.username)}>
                      重置密码
                    </button>
                    <button className="btn btn-ghost btn-danger" disabled={busy} onClick={() => del(u.username)}>
                      删除
                    </button>
                  </div>
                )}
              </div>
              <UnitSetter username={u.username} units={u.units} total={unitTotal} onDone={() => void load()} />
            </Fragment>
          ))}
        </div>
      </div>
    </section>
  );
}
