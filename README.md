# Lumen Pilgrimage

Lumen Pilgrimage は、Three.js と TypeScript で開発しているブラウザー向けの景観探索プロトタイプです。入り江から森・湖・稜線を歩き、丘陵展望台、都心の70階住戸、映画館シアター（大）を巡ります。昼夜や描画品質、環境音を切り替え、仮想モニターには端末の画面共有を表示できます。開発サーバーとプレビューには Vite を使います。

## 起動と操作

CI と同じ Node.js 22 系（22.18 以降）を使います。

```sh
npm ci
npm run dev
```

Vite が表示したローカル URL を Chrome で開くと、入り江の砂浜から始まります。`W` `A` `S` `D` で移動し、景観をクリックするとマウスで視点を動かせます。操作パネルに戻るには `Esc` を押してください。画面の「環境音を開始」で音が鳴ります。

「ファストトラベル」から都心の70階住戸へ移動できます。ローカル URL の末尾に `?world=residence` を付けると、夜のリビング南窓から始まります。

映画館はファストトラベルから選ぶか、ローカル URL に `?world=cinema` を付けます。「上映設定」から場内灯を切り替え、「試映を再生」で幕と場内音を体験できます。 [映画館の操作](docs/exploration.md#映画館シアター)

右上の「仮想モニター」から「配信画面を開く」を押すと、同じ Chrome の別タブに画面共有を開始するページが開きます。元の景観でコードを入力し、確認番号を照合して配信元で許可すると映像が浮かぶ面に映ります。[共有・配置・音声の操作](docs/exploration.md#仮想モニター)

## 文書案内

| 知りたいこと | 読む文書 |
| --- | --- |
| キー操作、散策路、視野角、描画・環境音の設定、仮想モニター | [探索ガイド](docs/exploration.md) |
| ワールド切替、地形、描画、音響の設計 | [設計](docs/architecture.md) |
| 70階住戸の間取りと窓からの眺望 | [基本設計](docs/residence/residence-70f-design.md) · [寸法入り設計図 PDF](docs/residence/residence-70f-drawings.pdf) |
| 映画館シアター（大）の客席・光・音の計画 | [基本設計 PDF](docs/cinema/cinema-floor-plan.pdf) · [音響・照明設計 PDF](docs/cinema/cinema-light-sound-design.pdf) |
| テストの実行、実機での確認、配布ビルド | [検証と配布ビルド](docs/verification.md) |
| 開発時の契約、変更に応じた文書の更新先 | [AGENTS.md](AGENTS.md) · [正本と更新先](docs/agent-harness.md#正本と更新先) |
| 旧ゲームの計画と進捗 | [旧ゲームの履歴](plans/README.md#旧ゲームの履歴) |

## 開発者の作業から探す

| 作業 | 読む文書 |
| --- | --- |
| 開発環境を用意して作業を再開する | [開発環境と起動](docs/development.md) |
| ワールドの構成、到着地点、移動と昼夜の引き継ぎを変更する | [ワールド案内](docs/worlds.md) · [実装設計](docs/architecture.md) |
| 仮想モニターの共有、接続、音声、対応環境を変更する | [仮想モニター仕様](docs/monitor.md) · [検証手順](docs/verification.md#仮想モニターの実機確認) |
| 素材を追加・加工し、出典や再現手順を記録する | [素材ガイド](docs/assets.md) · [素材の出典](docs/exploration.md#素材の出典) |
| 配布と運用の確認手順を調べる | [運用ガイド](docs/operations.md) |
| 文書の正本、更新先、受け入れ基準を確認する | [文書の責務と更新基準](docs/documentation-structure.md) |
