# Lumen Pilgrimage: Reforge の設計

## 起動と状態遷移

- [main.ts](../src/main.ts) が `#app` を取得する。標準の起動先は自然景観探索。クエリが `?scene=expedition` のときは [AppBootstrap](../src/bootstrap/AppBootstrap.ts) から [Game](../src/core/Game.ts) を起動する。`Game` は Three.js のレンダラー、シーン、フレームループを用意し、入力、UI、遠征、保存、描画・音響を接続する。
- [MenuManager](../src/game/ui/MenuManager.ts) は UI の操作をコマンドとしてキューに積む。`Game` がフレームごとに取り出し、[GameStateMachine](../src/game/state/GameStateMachine.ts) の遷移表に沿って画面と進行状態を切り替える。起動時は Main Menu で待機し、出撃または Continue で遠征が始まる。

## 自然景観探索

- [CoastApp](../src/coast/CoastApp.ts) は、景観用のレンダラー、カメラ、画面とフレームループを起動する。[移動先の定義](../src/coast/coastDestinations.ts) は両ワールドの着地点と到着時の向きを持つ。同じワールドでは入力と移動状態をリセットして着地点へ移動する。ワールドを渡るときは、移動先と時間帯を URL に渡してページを読み込む。景観側は遠征のセーブや設定から独立している。
- `?world=overlook` では [OverlookWorld](../src/coast/world/overlook/OverlookWorld.ts) が丘陵展望台を起動する。標高データで広域と周辺の地形を作り、公開街路データに沿って建物と街灯を配置する。[高層街区](../src/coast/world/overlook/overlookSkyline.ts) と [幹線交通](../src/coast/world/overlook/overlookTraffic.ts) は展望デッキからの眺めに合わせて配置した。幹線の周囲では建物の敷地を空け、車体とライトは道路の高さと走行方向に追従する。地上移動はテラスの柵、建物、ベンチ、望遠鏡に沿って制限する。 [地理データの出典](../public/coast-overlook/ATTRIBUTION.md)
- [CoastWorld](../src/coast/CoastWorld.ts) と [CoastControls](../src/coast/CoastControls.ts) は、[地形、散策路、沢の水位](../src/coast/terrain.ts) を共有する。道の縦断勾配を滑らかにつなぎ、周囲の地面に応じて横断勾配を付ける。西の岩棚、東の潮棚、林内の分岐と沢は、地形と [岩・シダの配置](../src/coast/world/coastLandmarks.ts) を合わせて組む。素材は [景観素材のクレジット](../public/coast-materials/ATTRIBUTION.md) を参照。
- 地上の登坂判定に引っかかったときは横方向の移動を試す。急な下りとジャンプは重力で接地させる。遊泳と潜水は海・沢・湖の水位を参照し、潜水時に水底への進入を止める。水底が浅くなると浮上し、岸で接地する。水中の視界は深さで減衰し、水面の裏側と水底に届く光を描く。
- 密林の高所から峠、湖の周回路、稜線へつながる。[朱の参道](../src/coast/world/coastInariTrail.ts) は湖の周回路から分かれ、地形の二つの歩行路に沿って石段と鳥居を置く。山の鞍部と樹冠の高さを調整し、南東から楼門や前庭、石段の入口に日が入る。小社からの下り道は稜線への道に合流する。路肩の地形、ベンチと屋外休憩所の座標、視界を空ける範囲を地形定義に持つ。[休憩所](../src/coast/world/coastRestAreas.ts) は地形に合わせて木製ベンチと低い石の縁を置く。
- [空と大気](../src/coast/world/coastAtmosphere.ts) は太陽光の色、空の散乱、距離霞を計算する。昼と夜の切替を空、環境光、距離霞、各ワールドの描画に反映する。入り江と山道の海・湖は、両品質で同じ空と光源を反射に使う。[湖面](../src/coast/world/coastUplandLake.ts) は地形の浅瀬を参照する。高品質では海岸と湖の水面付近で、反射用カメラを間隔を空けて描画する。丘陵展望台では、夜間に街灯と窓、デッキの照明が点く。
- 起動時は「軽量」。[照明](../src/coast/world/coastLighting.ts) は広域の影と林の間接光を共有する。高品質では視点近くを追従する影、地表の凹凸、近くの植生の詳細と内部解像度を追加する。軽量の広域影は視点が別の場所へ移るまで再利用する。
- [海面](../src/coast/world/coastOcean.ts) は海底の深さを使い、浅瀬で波が盛り上がる位置と崩れた泡を計算する。[波の周期](../src/coast/world/coastSwell.ts) を [CoastAudio](../src/coast/CoastAudio.ts) と共有し、砕波音の位置と強さを寄せ引きに合わせる。
- 音響は明示操作で開始する。[海岸の発音点](../src/coast/coastShore.ts) は海につながる浅瀬と陸の境界から求め、波が打つ方向へ動かす。再生中の発音点はクロスフェードで入れ替える。[伝播の計算](../src/coast/coastAcoustics.ts) は岩壁による遮蔽と短い反射、開口を経由する到達音を扱う。[足音と水音](../src/coast/CoastFoley.ts) は移動・潜水と地表の材質から選ぶ。カメラが潜ると、水中にいる深さに応じてミックスの高域を下げる。
- [落水](../src/coast/world/coastWaterfall.ts) は水の加速と岩に沿った流れを描く。泡と霧の起点は海・湖ごとの水位に合わせ、音響は描画と同じ着水点を参照する。
- [鳥](../src/coast/world/coastBirdLife.ts) が種類・個体・鳴いた位置を音響へ渡す。表示距離の外にいる鳥や、林と尾根に置いた止まり場からも、[鳥種ごとの減衰距離](../src/coast/coastBirdCue.ts)に応じて声を届ける。音響は録音を選び、飛行中は再生中の音源を動かす。距離による到達時間と地形による遮蔽を適用する。 [録音のクレジット](../public/coast-audio/ATTRIBUTION.md)

