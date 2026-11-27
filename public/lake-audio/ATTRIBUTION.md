# 湖畔の箏音声の出典と配布条件

[素材ガイド](../../docs/assets.md#外部音声の採用基準)の恒久ルールを適用します。候補の比較・取得・権利と倫理の判断は[箏実録音の採否](../../docs/lake/koto-sample-selection.md)、加工と奏法・音域の制約は[単音処理の正本](../../docs/lake/koto-sample-processing.md)、ファイル単位の14項目とhash・加工・配布対応は[音声台帳](../../assets/lake-audio/sample-manifest.json)を参照してください。

## 配布している加工単音

RutgerMullerが演奏・公開した箏の即興録音から、次の5単音を加工して同梱します。原出典のライセンスは **CC0 1.0**。録音者の役割は本人の投稿説明からの合理的な推定を含み、単独での録音著作権保有を独立に立証したものではありません。

| 配布ファイル | 原出典 | 加工・用途 |
| --- | --- | --- |
| [low-151.wav](samples/low-151.wav) | [Session 3・365242](https://freesound.org/people/RutgerMuller/sounds/365242/) | 単音加工・比較用。 |
| [mid-319.wav](samples/mid-319.wav) | [Session 2・365215](https://freesound.org/people/RutgerMuller/sounds/365215/) | 単音加工・比較用。 |
| [mid-452.wav](samples/mid-452.wav) | [Session 2・365215](https://freesound.org/people/RutgerMuller/sounds/365215/) | 単音加工・比較用。 |
| [high-640.wav](samples/high-640.wav) | [Session 2・365215](https://freesound.org/people/RutgerMuller/sounds/365215/) | 単音加工・比較用。 |
| [high-792.wav](samples/high-792.wav) | [Session 2・365215](https://freesound.org/people/RutgerMuller/sounds/365215/) | 単音加工・比較用。 |

[bank.json](samples/bank.json)は両出典のdecode hash、切出し範囲、加工値、推定基音、出力hashを対応付ける共有メタデータです。5 WAVは計297,148 bytes、48 kHz mono PCM16。公式の圧縮MP3プレビューから取得できた部分を使い、channel 0選択・DC除去・開始/終端フェード・bank共通gain・PCM16化を行っています。96 kHz・24-bit原WAVの取得や、全録音の完全性を示しません。加工値と再生成方法は[加工正本](../../docs/lake/koto-sample-processing.md#編集元と再現)を参照してください。

実使用は[台帳](../../assets/lake-audio/sample-manifest.json)に対応付けます。単音モデルは調音・押し手・消音の近似と短い高域attackのhybrid処理、解析CLIは同じ独自演奏入力による比較、加工スクリプトは保持した入力からの再生成、演奏モジュールは独自の調弦・音列・比較条件を担当します。原録音のフレーズ・発音順・間合いは転用しません。同梱する生成曲は、次節の実ファイルと元出典IDへ対応付けています。

## 同梱する39秒の生成曲

[koto-performance.wav](koto-performance.wav) は、独自の39秒曲に物理モデルと上記の加工単音の短い高域attackを用いたhybrid生成音です。**暫定技術選択・最終音質未判定**として同梱します。48 kHz・mono・24-bit PCM、39秒で、96 kHzの内部生成から変換し、共通gainと決定的なTPDF ditherを適用しています。

元出典IDは `freesound-365215` と `freesound-365242` です。[生成記録](../../assets/lake-audio/production.json)に入力hash・加工条件・出力hash・数値の結果を、[音声台帳](../../assets/lake-audio/sample-manifest.json)の `generatedAssets` に実配布ファイル・bytes・生成スクリプト・元出典IDを記録します。[生成スクリプト](../../scripts/prepare-koto-performance.mjs)は[独自の演奏入力](../../src/coast/world/lake/kotoPerformance.ts)を使い、48発音のうち4発音は録音attackなしの物理方式です。[実行時の読込](../../src/coast/world/lake/lakeKotoAsset.ts)はこの同梱生成音を読み、[研究用解析](../../scripts/koto-analysis.mjs)とは責務を分けます。

原録音の旋律・フレーズ・発音順・実演の間合いは転用していません。加工単音のCC0出典、本人の意思への配慮、圧縮プレビュー・収録条件・十三弦未確認・人間の混入確認未実施という制約を引き継ぎます。生成曲を配布したことは、自然さや最終音質の人間による合格を意味しません。

## ライセンス・制作者の意思と確認範囲

2026年11月27日に、個別ページのCC0 1.0表示と [CC0 1.0 Legal Code](https://creativecommons.org/publicdomain/zero/1.0/legalcode)、[CC0 FAQ](https://wiki.creativecommons.org/CC0_FAQ)を確認しました。[本人プロフィール](https://freesound.org/people/RutgerMuller/)の加工利用の希望を尊重し、無加工の録音全体を商用素材集として同梱せず、本人の推薦・関与・共同制作を示す表示は行いません。この記述は制作者の意思への配慮と本作の用途を記録したもので、CC0へ追加の法的条件を設けるものではありません。帰属表示はCC0の法的条件ではなく、出典を追えるようにする記録です。

台帳の `adopted` は権利・倫理と加工単音の同梱についての採用であり、完成音質の合格ではありません。十三弦という明示、人間による自然さ・第三者音混入の聴取確認は未確認のままです。自動の倍音screenから、声・他音楽・別の実演が一切ないとは断定しません。後に具体的な混入が判明したcutは不採用へ戻し、依存する生成音を更新します。

公式CDNから同じprefixを再取得する確認は通信切断・時間切れで未達でした。保持したhash固定入力からの加工再生成は一致しており、この2つの再現範囲を区別します。CC0表示と本人による制作説明は、他者の権利や非侵害を絶対に保証するものではありません。
