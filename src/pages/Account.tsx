import { Fragment, useCallback, useEffect, useState } from "react";
import { apiGet, apiPost, auth, login, logout, register, useAuth } from "../lib/auth";
import { datasetStages, useDatasets, type DatasetInfo, type DatasetStages } from "../lib/datasets";
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
  stages: Record<string, number>;
}

function StageSetter({
  username,
  info,
  stages,
  value,
  onDone,
}: {
  username: string;
  info: DatasetInfo;
  stages: DatasetStages | null;
  value: number;
  onDone: () => void;
}) {
  const [n, setN] = useState(value);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setN(value);
  }, [value, info.id]);
  const names = stages?.names ?? [];
  const isUnit = names.length > 0 && names[0].startsWith("Unit");
  const apply = async () => {
    setBusy(true);
    try {
      const d = await apiPost("/admin/progress", { username, dataset: info.id, stages: n });
      toast(
        isUnit
          ? `已把「${username}」在${info.name}设为学完 ${n} 个单元（共享池共 ${d.cards} 词）`
          : `已把「${username}」在${info.name}的进度设到 ${n === 0 ? "未开始" : names[n - 1]}（共享池共 ${d.cards} 词）`,
      );
      onDone();
    } catch (e) {
      toast(e instanceof Error ? e.message : "设置失败", "warn");
    } finally {
      setBusy(false);
    }
  };
  if (!stages || names.length === 0) return null;
  return (
    <div className="acct-row admin-progress">
      <span className="muted">{isUnit ? "调整进度：已学完" : "调整进度：已学到"}</span>
      <select value={n} onChange={(e) => setN(Number(e.target.value))} disabled={busy}>
        {Array.from({ length: names.length + 1 }, (_, i) => (
          <option key={i} value={i}>
            {isUnit ? i : i === 0 ? "未开始" : names[i - 1]}
          </option>
        ))}
      </select>
      {isUnit && <span className="muted">个单元</span>}
      <button className="btn btn-ghost" disabled={busy || n === value} onClick={() => void apply()}>
        设定进度
      </button>
    </div>
  );
}

export function AdminPanel() {
  const { user, registerOpen } = useAuth();
  const { list, active } = useDatasets();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [adjId, setAdjId] = useState("");
  const [stageMap, setStageMap] = useState<Record<string, DatasetStages>>({});
  const [busy, setBusy] = useState(false);

  const adjInfo = list.find((d) => d.id === (adjId || active)) ?? list[0];

  useEffect(() => {
    let live = true;
    void (async () => {
      const out: Record<string, DatasetStages> = {};
      for (const d of list) out[d.id] = await datasetStages(d);
      if (live) setStageMap(out);
    })();
    return () => {
      live = false;
    };
  }, [list]);

  const load = useCallback(async () => {
    try {
      const d = await apiGet("/admin/users");
      setUsers(d.users as AdminUser[]);
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
        {adjInfo && (
          <>
            <div className="acct-row">
              <span className="muted">调整进度针对词库：</span>
              <select value={adjInfo.id} onChange={(e) => setAdjId(e.target.value)}>
                {list.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <p className="muted">
              已学词是全词库共享的一份记录，这里按所选词库的阶段（单元 / 等级）设定；把某个词库调低时，被其他词库已完成阶段覆盖的词会保留。
            </p>
          </>
        )}
        <div className="admin-users">
          {users.map((u) => (
            <Fragment key={u.username}>
              <div className="admin-user">
                <div>
                  <b>{u.username}</b>
                  {u.role === "admin" && <span className="acct-badge">管理员</span>}
                  {u.disabled && <span className="acct-badge is-off">已停用</span>}
                  <small className="muted">
                    已学 {u.cards} 词
                    {list.map((d) => {
                      const st = stageMap[d.id];
                      if (!st || st.names.length === 0) return null;
                      const v = u.stages?.[d.id] ?? 0;
                      const label = st.names[0].startsWith("Unit")
                        ? `${v} 单元`
                        : v === 0
                          ? "未开始"
                          : st.names[v - 1];
                      return (
                        <span key={d.id}>
                          {" · "}
                          {d.name} {label}
                        </span>
                      );
                    })}
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
              {adjInfo && (
                <StageSetter
                  username={u.username}
                  info={adjInfo}
                  stages={stageMap[adjInfo.id] ?? null}
                  value={u.stages?.[adjInfo.id] ?? 0}
                  onDone={() => void load()}
                />
              )}
            </Fragment>
          ))}
        </div>
      </div>
    </section>
  );
}
