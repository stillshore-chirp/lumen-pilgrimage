# Lumen Pilgrimage リポジトリガイド

この文書は Lumen Pilgrimage 固有の開発・検証手順を補足します。Codex の運用は、アプリで有効な設定と指示に従ってください。

## 開発の入口

- 起動手順、現行の操作範囲、検証コマンドは [README.md](README.md) を参照してください。
- 入力、遠征、保存、描画の接続は [docs/architecture.md](docs/architecture.md) を参照してください。
- ハーネスの構成と保守は [docs/agent-harness.md](docs/agent-harness.md)、Hub・遠征・XR・保存の操作確認は [遠征検証Skill](.agents/skills/verify-expedition/SKILL.md) を参照してください。
- リポジトリ内に作業計画を残す場合は [plans/TEMPLATE.md](plans/TEMPLATE.md) を使えます。

## 変更時に確認する契約

- 入力やメニューを変更するときは、`Game` がデスクトップ入力と XR の状態・レイをどう消費するかを確認してください。実際に接続されている操作を基準に、変更する経路を検証してください。
- 遠征やセーブを変更するときは、既存スロットの読込と Continue を確認してください。biome・mission・room・装備の ID は保存や参照に使われます。変更時は旧データの復帰経路と、同じ `runSeed` によるルート選択への影響を確認してください。
- `localStorage` から読み込むセーブや設定は検証し、保存値を画面に出す場合は `textContent` などで文字列として描画してください。
- コンテンツ定義を変更するときは、ID の参照整合と room graph を `npm run validate:content` で確認してください。旧 ritual/glyph ループとデバッグ表示に関する配布ビルドの制約は、[リリース検証スクリプト](scripts/validate-release.mjs) で確認できます。

## 検証

- CI と同じ検証は `npm run check`、ハーネス文書と Skill の静的検査だけを行う場合は `npm run validate:harness` を使ってください。
- ロジックやデータ契約の変更で既存の検証が拾えない回帰条件は、対象に近い検証に追加してください。操作や保存は、変更箇所に応じた手動確認の結果を記録してください。
- 操作、セットアップ、モジュール間の契約を変更した場合は、対応する README または設計文書を更新してください。
