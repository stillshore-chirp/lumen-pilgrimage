# ワールド構成と変更経路

[全6ワールドの写真](gallery/README.md)。撮影条件はギャラリーを参照してください。

このページは、探索ワールドを会話履歴なしで読み直し、位置・地形・建築・音響の変更先を判断するための開発者向け案内です。利用者向けの操作と景観は[探索ガイド](exploration.md)、共通ランタイムの設計は[アーキテクチャ](architecture.md)を参照してください。現行のワールド構成と実装の入口は以下のとおりです。

| ワールド ID | 初期到着点・URL | 主な実装・設計資料 |
| --- | --- | --- |
| `coast` | 入り江の浜。通常起動時の既定ワールド。 | [CoastWorld](../src/coast/CoastWorld.ts) · [地形と水位](../src/coast/terrain.ts) |
| `overlook` | 中央展望デッキ。`?world=overlook` | [OverlookWorld](../src/coast/world/overlook/OverlookWorld.ts) · [標高と展望台の接地](../src/coast/world/overlook/overlookTerrain.ts) |
| `residence` | 夜のリビング南窓。`?world=residence` | [ResidenceWorld](../src/coast/world/residence/ResidenceWorld.ts) · [70階住戸の設計](residence/residence-70f-design.md) |
| `cinema` | 中段中央の座席。`?world=cinema` | [CinemaWorld](../src/coast/world/cinema/CinemaWorld.ts) · [客席・幕・退出点の配置](../src/coast/world/cinema/cinemaLayout.ts) |
| `atrium` | 通路を向いたラウンジのソファ。`?world=atrium` | [AtriumWorld](../src/coast/world/atrium/AtriumWorld.ts) · [商業アトリウムの設計](#商業アトリウム) |
| `lake` | 湖を向いた畳の広間。`?world=lake` | [LakeWorld](../src/coast/world/lake/LakeWorld.ts) · [湖畔の広間の設計](#湖畔の広間) |

## 起動 URL、時間帯、設定の引き継ぎ

[起動ルートの判断](../src/coast/explorationRoute.ts)は `monitor` と `world` を読みます。`monitor=sender` はワールド選択より先に配信ページを開くルートになります。`world` は表にあるIDの完全一致でワールドを選びます。省略時と未登録値は海岸を選びます。[main.ts](../src/main.ts)は選ばれたルートに応じて配信ページを読み込むか、[CoastApp](../src/coast/CoastApp.ts)のワールド読込処理を呼びます。読み込みに失敗した場合は起動エラー画面を表示します。過去の `scene=expedition` はワールド選択に使われず、現行の探索を開きます。

[explorationRoute.ts](../src/coast/explorationRoute.ts)の`readInitialExplorationState`は読み込み後の `place` と `time` を解釈し、[着地点一覧](../src/coast/coastDestinations.ts)がワールドごとの有効な移動先と座標を定義します。[CoastApp](../src/coast/CoastApp.ts)は解釈した初期状態を読み込み済みワールドへ適用し、有効な着地点がない場合はそのワールドの `navigation.spawn` を初期位置にします。各ワールドで使えるIDとラベルも一覧にまとめているので、新しい到着点は同じ一覧へ追加し、対応するナビゲーションの `spawn` とブラウザーテストも照合してください。

時間帯は `time=night` のとき夜です。その他の値は昼として扱い、住戸だけは `time` 自体がない場合に夜から始まります。`?world=overlook&place=upper-deck` は展望台の2階、`?world=residence&place=foyer&time=day` は昼の玄関、`?world=cinema` は中段中央を開きます。利用方法は[探索ガイド](exploration.md)を参照してください。

昼夜ボタンを押すと、現在のワールドと音響へ反映し、`urlForTime` が計算した URL を `history.replaceState` で適用します。ワールド間移動では `decideTravel` が `world`、`place`、現在の `time` を含む URL を計算し、`vr=pc` など既存のクエリも保持します。PCVR用の `vr=pc`、没入型VR中、[仮想モニターの接続・承認が進行中](monitor.md#接続切断失敗時の状態)、または映画館のローカル本編ファイルを保持している間は、移動先を読み込んでから同じページのシーンと履歴を更新します。それ以外のワールド間ファストトラベルはページを読み直します。同じページの履歴を戻る・進むときに読み込みが失敗すると、表示中のワールドの履歴項目へ戻ります。失敗した移動先は履歴から再試行できます。同一ワールド内では `CoastApp` がカメラと移動モードを着地点に戻して URL を置き換えます。ファストトラベルを開く時点でキー入力と予約操作を消し、ゲームパッドのボタン状態を同期し、キャンバスのポインターロックを解除します。着地処理でも入力を消し、飛行・潜水・垂直速度をリセットしてから、目的地の支持面と眼高へカメラを置きます。座席着地は指定眼高を使います。映画館では昼夜のUIを隠し、ワールド側の `setTimeOfDay` も空処理です。移動元の時刻はURLに保持されるため、映画館から別ワールドへ移るとその時刻を渡します。

### 夜の入り江から展望台へ移動する

1. [READMEの起動手順](../README.md#起動と操作)に従い、`npm ci` と `npm run dev` を実行して表示されたローカルURLを開きます。
2. URL の末尾を `?world=coast&place=inlet&time=night` にして、ファストトラベルから「中央展望デッキ」を選びます。
3. 到着後のURLは `?world=overlook&place=main-deck&time=night` となり、展望台の夜景が表示され、夜ボタンが選択状態になります。既存の[ブラウザーテスト](../scripts/coast-browser.test.mjs)も同じ着地・時刻保持を確認します。

### 設定の保存

視野角と音の設定は同一オリジンの `localStorage` に保存します。視野角キーは `lumen-pilgrimage:fov` です。範囲は40°〜95°、通常の既定値は60°、展望台は54°、商業アトリウムは42°、湖畔の広間は52°です。既定に戻すと保存値を削除します。

音の設定キーは `lumen-pilgrimage:sound` です。全体音量、環境音と歩行音のオン・オフ、種類別の音量を保存します。未指定のオン・オフは初回の操作まで保留し、音量は既定の100%を使います。保存値は読み込み時に項目ごとに検証します。BFCacheから復帰したページでも、保存値を読み直して表示と音響に反映します。ストレージを利用できないときは現在のページ内で設定できます。時間帯はURL、その他の操作状態はページ内で管理します。 [視野角の実装](../src/coast/CoastApp.ts) · [音の設定の実装](../src/coast/explorationSound.ts) · [探索ガイド](exploration.md)

起動時の描画品質は通常「軽量」です。PCVR用の `vr=pc` では「高品質」から始まり、選んだ品質は同じページでのワールド移動とVR終了後にも引き継ぎます。 [Windows PCVRの起動手順](verification.md#windows-pcvr)

### ワールド照明

[WorldLightingControl](../src/coast/WorldLightingControl.ts) の一括点灯・一括消灯は時間帯と独立したワールド内の操作です。「既定」は各ワールドの元の照明制御に戻します。同じシーンでの移動や昼夜の変更では一括設定を保持します。新しいシーンを作成したときは「既定」から始めます。

| ワールド | 一括操作する照明 | 独立して動くもの |
| --- | --- | --- |
| 入り江と山道 | 朱の参道・社殿前の石灯籠と地面に落ちる光。既定は夜に点灯。 | 太陽・月・星と空、木漏れ日、水面と水中の光。 |
| 丘陵展望台 | 欄干、柱、上階とパビリオンの灯具、敷石・壁を照らす光。既定は夜に点灯。 | 自然光と空の反射、盆地の窓明かり・街灯、車両・航空機の灯火。 |
| 都心の70階住戸 | 各区画の照明、操作可能な足元灯、作業灯、室内の装飾・シアター照明。 | 日光や月明かり、窓外の街と交通、機器の運転表示・加熱、テレビや共有画面の映像。 |
| 映画館シアター | 通常の場内照明、コーブの発光と壁・天井・幕への照り返し。既定は上映設定に連動。 | 段鼻・出口の誘導灯、清掃灯と非常点検灯、試映や共有映像と音声。非常点検中は点検設定が優先。 |
| 商業アトリウム | コーブと階段の側板、売場、枝状照明、室内の照り返し。既定は点灯。 | 天窓側の明るさと色は時間帯に連動。 |
| 湖畔の広間 | 左右奥の照明と、低卓のそばに現れる行灯。既定は夜に点灯。 | 外の自然光、星、雲、水面の明るさは時間帯に連動。 |

住戸の一括操作中も区画、器具、壁スイッチで調整できます。「既定」で一括操作前の点灯状態に戻ります。切り替えは発光材、局所照明、区画の照明データ、戸口からの漏れ光、反射に同じ状態を使います。映画館では通常照明に一括設定を適用します。非常点検中はワールドが操作できない理由を返し、一括設定の変更を止めます。点検を終えると直前の一括設定を再適用します。

## 共通座標・ナビゲーション契約

全ワールドは Three.js の座標を使い、Y を上下、X/Z を床面として扱います。座標原点はワールドごとに独立しています。ファストトラベルは `world`、`place`、`time` を引き継ぎ、各ワールドの目的地から位置を決めます。位置と向きは[CoastPose](../src/coast/CoastControls.ts)の `x`、`z`、`yaw`、`pitch` で表します。通常は地面または水面から眼高を算出します。上下に重なる床の上階を選ぶ着地点では `floorY` で支持層を指定できます。映画館の座席など、立位以外の視点は `seatedEyeHeight` を指定します。

[CoastNavigation](../src/coast/CoastControls.ts)はワールドごとに境界、初期姿勢、`groundHeight`、任意の水位と衝突判定、飛行上限、任意の天井高を提供します。共通の移動処理はこの契約から移動できる範囲と支持面を読みます。地形や建築を変更するときは、描画形状と同じ座標・高さをナビゲーションへ反映します。

飛行の任意判定 `blocksFlight(x, z, eyeY, clearance)` は、ワールド座標のカメラ中心高と余裕半径を受け取ります。共通処理の半径は0.25 mです。従来の2引数関数も使用できます。XYZ経路を屋外では最大0.46 m、屋内では最大0.15 m間隔で標本化し、形状・床・天井・頭部の余裕を満たした最後のXYZだけを確定します。上下移動にも同じ判定を行います。これは離散経路の検査であり、任意の薄い形状に対する連続衝突判定ではありません。

XRでスティック等により身体位置を動かす際は、追跡された頭部offsetを加えた位置でも判定します。既に重なっている場合は離れる向きへの退避を許可します。ヘッドセットから得る頭部の1対1追跡は維持し、現実の頭を動かした位置を仮想壁へ固定する処理にはしません。 [移動制御](../src/coast/CoastControls.ts) · [検査手順](verification.md#高さに応じた飛行の確認)

| 実装座標の前提 | 現行の基準 |
| --- | --- |
| 海岸 | 海面は `y=0`、海岸の既定着地点は `(-12, 79)`。湖は独立した水位を持ちます。 |
| 展望台 | 中央デッキは `y=346`。2階デッキは階段と踊り場の支持高さを地面判定と共有します。 |
| 住戸 | 平面の東座標を `x`、北座標を `-z` とし、仕上げ床は `y=0`。街路は住戸床から246 m下です。 |
| 映画館 | 幕面は `z=0`、客席方向は `+z`。段床、車いすスペース、出口は同じ配置データを使います。 |
| 商業アトリウム | 正面通路の比較点を原点に、ソファと曲階段へ向かう方向を `-z`。上階の回廊は `y=9.15` m。 |
| 湖畔の広間 | 広間の床が `y=0`、湖が `y=-0.82` m。湖に向かう方向は `-z`。 |

立位の眼高は1.65 m、しゃがみは1.15 mです。共通歩行は6.4 m/s、水面の遊泳は4.1 m/s、潜水は3.6 m/s、自由飛行は20.5 m/sです。商業アトリウムと湖畔の広間では歩行とジャンプで移動します。屋内では移動経路に沿って支持面、壁、開口と天井の高さを確認します。住戸、映画館、商業アトリウム、湖畔の広間は各ワールドの歩行速度を使います。 [移動制御](../src/coast/CoastControls.ts) · [利用者向け操作表](exploration.md)

### フレームと入力

[CoastApp のフレーム処理](../src/coast/CoastApp.ts)は、最大0.05秒に制限した経過時間を使い、操作可能なときに移動を更新し、座席遷移、XRの移動と視点、仮想モニター、ワールド更新、UI同期、音響更新の順に処理します。最後に任意の `world.prepareRender` を呼んでからシーンを描画します。環境音・歩行音はボタン操作またはオン設定の復元で開始します。自動再生が保留された場合は、最初の有効なクリックやキー入力で再開を試みます。シーン側の動的表現は `update(elapsed, viewer)`、高コストな描画準備は `prepareRender(renderer, camera)`、時間帯と描画品質は `setTimeOfDay`／`setQuality` を入口に揃えます。ページが通常終了する `pagehide` 時にワールド、音響、操作、レンダラーを破棄します。ページがBFCacheに保持される場合はXRセッションを終了し、ページ状態を残します。仮想モニターの接続とメディアの扱いは[仮想モニター仕様](monitor.md#接続切断失敗時の状態)に従います。

- **デスクトップ:** 文書が表示中でフォーカスを持ち、入力先がキャンバス・本文・ポインターロック中のキャンバスであれば、WASDなどのキー入力を読みます。操作パネル内のボタン・折りたたみ見出し・範囲スライダーも、ダイアログ外では平面移動キーを受け付けます。その他のボタン、リンク、フォーム、編集欄はキーボード移動を止めます。Cによるしゃがみ・潜水入力は通常の移動モード条件に従います。マウス視点はキャンバスのポインターロック中に限ります。T はファストトラベル、E はそのワールドが選んだ近接操作です。
- **標準ゲームパッド:** 最初に見つかった接続済みの `standard` mapping を読み、左右スティックで移動と視点を操作します。入力のデッドゾーンは0.16です。Xbox配置のA/B/Yはジャンプまたは上昇、潜水または下降、飛行切替に使います。ゲームパッドの軸はキーボード入力に加算されます。
- **WebXR:** [ImmersiveSession](../src/xr/ImmersiveSession.ts) がセッションを管理し、[CoastXR](../src/coast/CoastXR.ts) が全ワールド共通の移動基準と追跡中の視点を管理します。Touch の `xr-standard` 入力は左右の `XRInputSource` から読み、`CoastControls` の支持面・水位・壁・天井判定に渡します。頭の向きを基準に移動し、旋回は頭の位置を中心に30°ずつ行います。スティック移動では追跡視点のオフセットも衝突判定に含めます。ヘッドセットそのものを動かした分は追跡どおりに表示します。ワールド更新と空間音響のリスナーには同じ追跡視点を渡します。メニューでは通常の移動を止めます。グリップとピンチでのモニター配置は、モニターの表示中に扱います。 [操作表](exploration.md#meta-quest-3-で探索する) · [WebXRの模擬ブラウザー試験](../scripts/monitor-browser.test.mjs)

デスクトップでは、仮想モニターの配置編集中に `blocksSceneInput` が有効になります。パネル表示中も文書にフォーカスがあり、配置編集をしていなければゲームパッドで移動できます。没入型VR中はXR入力に切り替わります。モニターを掴んでいる間、アプリのダイアログ中、座席の暗転中、ワールドの読み込み中は、VRの移動と近接操作を停止します。 [入力停止条件](../src/monitor/monitorView.ts) · [フレームゲート](../src/coast/CoastApp.ts)

### 近接インタラクション

WebXRでは、湖畔の行灯を指してコントローラーのグリップを握ると掴めます。指した先の判定に `targetRaySpace`、保持位置の追従に `gripSpace` を使います。行灯の手前に浮遊モニターが重なるときは、指した先の映像面を掴みます。スティック移動と旋回を反映したワールド座標で行灯を更新します。解放時、メニューを開いたとき、追跡が途切れたときは、最後に置けた床または低卓の天板に着地します。 [WebXR Device API](https://www.w3.org/TR/webxr/#xrinputsource-interface) · [VR探索の実装](../src/coast/CoastXR.ts)

デスクトップの `F` は、保持中の対象の解放、照準内で射程に入った対象の掴み、対応ワールドの自由飛行切り替えの順に扱います。掴みは、探索画面にフォーカスがあり、ダイアログや配置編集が閉じているときに受け付けます。ワールドは掴める対象の描画ルート、交差判定、射程と、床に置く場合の支持面を登録できます。照準は視野角と投影のずれを含む画面中央の視線を使い、手前の壁や閉じた扉で遮られない範囲の対象を選びます。保持は移動先への着地や XR 開始時に解除します。 [掴みの実装](../src/coast/DesktopGrab.ts)

シーンごとの `label(position, facing)` が操作可能な対象を選び、画面ボタンまたはEキーで `invoke()` を呼び出します。ボタン表示は毎フレーム更新されます。距離・向き・建具の状態判定は各ワールドの実装が持ちます。

- 住戸は引戸、室内ドア、障子、カーテン、照明、家電を距離と向きで選びます。設備を選ぶと住戸の操作パネルを開けます。[住戸の操作選択](../src/coast/world/residence/ResidenceWorld.ts) · [住戸ナビゲーションとドア](../src/coast/world/residence/residenceNavigation.ts) · [ドア状態](../src/coast/world/residence/residenceDoors.ts)
- 映画館の出口扉と表示灯は館内の景観として残り、閉じた境界を保ちます。館外へ移動するときはファストトラベルから目的地を選びます。[映画館の出口・照明](../src/coast/world/cinema/cinemaFixtures.ts) · [映画館ナビゲーション](../src/coast/world/cinema/cinemaNavigation.ts)

## ワールド別の設計・変更経路

### 入り江と山道 — `coast`

海岸、森林、湖、稜線、朱の参道をひと続きの地形として生成します。[terrain.ts](../src/coast/terrain.ts)が地表高、水位、散策路と範囲の基準を持ち、[CoastWorld](../src/coast/CoastWorld.ts)が海岸・湖・地形・植生・滝・鳥・大気を組み立てます。描画と移動判定が同じ地形関数を参照する関係を保ってください。湖面は標高71 mです。

移動先は浜、密林の休憩所、湖畔、朱の参道、稜線です。[地形](../src/coast/terrain.ts) · [散策路と着地点](../src/coast/coastDestinations.ts) · [景観生成](../src/coast/world/coastSurface.ts) · [環境音](../src/coast/CoastAudio.ts) · [利用者向けルート](exploration.md)

地形やルートを変える場合は、支持面、海・湖・沢の水位、衝突、着地点、植生やランドマーク、音の発生位置を同じ座標で確認します。主な検証は[地形](../scripts/coast-terrain.test.mjs)、[操作](../scripts/coast-controls.test.mjs)、[ブラウザー](../scripts/coast-browser.test.mjs)です。

### 丘陵展望台 — `overlook`

標高グリッド2種（`public/coast-overlook/overlook-elevation.bin`、`overlook-detail.bin`）を読み込み、デッキの擁壁、斜面、盆地の街区をつなぎます。[overlookTerrain.ts](../src/coast/world/overlook/overlookTerrain.ts)が標高を補間し、中央デッキ周囲に接地用の斜面を作ります。[OverlookWorld](../src/coast/world/overlook/OverlookWorld.ts)はデッキ、街路、交通、航空機、空と照明をまとめ、更新処理から照明・交通・航空機を動かします。座標上の2階デッキは主デッキより7.2 m高く、東階段の各段・踊り場と歩行支持面を[overlookUpperDeck.ts](../src/coast/world/overlook/overlookUpperDeck.ts)で共有します。

中央デッキ、西テラス、東テラス、2階展望デッキへ直接移動できます。現在、展望台用の配置図PDFはありません。標高データの出典と条件は[展望台の素材クレジット](../public/coast-overlook/ATTRIBUTION.md)、利用経路は[探索ガイド](exploration.md)を参照してください。

亭の主外殻、両翼、段違い屋根、八角drum、ドーム断面は [overlookPavilionPlan.ts](../src/coast/world/overlook/overlookPavilionPlan.ts) を描画と飛行で共有します。高さは主床346 mからの相対値です。箱とdrumは余裕半径で保守的に拡張し、ドームは回転軸断面の各線分までの最短距離へ半径と外殻の最大突出量約0.06435 mを加えます。頂部と斜面の両方を守り、屋根より高い空間の移動を許可します。歩行範囲、飛行上限451 m、着地点と階段の支持面は維持します。

#### 表示地形と局所接地

地形の解析関数と表示三角形の高さを分けて扱います。`createOverlookSurface` が返す `sampleHeight(x,z)` は、描画用Float32頂点と同じ格子・対角線を使う補間です。非有限入力と表示field外は `undefined` になり、端へclampしません。表示fieldはX=−23000..23000 m、Z=−26000..11000 mです。

この補間は斜面の植物・岩と、鳥2点・虫5点の音源支持に渡します。植物は幹下部・株元、岩は下部の支持点を変換後に照合し、最高の基部点が地表−10 mmを超える場合は個体全体をY方向へ下げます。葉や個々の頂点を引き伸ばさず、局所形状、XZ位置と配置分布を保ちます。地下の根リングを使う数値と、目に見える茎の地表交差は分けて確認します。岩は支持footprintと露出する本体を調べ、全埋没を接地の成功へ数えません。

道路・都市・住宅の高さAPIを一律に置換する変更ではありません。音源の高さは表示面から鳥1.15 m、虫0.4 mの制作値を使い、道路の伝搬計算には従来の地形入力を保持します。編集先は [表示地形](../src/coast/world/overlook/overlookTerrain.ts)、[斜面の個体配置](../src/coast/world/overlook/overlookHillside.ts)、[局所音源](../src/coast/world/overlook/overlookAudio.ts)です。

#### 舗装と建物の支持断面

主床の基準はY=346 mで、歩行支持面と足音の材区分を保ちます。敷石は公称50 mm厚、top変動±1.5 mm、目地の芯幅10 mm、上端幅14 mm、面取り水平/鉛直各2 mmです。石を置く7fieldの直下だけに連続bedを設け、非石部と外縁は従来の床高さを保ちます。

| 層・接点 | 主床からの相対Y | 世界Y |
| --- | --- | --- |
| 石の上面 | 0±0.0015 m | 346±0.0015 m |
| 目地の上面 | −0.003 m | 345.997 m |
| 石の下面 / bed上面 | −0.050 m | 345.950 m |
| bed下面 / 既存cap上面 | −0.0785 m | 345.9215 m |
| 非石部のbacking上面 | −0.0355 m | 345.9645 m |
| 建物bearingの下面..上面 | −0.070..0 m | 345.930..346 m |

既存capの下面は345.7065 mで、foundation上面345.710 mへ3.5 mm重なります。亭の本体・両翼・入口柱2本・敷居の実6footprintにbearingを設け、backingへ34.5 mm重ねてcapまでの支持をつなぎます。敷居は `PAVILION_THRESHOLD` を描画と床支持で共有し、亭の描画形状や飛行volumeを変えません。装飾plinthの張出しは支持された本体からの持出しとして扱い、正当な影の隙間まで埋めません。数値は制作上の寸法であり、実施設の荷重認証ではありません。 [舗装生成](../src/coast/world/overlook/overlookDeck.ts) · [共通亭寸法](../src/coast/world/overlook/overlookPavilionPlan.ts)

擁壁、段、手すり、デッキの境界を変える場合は、描画形状と `groundHeight`／`blocksWalking`／`blocksFlight` を一組として扱います。[地形接続](../scripts/coast-terrain.test.mjs)と[階段・デッキのブラウザー試験](../scripts/coast-browser.test.mjs)が既存の入口です。

### 都心の70階住戸 — `residence`

[residencePlan.ts](../src/coast/world/residence/residencePlan.ts)の壁・開口・各室の平面を基準に、[residenceShell.ts](../src/coast/world/residence/residenceShell.ts)の建具と[residenceNavigation.ts](../src/coast/world/residence/residenceNavigation.ts)の歩行判定を作ります。[ResidenceWorld](../src/coast/world/residence/ResidenceWorld.ts)が都市、住戸躯体、家具、カーテン、照明、反射、近接操作を統合します。室内家具は通り抜けられます。壁・建具・手すり・バルコニー引戸は歩行、飛行、ジャンプ中の移動を止めます。室ごとの天井、開口の上端、バルコニーの上階スラブ下面で上昇を止めます。歩行速度は2.4 m/sです。

主な着地点はリビング南窓、ホームシアター、玄関、主寝室、茶室、書斎です。寸法と納まりの現行正本は[70階住戸の設計資料](residence/residence-70f-design.md)と[70階住戸の平面・展開図PDF](residence/residence-70f-drawings.pdf)です。[50階住戸PDF](residence/residence-50f-drawings.pdf)は過去案の比較資料です。現行の受け入れ条件は70階住戸の設計資料を基準にします。設備・操作の案内は[探索ガイド](exploration.md)を参照してください。

壁・戸・家具の変更では、図面、描画寸法、衝突判定、着地点、音響開口の状態を同じ平面で確認します。[住戸の移動・間取りテスト](../scripts/residence-navigation.test.mjs)、[住戸ブラウザーテスト](../scripts/residence-browser.test.mjs)、[住戸音響テスト](../scripts/residence-audio.test.mjs)が主な入口です。視線・街区寸法の詳細は設計資料を正本とします。

### 映画館シアター（大） — `cinema`

[cinemaLayout.ts](../src/coast/world/cinema/cinemaLayout.ts)が幕、20列の客席、段床、通路、車いすスペース、出口、移動先の共通配置データを持ちます。室内寸法は40 × 57 × 22 mです。スクリーンは16:9の30 × 16.875 mで、中心は前方床から9.8 mです。通常席580席と同伴席8席、車いすスペース8か所で596人分の位置を用意します。

[CinemaWorld](../src/coast/world/cinema/CinemaWorld.ts)が座席移動、上映、館内照明、空間音響をまとめます。[cinemaNavigation.ts](../src/coast/world/cinema/cinemaNavigation.ts)は座席背面と通路の歩行判定を同じ配置から作ります。映画館内の歩行は3.2 m/sです。背もたれは歩行を止め、上から越えることもできます。飛行中もスクリーン手前と客席側の外周で止まり、天井と梁の下まで上昇できます。

出口の扉と表示灯は館内の造作です。館外への移動はファストトラベルで行います。

着地点は中段中央、前方中央、後方側席、車いす席です。中段中央（R09）の床高は3.25 mで、座位からの幕幅は水平約48°、幕中央への仰角は約9°です。後方側席（R20）の床高は7.39 mで、幕中央への仰角は約1.4°です。横通路の床高は前から0、2.80、5.655、7.39 mです。R08・R15の車いすスペースと左右の扉までは、横通路を通じて同じ高さの床でつながります。同一ワールド内の座席移動は[cinemaSeatTransition.ts](../src/coast/world/cinema/cinemaSeatTransition.ts)で画面を覆う遷移をはさみます。現行の寸法・配置は[基本設計PDF](cinema/cinema-floor-plan.pdf)、照明と音響の設計は[設計PDF](cinema/cinema-light-sound-design.pdf)を参照してください。

座席・段・出口を変える場合は、`cinemaLayout` を配置の単一基準として描画とナビゲーションの両方から使います。[ナビゲーションテスト](../scripts/cinema-navigation.test.mjs)、[照明・音響テスト](../scripts/cinema-lighting.test.mjs)、[映画館ブラウザーテスト](../scripts/cinema-browser.test.mjs)で利用経路を確認します。

### 商業アトリウム

[配置定義](../src/coast/world/atrium/atriumLayout.ts) を建築、支持面、環境音と共有します。地上共用部は幅22.8 m、奥行き63 m。ソファ `(-2.70, -29.70)` の眼高は1.20 mで、通路側を向きます。「正面通路」は原点、立位、仰角約7°、縦視野角42°です。写真の消失方向、ソファ、曲階段下端、立面の縦線から制作寸法を求めました。天窓の輪郭は、高さ17.10 mの仮定面に写真上の点を逆投影して楕円を近似しました。実装値は中心 `(0.565, -44.92)` m、半径9.56 mと13.17 m、Y軸回り約22°です。 [単視点からの寸法推定](https://www.robots.ox.ac.uk/~vgg/publications/1999/Criminisi99/) · [専門書の実装事例](learning/atrium-case.md#商業アトリウムの実装で確かめたこと)

共用部は一人で散策する空間です。原画方向には左右9店と正面奥2店を通路から見渡せます。各店の入口の引き込み、床、奥壁、什器の位置は [1階テナント内装詳細設計](atrium/tenant-interior-design.md) の [寸法データ](atrium/tenant-interiors.json) に合わせています。左の衣料店はラックの背後に陳列台や試着室が見え、右手前の小物売場ではガラス、吊り装飾、商品、奥棚が手前から重なります。中央の展示島3基とソファの間も共用部から見渡せます。

ソファは原画と反対の `+Z` を向きます。この方向の施設は写真から確認できないため、[ソファ正面の施設設計](atrium/sofa-facing-facility-design.md)として独自に設計しました。固定ガラスの奥に室内光庭、着座右の西側に装丁・書籍の店、着座左の東側に生活工芸の店を配置します。上階には読書室、素材展示室、小サロンが重なります。庭・新店・用途室の内部は閉鎖展示で、共用床と既存の回廊から見渡せます。歩行端とソファの位置・向きは変更しません。

主階段は下端の幅約5 mから絞り、初めに右へ寄り、昇降塔の手前で左へ回り込んで西回廊の9.15 mへ着きます。西回廊の奥に続く階段でもう一層上がり、13.55 mの回廊へ渡れます。高さ4.55 mの回廊は手前で吹抜け側に張り出し、奥に向かって開きます。この回廊と奥の張り出しは景観と音の遮蔽に使います。[支持面](../src/coast/world/atrium/atriumNavigation.ts)は、踏面と同じ経路を連続した高さでたどります。地上の通路と回廊が上下に重なる場所では、現在の足元から到達できる支持面を選びます。店先、昇降塔、家具と手すりが探索の境界です。

[回廊と建築](../src/coast/world/atrium/atriumShell.ts)、[天窓の立ち上がりと昇降塔](../src/coast/world/atrium/atriumRoof.ts)、[階段](../src/coast/world/atrium/atriumStair.ts)、[店先](../src/coast/world/atrium/atriumRetail.ts)、[家具](../src/coast/world/atrium/atriumFurnishings.ts)を個別に編集できます。天窓には青い縦窓と上面の桟を置き、手前に昇降塔の上端を重ねます。回廊の庇と階段の側板は、光が器具から離れるにつれて弱くなる勾配を持ちます。店舗の照明は正面のケース、側面の木壁、奥の棚で光る位置を変えます。 [壁や天井を使う間接照明](https://www.erco.com/en/knowledge/fundamentals/indirect-lighting/)

新設施設の寸法は [`atriumFrontPlan.ts`](../src/coast/world/atrium/atriumFrontPlan.ts)に集約しています。[閉じた建築とガラス](../src/coast/world/atrium/atriumFrontShell.ts)、[店内・上階の内装と照明](../src/coast/world/atrium/atriumFrontInteriors.ts)、[植床・樹木・低植栽](../src/coast/world/atrium/atriumFrontGarden.ts)、[素材](../src/coast/world/atrium/atriumFrontMaterials.ts)を編集し、[`atriumFrontCommons.ts`](../src/coast/world/atrium/atriumFrontCommons.ts)で統合します。光は4点の実光と局所の拡散受光近似を組み合わせ、一括点消灯へ接続します。庭の鑑賞光G2だけが静的な影を持ち、品質切替や点灯に伴う必要な更新後は同じmapを使います。棚や脚などの接点は、新設受光面の形状に対応する[間接光の遮蔽近似](../src/coast/world/atrium/atriumFrontOcclusion.ts)を適用します。育成用の設備は造形上の予約にとどまり、昼夜とも消灯します。画面輝度から実植物の育成性能や照度を保証する設計ではありません。

床は石板の中央から色・法線・粗さを取り、1.35 m角の板と通路沿いの淡い帯を割り付けます。通常画面ではカメラを床に鏡映し、粗さに応じて反射の輪郭を広げます。WebXRでは各眼の反射方向から庇、店先、天窓の光を求めます。両方の反射に一括点消灯が反映されます。 [床の実装](../src/coast/world/atrium/atriumFloor.ts) · [素材の出典](../public/atrium-materials/ATTRIBUTION.md) · [WebXRのビュー](https://www.w3.org/TR/webxr/#xrview)

[店舗照明](../src/coast/world/atrium/atriumTenantLighting.ts)は、設計座標に合わせた灯具と棚の光を組み合わせます。黒枠の衣料店と右手前の小物売場には室内を照らす光源を各1点置きます。一括点消灯はこれらの光源、棚・縦光の発光、床に映る店舗の光に連動します。

[音響の実装](../src/coast/world/atrium/atriumAudio.ts)は、左右と上階の換気、1階カフェのカウンター下と上階の設備を別の位置から鳴らします。[伝搬の計算](../src/coast/world/atrium/atriumAcoustics.ts)は、店舗の開口、固定ガラス、入口の袖壁を設計と同じ座標から求め、通過する直接音と初期反射の高域・音量を調整します。石床、ガラス側の壁、回廊の床面と軒裏からの初期反射は、経路差に応じた遅れと方向を持ちます。ソファ正面の固定ガラスも共有寸法の有限面で反射を計算し、枠・不透明な支持柱・ガラスのない隙間では成立させません。新たな群衆音、店舗音楽、水音は追加しません。後期残響の設計値は吹抜け側1.86秒、低い天井の周辺0.95秒です。ソファの敷物や回廊の下に近づくと短い応答の比率が増え、歩行音にも反映されます。類似施設の測定を参考にした仮想空間の設定です。 [商業施設の残響実測](https://www.mdpi.com/2076-3417/10/3/1170) · [音源の生成と出典](../public/atrium-audio/ATTRIBUTION.md) · [鏡像法](https://pubs.aip.org/asa/jasa/article/65/4/943/765693/Image-method-for-efficiently-simulating-small-room)

### 湖畔の広間

[配置定義](../src/coast/world/lake/lakeLayout.ts)を建築、移動、音の境界に使います。`hall` は正面の比較視点、`west-window` と `east-window` は室内から浅瀬を見下ろす位置です。旧い着地点IDからも同じ室内の窓辺へ移れます。[移動判定](../src/coast/world/lake/lakeNavigation.ts)は湖側の窓、背面と左右の壁で歩行を止めます。低卓の位置は通常操作でもWebXRでも通過できます。

[広間](../src/coast/world/lake/lakeHall.ts)、[岩盆と石の環](../src/coast/world/lake/lakeBasin.ts)、[空と移流する雲](../src/coast/world/lake/lakeSky.ts)、[水面と水底](../src/coast/world/lake/lakeWater.ts)、[鳥と魚](../src/coast/world/lake/lakeWildlife.ts)を別々に編集できます。水面は通常画面で空と外の地形を縮小鏡映し、ヘッドセットの描画では各視点から方向を求めて反射を近似します。

湖畔専用の設定は `lumen-pilgrimage:lake-settings` に保存します。布団と灯籠は既定で収納し、月は既定で表示します。太陽と月の方位・高度は時間帯ごとに保持し、対応する空、照明と水面反射へ適用します。月を隠すと円盤と反射が消え、夜の基礎照明は継続します。 [設定の実装](../src/coast/world/lake/lakeSettings.ts)

[音響](../src/coast/world/lake/lakeAudio.ts)は水と鳥の距離、固定ガラスの遮蔽と両端の換気ルーバーを参照します。床の位置から畳と板の足音を選びます。形や寸法の根拠と確認条件は [湖畔の広間の設計](lake/lake-hall-design.md) にまとめています。

## 共通の変更経路

- 起動先、到着ID、時間帯の引き継ぎは [explorationRoute.ts](../src/coast/explorationRoute.ts)、[main.ts](../src/main.ts)、[CoastApp.ts](../src/coast/CoastApp.ts)、[coastDestinations.ts](../src/coast/coastDestinations.ts)、[CoastTravelPanel.ts](../src/coast/CoastTravelPanel.ts)を追います。別ワールドへ座標を直渡しせず、移動先IDと時刻をURLへ渡します。[海岸・展望台のブラウザーテスト](../scripts/coast-browser.test.mjs)にURLと描画時刻の既存例があります。
- [ルート判断と着地点検索の単体テスト](../scripts/exploration-route.test.mjs)は未知のワールドを海岸へ戻す判断と、未登録・他ワールドの `place` が着地点に解決されないことを確認します。このテストは純粋な選択と検索を対象とし、無効な `place` でブラウザー起動した際に `CoastApp` が `navigation.spawn` へ着地する画面挙動は確認しません。既存の[ブラウザーテスト](../scripts/coast-browser.test.mjs)は `scene=expedition` の旧URLと通常のURL・時刻保持を確認します。
- 移動入力、フォーカス、移動の解除は [CoastControls.ts](../src/coast/CoastControls.ts)、[CoastApp.ts](../src/coast/CoastApp.ts)、[CoastTravelPanel.ts](../src/coast/CoastTravelPanel.ts)を追います。モニター表示・VRとの競合条件は[monitorView.ts](../src/monitor/monitorView.ts)と[monitorXR.ts](../src/monitor/monitorXR.ts)も確認します。[操作単体テスト](../scripts/coast-controls.test.mjs)と[WebXR模擬入力テスト](../scripts/monitor-xr.test.mjs)があります。
- 時刻、照明、音響、フレーム更新の接続は [CoastApp.ts](../src/coast/CoastApp.ts)から各 `*World.ts`、[CoastAudio.ts](../src/coast/CoastAudio.ts)へ追います。地形・住戸・映画館の編集先と専用テストは、以下の各ワールド節にまとめています。

### 単体テスト

`npm run test:coast`、`npm run test:residence`、`npm run test:cinema` は地形・ナビゲーション・音響などのモジュール契約を確認します。対象に合わせて該当コマンドを選びます。スクリプトと対象範囲は[検証手順](verification.md)を参照してください。

### ブラウザー試験

探索や移動の変更ではビルド後に `COAST_CHROME_CHANNEL=chrome npm run test:coast:browser` を実行します。住戸・映画館を変更したときは[検証手順](verification.md)の該当ブラウザーテストを選びます。ここでの試験はPlaywrightによる自動操作です。WebXR入力は模擬セッション、モニターの画面取得は合成メディアと差し替えた `getDisplayMedia()` を使います。

### 実機確認

物理ゲームパッドの両スティック・ボタン、実機ヘッドセット上のWebXR、音響機器での定位や音割れを[実機確認手順](verification.md#実機での確認)に沿って確かめます。OSの画面・音声共有はブラウザーの許可操作も必要です。Windows機での画面取得・音声・PCVRは未確認です。自動試験の説明は実機での確認結果を意味しません。実施した検証は対象HEADと条件を作業記録に残します。
