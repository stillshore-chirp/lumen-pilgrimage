# 箏音源の識別可能性を調べた任意R&Dツール

採用しなかった二方式の入力固定版の数値研究を再現するための自作スクリプトです。現行の理論・採否の正本は[物理研究](../../../docs/lake/koto-physical-research.md)です。音声生成・加工・ダウンロードは行わず、JSONだけを書きます。npm、ブラウザー、通常のcheckには接続しません。原著のコード・図・本文・CTデータは同梱していません。

## 準備と入力

実測環境はPython 3.13.4、macOS arm64です。数値依存はこの研究用の [requirements.txt](requirements.txt) に固定しています。任意の作業ディレクトリで専用venvを作り、明示的にインストールしてください。プロジェクトのPython環境へ追加する必要はありません。

```sh
python3.13 -m venv /path/to/research-venv
/path/to/research-venv/bin/python -m pip install -r scripts/research/koto-identifiability/requirements.txt
```

`matrix_pencil.py` の既定入力はリポジトリの `public/lake-audio/samples/bank.json` と、そこにある `low-151.wav` です。commuted実験は240 Hz根を含む同梱6根 `public/lake-audio/samples/recorded-bank.json` を引数で指定します。研究時点は私有候補でしたが、今回の終了時に権利・加工経路を台帳へ登録して同梱しました。

入力は48 kHz・mono・PCM16、bank形式は `samples` 配列に `id`、`path`、`rootFrequency`、`durationSeconds`、`fadeOutSeconds` を持つJSONです。WAVのpathはbankからの相対パスです。commutedの6 IDは `low-151`、`mid-319`、`mid-452`、`high-640`、`high-792`、`low-240-candidate`。私有の5根コピーを使う場合も、同梱版とのhash一致を [measurement-snapshot.json](measurement-snapshot.json) で照合できます。

## 実行

リポジトリrootから、JSONの保存先を明示します。importだけでは解析を実行しません。

```sh
/path/to/research-venv/bin/python scripts/research/koto-identifiability/matrix_pencil.py --output /path/to/results/matrix.json
/path/to/research-venv/bin/python scripts/research/koto-identifiability/commuted.py --bank public/lake-audio/samples/recorded-bank.json --output /path/to/results/commuted.json
```

出力には入力hash、使用環境、窓とモデル条件、予測誤差、極や係数を含みます。`matrix.json` はpencil・安定1/2 mode・学習窓の感度・接続末尾の数値、`commuted.json` は部分音特徴とleave-one-root/lossの解析を `study`、rootとwindowの同時holdoutを `joint` に保存します。入力音や元の比較manifestは上書きしません。

## 151 Hzの近接減衰モード

原典は [Hua／Sarkar 1990](https://escholarship.org/content/qt2n45r2z5/qt2n45r2z5.pdf)、IEEE TASSP 38(5), 814–824、§II・式2.14–2.17、§IV–Vです。rank打切SVD、pencil長、雑音・近接極の感度を本文確認し、独自実装しました。

- 151根1本を4 kHzへ変換して推定し、元の48 kHz波形でも誤差を評価。
- 学習0.457–0.687秒、未使用holdout0.707–0.773秒。20 msの間隔は変換FIRの支持より長い。
- pencilは実指数対rank24/48、長さN/3とN/2。成長極を安定側へ反射しない。
- 1〜12次へ各1/2 modeを当て、周波数±1.8%、減衰率0〜120 s⁻¹。位相・振幅を含む共同最小二乗。2 modeの上限1000反復、開始窓±40 ms。既存研究で行った限定条件を固定し、新たな総当たりは加えていない。

1 modeの学習／holdout相対RMS誤差は約0.139／0.266、2 modeは0.077／0.239でした。窓を変えると低次の極が変わり、減衰ゼロ境界や相殺が残りました。末尾35 msの残差も2 modeで約0.286です。**観測内の説明は改善しても、この短い根から自然な継続振動や二偏極を同定できたとは判定しません。** 他弦、反射、非定常、圧縮録音も除けていません。この判断は全modal法の否定ではなく、この入力と外挿用途の不採用です。

## 固定胴・励振の分離

一次資料はSmithのCCRMA公式 [Commuted Synthesis](https://ccrma.stanford.edu/~jos/pasp/Commuted_Synthesis.html) と [Building a Synthetic Guitar Bridge Admittance](https://ccrma.stanford.edu/~jos/pasp/Building_Synthetic_Guitar_Bridge.html)。LTI交換、励振と共鳴器、反射と放射、受動性の範囲だけを使用し、ギターの数値・音色は移植していません。

- 6根の1〜6次を20–60／60–100／100–140／140–180 msのHann窓で測定。周波数を選ぶFFTは最初3窓だけを使用。
- 励振の次数別5係数、共通の絶対Hz曲率3係数。gainとconstant/tiltの不定性を固定してleave-one-rootを比較。
- 共有lossは非負の `σ=a+b(f/1000)²`。他の5根の最初3窓から、残した根の最後窓を予測。
- 次数5・胴曲率3・f²-loss1の計9係数を共同推定し、rootと最後窓を同時に外した比較も保存。

共通Hz曲線でleave-one-root誤差は15.66→8.79 dBへ改善しましたが、root＋window同時holdoutでは14.67 dB、共有lossも定数11.42 dBに対して11.50 dBで改善しません。共通曲線は励振の固定距離combでも生じ、安定可逆フィルタを胴と励振へ付け替える不定性も残ります。**胴の複素IR・弦内損失・橋の受動性を識別できたとはせず、新しいDWG音声へ進む根拠にはしません。** 押し手では弦が時変になりLTI交換も近似です。周期再循環を自然な持続と読み替えません。

## 保存値と限界

[measurement-snapshot.json](measurement-snapshot.json) は過去の測定を小さく抜き出した1件です。入力hash、使用version・環境、主要誤差、不採用理由だけを保持し、録音・原著本文・全学習データを含みません。パッケージ化では全探索を再実行せず、構文/import、元スクリプトの数値関数のAST、既存結果との整合を一度確認しました。異なるBLASや環境でのbit一致は保証しません。

この研究のJSONや数値は人間の箏同定・自然さ・美しさの合格を代行しません。同梱入力と保存値のhashを照合し、全探索を再実行した範囲と保存結果の確認を区別してください。
