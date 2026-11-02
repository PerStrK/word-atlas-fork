import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { setActive, setEnabled, useDatasets } from "../lib/datasets";
import { store } from "../store/store";

export function Onboarding() {
  const { list, enabled, active } = useDatasets();
  const [ds, setDs] = useState(active);
  const [goal, setGoal] = useState(10);
  const chosen = list.find((d) => d.id === ds) ?? list[0];
  const finish = () => {
    // The journey starts from the chosen dataset: enable it and make it the
    // active one, starting from its first word.
    if (chosen) {
      if (!enabled.includes(chosen.id)) setEnabled([...enabled, chosen.id]);
      setActive(chosen.id);
    }
    store.settings({ onboarded: true, startLevel: 0, dailyNew: goal });
  };
  return (
    <div className="onboard" role="dialog" aria-modal="true" aria-label="欢迎">
      <div className="onboard-card">
        <img className="onboard-art" src={`${import.meta.env.BASE_URL}brand/hero.webp`} alt="" />
        <div className="onboard-body">
          <p className="eyebrow">欢迎来到词光</p>
          <h1 className="display">
            {(chosen?.count ?? 0).toLocaleString()} 颗星，
            <br />
            等你一颗颗点亮。
          </h1>
          <fieldset>
            <legend>从哪个词库出发？</legend>
            <div className="choice-grid">
              {list.map((d) => (
                <button key={d.id} className={`choice ${ds === d.id ? "is-on" : ""}`} onClick={() => setDs(d.id)} aria-pressed={ds === d.id}>
                  <span className="chip">{d.count.toLocaleString()} 词</span>
                  <b>{d.name}</b>
                  <small>{d.desc}</small>
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>每天点亮几颗新星？</legend>
            <div className="segmented segmented-wide">
              {[5, 10, 15, 20].map((n) => (
                <button key={n} className={goal === n ? "is-on" : ""} onClick={() => setGoal(n)} aria-pressed={goal === n}>
                  {n} 颗{n === 10 ? " · 推荐" : ""}
                </button>
              ))}
            </div>
          </fieldset>
          <button className="btn btn-primary btn-xl" onClick={finish}>
            出发 <ArrowRight size={20} />
          </button>
          <p className="muted">进度会自动保存在本机；登录账号后还能同步到其他设备，随时可以在「我的」里修改。</p>
        </div>
      </div>
    </div>
  );
}
