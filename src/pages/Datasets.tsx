import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { setActive, setEnabled, useDatasets } from "../lib/datasets";
import { toast } from "../ui/Toast";

function localCards(id: string): number {
  try {
    const raw = localStorage.getItem(`word-atlas:v2:${id}`);
    if (!raw) return 0;
    const p = JSON.parse(raw);
    return Object.keys(p.cards ?? {}).length;
  } catch {
    return 0;
  }
}

export function DatasetsPanel() {
  const { list, enabled, active } = useDatasets();
  const { user } = useAuth();
  const [, setTick] = useState(0);
  useEffect(() => {
    setTick((x) => x + 1);
  }, [active, user]);

  const toggle = (id: string, on: boolean) => {
    if (!on && enabled.length <= 1) {
      toast("至少要保留一个词库。", "warn");
      return;
    }
    setEnabled(on ? [...enabled, id] : enabled.filter((x) => x !== id));
  };

  return (
    <section className="panel">
      <h3 className="eyebrow">词库</h3>
      <p className="muted">
        {user
          ? "勾选要载入的词库，选择会跟随账号保存，换设备一致。每个词库的学习进度互相独立、分别同步。"
          : "勾选要载入的词库（登录后选择会跟随账号保存，现在只存本机）。每个词库的学习进度互相独立。"}
      </p>
      <div className="admin-users">
        {list.map((d) => {
          const on = enabled.includes(d.id);
          const isActive = d.id === active;
          return (
            <div className="admin-user" key={d.id}>
              <div>
                <b>{d.name}</b>
                {isActive && <span className="acct-badge">使用中</span>}
                <small className="muted">
                  {d.desc} · 共 {d.count.toLocaleString()} 词 · 已学 {localCards(d.id)} 词
                </small>
              </div>
              <div className="acct-row">
                <label className="acct-check">
                  <input type="checkbox" checked={on} onChange={(e) => toggle(d.id, e.target.checked)} />
                  启用
                </label>
                {on && !isActive && (
                  <button className="btn btn-ghost" onClick={() => setActive(d.id)}>
                    使用此词库
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
