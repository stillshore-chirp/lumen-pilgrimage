# 箏の単音サンプルとハイブリッドの加工・制約

この文書は録音候補から単音を加工する方法と、物理モデルへ接続する設計の正本です。権利・倫理と原出典は[候補の採否](koto-sample-selection.md)、音源全体の実測は[比較測定](koto-measurements.md)、物理モデルの根拠は[物理音源の研究](koto-physical-research.md)を参照します。所有者による配布候補の初回試聴では箏の音色同定が未達でした。判定は[音源設計の聴感記録](koto-instrument-design.md#所有者による初回試聴と再設計の判断)を参照し、音高・波形の合格を自然さの合格へ読み替えません。

現在の配布は、ここに残す初回5根/hybrid比較から変更した。[追加240 Hz・有限時間加工4根の採否](koto-sample-selection.md#追加240-hzと現在の配送)と[現採用方式](koto-instrument-design.md#今回の区切りの採用方式)を参照する。以下の初回処理・比較の数値は履歴として保持する。

## 原理から実装への対応

| 要求・根拠 | 適用と限界 | 実装・検証 |
| --- | --- | --- |
| Smith, Bandlimited Interpolation の [Theory](https://ccrma.stanford.edu/~jos/resample/Theory_Ideal_Bandlimited_Interpolation.html) と [Implementation](https://ccrma.stanford.edu/~jos/resample/Implementation.html)。理想sinc補間、低い側のNyquist以下への帯域制限、有限窓と計算量・遷移帯域の関係を実読。 | 再生位置を変えるとき、読み飛ばす元サンプルの帯域を事前に制限する。有限長Blackman窓64 tap・512分割位相表は本実装の設計値であり、原典のKaiser窓実装をコピーしていない。音高と胴モード・時間長が一緒に変わる制約は残る。 | [`kotoSampleModel.ts`](../../src/coast/world/lake/kotoSampleModel.ts) の `interpolationTable` と `renderSelectedSample`。+5半音の20 kHz正弦波fixtureで折返し抑圧を測定。 |
| [Erkutほか, Extraction of Physical and Expressive Parameters for Model-Based Sound Synthesis of the Classical Guitar](https://aaltodoc.aalto.fi/server/api/core/bitstreams/a290c5f2-9a62-4d17-ba32-160615a9c670/content) §1–3。実録音から音高・倍音の振幅/周波数/位相・減衰を校正し、逆フィルター等で励振を得る方法と、非指数減衰・beating・表現の限界を実読。 | ギターの方法を箏の実測値と混同しない。今回の短い非無響録音では弦/胴の逆モデル校正を完了していないため、単音wavetableや録音attackを「校正済みcommuted synthesis」と呼ばない。 | 主基音と倍音エネルギーで候補をscreenし、別弦混入の強い低音区間を不採用。録音は限定音域の比較、物理音源は全音域へ適用する。 |
| [Välimäki・Tolonen, Multirate Extensions for Model-Based Synthesis of Plucked String Instruments](http://users.spa.aalto.fi/vpv/publications/icmc97-mr.pdf), ICMC 1997, pp.244–247, §3–4。励振残差から長い胴共振を分離し、短いattackと別の減衰部を扱う方法を実読。 | 録音attackと物理tailを区別する設計上の根拠。ギター論文の22/11 kHzや50/100 msを箏の合格値に転用しない。今回の3.5 kHz・約75–145 msは比較用の設計仮定として測定する。 | `renderHybridKotoNote` は録音の高域だけを交換し、物理モデルの基本音・胴・余韻を残す。fundamentalの無根拠な二重加算を行わない。 |

## 編集元と再現

元入力は本人演奏として公開された公式MP3プレビューの取得可能部分を48 kHz/stereo/PCM16へdecodeしたものです。96 kHz/24 bitの原WAVではなく、プレビュー末尾の完全性も確認していません。採用cutは取得部分の末尾から離れています。十三弦の個体であるかは未確認です。

[`prepare-koto-samples.py`](../../scripts/prepare-koto-samples.py) は既知のdecode SHA-256を必須とし、ネットワーク取得や認証を行いません。入力が異なれば停止します。公式プレビュー取得・decodeの証拠は[採否台帳](../../assets/lake-audio/sample-manifest.json)に対応付けます。

```sh
python3 scripts/prepare-koto-samples.py \
  --source-dir /path/to/reviewed-preview-decodes \
  --output-dir /tmp/koto-sample-rebuild
```

実行済み環境はPython 3.14.5、NumPy 2.4.6です。これはオフライン加工用で、ブラウザー配布へPython/NumPyを追加しません。出力はmono PCM16 WAVと `bank.json` です。[配布比較用bank](../../public/lake-audio/samples/bank.json)にはsource hash、cutの秒・frame、root周波数、加工値、WAVのhash/bytesが入ります。別ディレクトリへの再生成で5 WAVとJSONがバイト単位で一致しました。

| 単音ID | 元source | cut秒（終端は含まない） | root Hz | 長さ | 制約 |
| --- | --- | --- | --- | --- | --- |
| low-151 | 365242 | 30.803–31.650 | 151.823 | 0.847秒 | 低い基音が弱く第3倍音が強い。G3へ約+4.42半音。 |
| mid-319 | 365215 | 49.572–49.840 | 319.530 | 0.268秒 | 後続の異なる弦の混入前に切るため短い。 |
| mid-452 | 365215 | 33.225–33.700 | 452.138 | 0.475秒 | 次の発音前に切るため自然な全余韻は保持できない。 |
| high-640 | 365215 | 25.849–26.180 | 638.586 | 0.331秒 | 音高の細かな揺れがある。次の発音前に切る。 |
| high-792 | 365215 | 13.028–14.200 | 792.885 | 1.172秒 | 後半は信号が小さくなり、beatingと背景成分が相対的に増す。 |

各開始は1 ms RMSから推定したattackの3 ms前です。全cutで同じ物理マイク側のchannel 0を使います。左右の相関がmid-452で−0.467、high-640で−0.285だったため、平均による音色・レベルの変化を避けました。これはステレオ定位の復元ではなく、比較音源をmonoに固定する処理です。

処理はcutごとの平均DC除去、0.5 msのsine²立ち上がり、55–100 msのcosine²終端、bank共通gain 0.7849、PCM16量子化です。音別の正規化、圧縮、denoise、loop、time stretchは行いません。cutごとの録音強弱・マイク周波数応答・奏者の力の違いは残ります。

初期73–253 msの倍音近傍エネルギー比は0.9846–0.9991です。これは別弦・雑音を探すscreenであり、孤立実演や声の不存在の証明ではありません。低い202/228 Hz付近の別候補には別の基音が主音に対して約−11〜−19 dBあり、採っていません。楽曲の音列、即興phrase、録音全体は流用しません。第三者の会話・音楽・実演がないことの人間による聴取確認は未実施です。

## サンプル再生の契約

`renderSampleKotoNote(note, bank, sampleRate)` は `{samples, diagnostics}` を返します。bankは事前decodeした `KotoSample[]` を比較hostから渡します。外部サービスやAudioContextをこのモジュールから作成しません。`kotoSampleSupports` で可用性を調べられ、未対応音は `KotoSampleUnavailableError` の `code='KOTO_SAMPLE_UNAVAILABLE'` で区別します。壊れた入力の例外を未対応扱いへ隠しません。

rootの選択は押し手前後を含めて±5半音以内で、最大移調幅が最小の単音です。上限は少数rootによる大きな音色変化を限定する比較用の設計値であり、±5半音なら自然だという聴感合格値ではありません。13弦のD4/G3/A3/B♭3/D4/E♭4/G4/A4/B♭4/D5/E♭5/G5/A5のうち、A3とB♭3は未対応です。したがって純サンプルによる39秒の全曲は提供できません。

velocityは録音時の未知の力を再現するlayerではなく、基準0.6に対する振幅倍率です。pluckPositionは元録音で固定です。押し手は0.10–0.36秒の滑らかな再生rate変化で近似し、胴モード・時間長も変わります。消音は0.10秒で60 dBの振幅減衰を加える近似であり、指の接触音や胴の再励振を追加しません。元cutが消音時刻より先に尽きる場合、消音奏法を実証したとは扱いません。

## ハイブリッドの接続と位相

`renderHybridKotoNote(note, bank, physicalRenderer, sampleRate)` は同じ形式を返します。未対応音は `diagnostics.method='physical-fallback'` と理由を返し、その音に録音attackがないことを明示します。

129 tapの対称Blackman窓FIRで3.5 kHzの低域 `L(x)` を作り、高域を `H(x)=x−L(x)` と定義します。オフライン対称畳み込みは64 frameの群遅延を補償します。物理波形をP、録音をS、録音重みをwとすると、接続は `L(P)+N[(1−w)H(P)+w·g·H(S)]` です。基本音や低い胴成分を丸ごと2音重ねる構成ではありません。

gは初期4 msからhandoff開始までの高域RMSを合わせる倍率で、上限4とします。小さい録音のcodec/マイク雑音を無制限に増幅しません。gain下限0.25を設けた試作は一部音域の高域energyを最大約4.3 dB増幅したため撤廃しました。

初期窓で測った相関ρから、`N=1/sqrt(max(0.25,(1−w)²+w²+2ρw(1−w)))` とします。これは分散の加算式から導いた本実装の接続補正で、音楽知覚の合格を保証しません。相関は±0.95、補正は最大2へ制限します。通常は約75–145 msのcosine²移行で物理高域へ戻り、短cutは利用可能長に合わせて前倒しします。冒頭0.5 msをfadeしてFIRの先読み由来の不連続を抑えます。150 ms以降は元の物理波形とサンプル単位で一致します。

## 根音と音域一貫性の追加監査

追加の私有240 Hz候補を含む6 cutを、想定音高近傍のピークだけに拘束せず監査した。FFTの全局所ピーク、非拘束lag scan、差分関数、`f/2`・`f`・`2f`の奇数倍音系列と小数周期補間を複数窓で照合した。240 Hzは481 Hzが最大でも240/720/1200 Hz系列と時間周期が支持した。792→396 Hzや319→159.8 Hzの付替えを支持する強い下位奇数系列は得られず、638 Hzの弱い319/958/1596 Hz成分は弱modeか前音重畳か識別不能として残した。音高の検査を単一弦や十三弦個体の証明にはしない。

6根bankを同velocityで13弦へ割り当てた実出力では、240→319 Hz根の境界で第2倍音/基音が約+13.4→−13.9 dB、有効長823→287 ms、初期150 msのRMSも6.55 dB変わった。638→792 Hz根でも同部分音比−13.5→+1.0 dB、有効長329→996 msだった。自然な音域差を含むため、これだけで所有者の聴感の原因や異なる楽器と断定しないが、収音・奏法・levelを揃えた素材比較を優先する根拠になる。

弱0.3/強0.9は、全13弦でgain整合後の相関が約1、差分最大約−148.6 dBで、音量以外の強弱差を持たなかった。現行の単一velocity layerの制約を「自然な強弱を実現」と説明しない。同音弦1/5も同じwaveformを使っており、別弦の実録差や反復変動を収録済みとはしない。

## 実測と未評価

Node 22.23.4・48 kHz・velocity 0.6・seed 197・1.5秒、13弦の同一入力で24個の実波形を比較しました（純サンプル11、hybrid13、重複D4を含む）。65–195 msの窓で測った音高誤差は純サンプル最大3.22 cents、hybrid最大1.52 cents、非有限値0、DCは全て−100 dBFS未満でした。hybridの150 ms以降の物理波形との差は0、最大初終端差は約−116 dBFSでした。測定は短窓・その時点の物理モデルに限り、録音全体の音高安定性は証明しません。

別の正弦波fixtureを+5半音へ移調したとき、元20 kHzの折返し成分は1 kHz基準で−79.45 dB、元15 kHzの通過差は−0.36 dBでした。これを全入力・全rateの保証値にしません。単音samplerとhybrid追加処理は1回約5–34 msでしたが、JIT・GCを含むNodeオフライン観測で、ブラウザーの実時間CPUや実機の聴感ではありません。全比較と環境は[測定正本](koto-measurements.md)を優先します。

生成fixtureでの恒久回帰は [`koto-sample.test.mjs`](../../scripts/koto-sample.test.mjs) です。未対応音と壊れた入力の区別、alias抑圧、実際のattack差、物理tailの同一性、gain下限の再混入、zero velocity、cutをloopしないことを確認します。実録音の権利・自然さ・長時間性能はこのテストから認定しません。
