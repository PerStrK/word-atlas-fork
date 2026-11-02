import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { datasetWordKeys, setActive, setEnabled, useDatasets } from "../lib/datasets";
import { useStore } from "../store/store";
import { toast } from "../ui/Toast";

export function DatasetsPanel() {
  const { list, enabled, active } = useDatasets();
  const { user } = useAuth();
  const cards = useStore((s) => s.progress.cards);
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    let live = true;
    void (async () => {
      const out: Record<string, number> = {};
      for (const d of list) {
        const keys = await datasetWordKeys(d);
        let n = 0;
        keys.forEach((k) => {
          if (cards[k]) n++;
        });
        out[d.id] = n;
      }
      if (live) setCounts(out);
    })();
    return () => {
      live = false;
    };
  }, [list, cards]);

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
        词库只是学习任务的范围不同：已学、已掌握的词在所有词库之间共享，学过一次就不会重复学。
        {user ? "启用选择会跟随账号保存，换设备一致。" : "登录后，启用选择会跟随账号保存；现在只存本机。"}
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
                  {d.desc} · 共 {d.count.toLocaleString()} 词 · 已学 {counts[d.id] ?? "…"} 词（共享）
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
