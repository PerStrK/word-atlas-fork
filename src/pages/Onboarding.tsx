import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { useAtlas } from "../atlas/context";
import { store } from "../store/store";

const LEVELS_IELTS = [
  ["A2", "基础", "日常词还不太稳"],
  ["B1", "进阶", "目标 5.5 – 6 分"],
  ["B2", "中高", "目标 6.5 – 7 分"],
  ["C1", "高级", "冲刺 7.5 分以上"],
];

const LEVELS_UNITS = [
  ["Starter Unit 1", "预备单元一", "从头开始"],
  ["Unit 1", "第一单元", "预备单元已学完"],
  ["Unit 2", "第二单元", "第一单元已学完"],
  ["Unit 4", "第四单元", "前三单元已学完"],
];

export function Onboarding() {
  const atlas = useAtlas();
  const LEVELS = atlas.cefr[0]?.includes("Unit") ? LEVELS_UNITS : LEVELS_IELTS;
  const [level, setLevel] = useState(1);
  const [goal, setGoal] = useState(10);
  const finish = () => store.settings({ onboarded: true, startLevel: atlas.cefr.indexOf(LEVELS[level][0]), dailyNew: goal });
  return (
    <div className="onboard" role="dialog" aria-modal="true" aria-label="欢迎">
      <div className="onboard-card">
        <img className="onboard-art" src={`${import.meta.env.BASE_URL}brand/hero.webp`} alt="" />
        <div className="onboard-body">
          <p className="eyebrow">欢迎来到词光</p>
          <h1 className="display">
            {atlas.count.toLocaleString()} 颗星，
            <br />
            等你一颗颗点亮。
          </h1>
          <fieldset>
            <legend>你从哪里出发？</legend>
            <div className="choice-grid">
              {LEVELS.map(([code, name, desc], i) => (
                <button key={code} className={`choice ${level === i ? "is-on" : ""}`} onClick={() => setLevel(i)} aria-pressed={level === i}>
                  <span className={`chip chip-level lv-${code}`}>{code}</span>
                  <b>{name}</b>
                  <small>{desc}</small>
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
