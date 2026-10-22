# DND5e classpack for fvtt

整合了大部分种族，职业，物品，法术，
交流与制作群：942329050（新） 1083272094（旧，不再活跃）

`6.0.0-beta.8` 发布后，在“安装模组”的 Manifest URL 中填入：

    https://github.com/observer1236/classpack/releases/download/v6.0.0-beta.8/module.json

后续测试版使用对应版本的安装链接。也可以将发布的 ZIP 解压到 Foundry 数据目录的 `Data/modules/` 中。

发布记录：
https://github.com/observer1236/classpack/releases

传送选择落点时，默认显示被传送 Token 的原图预览；群体传送会按实际落点显示所有目标，保留各自的尺寸与相对位置。无效落点的预览变红，确认、取消或切换场景后清除。调用 `dnd5eClasspack.teleport` 时可用 `previewTokens: false` 关闭，或用 `previewAlpha` 调整图像不透明度（默认 `1`，`0` 不显示图像，`1` 保留原 Token 的不透明度）。落点圆形默认只显示边框；`crosshairsConfig.fillAlpha` 单独控制圆形填充的不透明度（默认 `0`），避免填充遮挡 Token 图像。

如需为本项目贡献，请参阅：
https://github.com/observer1236/classpack/blob/master/CONTRIBUTING.md
