# Lumen Pilgrimage: Reforge

Three.js と TypeScript で開発している、Hub を拠点としたアクション探索ゲームのプロトタイプです。デスクトップでは、出撃準備から遠征の戦闘・報酬選択・保存・再開までを操作できます。WebXR ではセッション管理と Hub 端末のレイ選択を実装しています。

## 起動と操作

CI と同じ Node.js 22 系を使います。

```sh
npm ci
npm run dev
```

Vite が表示したローカル URL をブラウザで開いてください。

1. Main Menu でセーブスロットを選択し、`Enter Hub` を押します。`New Game` は選択中のスロットの遠征データと恒久進行を初期化します。
2. Hub の `Expedition Prep` で解放済みの biome・装備とミッションを選び、`Launch Expedition` で出撃します。モードは Main Menu の `Mode Select` から選べます。
3. 遠征中は選択スロットに進行が自動保存されます。ページを再読み込みして同じスロットを選択し、`Continue Expedition` から保存済みの遠征を再開できます。

| 場面 | 入力 | 操作 |
| --- | --- | --- |
| Hub | `Q` / `E` | 端末の切り替え / 起動 |
| 遠征 | 左クリックまたは `Space` / 右クリック | 主武器で攻撃 / ガード |
| 遠征 | `F` / `Q` | パリィ / 副手段の使用 |
| 遠征 | 左 `Shift` / `R` | ダッシュ / Ash Sight |
| 遠征 | `A`・`D` / `E` | 報酬候補の切り替え / 決定。通常時の `E` は装備の切り替え |

WebXR セッションを試すには、対応ブラウザとヘッドセットを使い、セキュアコンテキストでページを開きます。接続中のコントローラーのレイで Hub の端末を選択できます。端末の起動と戦闘には現時点でデスクトップ入力を使います。[WebXR Device API](https://www.w3.org/TR/webxr/#idl-index)

## 検証と配布ビルド

```sh
npm run check
```

型チェック、Vite の本番ビルド、コンテンツ検証、リリース検証を順に実行します。CI の各ステップは [CI ワークフロー](.github/workflows/ci.yml) を参照してください。

- `npm run validate:content` は、コンテンツの最低件数、ID の重複と参照、biome の room graph、開発用・旧仕様の文言を静的に確認します。
- `npm run validate:release` は、`src/` の旧実装への参照と、`dist/` のデバッグ・旧実装の痕跡を確認します。単独で実行する場合は、先に `npm run build` で `dist/` を生成してください。

`dist/` のローカル確認には、ビルド後に `npm exec -- vite preview` を使います。操作の確認では、起動、出撃、入力、再読み込み後の Continue を変更範囲に合わせて試してください。WebXR のセッションや入力を変更した場合は、対象のブラウザと実機でセッションの開始・終了、コントローラーの選択、終了後のデスクトップ操作を確認してください。

## 開発資料

- [設計](docs/architecture.md) に、入力、遠征、保存、描画・音響の現行の接続を記載しています。
- [Reforge ロードマップ](plans/reforge-roadmap.md) に、ゲームとしての到達目標と残る実装課題を記載しています。`plans/` 内の個別計画と進捗 JSON は、作成時点の記録です。
