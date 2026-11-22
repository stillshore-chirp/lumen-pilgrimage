# Lumen Pilgrimage: Reforge の設計

## 起動と状態遷移

- [main.ts](../src/main.ts) が `#app` を取得する。標準の起動先は海岸探索。クエリが `?scene=expedition` のときは [AppBootstrap](../src/bootstrap/AppBootstrap.ts) から [Game](../src/core/Game.ts) を起動する。`Game` は Three.js のレンダラー、シーン、フレームループを用意し、入力、UI、遠征、保存、描画・音響を接続する。
- [MenuManager](../src/game/ui/MenuManager.ts) は UI の操作をコマンドとしてキューに積む。`Game` がフレームごとに取り出し、[GameStateMachine](../src/game/state/GameStateMachine.ts) の遷移表に沿って画面と進行状態を切り替える。起動時は Main Menu で待機し、出撃または Continue で遠征が始まる。

## 海岸探索

- [CoastApp](../src/coast/CoastApp.ts) は、海岸専用のレンダラー、カメラ、画面とフレームループを起動する。従来ゲームへのリンクは同一オリジンでページを遷移する。海岸側は遠征のセーブや設定を読み書きしない。
- [CoastWorld](../src/coast/CoastWorld.ts) と [CoastControls](../src/coast/CoastControls.ts) は、[地形の高さ関数と座標](../src/coast/terrain.ts) を共有する。描画は高さ関数から海岸線、滝のある岩棚、起伏をサンプリングし、植生を固定シードで配置する。岩・砂・空のテクスチャと水際の岩棚には [収録済みの景観素材](../public/coast-materials/ATTRIBUTION.md) を使う。移動は同じ高さ関数で斜面・水際・接地を判定する。
- 起動時の描画設定は毎回ローポリ。ローポリでは低解像度の影を再利用する。通常描画は、影の解像度と更新頻度、ピクセル比、遠方クリップ面、景観のメッシュと植生を増やす。カメラの姿勢、制御器、音響グラフは初期化し直さない。
- [CoastAudio](../src/coast/CoastAudio.ts) は、明示操作で Web Audio の再生を開始する。ループや間隔を変えて鳴らす録音を複数レイヤーで重ね、点音源は HRTF と距離減衰を使う。カメラの位置と前方ベクトルをリスナーに渡す。描画品質は音響側への入力に含まれない。

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
