# 素材の所在と再現手順

`public/` は配布時にそのまま読み込む完成素材、`src/` は実行時に地形・形状・材質・音響を組み立てる正本です。素材ごとの権利者、ライセンス、クレジット、加工記録は各 `ATTRIBUTION.md` を正本として参照してください。差し替えや新しい出力を加える場合は、同じ変更で該当するクレジットも更新します。

## 素材の選定・採用・加工

録音、画像、3Dモデル、地理・計測データ、ライブラリ、既製アセットと、独自に生成・制作する素材の選定には、個別に調査を依頼されていなくても[専門分野の業務工程](agent-harness.md#専門分野の業務工程)を適用します。外部採用の権限と権利確認は[外部素材と技術方式の採用](agent-harness.md#外部素材と技術方式の採用)、受け入れの設計と評価は[検証手順](verification.md#制作前の検証設計)に従います。

1. **用途と候補を照合する** 対象の設計正本から、必要な形状・信号・表面特性、利用距離・視点・聴取位置、配置、処理、対象環境を確認します。録音は音源の内容と収録条件だけでなくループ・空間配置・残響との組合せ、3Dモデルや仕上げ材は寸法・輪郭・材質と照明・移動境界との整合も比較します。独自制作と外部採用の候補は、科学技術上の妥当性、知覚品質、機能、性能、権利、保守、再現性、検証可能性で比較し、対象の設計資料またはIssueに採否と理由を記録します。
2. **予定する取得・加工・配布の経路を確認する** 提供元の一次情報と利用条件の該当箇所を、下記の受け入れ記録へ残します。参照だけか、改変して取り込むか、ビルドに同梱するか、実行時に取得するかを明記し、配布されるファイルと必要な表示・ライセンス文・添付物の配置を決めます。技術方式の権利情報、遵守可能性・管理負担、懸念がある候補の扱いは、[外部素材と技術方式の採用](agent-harness.md#外部素材と技術方式の採用)に従って判断します。
3. **加工して実装へ組み込む** 編集元や取得物を保持し、座標・寸法・ピボット、色や材質の扱い、音声のチャンネル・サンプルレート、データの座標系など、実装側が要求する契約へ合わせます。使用ツール・版・設定・コマンドと、設計した配置・処理の実装箇所を記録し、編集元から配布物までたどれる状態にします。
4. **同じ利用条件で成果物を確認する** 加工後のファイルと実装上の配置・処理を、制作前に定めた受け入れ条件で評価します。[差し替え後の確認](#差し替え後の確認)に加え、素材固有の見え方・聞こえ方・操作・性能を確認し、採用時の期待と実際の結果、残る制約を記録します。

### 参考画像と解析用の派生物

参考画像の分析には[段階的解析](agent-harness.md#参考画像の段階的解析)を適用します。原資料のID・版またはhash、取得元、原寸・縦横比・向き、利用できる解像度を記録し、グリッドと対象別切り出しを原画像の矩形座標へ対応付けます。切り出し・表示倍率・色変換等の処理と再取得方法を残し、補間や生成で追加した細部を原資料で観察した事実にしません。解析・設計の記録は対象の設計正本、制作候補との比較条件と結果は[検証記録](verification.md#ワールド制作の検証記録)へ置きます。

参照できることと再配布できることを分け、原画像・切り出し・比較図・画面への重ね合わせごとに公開条件を確認します。公開できない資料は配布ツリーや公開添付物へ入れず、許される範囲の資料ID・参照箇所・観察結果・確認方法で追跡します。出典と利用条件の記録は下記の受け入れ記録と該当クレジットへ集約し、同じ画像の派生物ごとに矛盾する権利判断を作りません。条件を満たす素材の採用権限は既存の自律採用規則に従います。

## 素材の受け入れ記録

素材を追加・差し替え・再現するときは、次の項目を記録します。素材ごとの出典・権利条件・加工記録は該当する `ATTRIBUTION.md`、科学技術上の根拠・モデル・仮定と設計判断は対象の設計資料、工程の実績はIssue・PRへ残し、相互に参照します。取得できなかった値や残る不確実性は未確認と明示します。過去の調査や採用記録を再利用するときは、出典・適用条件・現行要件・変更の影響を照合し、記録の存在だけで現在の条件への適合を認定しません。

| 項目 | 素材選定から検証まで追える記録内容 |
| --- | --- |
| 原本・取得元 | 編集可能な原本の場所、または配布元・取得先と素材・データの識別情報。調査の出典の参照箇所と適用条件、候補の比較・採用理由を対象の設計資料からたどれるようにします。 |
| 出典・利用条件 | 権利者・提供者、ライセンス、確認した一次情報と確認日、必要な表示・添付物、改変・再配布条件。予定する利用・改変・同梱・配布との対応、関連する技術権利、遵守可能性・管理負担と代替の判断を記録し、該当する `ATTRIBUTION.md` を更新します。 |
| 作成・加工 | 使用ツールと版、設定値、実行コマンド、入力素材から出力までの手順。根拠とモデル・仮定から選定・加工・配置・処理をどう設計したか、制作物と実装のどこへ反映したかを対応付けます。 |
| 出力・実行条件 | 生成物の形式・配置、実行時の依存や制約、対象ブラウザー・品質設定などの条件。編集元・取得物・加工後の配布ファイルの対応を記録します。 |
| 検証・証拠 | 制作前に定めた受け入れ条件、代表的な手順、入力・機器・利用条件、期待結果と実結果、確認用画像・音声・測定値・ログの参照先、確認できた範囲と未確認事項・制約。 |

## 外部音声の採用基準

本節は新たに採用・差し替える外部音声の恒久ルールです。[専門分野の業務工程](agent-harness.md#専門分野の業務工程)と併せて適用し、録音の採用後も原典調査、物理・演奏・信号処理の設計、実装、実音の測定・知覚評価を継続します。条件を満たす音声の調査・取得・加工・組み込みは依頼の範囲で自律的に進め、プロジェクト所有者の事前承認を通常工程に追加しません。第三者から必要な許諾と、認証・権限・ツールの境界は守ります。

### 採用の10原則

1. **一次出典を確認する** 公式配布ページ、制作元、提供者、権利者、ライセンスの本文と対象ファイルを調査します。検索結果、転載サイト、ライブラリ全体の表示だけで個別音声を認定しません。
2. **CC0を優先して比較する** 予定用途に適合するCC0音声を優先候補にします。CC0以外のライセンスを恒久的に一律禁止せず、既存素材の撤去も自動で要求しません。案件限定の条件は対象と期間を採用記録へ明記します。
3. **CC0表示を保証と扱わない** 適用主体が持つ権利の範囲、表示の信頼性と矛盾を確認します。CC0は権利保有・非侵害・品質を保証せず、他者の権利を消しません。
4. **権利の層を分ける** 録音物、実演、楽曲・編曲、取り込まれた第三者サンプルと、人格・プライバシー等の権利を別々に調べます。録音者によるCC0だけで作曲者や別の実演家まで許諾済みにしません。
5. **実際の利用経路を照合する** 切り出し、調音、加工、音源生成、ゲームへの組み込み、ビルド同梱、公開リポジトリでの再配布を区別し、各経路が利用条件に合うことを確かめます。楽曲利用可を単音集の再配布可に読み替えません。
6. **品質と運用を評価する** 楽器種・奏法・音域・強弱、マイク・収録空間・残響、雑音・混入音・圧縮、音響処理との適合を比較します。音高・立ち上がり・倍音と減衰・消音・ループ・性能を対象用途で測り、取得・加工の再現性、容量、保守を評価します。数値と人間の聴感評価は別に記録します。
7. **実演家の表現を尊重する** 特定の実演家の創作的な演奏・フレーズ・編曲や個性的表現を、権利根拠なく複製・模倣しません。単音採取と特徴的な演奏の再現を区別し、本人の関与・推薦・共同制作を誤認させません。
8. **制作者の意思と目的を確認する** 法的条件とは区別して、クレジットの希望、無加工販売への意向、文化的・人格的文脈と予定用途の倫理上の懸念を調べます。法的に必須でない希望も、合理的な範囲で設計・配布へ反映します。
9. **解消できない候補を採らない** 合理的な調査で解消できない権利・倫理上の懸念が残る素材は不採用にし、別候補または独自合成を進めます。不明な候補を所有者承認待ちへ移すことで採用根拠を代替しません。取得・再配布が未確定の音声は公開・配布ツリーに置きません。
10. **根拠と必要な表示を残す** 下記の素材台帳、採否比較、ライセンス確認記録、加工・配布対応、必要なクレジットを同じ変更へ含めます。確認済み事実、推論、未確認、未実施を分け、絶対的な法的安全や未実施の聴取を宣言しません。

音高を割り当てる録音・楽器サンプルでは、根音を最大スペクトルピークだけで決めないでください。複数の時間窓で倍音系列と時間周期を照合し、オクターブ候補、減衰・混入・測定限界を記録します。基音推定の成立を、単一弦・楽器種・奏法の証明へ広げません。bankとして使う場合は、個々の素材に加えて音域境界と強弱を実際の割当・加工後の音で比較し、音量だけの変化を音色の強弱表現と認定しないでください。根拠・結果・未確定事項は台帳13と設計正本から追跡できるようにします。

### 音声台帳の14項目

素材単位の権利・配布条件は `public/**/ATTRIBUTION.md`、機械的に照合するファイル対応は素材ディレクトリのmanifest、候補比較と音響設計判断は対象の設計資料を正本にします。長い原文の無断再配布や同じ事実の多重転記を避け、URL・参照箇所・短い表示記録で結びます。値が不明なら空欄でなく未確認と理由を記し、採用可否への影響を示します。

| 項目 | 必要な記録 |
| --- | --- |
| 1. 素材名・ファイル名 | 一意な素材ID、原ファイルと加工物の名前、楽器種・弦数等の確認範囲。 |
| 2. 制作者・録音者・演奏者 | 役割を分けた氏名・公開名と一次根拠。役割を本人と推定した場合は推定と明記。 |
| 3. 公式出典 | 原配布ページURL、素材ID・版、制作元との対応。 |
| 4. ライセンス明示先 | 個別音声の表示URL、ライセンス名・版、法文URL、対象外部分・追加条件の有無。 |
| 5. ライセンス確認日 | CC0等の表示と法文を確認した日付。過去記録の再利用なら今回の再照合範囲。 |
| 6. 確認時刻・表示証拠 | タイムゾーン付き時刻、確認した節・リンク・短い表示、確認方法。後日の変更と区別できる記録。 |
| 7. 適用主体・権利範囲 | CC0等を適用した主体、録音・実演・楽曲等どこまで権利を合理的に確認できたか。 |
| 8. 第三者権利・倫理 | 楽曲・編曲・実演・録音・第三者音源・人格等の調査、制作者の意思と用途、矛盾や懸念への判断。 |
| 9. 元ファイルの同一性 | 取得物のSHA-256とバイト数。原WAVか公式の圧縮プレビューかも区別。 |
| 10. 取得・加工 | 合法な取得URL・取得時刻、ツールと版、切出し範囲・フィルター・調音・変換・正規化等の設定とコマンド。 |
| 11. 配布物への対応 | 元ファイルから各配布物への対応、出力形式・SHA-256、公開範囲、必要な表示・添付物。 |
| 12. 実使用箇所 | 読み込み・音源生成・演奏・空間処理のコード、ビルドへの取り込み先。未採用候補は使用なしと明記。 |
| 13. 音響品質の評価 | 同条件の比較対象、計測・試聴の方法と結果、採用・限定利用・不採用の理由。聴感未評価は明記。 |
| 14. 残る不確実性 | 解消できない事項と影響、必須の未検証、採否・使用制限・代替策。 |

CC0の解釈は [CC0 1.0 Legal Code](https://creativecommons.org/publicdomain/zero/1.0/legalcode) §1–4 と [CC0 FAQ](https://wiki.creativecommons.org/CC0_FAQ) の権利範囲・隣接権・表示・保証に関する項目を参照します。CC0は適用主体自身の著作権・関連権を法の許す範囲で放棄し、無効な範囲にはライセンスの仕組みを置きます。実演家・録音製作者等の隣接権を含み得ますが、別の作曲者等の権利、放棄できない人格権、他者の権利、商標・特許まで一括で消去する仕組みではありません。帰属表示はCC0の法的条件ではありませんが、出典追跡と倫理上の希望に応じて表示します。

案件例は[箏実録音の採否](lake/koto-sample-selection.md)を参照してください。新規素材の探索開始、Ready、レビュー、完了では、台帳と実ファイル・実装・検証を照合し、採用したという事実だけで音質や全体の完了を認定しません。

## 現行素材と編集元

外部音声の台帳と配布物の機械的な対応は `npm run validate:audio-samples` で検査します。[検査実装](../scripts/validate-audio-samples.mjs)は採用状態、必要欄、案件固有ライセンス、配布hash/bytes、使用パス、管理対象音声の未記録を扱います。個別の法的・倫理的妥当性や人間の聴感は合格にしません。新しい音声群では、台帳へ配布物と生成物・入力source IDを登録し、元音声を公開しない場合も実取得物のhashと再現経路を保持します。

| 対象 | 配布物と出典 | 実装の正本 |
| --- | --- | --- |
| 海岸・森・参道 | [`public/coast-materials/`](../public/coast-materials/) の WebP と4つの GLB。出典・利用条件は[景観素材のクレジット](../public/coast-materials/ATTRIBUTION.md)。 | 地形、植物、鳥、海、滝などは [`src/coast/world/`](../src/coast/world/) の TypeScript で生成。画像と3Dモデルの読込は [`coastSurface.ts`](../src/coast/world/coastSurface.ts)、[`coastSceneryAssets.ts`](../src/coast/world/coastSceneryAssets.ts)、[`coastVegetation.ts`](../src/coast/world/coastVegetation.ts)。 |
| 海岸の環境音 | [`public/coast-audio/`](../public/coast-audio/) の録音。出典・ライセンス・記録された編集内容は[環境音素材のクレジット](../public/coast-audio/ATTRIBUTION.md)。 | 再生・配置・音響処理は [`CoastAudio.ts`](../src/coast/CoastAudio.ts) と各ワールドの音響モジュール。録音ファイルはビルド時に同梱し、実行時に外部サービスから取得しません。 |
| 丘陵展望台と共有する街並み | [`public/coast-overlook/`](../public/coast-overlook/) の標高グリッド、街路画像、建物・街灯配置、録音。取得元と利用条件は[展望台の出典](../public/coast-overlook/ATTRIBUTION.md)。 | 変換は [`prepare-overlook-elevation.py`](../scripts/prepare-overlook-elevation.py) と [`prepare-overlook-city.py`](../scripts/prepare-overlook-city.py)。地形・街路・建物の描画は [`overlookTerrain.ts`](../src/coast/world/overlook/overlookTerrain.ts) と [`overlookCity.ts`](../src/coast/world/overlook/overlookCity.ts)。 |
| 都心70階の住戸 | [`public/residence-materials/`](../public/residence-materials/) の仕上げ材と [`public/residence-audio/`](../public/residence-audio/) の電子レンジ完了音。出典と条件は[住戸の仕上げ材](../public/residence-materials/ATTRIBUTION.md)・[住戸の録音](../public/residence-audio/ATTRIBUTION.md)。交通音は展望台と同じ `distant-traffic.ogg` を使います。 | 平面・壁・開口は [`residencePlan.ts`](../src/coast/world/residence/residencePlan.ts)、材料は [`residenceMaterials.ts`](../src/coast/world/residence/residenceMaterials.ts)、都市と交通音は [`residenceCity.ts`](../src/coast/world/residence/residenceCity.ts)・[`residenceAudio.ts`](../src/coast/world/residence/residenceAudio.ts)。 |
| 映画館と仮想モニター | 映画館の設計資料は[平面図](cinema/cinema-floor-plan.pdf)と[光・音の設計](cinema/cinema-light-sound-design.pdf)。仮想モニターの映像は接続した配信元から実行時に受け取ります。 | 映画館の形状・仕上げ・空調音は [`src/coast/world/cinema/`](../src/coast/world/cinema/) で生成。モニターの面と接続映像は [`monitorObject.ts`](../src/monitor/monitorObject.ts) で生成・表示します。 |
| 映画館の生成仕上げ | [前板と黒い裏当て](cinema/cinema-speaker-mounts.md)、[壁・丸い張地の尺度](learning/modeling-materials.md#面の寸法と模様の周期を結び付ける)は独自の生成模様です。写真や製品素材を追加せず、壁の不透明模様と前板の透過coverageを区別します。 | [`cinemaSpeakerFinishes.ts`](../src/coast/world/cinema/cinemaSpeakerFinishes.ts)は共有512pxの色/coverageとheight、[`cinemaFinishes.ts`](../src/coast/world/cinema/cinemaFinishes.ts)は512px壁と128pxの織りを生成。8bit変換前に範囲をclampし、糸の明部が整数の折返しで黒点へ化けるのを防ぎます。張地と垂幕は画像を共有してUV変換を分け、床と垂幕の既存写像は保持します。 |
| 映画館の測定済みHRTF | [`public/cinema-audio/`](../public/cinema-audio/) のMIT KEMAR由来48 kHz・144 tap配布表。出典・利用条件・加工・バイナリ表仕様は[HRTFのクレジット](../public/cinema-audio/ATTRIBUTION.md)に記録します。 | [`prepare-cinema-hrtf.py`](../scripts/prepare-cinema-hrtf.py) が公式compact archiveから規則的な角度表を再生成します。上映側の読込・畳み込みは映画館の音響実装が所有します。 |
| 映画館の機器形状が使うソフトウェア | Three.js 0.184.0のMITライセンス全文と版・hashを[`public/licenses/`](../public/licenses/ATTRIBUTION.md)へ保存し、ビルドでは`dist/licenses/`へ同梱します。 | [`prepare-cinema-code-licenses.mjs`](../scripts/prepare-cinema-code-licenses.mjs)が実際のインストール済みpackageのLICENSEをバイト同一で転記。丸角筐体・支持・取付の[現行設計](cinema/cinema-speaker-mounts.md)から参照します。 |
| 商業アトリウム | [床材の取得と加工](../public/atrium-materials/ATTRIBUTION.md) · [合成環境音の内訳](../public/atrium-audio/ATTRIBUTION.md)。 | [建築・展示と音の編集先](worlds.md#商業アトリウム)。環境音の生成は [`atriumAudioSamples.ts`](../src/coast/world/atrium/atriumAudioSamples.ts)。 |
| 湖畔の広間 | [雲と植生の出典・生成と変換](../public/lake-materials/ATTRIBUTION.md)。小葉の[編集元PNG](../assets/lake-materials/lake-broadleaf-clusters.png)を保持。箏の加工単音と39秒生成曲は[音声クレジット](../public/lake-audio/ATTRIBUTION.md)・[採否台帳](../assets/lake-audio/sample-manifest.json)へ対応付け。木材と岩は既存の仕上げ材・景観素材を使用。 | [植生の形態と配置](lake/lake-hall-design.md#植生の形態と配置)、[樹木・低木・地被](../src/coast/world/lake/lakeVegetation.ts)、[卓上の有花枝](../src/coast/world/lake/lakeHallArrangement.ts) · [ワールドの編集先](worlds.md#湖畔の広間)。 |

商業アトリウムの新設施設では、木・布・紙の模様を [`atriumFrontMaterials.ts`](../src/coast/world/atrium/atriumFrontMaterials.ts)、植物の形状を [`atriumFrontGarden.ts`](../src/coast/world/atrium/atriumFrontGarden.ts) から生成します。調査資料の図版・写真・製品意匠は転写せず、出典と適用条件は [施設設計](atrium/sofa-facing-facility-design.md)に記録します。 大型カフェの低振幅の木・布・鉱物肌と独自メニューは [`atriumCafeInterior.ts`](../src/coast/world/atrium/atriumCafeInterior.ts) で生成し、既存の許諾済み石材と組み合わせます。寸法・UV周期・接触AO・生成条件は[大型カフェの設計](atrium/cafe-interior-design.md#詳細造作素材の製作仕様)を参照します。

### 画像・3Dモデル・録音の再作成

- 海岸の4つの GLB は `GLTFLoader` で読み込み、各モデルのメッシュ名と `MeshStandardMaterial` を実行時に参照します。`moss.glb` は `moss01`〜`moss06`、`shelf.glb` は `rockShelf`、`boulder.glb` は `rockBoulder`、`ferns.glb` は `fernA`〜`fernD` を持ちます。差し替え時も [`coastSceneryAssets.ts`](../src/coast/world/coastSceneryAssets.ts) にある名前を保ち、メートル単位、X/Z 中央、Y=0 の底面ピボットを使います。現在のファイルでは `EXT_texture_webp` が必須です。メタデータの `glTF-Transform v4.5.1` は確認できますが、編集可能なモデル原本、利用アプリ、変換コマンドはリポジトリにありません。元モデルとライセンスは景観素材のクレジットから確認してください。
- 石灰岩と積雲の画像は本プロジェクト向けに ImageGen で作成され、プロンプトは[景観素材のクレジット](../public/coast-materials/ATTRIBUTION.md)に残っています。生成モデルの版とシードは記録されていないため、同じ画像の再生成は保証できません。Poly Haven 由来の画像も完成 WebP のみがリポジトリにあり、元のテクスチャ一式や画像編集コマンドはありません。
- 海岸・展望台・住戸の従来の録音は、原出典とライセンス、記録された切り出し・フィルター処理を各音声クレジットへ残しています。配布用はOgg Opusの完成品で、元録音や再変換コマンドは含まれていません。箏の加工単音は[編集元と再現](lake/koto-sample-processing.md#編集元と再現)を参照してください。元プレビューの再ダウンロードは未再現、保持したhash固定入力からの加工再生成は一致、という範囲を区別します。

3Dモデルを差し替えるときは次の順で進めます。

1. [景観素材のクレジット](../public/coast-materials/ATTRIBUTION.md)から対象モデルの出典と利用条件を確認し、取得した元モデルを編集原本にします。現行GLBから元形状や編集レイヤーは復元できません。
2. 編集元からGLBを作り、現行の material map 参照、`EXT_texture_webp`、[`coastSceneryAssets.ts`](../src/coast/world/coastSceneryAssets.ts) が要求するメッシュ名と `MeshStandardMaterial`、メートル単位、X/Z中央とY=0の底面ピボットを保ちます。元の編集アプリと書き出しコマンドは不明です。`glTF-Transform v4.5.1` はファイル内のメタデータとして確認できます。新しい出力では使用ツール、版、設定、コマンドを記録します。
3. `public/coast-materials/scenery/<name>.glb` にステージします。
4. `npm run build` の後に `npm exec -- vite preview` を起動し、表示されたローカルURLの既定の海岸で形状と表面を目視確認します。`COAST_CHROME_CHANNEL=chrome npm run test:coast:browser` でもモデルを含む素材の読込と海岸の操作を確認します。自動試験は視覚的な一致までは保証しません。

### 標高・街路データの再生成

標高の入力 GeoTIFF と Census の ZIP はリポジトリにありません。出典、記録済みの標高取得範囲、道路アーカイブは[展望台の出典](../public/coast-overlook/ATTRIBUTION.md)を参照してください。標高は [USGS 3DEP ImageServer](https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer) の `exportImage` を使います。リクエスト方式と `bbox`、`size`、座標系、画素形式、補間、TIFF 圧縮などの引数は [Esri の REST API リファレンス](https://developers.arcgis.com/rest/services-reference/enterprise/export-image/)に記載されています。

再取得時は `bboxSR=4326`、`imageSR=4326`、`format=tiff`、`pixelType=F32`、`compression=None`、`interpolation=RSP_BilinearInterpolation`、`adjustAspectRatio=false`、`f=image` を指定します。寸法は広域 `641,513`、近景 `321,321` です。広域の元リクエスト範囲は上記クレジットに記録されています。近景の元リクエスト範囲は記録されていません。現行 `HILL` グリッドのヘッダーから求めた近似 pixel-edge 範囲は、広域 `-118.5499380,33.8511237,-118.0508620,34.2505403`、近景 `-118.3117920,34.1070380,-118.2890080,34.1298220` です。これらは出力から推定した範囲で、元の取得範囲を示す証拠ではありません。広域はヘッダー推定値とクレジット記載値で南北範囲が異なります。

ヘッダー推定範囲で行った取得・変換では、両グリッドの範囲は現行ファイルから 0.004 m 以内でしたが、標高値には最大 0.25 m の差があり、バイト列は一致しませんでした。元の GeoTIFF が保存されていないため、同じ出力の再生成は未確認です。取得範囲の食い違いが解消するまでは、生成物を直接上書きしないでください。

```sh
ASSET_STAGE="$(mktemp -d)"
USGS_EXPORT_URL='https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage'
export_image() {
  curl --get --fail --silent --show-error "$USGS_EXPORT_URL" \
    --data-urlencode "bbox=$1" \
    --data-urlencode "size=$2" \
    --data-urlencode 'bboxSR=4326' \
    --data-urlencode 'imageSR=4326' \
    --data-urlencode 'format=tiff' \
    --data-urlencode 'pixelType=F32' \
    --data-urlencode 'compression=None' \
    --data-urlencode 'interpolation=RSP_BilinearInterpolation' \
    --data-urlencode 'adjustAspectRatio=false' \
    --data-urlencode 'f=image' \
    --output "$3"
}

export_image '-118.5499380,33.8511237,-118.0508620,34.2505403' '641,513' "$ASSET_STAGE/overlook-regional.tif"
export_image '-118.3117920,34.1070380,-118.2890080,34.1298220' '321,321' "$ASSET_STAGE/overlook-nearby.tif"
python3 scripts/prepare-overlook-elevation.py "$ASSET_STAGE/overlook-regional.tif" "$ASSET_STAGE/overlook-nearby.tif" --output "$ASSET_STAGE/elevation-check"

# Download the credited archive into the temporary stage; it is not a repo input.
curl --location --fail --silent --show-error \
  'https://www2.census.gov/geo/tiger/TIGER2025/ROADS/tl_2025_06037_roads.zip' \
  --output "$ASSET_STAGE/tl_2025_06037_roads.zip"

# This tested optional environment uses Python 3.14.5, NumPy 2.4.6, and Pillow 13.0.0.
python3 --version
python3 -m venv "$ASSET_STAGE/venv"
"$ASSET_STAGE/venv/bin/python" -m pip install numpy==2.4.6 Pillow==13.0.0

# The city script writes beside its own scripts/ directory, so copy it into the stage.
mkdir -p "$ASSET_STAGE/scripts"
cp scripts/prepare-overlook-city.py "$ASSET_STAGE/scripts/"
"$ASSET_STAGE/venv/bin/python" "$ASSET_STAGE/scripts/prepare-overlook-city.py" "$ASSET_STAGE/tl_2025_06037_roads.zip"

# Compare staged outputs before copying any file into public/.
cmp public/coast-overlook/overlook-streets.webp "$ASSET_STAGE/public/coast-overlook/overlook-streets.webp"
gzip -dc public/coast-overlook/overlook-buildings.bin.gz > "$ASSET_STAGE/tracked-ovc1.bin"
gzip -dc "$ASSET_STAGE/public/coast-overlook/overlook-buildings.bin.gz" > "$ASSET_STAGE/rebuilt-ovc1.bin"
cmp "$ASSET_STAGE/tracked-ovc1.bin" "$ASSET_STAGE/rebuilt-ovc1.bin"
```

GeoTIFF の再生成出力を追跡中の HILL グリッドと照合するには、同じシェルで次を実行します。標準ライブラリだけで、magic・想定寸法・24-byte ヘッダーに対するファイルサイズを検査し、サンプル中心の四辺と 0.25 m 単位の標高差を表示します。

```sh
python3 - "$ASSET_STAGE/elevation-check" <<'PY'
from pathlib import Path
import struct
import sys

staged, tracked = Path(sys.argv[1]), Path("public/coast-overlook")
grids = {"overlook-elevation.bin": (641, 513), "overlook-detail.bin": (321, 321)}

def read_grid(path, shape):
    data = path.read_bytes()
    if len(data) < 24:
        raise ValueError(f"short HILL file: {path}")
    magic, width, height, west, north, dx, dz = struct.unpack_from("<4sHH4f", data)
    if magic != b"HILL" or (width, height) != shape or len(data) != 24 + width * height * 2:
        raise ValueError(f"invalid HILL header, shape, or size: {path}")
    heights = struct.unpack_from(f"<{width * height}h", data, 24)
    extent = (west, north, west + (width - 1) * dx, north - (height - 1) * dz)
    return extent, heights

for filename, shape in grids.items():
    old_extent, old = read_grid(tracked / filename, shape)
    new_extent, new = read_grid(staged / filename, shape)
    deltas = tuple(new_value - old_value for new_value, old_value in zip(new_extent, old_extent))
    height_deltas = tuple(abs(a - b) for a, b in zip(new, old))
    print(f"{filename}: sample-center west/north/east/south delta (m)={deltas}; ")
    print(f"  changed heights={sum(value != 0 for value in height_deltas)}/{len(old)}, max delta={max(height_deltas) * 0.25:.2f} m")
PY
```

標高変換は無圧縮・単一チャンネル Float32 GeoTIFF を読み、`overlook-elevation.bin` と `overlook-detail.bin` を出力します。`--output` で確認用ディレクトリを指定できます。街路変換は ZIP 内の対応する `.shp` と `.dbf` を読みます。出力先は `scripts/prepare-overlook-city.py` の場所から決まるため、確認用の一時ツリーにスクリプトをコピーして実行してください。両変換には Python 3 が必要で、街路変換には Pillow と NumPy も必要です。版を固定する依存ファイルはありません。

標高ファイルは `HILL` ヘッダー（24 bytes）に幅・高さ、座標原点、格子間隔を記録し、その後ろに行優先の符号付き16 bit・0.25 m 刻み標高を格納します。街路画像は RGB のマスクで、赤が開発範囲、緑が道路、青が幹線です。`overlook-buildings.bin.gz` を展開した `OVC1` データは、12-byte ヘッダーの後に8-byteの建物記録と6-byteの街灯記録を続けます。ランタイム側の形式チェックは [`overlookTerrain.ts`](../src/coast/world/overlook/overlookTerrain.ts) と [`overlookCity.ts`](../src/coast/world/overlook/overlookCity.ts) にあります。

街路の実行例では Python 3.14.5、NumPy 2.4.6、Pillow 13.0.0 で `overlook-streets.webp` がバイト単位で一致し、gzip 展開後の OVC1 ペイロードも 2,051,160 バイトで一致しました。gzip ファイル自体は一致しませんでした。この組み合わせは検証済みの環境であり、履歴に記録された必須版や固定済み依存ではありません。出力には固定シードが使われますが、gzip の圧縮結果まで同一とは限らないため、上記のように展開したペイロードを比較します。

## 設計図と現在の実装

| 資料 | 内容と位置づけ |
| --- | --- |
| [映画館の平面図](cinema/cinema-floor-plan.pdf) | 客席、スクリーン、出入口、主要寸法を示す7ページの設計資料。 |
| [映画館の光・音の設計](cinema/cinema-light-sound-design.pdf) | 投影光、室内反射、座席位置ごとの音響を扱う9ページの設計資料。 |
| [映画館の機器取付](cinema/cinema-speaker-mounts.md)と[還気口の断面](cinema/cinema-ventilation.md) | 原稿未追跡の既存PDFを再作図せず、変更した機器・開口・支持の現行仕様を補います。各ページから同じランタイム定義を読むSVG生成コマンドをたどれます。 |
| [70階住戸の設計仕様](residence/residence-70f-design.md) と [図面](residence/residence-70f-drawings.pdf) | 現行住戸の設計正本。図面は平面、眺望断面、街区、茶室と書斎の詳細を収めた4ページです。 |
| [50階住戸の設計案](residence/residence-50f-design.md) と [図面](residence/residence-50f-drawings.pdf) | 過去の設計記録です。現在の住戸実装の正本ではありません。 |

これらの PDF は設計参照資料です。映画館の室内は [`cinemaLayout.ts`](../src/coast/world/cinema/cinemaLayout.ts)・[`cinemaAuditorium.ts`](../src/coast/world/cinema/cinemaAuditorium.ts) が生成し、仕上げ画像も [`cinemaFinishes.ts`](../src/coast/world/cinema/cinemaFinishes.ts) がコードから作ります。住戸の現在の寸法と室配置は `residencePlan.ts` にあります。映画館PDFの生成メタデータには Creator `HeadlessChrome/157`・Producer `Skia/PDF m157` が記録されていますが、編集用の原稿・書き出しコマンドは追跡されていません。住戸図面も元の作図原稿は未追跡ですが、改訂前PDFと入力ハッシュを保存し、共通設計データに基づくベクトル改訂を再現できます。[住戸図面の入力・座標・再生成手順](residence/source/README.md)を参照してください。訪問者向けの画面キャプチャは[ワールドギャラリー](gallery/README.md)に掲載しています。[撮影条件と再取得](gallery/capture.md)には撮影版・原寸・変換方法を記録します。回帰検証用の撮影の入口は[検証手順](verification.md)にあります。

## コード依存のライセンス同梱

共通描画と形状生成で使用するThree.js 0.184.0のMIT本文は、[ソフトウェア表示](../public/licenses/ATTRIBUTION.md)とともに `public/licenses/` に保持します。[再生成](../scripts/prepare-cinema-code-licenses.mjs)ではロック済みのpackage versionと原文を確認し、Viteが配布先の `dist/licenses/` へ同じbytesを同梱することを確認します。照明shaderの独自記述と既存Three由来の処理を区別し、資料の公開を特許許諾や無侵害の保証として扱いません。

## 差し替え後の確認

`public/` の既存パスを変えずに素材を差し替え、まず `npm run build` で配布用の読込を確認します。開発サーバーは `npm run dev` で起動します。既定 URL で海岸、`?world=overlook` で展望台、`?world=residence` で現行住戸、`?world=cinema` で映画館を開けます。

- 海岸、展望台、共有都市を含む変更: `COAST_CHROME_CHANNEL=chrome npm run test:coast:browser`
- 住戸の変更: `COAST_CHROME_CHANNEL=chrome npm run test:residence:browser`
- 映画館の変更: `COAST_CHROME_CHANNEL=chrome npm run test:cinema:browser`
- 仮想モニターの映像・配置・音声を変えた場合: `COAST_CHROME_CHANNEL=chrome npm run test:monitor:browser`
- 文書だけの変更: `npm run validate:harness`

ブラウザ試験の準備と検証範囲は[検証手順](verification.md)を参照してください。自動試験は読込失敗や操作・音響経路を検出しますが、素材の見た目や音の適合までは証明しません。外観を変えた場合は視点、昼夜、描画品質をそろえた画像を比較し、音を変えた場合は同じ場所と音量で聴いて記録してください。
