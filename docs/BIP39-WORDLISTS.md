# BIP39 字典来源

本地助记词检测使用 Bitcoin BIPs 仓库的 BIP39 字典。构建时保存为 JSON，运行时不下载。

- 版本：`620871a7a442e276a058b487cd8743775fb499a4`
- 许可：MIT；规范说明见 https://github.com/bitcoin/bips/blob/620871a7a442e276a058b487cd8743775fb499a4/bip-0039.mediawiki
- 不包含用户助记词、钱包数据或密钥。
- 许可声明随安装应用提供，见 `THIRD_PARTY_LICENSES.md`。

测试使用 Trezor [公开测试向量](https://github.com/trezor/python-mnemonic/blob/master/vectors.json) 的十种语言共 240 条，只保留公开熵和助记词；另用其 [Python 参考实现](https://github.com/trezor/python-mnemonic/blob/master/src/mnemonic/mnemonic.py) 生成零熵 15 / 21 词共 20 条向量，补齐长度边界。均为离线构建测试资料，不包含派生钱包种子或账户；参考实现不进入应用运行时。

于 2026-09-12 下载的原文件 SHA-256：

- `vectors.json`：`fa3b937b7cff9c9b8ecd3aa011faeb8d6dd67993174b72326e83f4de8fdb30f8`
- `mnemonic.py`：`42daf1fb4f3b43eb40284add75d832e384bbe3aaa6d00ae68c8850b8a0a6d75b`

| 字典 | 原始文件 SHA-256 | 来源 |
| --- | --- | --- |
| chinese_simplified.txt | `5c5942792bd8340cb8b27cd592f1015edf56a8c5b26276ee18a482428e7c5726` | [原文件](https://raw.githubusercontent.com/bitcoin/bips/620871a7a442e276a058b487cd8743775fb499a4/bip-0039/chinese_simplified.txt) |
| chinese_traditional.txt | `417b26b3d8500a4ae3d59717d7011952db6fc2fb84b807f3f94ac734e89c1b5f` | [原文件](https://raw.githubusercontent.com/bitcoin/bips/620871a7a442e276a058b487cd8743775fb499a4/bip-0039/chinese_traditional.txt) |
| czech.txt | `7e80e161c3e93d9554c2efb78d4e3cebf8fc727e9c52e03b83b94406bdcc95fc` | [原文件](https://raw.githubusercontent.com/bitcoin/bips/620871a7a442e276a058b487cd8743775fb499a4/bip-0039/czech.txt) |
| english.txt | `2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda` | [原文件](https://raw.githubusercontent.com/bitcoin/bips/620871a7a442e276a058b487cd8743775fb499a4/bip-0039/english.txt) |
| french.txt | `ebc3959ab7801a1df6bac4fa7d970652f1df76b683cd2f4003c941c63d517e59` | [原文件](https://raw.githubusercontent.com/bitcoin/bips/620871a7a442e276a058b487cd8743775fb499a4/bip-0039/french.txt) |
| italian.txt | `d392c49fdb700a24cd1fceb237c1f65dcc128f6b34a8aacb58b59384b5c648c2` | [原文件](https://raw.githubusercontent.com/bitcoin/bips/620871a7a442e276a058b487cd8743775fb499a4/bip-0039/italian.txt) |
| japanese.txt | `2eed0aef492291e061633d7ad8117f1a2b03eb80a29d0e4e3117ac2528d05ffd` | [原文件](https://raw.githubusercontent.com/bitcoin/bips/620871a7a442e276a058b487cd8743775fb499a4/bip-0039/japanese.txt) |
| korean.txt | `9e95f86c167de88f450f0aaf89e87f6624a57f973c67b516e338e8e8b8897f60` | [原文件](https://raw.githubusercontent.com/bitcoin/bips/620871a7a442e276a058b487cd8743775fb499a4/bip-0039/korean.txt) |
| portuguese.txt | `2685e9c194c82ae67e10ba59d9ea5345a23dc093e92276fc5361f6667d79cd3f` | [原文件](https://raw.githubusercontent.com/bitcoin/bips/620871a7a442e276a058b487cd8743775fb499a4/bip-0039/portuguese.txt) |
| spanish.txt | `46846a5a0139d1e3cb77293e521c2865f7bcdb82c44e8d0a06a2cd0ecba48c0b` | [原文件](https://raw.githubusercontent.com/bitcoin/bips/620871a7a442e276a058b487cd8743775fb499a4/bip-0039/spanish.txt) |
