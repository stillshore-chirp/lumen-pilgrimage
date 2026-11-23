# Lumen Pilgrimage

Three.js と TypeScript で開発している景観探索プロトタイプです。入り江から森・湖・稜線を歩き、丘陵展望台や都心の70階住戸から街を見渡せます。

## 起動と操作

CI と同じ Node.js 22 系（22.18 以降）を使います。

```sh
npm ci
npm run dev
```

Vite が表示したローカル URL を Chrome で開くと、入り江の砂浜から始まります。`W` `A` `S` `D` で移動し、景観をクリックするとマウスで視点を動かせます。操作パネルに戻るには `Esc` を押してください。画面の「環境音を開始」で音が鳴ります。

「ファストトラベル」から都心の70階住戸へ移動できます。ローカル URL の末尾に `?world=residence` を付けると、夜のリビング南窓から始まります。

右上の「仮想モニター」から「配信画面を開く」を押すと、同じ Chrome の別タブに画面共有を開始するページが開きます。元の景観でコードを入力し、確認番号を照合して配信元で許可すると映像が浮かぶ面に映ります。[共有・配置・音声の操作](docs/exploration.md#仮想モニター)

## 文書案内

| 知りたいこと | 読む文書 |
| --- | --- |
| キー操作、散策路、視野角、描画・環境音の設定、仮想モニター | [探索ガイド](docs/exploration.md) |
| ワールド切替、地形、描画、音響の設計 | [設計](docs/architecture.md) |
| 70階住戸の間取りと窓からの眺望 | [基本設計](docs/residence/residence-70f-design.md) · [寸法入り設計図 PDF](docs/residence/residence-70f-drawings.pdf) |
| テストの実行、実機での確認、配布ビルド | [検証と配布ビルド](docs/verification.md) |
| 開発時の契約、変更に応じた文書の更新先 | [AGENTS.md](AGENTS.md) · [正本と更新先](docs/agent-harness.md#正本と更新先) |
| 旧ゲームの計画と進捗 | [旧ゲームの履歴](plans/README.md#旧ゲームの履歴) |
