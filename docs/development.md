# 開発ガイド

この文書は、会話履歴なしで開発を再開するための環境、作業場所、検証入口をまとめます。文書ごとの正本と更新条件は[文書の責務と更新基準](documentation-structure.md)を参照してください。

## 環境と起動

README は Node.js 22.18 以降を案内し、CI は Node.js 22 系を使います。依存の導入を確認した環境は Node.js 22.23.4 と npm 10.9.9 です。

```sh
npm ci
npm run dev
```

Vite が表示した URL を Chrome で開きます。入り江から始まり、丘陵展望台、住戸、映画館はファストトラベルか `?world=overlook`、`?world=residence`、`?world=cinema` で直接開けます。操作の入口は[README](../README.md#起動と操作)、ビルド後のプレビューは[運用ガイド](operations.md)にあります。

## 技術と検証ツール

バージョンは [`package-lock.json`](../package-lock.json) の解決値です。[`package.json`](../package.json) は npm スクリプトと依存宣言の正本です。

| 技術 | バージョン・責務 |
| --- | --- |
| Node.js / npm | CI は Node.js 22 系。[README](../README.md#起動と操作)の下限は 22.18。依存は `npm ci` でロックファイルから導入します。 |
| TypeScript | 5.9.3。[`tsconfig.json`](../tsconfig.json) は strict、ES2022、未使用ローカル・引数の検査を有効にします。 |
| Three.js | 0.184.0。3D の景観、ワールド描画、入力、音響のブラウザー API 連携に使います。 |
| Vite | 7.3.8。[`vite.config.mjs`](../vite.config.mjs)で開発サーバー、本番ビルド、ローカルプレビューを構成します。仮想モニターのシグナリング middleware も Vite に接続します。 |
| Playwright | 1.65.1。ブラウザー回帰試験で Chromium またはインストール済み Chrome を操作します。 |
| WebGL 2 | Three.js が景観とワールドを描画します。[`CoastApp`](../src/coast/CoastApp.ts) は WebGL renderer を作り、WebGL 2 が使えない場合は [`main.ts`](../src/main.ts) が Chrome とグラフィックアクセラレーションの確認を案内します。 |
| Web Audio API | [`CoastAudio`](../src/coast/CoastAudio.ts) が環境音を空間化し、[`monitorAudio`](../src/monitor/monitorAudio.ts) と[映画館の再生処理](../src/coast/world/cinema/cinemaPlayback.ts)が共有音声を処理します。環境音は画面上の利用者操作から開始します。 |
| WebRTC | [`monitorSession.ts`](../src/monitor/monitorSession.ts) が画面・音声を端末間で直接送ります。ペアリングは Vite の[シグナリング middleware](../server/virtual-monitor-signaling.mjs)を使い、STUN/TURN を設定していないため、別端末同士は直接到達できる必要があります。詳しくは[仮想モニター技術仕様](monitor.md)を参照してください。 |
| WebXR | [`ImmersiveSession.ts`](../src/xr/ImmersiveSession.ts) が `immersive-vr` を検査し、`local-floor` を必須、手の追跡を任意として開始します。操縦とヘッドセット追跡は [`CoastXR.ts`](../src/coast/CoastXR.ts) が接続します。入力試験は模擬で、実機確認は[検証ガイド](verification.md#別端末とvr)に分けてあります。 |

主な入口は [`package.json`](../package.json) の `dev`、`build`、`check`、`validate:harness`、領域別テストです。GitHub Actions の [CI ワークフロー](../.github/workflows/ci.yml)は `main` への push または pull request で Node.js 22 を用意し、`npm ci` と `npm run check` を実行します。細かなブラウザー試験と実機確認の条件は[検証と配布ビルド](verification.md)に集約しています。

## どこを編集するか

| 変更対象 | 主な場所 |
| --- | --- |
| 起動ルートと初期状態、移動先・時間帯の URL 判断 | [`explorationRoute.ts`](../src/coast/explorationRoute.ts) |
| ワールド読込、起動表示、移動の適用 | [`src/main.ts`](../src/main.ts)、[`CoastApp.ts`](../src/coast/CoastApp.ts)、[`CoastTravelPanel.ts`](../src/coast/CoastTravelPanel.ts) |
| 操作、移動先と座標、共有する時間・場所の状態 | [`CoastControls.ts`](../src/coast/CoastControls.ts)、[`coastDestinations.ts`](../src/coast/coastDestinations.ts) |
| 海岸・森・湖 | [`CoastWorld.ts`](../src/coast/CoastWorld.ts)、`src/coast/world/` の各景観モジュール |
| 展望台 | [`OverlookWorld.ts`](../src/coast/world/overlook/OverlookWorld.ts) と `src/coast/world/overlook/` |
| 70階住戸 | [`ResidenceWorld.ts`](../src/coast/world/residence/ResidenceWorld.ts)、[`residencePlan.ts`](../src/coast/world/residence/residencePlan.ts)、[`ResidenceControlPanel.ts`](../src/coast/ResidenceControlPanel.ts) |
| 映画館 | [`CinemaWorld.ts`](../src/coast/world/cinema/CinemaWorld.ts)、[`cinemaLayout.ts`](../src/coast/world/cinema/cinemaLayout.ts) |
| 仮想モニターの送信・視聴・キャプチャ・WebRTC・配置・音声 | [`monitorSender.ts`](../src/monitor/monitorSender.ts)、[`monitorCapture.ts`](../src/monitor/monitorCapture.ts)、[`monitorSession.ts`](../src/monitor/monitorSession.ts)、[`monitorXR.ts`](../src/monitor/monitorXR.ts)、[`monitorAudio.ts`](../src/monitor/monitorAudio.ts) |
| 仮想モニターのセッション確立 | [`virtual-monitor-signaling.mjs`](../server/virtual-monitor-signaling.mjs) と [`vite.config.mjs`](../vite.config.mjs) |
| 配布時に読む画像・音声・地理データ | `public/**`。制作・検証の案内は[素材ガイド](assets.md)、出典と再配布条件は各 `ATTRIBUTION.md` が正本です。 |
| 自動試験 | [`scripts/`](../scripts/) の `*.test.mjs` と [`package.json`](../package.json) のスクリプト |

起動と責務のつながりは[設計](architecture.md)、操作と利用者向けの設定は[探索ガイド](exploration.md)にあります。編集前に[文書の責務と更新基準](documentation-structure.md)で対象の正本を選び、仕様・操作・素材に影響する場合は対応する文書も更新してください。

## 通常の変更手順

1. [コーディング規約](coding-standards.md)、[`package.json`](../package.json)、対象に近い実装・テストを確認し、変更する契約を[文書の責務と更新基準](documentation-structure.md)で特定します。
2. 変更と同じ責務の試験を更新します。入力、移動、地形、描画、音響、ワールド切替では [AGENTS.md の検証条件](../AGENTS.md#検証)も確認してください。
3. 受け入れ条件に応じて `npm run check` と対象ブラウザー試験を選びます。詳細な実行条件は[検証ガイド](verification.md)を使い、同じ長時間試験を重複させません。
4. 文書・リンクを変えた場合は `npm run validate:harness` を実行します。静的検査が示すのはリンクや記載された npm スクリプトの整合性です。動作や実機の証明には使いません。

ツールの実行入口はリポジトリの `package.json` と GitHub Actions の CI です。人の承認者、デプロイ権限、公開用の認証情報はリポジトリ内で定義されていません。リモート操作の権限は作業環境と対象サービスの設定に従います。
