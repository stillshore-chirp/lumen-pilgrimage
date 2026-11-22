# 検証と配布ビルド

依存関係は [README の起動手順](../README.md#起動と操作) に沿って用意します。変更時に必要な検証は [AGENTS.md](../AGENTS.md#検証) を参照してください。

## 一括検証

```sh
npm run check
```

型チェック、本番ビルド、ハーネス文書の静的検査、探索の地形・操作・音の回帰テストを実行します。[CI](../.github/workflows/ci.yml) でも同じコマンドを実行します。

- `npm run build` は型チェックと Vite の本番ビルドを行います。
- `npm run validate:harness` は現行文書のリポジトリ内リンクと、記載された npm スクリプト名を確認します。
- `npm run test:coast` は探索の移動・地形・音響の単体テストを実行します。

## 配布ビルドの確認

`dist/` のローカル確認には、ビルド後に `npm exec -- vite preview` を使います。

## ブラウザでの回帰テスト

景観探索のブラウザテストはビルド後に MacBook の Google Chrome で `COAST_CHROME_CHANNEL=chrome npm run test:coast:browser` を実行します。Playwright の Chromium を使う場合は、次のコマンドで準備と実行ができます。

```sh
npx playwright install chromium --no-shell
npm run test:coast:browser
```

ブラウザテストは、海岸と丘陵展望台の描画、移動・遊泳・飛行、模擬ゲームパッド入力、環境音、描画品質、ワールド間移動と時間帯の引き継ぎを確認します。展望台では環境音の開始とミュート、2階への階段の往復、手すりでの停止、夜のファストトラベルも検証します。過去の直接起動 URL で開いた場合も自然景観探索が起動することを確認します。

## 実機での確認

ゲームパッドの両スティックと上下・モード切替を試します。ヘッドホンでは滝との距離や視点を変え、定位と音割れ・途切れの有無を確認します。
