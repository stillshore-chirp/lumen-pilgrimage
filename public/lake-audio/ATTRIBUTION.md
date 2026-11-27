# 湖畔の箏音声の出典と配布条件

[音声採用基準](../../docs/assets.md#外部音声の採用基準)を適用します。権利・倫理と候補の判断は[実録音の採否](../../docs/lake/koto-sample-selection.md)、素材ごとの14項目、hash、元・中間・配布物の対応は[音声台帳](../../assets/lake-audio/sample-manifest.json)を正本とします。

## 現在同梱する39秒曲

[koto-performance.wav](koto-performance.wav) は、既存の独自39秒曲を、240/452/638/792 Hzの4根の録音素材、有限の余韻時間加工、自作の相対励振FIRで生成したものです。48 kHz・mono・24-bit PCM、5,616,044 bytes。入力hash、共通gain、TPDF dither、数値の結果は[生成記録](../../assets/lake-audio/production.json)へ対応付けます。[生成スクリプト](../../scripts/prepare-koto-performance.mjs)と[独自演奏入力](../../src/coast/world/lake/kotoPerformance.ts)による全48発音に、物理方式へのfallbackはありません。基準velocity 0.6を除く44発音には[相対励振FIR](../../src/coast/world/lake/kotoExcitationColor.ts)を適用しています。

所有者の指示で今回の改良turnを区切り、この音源を配送します。**終了の合意は、人間による最終音質・自然さ・一つの箏としての音色の合格を意味しません。** 以前のhybridや分割方式は音色に否定的な評価を受けており、この終了によって合格へ変更しません。[実行時の読込](../../src/coast/world/lake/lakeKotoAsset.ts)は同梱曲だけを使い、原録音サービスへ接続しません。

## 元録音と原単音

原出典はRutgerMullerによる [Session 2・365215](https://freesound.org/people/RutgerMuller/sounds/365215/) と [Session 3・365242](https://freesound.org/people/RutgerMuller/sounds/365242/)、原音声のライセンスは **CC0 1.0** です。個別ページと本人の即興演奏・録音公開の説明を合理的な根拠とします。録音者の役割には本人説明からの推定を含み、単独権利保有、実物十三弦、両録音の楽器・収音・力の同一性を独立に立証したものではありません。

| 原単音 | 出典・扱い |
| --- | --- |
| [low-151.wav](samples/low-151.wav) | 365242。初回5根の比較履歴・再生成入力。 |
| [mid-319.wav](samples/mid-319.wav) | 365215。初回5根の比較履歴・再生成入力。 |
| [mid-452.wav](samples/mid-452.wav) | 365215。初回比較と現在の有限時間加工の入力。 |
| [high-640.wav](samples/high-640.wav) | 365215。初回比較と現在の有限時間加工の入力。 |
| [high-792.wav](samples/high-792.wav) | 365215。現在の4根でも時間伸長せず使う入力。 |
| [low-240.wav](samples/low-240.wav) | 365242の38.769–39.580秒、channel 0。DC除去・開始/終端フェード・初回bankと共通のgainを適用した0.811秒。 |

[初回5根bank](samples/bank.json)と[原6根bank](samples/recorded-bank.json)を保持します。原単音という呼称は時間加工前の入力を意味し、未加工の原WAVではありません。入力は公式の圧縮MP3プレビューから得た部分で、96 kHz/24-bit原WAVを取得した記録ではありません。原6根bankは元研究snapshotのstatusとhashを `originStatus` / `originSnapshotSha256` に保持し、現在の配送採用をroot台帳へ参照します。

## 4根の処理素材と生成への対応

| 配布素材 | 入力・時間処理 |
| --- | --- |
| [low-240-candidate.float.wav](samples/sustain/low-240-candidate.float.wav) | low-240。先頭140 msを保持し、録音tailを要求1.175倍の範囲で有限時間加工。 |
| [mid-452.float.wav](samples/sustain/mid-452.float.wav) | mid-452。先頭120 msを保持し、要求3倍を上限とする有限時間加工。 |
| [high-640.float.wav](samples/sustain/high-640.float.wav) | high-640。先頭120 msを保持し、要求3倍を上限とする有限時間加工。 |
| [high-792.float.wav](samples/sustain/high-792.float.wav) | high-792。時間伸長せず、mono float32の処理入力へ変換。 |

[処理bank](samples/sustain/bank.json)に、元decode hash、cut範囲、入力単音hash、実出力時間、atempo command、接続・フェードと各出力hashを記録します。[有限時間加工](../../scripts/koto-recorded-sustain-study.mjs)は自然に録音されなかった未来の減衰を回復するものではありません。サンプルの調音・押し手・消音に続く相対励振FIRは、仮定した接触時間τとvelocityの関係による自作の小さな補正であり、実測velocity層、同定した胴IR、校正済みの実物楽器モデルではありません。元録音の音列・フレーズ・発音順・実演の間合いは転用しません。

FFmpeg 8.1.2のGPLv3以降のbuildは、オフラインの時間加工ツールとしてだけ使用しています。FFmpegの実行ファイル・ライブラリは配布へ含めず、ツールの版・実行ファイルhash・commandは台帳に記録します。ツールのライセンスと、原録音のCC0・本作の音声加工物の由来を区別します。

## 以前の生成曲の履歴

[初回hybridの39秒曲](../../assets/lake-audio/history/koto-performance-hybrid96.wav)と[当時の生成記録](../../assets/lake-audio/history/hybrid96-production.json)は比較履歴として保持し、通常のpublic配布へは含めません。元の出力path・commit・入力snapshotを当時の記録へ残しています。現在の曲へ置換したことによって、以前のhash、方式、所有者の否定的な音色評価を失わないようにしています。

## 制作者の意思と残る不確実性

2026年11月27日に確認した個別のCC0 1.0表示、[CC0 Legal Code](https://creativecommons.org/publicdomain/zero/1.0/legalcode)、[CC0 FAQ](https://wiki.creativecommons.org/CC0_FAQ)、[本人プロフィール](https://freesound.org/people/RutgerMuller/)の根拠を継承します。加工・リミックスの意思に沿い、無加工の録音全体を商用素材集として配布せず、本人の推薦・参加・共同制作を誤認させません。この配慮はCC0へ追加の法的条件を設けるものではありません。出典表示は追跡のための記録です。

十三弦の個体、独立した録音強弱層、第三者の声・音楽・実演の不存在、人間による最終音質は未確認です。周期・倍音screenを権利や単一弦・音質の証明にはしません。公式CDNから同じprefixの再取得は未達で、保持したhash固定入力からの加工再現と区別します。後に具体的な第三者混入が判明したcutは不採用に戻し、依存音声を更新します。CC0表示と本人説明から、他者の権利や非侵害の絶対保証はしません。
