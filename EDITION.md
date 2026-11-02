# 主力版说明（pep-main 分支）

这个分支是词光的主力版本：人教版七上（教学词库）+ 雅思词库可切换，带账号系统与进度云同步，
部署在 word.678912.xyz 根路径。`main` 分支保留上游原版，不直接改动。

## 新增/改动

- 账号系统：注册/登录（会话 cookie）、管理员后台（开关注册、用户管理、按单元设定学习进度）。
  前端 `src/lib/auth.ts`、`src/pages/Account.tsx`；后端 `server/g7_server.py`（Python 标准库 + SQLite，
  同时托管静态站点与 `/api/*`，监听 8098）。
- 进度云同步：按账号、按词库分别存服务器；本地同步元数据防串号，多设备以最后保存为准。
  `src/lib/sync.ts`，`store` 新增 `adoptProgress`。
- 多词库：词库清单由后端 `GET /api/datasets` 下发（数据在 `server/datasets.json`，改清单即增删词库，
  无需改前端）；账号在「我的」页勾选启用并切换，选择跟随账号保存（`user_prefs`）。
  `src/lib/datasets.ts`、`src/pages/Datasets.tsx`；词库数据根由清单的 `root` 字段给出（相对站点根）。
- 界面文案随词库切换：分级标签为 Unit 时显示「单元」，为 A1–C2 时显示「难度」。

## 数据布局

- 雅思词库：沿用上游 `public/atlas`（仓库内全量，含图片/音频）。部署时软链到站点 `datasets/ielts/atlas`。
- 人教版七上：文本数据在本分支 `datasets/pep-g7s1/`（index.json + entries/）；构建部署时组装进
  `public/atlas`。其图片/音频为生成资产（约 40 MB、近两千个文件），保存在部署机
  `/data/work/word-atlas-g7/app-src/public/atlas`，未逐个同步进 Git（接口逐文件推送太慢）；需要时可整包迁移。

## 构建与部署

```bash
ATLAS_BASE=/ npm ci && npm run build   # 产物 dist 即站点根
python3 server/g7_server.py            # 托管 webroot + API（8098）
```

部署机上的可运行副本与脚本在 `/data/work/word-atlas-g7/`（app-src / server / deploy_g7.sh）。
