# スクリーンショットの撮影と更新

[ワールドギャラリー](README.md)に掲載する画像は、Lumen Pilgrimage の実際のブラウザー描画です。参照原画の転載、生成画像への置換、景観の合成、明暗・色・形状の補正はしていません。撮影時だけ操作UIを非表示にした景観写真と、UIを含む画面を区別しています。

## 撮影条件

- 撮影版は写真別に管理します。更新済みの写真は検証用clean統合merge `9b04bebe6ec5866446e8689ffeaaf4969bdf0db1`、その他は撮影記録に示す既存版から取得しています。更新対象のworldは `captureSources` と各frameで確認でき、全48画像が単一revisionの描画を示すものではありません。
- 画面：1920 × 1080 px、devicePixelRatio 1、デスクトップ Chromium、描画設定「高品質」。
- 視点：既存の到着地点と通常のマウス・キーボード操作。写真別の位置・向き・縦視野角、昼夜、照明や布団・灯籠の設定は [撮影記録](manifest.json)に記録しています。
- シーンの時間は停止せず、雲、水、鳥、交通などは通常の描画更新で取得しています。同じ手順でも動く物体の位置や画素は一致しません。
- 未接続の仮想モニターや映画館の空のスクリーンは、外部映像を再生している状態ではありません。この記録が確認したのは撮影時のPC表示です。音響・VR実機・性能の確認範囲は[検証ガイド](../verification.md)を参照してください。

掲載用の画像は原寸PNGをWebPへ圧縮したものです。6枚の一覧用サムネイルだけ640 × 360 pxに縮小しています。更新分のREADME代表は展望台の主夜景、住戸のリビング昼景、映画館の清掃照明の後方視点です。写真の構図はトリミングしていません。撮影日時、ブラウザー版、原本PNGと掲載WebPのSHA-256、画像容量は撮影記録を参照してください。

掲載は景観36枚、UIあり6枚、一覧用6枚の計48ファイル、合計7,807,210 bytes（約7.45 MiB）です。新しい撮影版の掲載画像は24ファイルです。撮影日時とブラウザー版は写真別記録、掲載用の変換はImageMagick 7.0.10-57、quality 88 / method 6です。

| ワールド | 景観写真 | 縦視野角 |
| --- | --- | --- |
| 入り江と山道 | 6枚 | 60° |
| 丘陵展望台 | 5枚 | 54° |
| 都心の70階住戸 | 7枚 | 60° |
| 映画館シアター | 6枚 | 60° |
| 商業アトリウム | 5枚 | 42° |
| 湖畔の広間 | 7枚 | 52° |

## 写真ごとの来歴

撮影記録のschemaVersion 2は複数版を扱います。`frames[].sourceRevision` が実際の撮影元コミット、`route` がホストを含まない相対到着URL、位置・向き・projection・raster・animation・inputが条件です。`publicComponents` は公開済みのworldと共通操作のcommitを示します。撮影treeとcomponentのcommitは役割が異なります。

| 撮影用統合版の構成 | 公開component |
| --- | --- |
| 丘陵展望台・共通操作 | `5ae0c29d47be9a5dd039a175298f639cb36772c1` |
| 都心の70階住戸 | `6cd8cd372a378c2dcc12c1ad232553cee2127d08` |
| 映画館シアター | `cd79fdea5cda19827465f394557a6bf94063be66` |

`captureSources` は撮影版の役割とcompiled buildの同一性をまとめます。海岸・アトリウム・湖畔の旧frameと原本PNG識別子は保持しています。新しい公開記録も原本PNGのSHA、掲載WebPのSHA・寸法・容量を結び付け、ホストの絶対path、loopbackのportや配信URL、実行環境の識別子は記録しません。通常描画の静止写真であり、全方向・移動・音響・長期再生を一括して保証するものではありません。

## 再取得

