# Lumen Pilgrimage の設計

## 起動と状態遷移

- [main.ts](../src/main.ts) が `#app` を取得し、[CoastApp](../src/coast/CoastApp.ts) で入り江と山道を起動する。`?world=overlook` のときは [OverlookWorld](../src/coast/world/overlook/OverlookWorld.ts) を読み込んで丘陵展望台を開く。
- `CoastApp` はレンダラー、カメラ、UI、フレームループ、操作を接続する。[CoastTravelPanel](../src/coast/CoastTravelPanel.ts) でファストトラベルと昼夜の切り替えを操作できる。[移動先の定義](../src/coast/coastDestinations.ts) は両ワールドの着地点と到着時の向きを持つ。選択した移動先と時間帯は URL の `world`、`place`、`time` に反映される。同一ワールド内では位置と入力状態をリセットして移動し、ワールドを移ると移動先と時間帯を渡してページを読み込み直す。

## 自然景観探索

- 丘陵展望台は標高データに展望デッキの擁壁と、その外側に落ちる斜面を接続する。公開街路に沿って建物と街灯を配置する。手前から遠景へ [高層業務街区](../src/coast/world/overlook/overlookSkyline.ts) を並べ、独立住宅は低層街区の一部に残す。[幹線交通](../src/coast/world/overlook/overlookTraffic.ts) は立体交差の高さを求め、同じ線形に車体・前照灯・尾灯を沿わせる。幹線と高層棟の敷地には、街路沿いの建物を配置しない。[地理データの出典](../public/coast-overlook/ATTRIBUTION.md)
- [2階展望デッキ](../src/coast/world/overlook/overlookUpperDeck.ts) は東側の階段と踊り場をパビリオンの屋外デッキにつなぐ。階段の滑らかな歩行面と各踊り場の高さを共有し、手すりの位置で歩行を止める。ファストトラベルで選んだ着地点にも同じ高さを適用する。1階はテラスの縁、建物、ベンチ、望遠鏡に沿って歩行を制限する。夜は石の縁と段鼻の灯りが足元を照らす。
- [CoastWorld](../src/coast/CoastWorld.ts) と [CoastControls](../src/coast/CoastControls.ts) は、[地形、散策路、沢の水位](../src/coast/terrain.ts) を共有する。道の縦断勾配を滑らかにつなぎ、周囲の地面に応じて横断勾配を付ける。西の岩棚、東の潮棚、林内の分岐と沢は、地形と [岩・シダの配置](../src/coast/world/coastLandmarks.ts) を合わせて組む。素材は [景観素材のクレジット](../public/coast-materials/ATTRIBUTION.md) を参照。
- 地上の登坂判定に引っかかったときは横方向の移動を試す。急な下りとジャンプは重力で接地させる。遊泳と潜水は海・沢・湖の水位を参照し、潜水時に水底への進入を止める。水底が浅くなると浮上し、岸で接地する。水中の視界は深さで減衰し、水面の裏側と水底に届く光を描く。
- 密林の高所から峠、湖の周回路、稜線へつながる。[朱の参道](../src/coast/world/coastInariTrail.ts) は湖の周回路から分かれ、地形の二つの歩行路に沿って石段と鳥居を置く。山の鞍部と樹冠の高さを調整し、南東から楼門や前庭、石段の入口に日が入る。小社からの下り道は稜線への道に合流する。路肩の地形、ベンチと屋外休憩所の座標、視界を空ける範囲を地形定義に持つ。[休憩所](../src/coast/world/coastRestAreas.ts) は地形に合わせて木製ベンチと低い石の縁を置く。
- [空と大気](../src/coast/world/coastAtmosphere.ts) は太陽光の色、空の散乱、距離霞を計算する。昼と夜の切替を空、環境光、距離霞、各ワールドの描画に反映する。入り江と山道の海・湖は、両品質で同じ空と光源を反射に使う。[湖面](../src/coast/world/coastUplandLake.ts) は地形の浅瀬を参照する。高品質では海岸と湖の水面付近で、反射用カメラを間隔を空けて描画する。丘陵展望台では、夜間に街灯と窓、デッキの照明が点く。
- 起動時は「軽量」。[照明](../src/coast/world/coastLighting.ts) は広域の影と林の間接光を共有する。高品質では視点近くを追従する影、地表の凹凸、近くの植生の詳細と内部解像度を追加する。軽量の広域影は視点が別の場所へ移るまで再利用する。
- [海面](../src/coast/world/coastOcean.ts) は海底の深さを使い、浅瀬で波が盛り上がる位置と崩れた泡を計算する。[波の周期](../src/coast/world/coastSwell.ts) を [CoastAudio](../src/coast/CoastAudio.ts) と共有し、砕波音の位置と強さを寄せ引きに合わせる。
- 音響は明示操作で開始する。[海岸の発音点](../src/coast/coastShore.ts) は海につながる浅瀬と陸の境界から求め、波が打つ方向へ動かす。再生中の発音点はクロスフェードで入れ替える。[伝播の計算](../src/coast/coastAcoustics.ts) は岩壁による遮蔽と短い反射、開口を経由する到達音を扱う。[足音と水音](../src/coast/CoastFoley.ts) は移動・潜水と地表の材質から選ぶ。カメラが潜ると、水中にいる深さに応じてミックスの高域を下げる。
- [丘陵展望台の音響](../src/coast/world/overlook/overlookAudio.ts) は幹線の高さを含む中心線を分割し、各区間の距離と丘による遮蔽で音の強さと高域の減衰を求める。道路ごとに合成した音を頭部伝達関数（HRTF）で定位させる。昼は低木に鳥声、夜は虫の声を配置し、時間帯の切替時に音量をなじませる。[録音の出典と伝搬の資料](../public/coast-overlook/ATTRIBUTION.md)
- [落水](../src/coast/world/coastWaterfall.ts) は水の加速と岩に沿った流れを描く。泡と霧の起点は海・湖ごとの水位に合わせ、音響は描画と同じ着水点を参照する。
- [鳥](../src/coast/world/coastBirdLife.ts) が種類・個体・鳴いた位置を音響へ渡す。表示距離の外にいる鳥や、林と尾根に置いた止まり場からも、[鳥種ごとの減衰距離](../src/coast/coastBirdCue.ts)に応じて声を届ける。音響は録音を選び、飛行中は再生中の音源を動かす。距離による到達時間と地形による遮蔽を適用する。 [録音のクレジット](../public/coast-audio/ATTRIBUTION.md)
