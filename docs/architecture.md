# Lumen Pilgrimage: Reforge の設計

## 起動と状態遷移

- [main.ts](../src/main.ts) が `#app` を取得する。標準の起動先は自然景観探索。クエリが `?scene=expedition` のときは [AppBootstrap](../src/bootstrap/AppBootstrap.ts) から [Game](../src/core/Game.ts) を起動する。`Game` は Three.js のレンダラー、シーン、フレームループを用意し、入力、UI、遠征、保存、描画・音響を接続する。
- [MenuManager](../src/game/ui/MenuManager.ts) は UI の操作をコマンドとしてキューに積む。`Game` がフレームごとに取り出し、[GameStateMachine](../src/game/state/GameStateMachine.ts) の遷移表に沿って画面と進行状態を切り替える。起動時は Main Menu で待機し、出撃または Continue で遠征が始まる。

## 自然景観探索

- [CoastApp](../src/coast/CoastApp.ts) は、景観用のレンダラー、カメラ、画面とフレームループを起動する。従来ゲームへのリンクは同一オリジンでページを遷移する。景観側は遠征のセーブや設定から独立している。
- [CoastWorld](../src/coast/CoastWorld.ts) と [CoastControls](../src/coast/CoastControls.ts) は、[地形、散策路、沢の水位](../src/coast/terrain.ts) を共有する。海岸の周回路と内陸の分岐には地形に沿う勾配を付ける。沢を渡る道と岩間を抜ける道が高所で合流する。[植生](../src/coast/world/coastVegetation.ts) は場所に応じて樹種と密度を変え、散策路や渡渉点を空ける。樹皮や地表の素材は [景観素材のクレジット](../public/coast-materials/ATTRIBUTION.md) を参照。
- 地上の登坂判定に引っかかったときは横方向の移動を試す。急な下りとジャンプは重力で接地させる。海と沢ではその場所の水位を基準に、浅瀬から遊泳へ切り替える。飛行を解除すると同じ水平座標で地表または水面まで降りる。
- 起動時は「軽量」。[照明](../src/coast/world/coastLighting.ts) は広域の影と林の間接光を共有する。高品質では視点近くを追従する影、地表の凹凸、近くの植生の詳細と内部解像度を追加する。軽量の広域影は視点が別の場所へ移るまで再利用する。
- [海面](../src/coast/world/coastOcean.ts) は海底の深さを使い、浅瀬で波が盛り上がる位置と崩れた泡を計算する。[波の周期](../src/coast/world/coastSwell.ts) を [CoastAudio](../src/coast/CoastAudio.ts) と共有し、砕波音の位置と強さを寄せ引きに合わせる。
- 音響は明示操作で開始する。落水と滝つぼのしぶきには別の距離減衰を使い、鳥、虫、沢の瀬には内陸の位置を与える。[伝播の計算](../src/coast/coastAcoustics.ts) は空気による高域の減衰、岩壁による遮蔽と短い反射、岩間の開口を経由する到達音を扱う。どちらの描画設定でも同じ HRTF 音響グラフが続く。

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
