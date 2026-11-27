# 十三弦箏の測定と比較試聴

この文書は乾音の測定条件・比較ファイル・数値の解釈の正本です。音色・演奏・室内伝搬を分け、数値の合格を人間の自然さ・美しさの合格へ読み替えません。設計上の要求は [Issue #275](https://github.com/stillshore-chirp/lumen-pilgrimage/issues/275)、室内の音源配置は [広間の設計](lake-hall-design.md#生き物と音)、再生実装は [LakeKoto](../../src/coast/world/lake/lakeKoto.ts) を参照します。

## 測定前に固定した条件

旧音源は revision `375c3b7a2d77f3cae2420e5b3ca7c2f4e8bba597` の `lakeKotoScore.ts` です。24 kHz・39秒・13弦の加算合成を変更せず、Git blobとbyte一致する [fixture](../../scripts/fixtures/lakeKotoLegacy.ts) を読み、一時ディレクトリにも保存します。単音測定だけはTypeScriptを一時変換し、private関数をstaging上でexportします。本番コードには測定用exportを足しません。新方式は48 kHzで生成します。旧音源はBlackman窓sinc補間（左右32 tap、cutoff=元Nyquistの94%）で48 kHzへ変換し、元の12 kHz超の帯域が復元しないことを記録します。

低音は弦2・G3（196.00 Hz）、中音は弦7・G4（392.00 Hz）、高音は弦13・A5（880.00 Hz）。force/velocityは弱0.30、中0.60、強0.90です。各6秒の単音、一半音・二半音の押し手、0.65秒での消音、同弦再発音と多弦の重なり、五・十の同時合わせ爪、冒頭短旋律、39秒の全曲の16条件を出力します。入力は [共通case](../../src/coast/world/lake/kotoPerformance.ts) を正本とします。旧版には消音APIがないため、その比較は無加工の旧音を保存し「未対応」と記録します。39秒の旧新比較には演奏制御の改良も含まれ、音色だけを分離した評価には共通単音を使います。

| 確認する量 | 先に固定した判定・方法 | 根拠と限界 |
| --- | --- | --- |
| 非有限値 | NaN/Infinityが0 sample。 | デジタル信号の成立条件。音質判定ではありません。 |
| DC | 全窓平均の絶対値が−60 dBFS以下。 | 0.1%FSの設計上の許容値。過渡信号の有限窓平均でありDCフィルター特性とは異なります。 |
| 基音 | 通常±10 cent、押し手の到達音±15 cent。 | 調弦と制御の実装許容値。聴覚の普遍的弁別閾ではありません。 |
| 音高測定窓 | 通常0.12–0.291秒、押し手0.48–0.651秒。8192-point Hann FFTの期待基音周辺をlog放物線補間。基音peak≤−100 dBFSは周波数を推定せず欠測。 | 開始直後のノイズと押し手移行中を避けます。倍音が強いと基音局所推定と聴覚的音高が異なる場合があります。合成正弦波で推定誤差を確認します。欠測は音高gateの合格ではありません。 |
| 倍音と非調和 | 1〜12次の局所peak周波数・振幅と基音整数倍からのcent偏差。 | 記述量。実録音の校正値を持たないため自然さの数値合格線は設けません。押し手は到達後の窓を使います。 |
| 減衰 | 80–500、500–2000、2000–8000 HzのSTFT帯域エネルギーを32 ms窓で追跡。初期から−5〜−25 dBの点を回帰。 | 観測幅15 dB以上だけ傾きからT60を外挿。弦のT60外挿であり、室の残響時間の実測ではありません。二段減衰を単一指数へ押し込めず軌跡も保存します。 |
| attack | 最初100 msの1 ms RMS包絡、10–90%立上りと最大時刻。 | plectrum接触の実測値ではありません。自然さの合格線は設けません。 |
| クリック | 最大隣接sample差とその時刻、開始/終了の波形、消音後の残留。 | 高音の正常な傾斜も大きな差になります。最大差だけでclick合格を判定せず、意図した過渡と数値不連続を区別します。 |
| loop | 39秒曲の最後と最初のsample差が−80 dBFS以下、末尾50 msのRMSが−70 dBFS以下。 | 無音を持つ現行曲の設計条件。終端のsample連続だけで演奏上の不自然な間合いを合格にしません。 |
| peak/RMS/crest | rawのsample peak、全窓RMS、peak/RMSのdB。比較用WAVはsample peak≤−3 dBFS。 | sample peakはtrue peakではありません。−3 dBは比較素材の余裕でありITU適合値ではありません。 |
| alias | Nyquistの90%以上のエネルギーを診断表示し、aliasと断定しません。 | 単一波形から真の高域と折返しを区別できません。モデルのmode上限・高レート収束実験を別証拠として扱います。 |
| レート収束 | 同一seed/入力で48/96 kHzを生成し、96 kHzをsinc変換した参照と0.12–0.80秒で比較。基音差±2 cent。 | 未押弦の低中高で数値積分・filter・補間を含む収束を確認します。波形相対誤差と基音振幅差も保存し、残差をalias単独の水準と呼びません。 |
| 消音 | 消音直前100 msと、消音後0.20–0.30秒のRMSを比べ24 dB以上の低下。 | 0.10秒T60の弦制動に対し胴の残留を含めた設計上の基準。旧版は機能未対応と記録します。 |
| 性能・memory | renderのwall time、process CPU、ArrayBuffer/heap/RSSの差、保持PCM byte数。 | Nodeのオフライン単回値。GC・割当の雑音を含み、ブラウザーの主thread占有・HRTF負荷・長時間の保持memoryは別測定です。 |

判定値は測定前の実装上の基準です。結果に合わせて下げません。非定常音、測定窓外の押し手、重複音などで不適用なら、理由と別の測定窓・予測値を記録します。強弱・音色・押し手・消音・多弦の定性的評価は試聴と組み合わせて行います。

## 音量をそろえる方法

[EBU Tech 3343（2023）](https://tech.ebu.ch/docs/tech/tech3343.pdf) §2.1は、peakが同じでも平均的な聴こえの大きさはそろわないことを説明しています。§8.2の73 dBC/SPLによる較正は、500–2000 Hzの基準noiseと実際の音圧計を用いる、適用室容積・再生構成を持つ手順です。ヘッドホンや仮想12スピーカーへ、そのまま較正済みと宣言しません。

[ITU-R BS.1770-5（2023）](https://www.itu.int/dms_pubrec/itu-r/rec/bs/R-REC-BS.1770-5-202311-I!!PDF-E.pdf) Annex 1はK-weighting・channel weighting・400 ms block/75% overlap・絶対/相対gateを用います。本比較の非重み付きRMSは、このアルゴリズムを実装せず、LUFSと呼びません。同規格のNote 1のとおり、規格上のloudnessにも音源・聴取者・条件による不確実性があります。

比較では方式ごとに`mid-normal`の発音0〜3秒のRMSを−24 dBFSにそろえるgainを求め、その方式の全単音・奏法・短旋律に**同じgain**を適用します。弱/強を各々正規化しません。39秒曲は全39秒のRMSを別anchorにします。全方式・全clipのpeakを調べ、どれかが−3 dBFSを超える場合だけ全clipへ共通の追加減衰をかけます。limiterやcompressorは使いません。gainはmanifestへ保存します。これは再現可能な電気レベルの整合であり、周波数・持続の異なる音の知覚的な等音量を保証しません。

試聴時は同じ機器・音量・再生経路で比較し、較正の有無を記録します。乾音の比較と天井12スピーカー経由を分けます。raw WAVはfloat32なので元振幅を保持し、音量を下げて扱います。比較用WAVは安全gain適用後のPCM16です。

## 再現と成果物

依存を準備したリポジトリで次を実行します。通常配布には測定や比較ファイルを組み込みません。

```sh
node --test scripts/koto-analysis.test.mjs
node scripts/koto-analysis.mjs /private/tmp/lumen-koto-evaluation
# 第3引数でbankを指定可能。既定は同梱bank（存在する場合のみ使用）
node scripts/koto-analysis.mjs /private/tmp/lumen-koto-evaluation public/lake-audio/samples/bank.json
```

[解析CLI](../../scripts/koto-analysis.mjs)は`manifest.json`、clipごとのraw float32 WAV、音量整合済みPCM16 WAV、measurement JSON、visualization JSONを生成します。sourceとWAVのSHA-256、入力sourceのsnapshot、基準revision、Node/OS/architecture、入力、実行日時、測定値と不合格を追跡できます。`visualization`には700点以下のmin/max波形包絡、96対数周波数点のスペクトル、8192-point Hann STFTの80時刻を保存します。表示用の間引きJSONを精密な信号解析入力へ再利用しません。図の値はraw振幅であり、UIは`matchGainDb`と`commonSafetyGainDb`の和を適用します。実行中に入力sourceが変われば`sourceDrift`へ記録し、CLIはexit 2とします。

`manifest.methods`には実際にrenderした方式だけを入れます。sample/hybridはbankの採用状態・録音形式・楽器弦数の未確認を引き継ぎ、研究候補と本番採用を区別します。未対応の音高を含むclipは`unavailableClips`へ理由を保存します。適格な実録音がない場合、sample/hybridを生成したと偽装せず、採否の調査記録へ理由を残します。`unperformed`には人間の試聴、実機較正、最終空間出力、ブラウザーの実時間CPU/memory、aliasの分離実験など、実施していない事項を保持します。

## 現行旧音源から確認できること

コード上では18弦modeの各振幅を単一指数で減衰させ、別の6胴modeと22 msのnoiseを足し、各voiceを2.9秒で打ち切ります。胴への加算は弦との双方向のエネルギー結合ではなく、forceや弾弦位置を物理計測から校正していません。全曲は最終peakを0.76へ正規化します。これらはコードから確認した事実です。音色の問題への寄与の大小は、比較render・測定・試聴で区別して判断します。24→48 kHzの変換だけではモデルを改善したことになりません。

人間による聴感合格、実機VR、耳元音圧と12スピーカーの実空間再生は、この測定CLIでは判定しません。

## 旧モデル5e1aの比較履歴

以下は修正前モデルの比較履歴です。63本と元のmanifestを`/private/tmp/lumen-koto-evaluation-source5e1ad728`へbyte/hash同一で保全しました。旧manifest SHA-256は`7bfdb05655253dfbfd325c3dcd1fa5da3301f7bead33d961c69d48d04aba92de`です。この表を新しい本番候補の最終測定と呼びません。

2026-11-27 12:21 UTC、Node v22.23.4・macOS/x64で63 clipを出力しました。解析終了時の`sourceDrift`は空です。物理モデルSHA-256は`5e1ad7288612218ac8d6d645be950fd95c550c6c31b56f9505c383dd62d26825`、sampleモデルは`6ca104c08eff9885b1e031633f1e11904f26611a2fd15e6c591b9159592aea95`、共通演奏入力は`9369a44f18b55e54412301a332e1446c30720bcbbab3fd767b7b73d2440e02bd`です。bankと全WAVのhashはmanifestへ保存しています。

| 方式 | 出力数 | 通常単音の最大基音偏差 | 押し手の到達窓 | 消音 | 39秒曲 |
| --- | --- | --- | --- | --- | --- |
| 旧加算合成 | 16/16 | 1.772 cent | 半音−0.848、全音−0.425 cent | 機能未対応。自然減衰4.53 dBを制動合格と数えない | 出力、loop合格 |
| 改良物理モデル | 16/16 | 1.403 cent | 半音−0.323、全音−0.552 cent | 106.42 dB低下、合格 | 出力、loop合格 |
| 実録音候補 | 15/16 | 5.809 cent | 窓の前に音が終了。音高は欠測、不合格 | 消音前に音が終了。効果は欠測、不合格 | A3/B♭3の素材がなく未対応 |
| ハイブリッド候補 | 16/16 | 1.403 cent | 物理モデルと同じ到達値 | 106.42 dB低下、合格 | 出力、4/48音は記録どおり物理へfallback |

全出力で有限値・DC・所定duration・終端の適用gateは合格し、比較用PCM16は全63本がsample peak≤−3 dBFSです。純sampleの押し手2本と消音1本の不合格は残しました。短いtailをloop・引伸し・別の音で隠す修正は行っていません。実録音の採否・短いcut・弦数と録音条件の限界は [sampleの加工記録](koto-sample-processing.md) を参照します。

| 39秒のraw乾音 | sample peak | 全窓RMS | DC | 生成wall time | 保持する元PCM |
| --- | --- | --- | --- | --- | --- |
| 旧加算合成 | −2.41 dBFS | −24.01 dBFS | −81.97 dBFS | 0.102秒 | 3,744,000 byte・24 kHz |
| 改良物理モデル | −10.54 dBFS | −30.66 dBFS | −131.34 dBFS | 41.93秒 | 7,488,000 byte・48 kHz |
| ハイブリッド候補 | −10.34 dBFS | −30.68 dBFS | −127.37 dBFS | 41.94秒 | 7,488,000 byte・48 kHz |

生成時間はオフラインNodeの単回値で、ブラウザーの再生負荷とは異なります。39秒音を操作のたびに同期生成する設計には長い停止のリスクがあり、完成音を同梱してdecode・再生する必要性の根拠になります。旧音源の比較用48 kHz PCMは別途7,488,000 byteです。

中音の弱→強のRMS差は旧8.43 dB、物理11.02 dB、純sample9.54 dB、hybrid11.01 dBでした。同じ窓のpower centroidは、純sampleでは約499.90 Hzのままです。1つのvelocity layerを振幅だけで変える制約が実出力に現れています。物理では683.71→809.29 Hzへ変わりますが、その変化を自然な強弱の聴感合格とは扱いません。中音の帯域T60外挿（低/中/高域）は旧5.10/2.98/1.40秒、物理2.96/4.98/2.75秒でした。帯域の複数modeの合計の回帰であり、特定弦modeの減衰や実楽器の校正値とは区別します。

48/96 kHz収束では低/中/高の基音差が0.00049/0.00041/0.00089 cent、基音振幅差が−0.010/−0.006/−0.028 dBで、事前の基音差gateは合格です。無調整の時間波形相対誤差は−30.63/−26.72/−19.23 dBです。これをalias単独の水準と解釈しません。sample resamplerの合成高域入力による折返し抑圧検査は [sample回帰テスト](../../scripts/koto-sample.test.mjs) と加工記録で別に扱います。

測定器の [6つの回帰テスト](../../scripts/koto-analysis.test.mjs) は既知正弦波のRMS/crest/DC、FFT基音、帯域外抑圧を伴うsample-rate変換、強弱を保つ正規化、float WAVの過大振幅保持/PCMのclip拒否、既知指数減衰と無音の欠測を確認しました。ここまでの結果は、純sample候補の機能・音域不足を判定し、物理/hybridの比較可能な乾音を用意した証拠です。この測定に人間の聴感評価は含みません。後続の所有者による配布候補の初回試聴では、改善とともに箏の音色同定の未達が報告されました。[聴感記録と再設計判断](koto-instrument-design.md#所有者による初回試聴と再設計の判断)を正本とします。完成空間・全奏法の聴感合格は未確認です。

## 数値写像の修正と再評価

旧モデルの高音の48/96 kHz時間波形差−19.23 dBを、そのまま聴感上の不良やaliasと扱わず、filter前後・位相・減衰の原因を分けました。その結果、振動modeの周波数だけをprewarpして減衰係数を補正しない点と、中点速度をsample時刻の値として出力する半stepの時刻ずれが見つかりました。例えば孤立した14.08 kHz modeでは、減衰率の目標48.26 s⁻¹に対し、旧48 kHz実装の実効値は17.64 s⁻¹でした。これは根拠のない音色調整ではなく、指定したモデルと数値実装の不一致です。

新source `0f9fe7cd79f40e6e5f117070f59051837b9a74c2e8622d5eb7d3f8912367be2a`では、sample周期をh、角固有振動数をω₀、振幅減衰率をσとして、連続極λ=−σ+i√(ω₀²−σ²)からz=exp(λh)を作り、s*=2(z−1)/(h(z+1))へ逆bilinear写像します。質量正規化した剛性をK*=|s*|²、減衰をC*=−2 Re(s*)にして、孤立modeの周波数と減衰を同時に一致させます。出力もv(tᵢ)をtᵢへ対応させます。連成系全体のmatrix exponentialとの一致を主張するものではありません。

物理laneの独立診断では、同一880 Hz・velocity0.6・seed197・1.2秒、無調整0.12–0.80秒窓の全出力誤差が48/96 kHzで−26.50 dB、96/192 kHzで−38.88 dBとなりました。filter前は−39.02/−50.91 dBで、残差には出力filterのレートによる位相差と連成の近似が含まれます。旧変換器64/256 tapの差は−99.07 dBで、主要因ではありません。これらもalias単独の量、知覚的な自然さの評点ではありません。再現用診断の原本は`/private/tmp/lumen-koto-research/convergence/final-convergence.json`と`refinement.json`、恒久検証は [物理モデルのテスト](../../scripts/koto-physical.test.mjs) です。

本番候補は96 kHz内部生成から48 kHzへ変換し、配布時のrate・39秒・単ch・再生経路を維持します。比較UIの物理/hybridは48 kHz基準を保ち、本番の24-bit PCMそのものを別method `production96`の全曲clipとして追加できます。同じ全39秒RMS anchorと共通peak制限・loop基準で比較し、配布用の固定gainとditherも含めて測ります。

再評価は変更した物理/hybridの入力閉包だけを対象にします。旧音源と純sampleはDSP source・共通case・判定基準・bank・raw WAV hashの一致を確認し、元の音声と乾音測定値を再利用します。共通の追加減衰が変わる場合の整合済みWAVとpeakだけは再計算します。`reusedFrom`には元manifestと測定器のhashを記録します。基準を下げません。

```sh
node scripts/koto-analysis.mjs /private/tmp/lumen-koto-evaluation public/lake-audio/samples/bank.json \
  --reuse /private/tmp/lumen-koto-evaluation-source5e1ad728 \
  --production assets/lake-audio/production.json
```

`--production`は、生成済みの96 kHz本番候補の記録・全入力hash・配布WAV hashを照合して取り込みます。解析CLIで同じ全曲を96 kHz再生成することはありません。7つに増えた測定器テストは、24-bit PCMの復号と、物理sourceの変更が独立した純sampleの証拠を失効させないこと、case・基準・bank・sample DSPの変更が再利用を拒否することも確認します。

### 修正後の回収結果

2026-11-27 12:38:55 UTC、新model `0f9fe7…`、共通演奏`9369a4…`、解析器`513a5d…`で64 clip・5 methodを回収しました。manifest SHA-256は`14effbec0b2b10878a6b0372ddbd78f230a6734b70a1da1d446ab4b025da9f39`、`sourceDrift=[]`、CLI exit 0です。旧16本と純sample15本のraw hashは比較履歴と全31本一致し、再生成しませんでした。

| 修正後の方式 | clip数 | 通常基音の最大偏差 | 押し手の到達偏差 | 消音の低下量 |
| --- | --- | --- | --- | --- |
| 物理・48 kHz基準 | 16 | 1.403 cent | 半音−0.322、全音−0.550 cent | 106.46 dB |
| hybrid・48 kHz基準 | 16 | 1.403 cent | 半音−0.322、全音−0.550 cent | 106.46 dB |
| 配布音声そのもの・96 kHz内部→48 kHz出力 | 全曲1 | 全曲なので単音gateは適用外 | 全曲なので単音gateは適用外 | 全曲なので単音gateは適用外 |

新規33本は適用するfinite/DC/duration/音高/消音/終端/loop/比較peakのgateを通過しました。純sampleの既知の押し手2本・消音1本の欠測不合格と全曲未対応は、そのまま保持しました。48/96 kHzの基音差最大は0.000842 cent、低/中/高の無調整時間波形相対誤差は−38.41/−34.43/−26.50 dBです。

| 新規全曲 | raw sample peak | raw RMS | DC | オフライン生成wall time |
| --- | --- | --- | --- | --- |
| 物理48 kHz | −10.538 dBFS | −30.670 dBFS | −131.83 dBFS | 42.62秒 |
| hybrid48 kHz | −10.527 dBFS | −30.686 dBFS | −127.67 dBFS | 44.90秒 |
| 配布24-bit PCM・96 kHz内部 | −3.707 dBFS | −24.000 dBFS | −120.97 dBFS | 90.64秒（生成記録から取込） |

配布WAVは5,616,044 byte、SHA-256 `c73976efaa69ff309fdb66e765acad4e46c08770e850f0c3997ad78d909838c2`です。配布量子化の前に固定gain +6.6843 dBと24-bit TPDF ditherを適用し、量子化誤差RMSは−144.50 dBFS、末尾50 msは−144.47 dBFSです。全曲RMS anchorと全方式共通の−5.8919 dB追加減衰で比較用を作り、本番gainは比較UI用の追加減衰と区別します。この生成・測定時には聴感評価を含めません。後続の所有者の所見と未達は[音源設計](koto-instrument-design.md#所有者による初回試聴と再設計の判断)を参照します。

## 全39秒のLUFS・true peakによる補助確認

RMSが同じでも帯域分布が違うため、旧・物理48 kHz・hybrid48 kHz・配布96 kHz内部の全曲4本を [補助計測CLI](../../scripts/koto-loudness-study.mjs) で測りました。rawとRMS整合済み各4本の、39秒全体・mono・48 kHzを同じ条件にします。`analysis.mjs`、本番gain、既存RMS比較は変更しません。

FFmpeg 8.1.2の [ebur128](https://ffmpeg.org/ffmpeg-filters.html#ebur128) を`peak=true`で使い、補間後のtrue peakとintegrated loudnessを取得します。0.1 LUに丸められたsummaryだけでなく、`metadata=1`のintegrated値（0.001 LU表示）を保存します。[loudnorm](https://ffmpeg.org/ffmpeg-filters.html#loudnorm) はinput JSONだけを測り、変換した出力は破棄します。同filterはtrue peak検出のため192 kHzへ上げます。どちらも`dualmono=false`とし、乾音1chの電気レベルの比較です。HRTF後のstereo出力や耳元音圧にそのまま適用しません。

先に、追加の全曲整合を検討する差を0.5 LU、2 filter間の補助一致をintegrated±0.15 LU・true peak±0.2 dBとしました。普遍的な聴覚弁別閾ではありません。ITU-R BS.1770-5 Annex 1の997 Hz基準に対して振幅0.5の6秒正弦波を使い、期待−9.0306 LKFS/−6.0206 dBTPに対し、ebur128は−9.036 LUFS/−6.0 dBTP、loudnormは−9.05 LUFS/−6.02 dBTPで、事前±0.15の設定確認を通過しました。BS.2217の全適合試験を行った認証meterではありません。同じFFmpegの2 filterの照合も、独立した認証機器2台とは区別します。

| RMS整合済み39秒曲 | 全窓RMS | ebur128 integrated | loudnorm input integrated | loudnorm input true peak |
| --- | --- | --- | --- | --- |
| 旧 | −29.892 dBFS | −28.588 LUFS | −28.70 LUFS | −8.24 dBTP |
| 物理48 kHz | −29.892 dBFS | −28.622 LUFS | −28.75 LUFS | −9.75 dBTP |
| hybrid48 kHz | −29.892 dBFS | −28.636 LUFS | −28.76 LUFS | −9.65 dBTP |
| 配布96 kHz内部 | −29.892 dBFS | −28.646 LUFS | −28.77 LUFS | −9.53 dBTP |

方式間の差はebur128で0.058 LU、loudnormで0.07 LUでした。事前0.5 LUを下回るため、追加のLUFS整合ファイル・UI選択・本番gain変更は不要と判断しました。2 filterの差は全8測定でintegrated最大0.132 LU・true peak最大0.05 dBで、設定した補助一致条件を満たします。配布音声そのもののrawはebur128 −22.754 LUFS/−3.6 dBTP、loudnorm −22.88 LUFS/−3.64 dBTPです。

この結果はこの4本の39秒全曲に限ります。[ITU-R BS.1770-5](https://www.itu.int/dms_pubrec/itu-r/rec/bs/R-REC-BS.1770-5-202311-I!!PDF-E.pdf) Note 1は聴取者・素材・条件による不確実性を示し、Annex 1は純音の主観的loudnessへの一般化にも限界を示しています。997 Hzはmeterの設定確認であり短い箏単音の等音量評価ではありません。[EBU Tech 3343](https://tech.ebu.ch/docs/tech/tech3343.pdf) §9.1/§11.2.2は短いprogrammeでLRAを安定に解釈する点を問題にしているため、39秒のLRAから音楽的dynamicの優劣を判定しません。聴感の自然さ・好み・箏らしさは、この補助数値でも合格にしません。

```sh
node scripts/koto-loudness-study.mjs /private/tmp/lumen-koto-evaluation
```

`loudness/study.json`へFFmpeg版・filter条件・基準・997 Hz設定確認・WAV/manifest/script hash・raw/整合済み実測・提案の採否・限界を保存します。生のmeterログは同じlocalディレクトリに保持し、会話へ展開しません。