[開発環境](../development.md)を準備し、[ブラウザー試験の準備](../verification.md#ブラウザでの回帰テスト)に従ってChromiumを導入します。写真は保存先を指定して取得します。スクリプトは一時的なloopbackサーバーとブラウザーを起動し、終了時に閉じます。既存の利用者用サーバーは停止しません。

```sh
npm ci
npm run build
GALLERY_OUTPUT=/tmp/lumen-gallery-raw COAST_CHROME_CHANNEL=chromium node scripts/capture-gallery.mjs
```

[撮影計画](../../scripts/gallery-shots.json)のIDを指定すると、一部だけ取得できます。

```sh
GALLERY_OUTPUT=/tmp/lumen-gallery-raw node scripts/capture-gallery.mjs coast-inlet-day lake-hall-day
```

[撮影スクリプト](../../scripts/capture-gallery.mjs)はURLで到着地点を開き、「高品質」、昼夜、設定ボタン、通常のマウス操作・歩行から構図を作ります。WebGLの行列を読み取り、実際に描画した視点を記録します。追跡中の `src/`・`public/` に未コミット変更がある場合は撮影を止めます。配信されたHTML・JavaScriptのハッシュも記録しますが、それだけでビルドとコミットの対応は証明できないため、再取得前に `npm run build` を実行してください。更新した18視点はclean統合版から取得し、配信HTML・JavaScriptと全103配布ファイルが検証済みnativeビルドに一致することを確認しました。実撮影revisionは公開componentのcommitへ置換せずに記録します。撮影用スタイルで操作UIを一時的に非表示にし、UIあり版も別途取得します。シーンの座標や形状を直接書き換えていません。撮影計画を変えたら、実際の写真と操作経路を目視し、キャプションと記録も同時に更新してください。

## 掲載用の変換

WebP変換と一覧用の縮小には ImageMagick の `magick` を使います。これは撮影後の画像加工用で、アプリの依存には追加していません。変換したファイルを目視してから掲載します。

```sh
magick /tmp/lumen-gallery-raw/coast-inlet-day.png -strip -quality 88 -define webp:method=6 docs/gallery/images/coast-inlet-day.webp
magick /tmp/lumen-gallery-raw/coast-inlet-day.png -resize 640x360 -strip -quality 88 -define webp:method=6 docs/gallery/images/coast-inlet-day-thumb.webp
```

画像は `docs/gallery/images/`、実際の取得・変換結果は `manifest.json` に置きます。READMEとギャラリーの一覧は同じサムネイルを共用します。文書用画像は `public/` に入れず、アプリの配布ビルドへ同梱しません。画面キャプチャは本文とは別に再取得できるので、元PNGを重複してリポジトリへ追加する必要はありません。原本の識別は記録したSHA-256で行います。

## 出典と公開範囲

写真に見える形状・仕上げ・植生は、リポジトリのワールド実装から描画しています。使用素材の出典と利用条件は次の正本を引き継ぎます。画像全体に新しい一括ライセンスを付与するものではありません。

- [海岸・森・参道の素材](../../public/coast-materials/ATTRIBUTION.md)：Poly HavenのCC0素材、本プロジェクト用の生成素材。
- [展望台・街並みの地形と街路](../../public/coast-overlook/ATTRIBUTION.md)：USGS標高、Census街路と独自の都市造形。参照写真そのものは掲載していません。
- [住戸の仕上げ](../../public/residence-materials/ATTRIBUTION.md)：Poly HavenのCC0素材。
- [アトリウムの仕上げ](../../public/atrium-materials/ATTRIBUTION.md)：CC0の大理石、共用木材と独自の形状。
- [湖畔の広間の雲と植生](../../public/lake-materials/ATTRIBUTION.md)：本プロジェクト用の生成素材と独自の形状。

映画館の写真に他者の映画や個人の画面共有は使用していません。接続コード、私物の画面、元の参照画像も公開写真へ含めません。新しい映像や共有画面を撮影するときは、その画面の公開可能性を別途確認してください。

## 掲載前の確認

1. 各画像を原寸で開き、読み込み途中、壊れた反射、意図しないUI、秘密情報、説明に合わない被写体がないか確かめます。
2. READMEの代表写真と6ワールドのリンク、ギャラリーから探索ガイドへのリンク、設計資料からの参照を確認します。
3. デスクトップ幅と狭い画面で、画像・キャプションが読めて横にはみ出さないことを確認します。
4. `npm run validate:harness` で文書参照を検査します。静的検査の成功だけで写真の品質を合格にしません。

同じワールドの描画が変更されたときは、該当する写真とREADMEのサムネイルを更新し、撮影版・条件も更新してください。写真の古さが判断できるよう、撮影記録は残します。
