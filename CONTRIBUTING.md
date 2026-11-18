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
  "maintainers": ["you"],
  "versions": []
}
```

`versions` 先留空，再运行 `node scripts/bump.mjs --id my-publisher --commit <40 位 commit> --ref v0.1.0`。它会下载那个 commit 的压缩包，读出 version、requires_onset，算好 digest，再把这一版写进去。

| 字段 | 要求 |
|---|---|
| `id` | 与清单的 `id` 相同；小写字母、数字与 `-`，以字母开头；不能与片场自带的功能重名 |
| `source` | `github:owner/repo` 或 `https://` 的 git 地址，**不带** `#ref` |
| `versions[].commit` | 完整的 40 位 commit。客户端只认 commit，取回后会核对 |
| `versions[].ref` | 给人看的 tag。写成 `v` 或数字开头时，CI 会核对 tag 指向这个 commit |
| `versions[].version` | 与那个 commit 里清单的 `version` 相同 |
| `versions[].requires_onset` | 与清单的 `requires.onset` 相同；没写就都不写 |
| `versions[].digest` | GitHub 来源必须写，由 `scripts/bump.mjs` 算。用户电脑上没有 git 时，片场靠它下载 GitHub 的压缩包并核对内容 |
| `maintainers` | 能改这条登记的 GitHub 账号，至少一个，新登记时要写上你自己 |
| `icon` | 放在本仓库 `icons/` 下，PNG / JPEG / WebP，256×256，不超过 100 KB；不收 SVG |
| `screenshots` | 可选，放在 `screenshots/<id>/` 下，每张不超过 500 KB |

4. 本地先跑一遍：

```bash
node scripts/format.mjs
node scripts/validate.mjs --since origin/main
```

## 谁能改哪条登记

- **新登记**：只能登记你自己的仓库，或你作为公开成员所在组织的仓库，并且要把自己写进 `maintainers`。
- **改或删已有的登记**：PR 作者必须在原来那条登记的 `maintainers` 里。要交给别人维护，就先由现在的维护者发 PR，把对方加进去。
- 本仓库的成员不受这个限制，但照样要审。

CI 按 PR 作者核对这些规则。

## 发新版本

最省事的做法是在插件仓库里加一个工作流：推 tag 时自动向这里发 PR。

```yaml
# 插件仓库的 .github/workflows/onset-catalog.yml
on:
  push:
    tags: ['v*']
jobs:
  catalog:
    uses: OnSet-VibeMotion/onset-plugins/.github/workflows/bump.yml@v1
    with:
      id: my-publisher
    secrets:
      token: ${{ secrets.ONSET_CATALOG_TOKEN }}
```

然后在插件仓库的 Settings → Secrets and variables → Actions 里新建 `ONSET_CATALOG_TOKEN`，填你自己的 GitHub token：经典 token 勾 `public_repo`，或细粒度 token 给 fork 和发 PR 的权限。PR 以你的账号发出，所以你要在 `maintainers` 里。PR 照样要过 CI、要人合并。没设这个 secret 时，工作流第一步就会停下，说明要设什么。

你的 token 会经过哪些代码：

- 写 `@v1`，用的是这个仓库 `v1` tag 上的 `bump.yml`，之后改 `main` 不会影响你。想完全自己把关，就钉到具体的 commit（`bump.yml@<40 位 commit>`）。
- token 只交给 `bump.yml` 的第二个任务。那个任务不运行这个仓库里的任何脚本，只做 fork、放进改好的 `index.json`、提交、推送、开 PR，命令都写在 `bump.yml` 里。
- 算版本的 `scripts/bump.mjs` 在第一个任务里跑，不带 token，交给第二个任务的只有 `index.json`。
- `bump.yml` 有不兼容的改动时会发 `v2`，`v1` 不会被改成另一套行为。

也可以手动运行 `node scripts/bump.mjs --id <id> --commit <commit> --ref <tag>` 再发 PR。新版本**追加**在 `versions` 里，旧版本保留。客户端会在用户的片场版本满足 `requires_onset` 的版本里挑最新的一版。只更新到新片场才能用的版本时，用旧片场的用户还能装上一版。

不要改已有版本的 `commit`，也不要删掉已经发出去的版本。

## 撤回与停止维护

- **撤回某一版**：给它加上 `"yanked": "原因"`。这一版不会再推荐给任何人；已经装了它的用户会看到这句原因，并被引导换到另一版能用的版本，哪怕那一版的版本号更低。
- **不再维护**：给插件加上 `"deprecated": "原因"`，比如「改做 xxx 了」。不会再给新用户装；已经装了的照常能用，也会看到这句原因。

这两种做法都比删掉登记好：删掉之后，装了它的人什么提示都收不到。

## 换仓库

客户端只给同一个仓库里的新版本提示「更新」。换了 `source`，已经装了的用户会看到「装着同名插件，但不是从这里装的」，要先去掉再装。换仓库请在 PR 里说明原因。

## 审核看什么

- CI 必须通过
- 名字和说明说清它做什么，不冒充片场自带的功能，也不冒充别的插件
- 新申请的权限（`permissions.network`、`permissions.uses`、`permissions.project`、`browser`）在 PR 里说明了用途

审核不检查插件代码的安全性。安装时片场会把插件要的权限和操作原样列给用户，由用户决定装不装。
