# エージェントハーネス

Codexの運用は、アプリで有効な設定と指示に従います。リポジトリには、Lumen固有の開発・検証条件と、その参照先を置きます。

| 入口 | 読む場面 |
| --- | --- |
| [AGENTS.md](../AGENTS.md) | 作業を始めるとき。セーブ互換、コンテンツ制約、検証の入口を確認する |
| [遠征検証Skill](../.agents/skills/verify-expedition/SKILL.md) | Hub・遠征・XR・セーブを変更し、影響する操作を確認するとき |
| [README](../README.md) と [設計](architecture.md) | 起動、操作、現行のモジュール間の接続を調べるとき |
| [Codexのローカル環境設定](../.codex/environments/environment.toml) | Codexアプリで新しいワークツリーの依存関係をセットアップするとき |
| [CI](../.github/workflows/ci.yml) と [package.json](../package.json) | 自動実行の条件と検証コマンドを確認するとき |

## 更新と検証

特定の作業で繰り返し使う手順は `.agents/skills/` に置き、ここから案内します。操作や設計に関する事実は README や設計文書を更新します。`plans/` の個別計画は、その作業時点の記録です。

指示や参照を変更したら `npm run validate:harness` を実行します。[静的検査](../scripts/validate-harness.mjs) は、現行文書と Skill の Markdown インラインリンク、npm スクリプト名、Skill の `name` と `description` を確認します。この検査はファイルの構成を対象とします。Codexアプリでの指示の読込、ブラウザ操作、XR実機の結果は、必要な作業で個別に確認します。
