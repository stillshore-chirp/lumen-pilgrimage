# エージェントハーネス

Codexの運用は、アプリで有効な設定と指示に従います。リポジトリには、Lumen固有の開発・検証条件と、その参照先を置きます。

| 入口 | 読む場面 |
| --- | --- |
| [AGENTS.md](../AGENTS.md) | 作業を始めるとき。探索の変更条件と検証の入口を確認する |
| [README](../README.md) と [設計](architecture.md) | 起動、操作、自然景観のワールドとモジュール間の接続を調べるとき |
| [Codexのローカル環境設定](../.codex/environments/environment.toml) | Codexアプリで新しいワークツリーの依存関係をセットアップするとき |
| [CI](../.github/workflows/ci.yml) と [package.json](../package.json) | 自動実行の条件と検証コマンドを確認するとき |

## 更新と検証

操作や設計に関する事実は README や設計文書を更新します。`plans/` の個別計画と進捗 JSON は、その作業時点の記録です。

指示や参照を変更したら `npm run validate:harness` を実行します。[静的検査](../scripts/validate-harness.mjs) は、現行文書の Markdown インラインリンクと記載された npm スクリプト名を確認します。探索の起動、操作、描画、音響は、変更に応じて `npm run test:coast` とビルド後の `npm run test:coast:browser` で確認します。