## 遠征とキャンペーン

- [CombatSandboxDirector](../src/game/sandbox/CombatSandboxDirector.ts) は遠征の戦闘状態を更新し、HUD に体力・資源、攻撃予告、報酬、ボスのフェーズ、戦績を渡す。Campaign、Contracts、Boss Rush、Endless Collapse は、同じ戦闘処理にモード別の補正を適用する。
- [EncounterDirector](../src/game/director/EncounterDirector.ts) はルームの接続、ミッションが優先するルート、攻略時間、被ダメージなどから次のルームを選ぶ。同順位の候補選択には `runSeed` から初期化した乱数を使う。ミッション、ルーム、敵の出現、ボス契約の定義は [`game/encounters/`](../src/game/encounters/) にある。
- [CampaignState](../src/game/state/CampaignState.ts) は解放済みの biome と次の目標を表す。攻略結果から次の biome を解放する処理は、現行の遠征経路に未接続。

## 入力と WebXR

- [DesktopActionAdapter](../src/engine/input/DesktopActionAdapter.ts) はキーボードとマウスの入力を `ActionState` に変換する。`Game` はこの入力を戦闘と Hub 端末の起動に使う。方向入力のうち左右は報酬選択に使われ、プレイヤーの座標を更新する処理は未接続。
- [XRActionAdapter](../src/engine/input/XRActionAdapter.ts) はコントローラーからレイを作り、[PilgrimsBelfryScene](../src/world/hub/PilgrimsBelfryScene.ts) が最も近いヒットから Hub 端末を選ぶ。端末の起動と戦闘を XR コントローラーのボタンで行う経路は未接続。
- [SessionBootstrap](../src/bootstrap/SessionBootstrap.ts) はセッションの開始・終了と表示状態を追跡し、`local-floor` を設定する。参照空間の取得は Three.js のセッション処理が担う。

## 描画と音響

- [HudManager](../src/game/ui/HudManager.ts) と `MenuManager` は DOM UI を描画する。`PilgrimsBelfryScene` が Hub のシーンを持ち、[WorldAssembler](../src/world/WorldAssembler.ts) は biome に応じて背景色・霧・照明を切り替える。戦闘中のプレイヤー・敵のモデルとルーム別のジオメトリは未接続。
- ボス戦の環境効果は照明や [ParticleDirector](../src/engine/render/ParticleDirector.ts) のエミッターに反映される。照明の一部は biome 別のプリセットで指定した座標を使う。
- [MusicDirector](../src/engine/audio/MusicDirector.ts) が戦闘状況から音楽の各ステムの音量を計算し、[AudioDirector](../src/engine/audio/AudioDirector.ts) が Web Audio のゲインを更新する。現在の起動経路にステム音源の登録は未接続。

## 保存と再開

- `Game` が3つのスロットを提供し、[SaveManager](../src/engine/save/SaveManager.ts) がスロットごとの状態、解放、恒久進行、遠征スナップショットを `localStorage` に保存する。遠征中は約1秒ごとに更新し、Continue でルーム、ミッション、ルート、体力・資源、レリックを復元する。
- 旧スナップショットで欠けている `runSeed`、`roomId`、`missionId`、`relicModifiers` と、スロットの `metaProgress` は既定値を補う。再開時のルート抽選は保存済みの `runSeed` から再初期化する。抽選途中の状態は保存していない。
- [SettingsStore](../src/engine/save/SettingsStore.ts) は設定を別の `localStorage` キーに保存する。UI スケール、音量、点滅低減、難易度などは `Game` が関連する処理へ反映する。
