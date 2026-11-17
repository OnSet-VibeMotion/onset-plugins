# 片场插件中心

[片场（OnSet）](https://github.com/OnSet-VibeMotion/OnSet) 客户端「设置 → 功能与插件 → 插件中心」读的目录。客户端从这里取 `index.json`，列出可以装的第三方插件。

- **目录里只有登记，没有插件代码**。每个插件在作者自己的仓库里，这里记它的来源和每一版钉住的 commit。
- **装之前先给你看**。点「安装」后，客户端按目录里的 commit 取回插件，核对 id 和 commit 都与目录一致，再把它要的权限、操作和接进来的地方列给你。你点「装上」才装。更新也一样，还会多列出新版本新申请的权限。
- **由作者维护**。插件不是片场自带的，片场不审查插件的代码。这里的 CI 只核对登记写得对不对，以及登记的 commit 里确实是那个插件的那一版。

## 地址

客户端默认依次试这两个地址：

- `https://raw.githubusercontent.com/OnSet-VibeMotion/onset-plugins/main/index.json`
- `https://cdn.jsdelivr.net/gh/OnSet-VibeMotion/onset-plugins@main/index.json`（GitHub 连不上时用；jsDelivr 有缓存，合并后最多要半天才能看到）

公司内部或镜像可以在客户端「设置 → 网络与更新 → 插件中心地址」填自己的地址。格式和这份目录相同。

## 登记一个插件

见 [CONTRIBUTING.md](CONTRIBUTING.md)。写插件见片场仓库的 [docs/plugin-authoring.md](https://github.com/OnSet-VibeMotion/OnSet/blob/main/docs/plugin-authoring.md)。
