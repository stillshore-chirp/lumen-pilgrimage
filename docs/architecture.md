# Lumen Pilgrimage の設計

探索の実装上の責務と接続をまとめます。利用者向けの操作や設定は [探索ガイド](exploration.md) を参照してください。

## 起動と状態遷移

- [main.ts](../src/main.ts) が `#app` を取得し、[CoastApp](../src/coast/CoastApp.ts) で入り江と山道を起動する。`?world=overlook` は丘陵展望台、`?world=residence` は都心の50階住戸を遅延読み込みする。 [OverlookWorld](../src/coast/world/overlook/OverlookWorld.ts) · [ResidenceWorld](../src/coast/world/residence/ResidenceWorld.ts)
- `CoastApp` はレンダラー、カメラ、UI、フレームループ、操作を接続する。ファストトラベルでは各ワールドの着地点と到着時の向きを使う。選択した移動先と時間帯は URL の `world`、`place`、`time` に反映される。同一ワールド内では位置と入力状態をリセットして移動し、ワールドを移ると移動先と時間帯を渡してページを読み込み直す。 [CoastTravelPanel](../src/coast/CoastTravelPanel.ts) · [移動先の定義](../src/coast/coastDestinations.ts)

## 仮想モニターの設計

- `?monitor=sender` は [配信ページ](../src/monitor/monitorSender.ts) を起動する。共有ボタンの操作から `getDisplayMedia()` を呼び、ブラウザが選択と許可を管理する。macOSとWindowsは同じ [画面取得](../src/monitor/monitorCapture.ts) とトラック契約を使う。保護コンテンツは共有元の制限に従う。[W3C Screen Capture](https://www.w3.org/TR/screen-capture/) · [ChromiumのmacOSウィンドウ音声対応](https://chromium.googlesource.com/chromium/src/+/c27d9c73c94555e3ec51dcec1317aedd539537fb)
- [シグナリング](../server/virtual-monitor-signaling.mjs) はViteの開発・プレビューで同一オリジンのPOSTを受ける。発行から2分以内にコードで視聴先1件を予約する。照合番号を確認して配信元が許可すると、役割別の一時トークンとリビジョン番号を使い、接続情報を交換する。許可済みセッションは片側の通信が90秒途絶えるか、開始から8時間で期限切れになる。一時情報はメモリ上に保持し、期限切れ・拒否・終了で破棄する。映像と音声は [WebRTC](../src/monitor/monitorSession.ts) で端末間を直接通り、録画・保存は行わない。サーバーは外部STUN・TURNを使わない。
- [視聴パネル](../src/monitor/monitorView.ts) を初めて開くと、一枚の [映像面](../src/monitor/monitorObject.ts) を景観に追加できる。映像面の位置・向き・大きさはワールド座標に保持する。映像の縦横比に合わせて同じ平面を描き、映像を失ったらそこに状態を表示する。配置編集時はFPSのマウスロックを解除し、ドラッグを映像面に渡す。
- [VR入力](../src/monitor/monitorXR.ts) はWebXRの `local-floor` に接続する。コントローラーの `squeeze` と手の関節座標によるピンチを個別に扱う。追跡を失った場合は掴みを解除し、その時点の姿勢に固定する。デスクトップの視点とFOVはVRセッションから独立している。[W3C WebXR](https://www.w3.org/TR/webxr/) · [WebXR Hand Input](https://www.w3.org/TR/webxr-hand-input-1/)
- [モニター音声](../src/monitor/monitorAudio.ts) は受信音声専用のWeb Audioコンテキストを持つ。音量とミュートを滑らかに変更し、頭部固定ステレオとHRTFによる定位・距離減衰・指向性を切り替える。映像要素はミュートし、Web Audioに再生を集約する。描画品質は自然環境音・共有音声の処理に影響しない。

## 地形と移動

- [CoastWorld](../src/coast/CoastWorld.ts) と [CoastControls](../src/coast/CoastControls.ts) は、[地形、散策路、沢の水位](../src/coast/terrain.ts) を共有する。道の縦断勾配を滑らかにつなぎ、周囲の地面に応じて横断勾配を付ける。西の岩棚、東の潮棚、林内の分岐と沢は、地形と [岩・シダの配置](../src/coast/world/coastLandmarks.ts) を合わせて組む。素材は [景観素材のクレジット](../public/coast-materials/ATTRIBUTION.md) を参照。
- 地上の登坂判定に引っかかったときは横方向の移動を試す。急な下りとジャンプは重力で接地させる。遊泳と潜水は海・沢・湖の水位を参照し、潜水時に水底への進入を止める。水底が浅くなると浮上し、岸で接地する。水中の視界は深さで減衰し、水面の裏側と水底に届く光を描く。
- 密林の高所から峠、湖の周回路、稜線へつながる。[朱の参道](../src/coast/world/coastInariTrail.ts) は湖の周回路から分かれ、地形の二つの歩行路に沿って石段と鳥居を置く。山の鞍部と樹冠の高さを調整し、南東から楼門や前庭、石段の入口に日が入る。小社からの下り道は稜線への道に合流する。路肩の地形、ベンチと屋外休憩所の座標、視界を空ける範囲を地形定義に持つ。[休憩所](../src/coast/world/coastRestAreas.ts) は地形に合わせて木製ベンチと低い石の縁を置く。
- [2階展望デッキ](../src/coast/world/overlook/overlookUpperDeck.ts) は東側の階段と踊り場をパビリオンの屋外デッキにつなぐ。階段の滑らかな歩行面と各踊り場の高さを共有し、手すりの位置で歩行を止める。ファストトラベルで選んだ着地点にも同じ高さを適用する。1階はテラスの縁、建物、望遠鏡に沿って歩行を制限する。夜は石の縁と段鼻の灯りが足元を照らす。各ワールドのベンチは通り抜けられる。

## 景観と描画

- 丘陵展望台は標高データに展望デッキの擁壁と、その外側に落ちる斜面を接続する。手前の街区から約15 km先の都心へ向けて建物を段階的に高くし、西・東・さらに奥へ複数の高層街区を広げる。高層棟と周囲の低・中層街区は同じ基準位置を使う。既存の街路沿いの建物から向きと間隔を求め、遠方の低・中層街区を補う。幹線と高層棟の敷地を空け、延伸先でも車体・前照灯・尾灯を道路の高さと線形に合わせる。 [街区の基準位置](../src/coast/world/overlook/overlookDistricts.ts) · [高層業務街区](../src/coast/world/overlook/overlookSkyline.ts) · [幹線交通](../src/coast/world/overlook/overlookTraffic.ts) · [地理データの出典](../public/coast-overlook/ATTRIBUTION.md)
- [空と大気](../src/coast/world/coastAtmosphere.ts) は太陽光の色、空の散乱、距離霞を計算する。昼と夜の切替を空、環境光、距離霞、各ワールドの描画に反映する。入り江と山道の海・湖は、両品質で同じ空と光源を反射に使う。[湖面](../src/coast/world/coastUplandLake.ts) は地形の浅瀬を参照する。高品質では海岸と湖の水面付近で、反射用カメラを間隔を空けて描画する。丘陵展望台では、夜間に街灯と窓、デッキの照明が点く。
- [入り江の星空](../src/coast/world/coastMilkyWay.ts) は天の川の星の密集と暗黒帯を手続き生成する。空の方角に固定して星と銀河の帯を描き、地平線近くと月の周囲では弱める。軽量と高品質で同じ星の配置を使う。[天の川の暗黒帯の解説](https://science.nasa.gov/solar-system/skywatching/night-sky-network/augusts-night-sky-notes-the-great-rift/)
- 起動時は「軽量」。[照明](../src/coast/world/coastLighting.ts) は広域の影と林の間接光を共有する。高品質では視点近くを追従する影、地表の凹凸、近くの植生の詳細と内部解像度を追加する。軽量の広域影は視点が別の場所へ移るまで再利用する。
- [海面](../src/coast/world/coastOcean.ts) は海底の深さを使い、浅瀬で波が盛り上がる位置と崩れた泡を計算する。[波の周期](../src/coast/world/coastSwell.ts) を [CoastAudio](../src/coast/CoastAudio.ts) と共有し、砕波音の位置と強さを寄せ引きに合わせる。
- 入江の滝は岩に沿った流路と着水地点を地形から求める。飛沫の虹は観察者から水滴へ向かう方向を対日点から測り、外側の赤約42°から内側の紫約40°の帯を描く。日が当たる飛沫だけに出て、地形が太陽を遮る箇所は抑える。 [滝の描画](../src/coast/world/coastWaterfall.ts) · [飛沫の虹](../src/coast/world/coastSprayRainbow.ts) · [WMOの主虹](https://cloudatlas.wmo.int/en/primary-rainbow.html)

## 都心の50階住戸

- 図面の P1 を基準に、東を `x`、北を `-z`、50階の仕上げ床を `y=0` とし、単位をメートルにそろえる。部屋、壁、開口、手すりを描画と歩行判定で共有する。室内家具の外形は間接光の遮蔽に使い、歩行では通り抜けられる。主寝室の引戸は開き量を描画と音響に渡し、人が敷居を通れる幅まで開いてから通行できる。 [設計図 PDF](residence/residence-50f-drawings.pdf) · [平面](../src/coast/world/residence/residencePlan.ts) · [歩行判定](../src/coast/world/residence/residenceNavigation.ts)
- 街路面は `y=-176`。大通りの軸、交差点、両脇の高層塔を住戸の窓からの眺望断面と照合し、その外側に展望台と共有する都市を接続する。昼夜で建物の窓明かりと車の灯火を切り替える。ガラスの下枠と外周床は視線断面に合わせ、着座・立位のどちらでも路面が見える。 [基本設計](residence/residence-50f-design.md#街区と視線) · [都市の描画](../src/coast/world/residence/residenceCity.ts) · [住戸の躯体](../src/coast/world/residence/residenceShell.ts)
- 室内はオーク、石、タイル、布の模様と反射を実寸で設定する。昼は窓方位に合わせた日射と室内の間接光、夜は照明器具と天井・壁の間接光を使う。軽量と高品質で間取りと光源の位置を共有し、影の解像度と描画密度を変える。 [室内照明](../src/coast/world/residence/residenceLighting.ts) · [内装材](../src/coast/world/residence/residenceMaterials.ts)
- 録音した交通音を南と東の街路に配置する。高さと距離で減衰させ、窓ガラスと引戸の開き量で透過する音を変える。室内、敷居、屋外で反射と足音を変え、頭部伝達関数で方向を表現する。録音は展望台と同じライセンス済み素材を使う。 [住戸の音響](../src/coast/world/residence/residenceAudio.ts) · [録音の出典と再配布条件](../public/coast-overlook/ATTRIBUTION.md)

## 音響

- 音響は明示操作で開始する。[海岸の発音点](../src/coast/coastShore.ts) は海につながる浅瀬と陸の境界から求め、波が打つ方向へ動かす。再生中の発音点はクロスフェードで入れ替える。[伝播の計算](../src/coast/coastAcoustics.ts) は岩壁による遮蔽と短い反射、開口を経由する到達音を扱う。[足音と水音](../src/coast/CoastFoley.ts) は移動・潜水と地表の材質から選ぶ。カメラが潜ると、水中にいる深さに応じてミックスの高域を下げる。
- [丘陵展望台の音響](../src/coast/world/overlook/overlookAudio.ts) は幹線の高さを含む中心線を分割し、各区間の距離と丘による遮蔽で音の強さと高域の減衰を求める。道路ごとに合成した音を頭部伝達関数（HRTF）で定位させる。昼は低木に鳥声、夜はデッキ前方の草地と斜面に虫の声を間隔をずらして配置する。虫の音も高低差と地形の遮蔽を反映する。 [録音の出典と伝搬の資料](../public/coast-overlook/ATTRIBUTION.md)
- `CoastApp` は描画と音響に同じ時間帯を渡す。自然景観では昼の鳥声と夜の虫声をなじませ、丘陵展望台と住戸の夜は交通の発音量を下げる。静穏な昼と弱い夜間逆転層を想定し、伝搬経路の曲がり方を地形遮蔽に反映する。遠方の低域を補正し、近くの波や落水、潜水時の処理は各音源の位置と水深に従う。[大気による吸収と屈折の資料](https://www.fhwa.dot.gov/ENVIRonment/noise/noise_barriers/design_construction/design/design03.cfm)
- [落水](../src/coast/world/coastWaterfall.ts) は水の加速と岩に沿った流れを描く。泡と霧の起点は海・湖ごとの水位に合わせ、音響は描画と同じ着水点を参照する。
- [鳥](../src/coast/world/coastBirdLife.ts) が種類・個体・鳴いた位置を音響へ渡す。表示距離の外にいる鳥や、林と尾根に置いた止まり場からも、[鳥種ごとの減衰距離](../src/coast/coastBirdCue.ts)に応じて声を届ける。音響は録音を選び、飛行中は再生中の音源を動かす。距離による到達時間と地形による遮蔽を適用する。 [録音のクレジット](../public/coast-audio/ATTRIBUTION.md)
