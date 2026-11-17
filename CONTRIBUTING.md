# 登记或更新插件

通过 PR 改 `index.json`。CI 会按你写的 commit 取回插件，核对清单。合并后，客户端下次刷新插件中心时就能看到。

## 新登记

1. 插件放在你自己的公开 git 仓库里，根目录有 `onset-station.json`（写法见片场的 [docs/plugin-authoring.md](https://github.com/OnSet-VibeMotion/OnSet/blob/main/docs/plugin-authoring.md)）、README 和许可证。
2. 给要发布的那个 commit 打 tag，例如 `v0.1.0`，然后推上去。
3. 在 `index.json` 的 `plugins` 里加一项：

```json
{
  "id": "my-publisher",
  "name": "自动发布到某平台",
  "description": "一句话说清它做什么，不超过 200 字",
  "author": { "name": "你的名字", "url": "https://github.com/you" },
  "license": "MIT",
  "tags": ["发布"],
  "homepage": "https://github.com/you/onset-my-publisher",
  "source": "github:you/onset-my-publisher",
  "icon": "icons/my-publisher.png",
  "versions": [
    { "version": "0.1.0", "ref": "v0.1.0", "commit": "<40 位 commit>", "requires_onset": "2.0.0" }
  ]
}
```

| 字段 | 要求 |
|---|---|
| `id` | 与清单的 `id` 相同；小写字母、数字与 `-`，以字母开头；不能与片场自带的功能重名 |
| `source` | `github:owner/repo` 或 `https://` 的 git 地址，**不带** `#ref` |
| `versions[].commit` | 完整的 40 位 commit。客户端只认 commit，取回后会核对 |
| `versions[].ref` | 给人看的 tag。写成 `v` 或数字开头时，CI 会核对 tag 指向这个 commit |
| `versions[].version` | 与那个 commit 里清单的 `version` 相同 |
| `versions[].requires_onset` | 与清单的 `requires.onset` 相同；没写就都不写 |
| `icon` | 放在本仓库 `icons/` 下，PNG / JPEG / WebP，256×256，不超过 100 KB；不收 SVG |
| `screenshots` | 可选，放在 `screenshots/<id>/` 下，每张不超过 500 KB |

4. 本地先跑一遍：

```bash
node scripts/validate.mjs --since origin/main
```

## 发新版本

在这个插件的 `versions` 里**追加**一项，旧版本保留。客户端会在用户的片场版本满足 `requires_onset` 的版本里挑最新的一版。只更新到新片场才能用的版本时，用旧片场的用户还能装上一版。

不要改已有版本的 `commit`。要撤回某一版，请删掉那一项，并在 PR 里说明原因。

## 换仓库

客户端只给同一个仓库里的新版本提示「更新」。换了 `source`，已经装了的用户会看到「装着同名插件，但不是从这里装的」，要先去掉再装。换仓库请在 PR 里说明原因。

## 审核看什么

- CI 必须通过
- 名字和说明说清它做什么，不冒充片场自带的功能，也不冒充别的插件
- 新申请的权限（`permissions.network`、`permissions.uses`、`permissions.project`、`browser`）在 PR 里说明了用途

审核不检查插件代码的安全性。安装时片场会把插件要的权限和操作原样列给用户，由用户决定装不装。
