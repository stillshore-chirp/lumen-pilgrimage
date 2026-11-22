---
name: verify-expedition
description: Lumen Pilgrimage の入力、Hub、遠征、セーブ、WebXR の変更に対し、対象経路に合う検証と実機で確認できた範囲を判断する。
---

# 遠征経路の検証

## 変更箇所から確認範囲を選ぶ

まず [README の操作手順](../../../README.md#起動と操作)、[現行アーキテクチャ](../../../docs/architecture.md)、変更された経路の実装を読む。次の対応で影響する経路だけを選ぶ。

- 入力・メニュー・Hub 操作では、[Game](../../../src/core/Game.ts)、[デスクトップ入力](../../../src/engine/input/DesktopActionAdapter.ts)、[メニュー](../../../src/game/ui/MenuManager.ts)、[Hub 端末](../../../src/world/hub/HubTerminalDirector.ts) を確認する。
- XR のセッション・レイ選択では、[SessionBootstrap](../../../src/bootstrap/SessionBootstrap.ts)、[XR 入力](../../../src/engine/input/XRActionAdapter.ts)、[Hub シーン](../../../src/world/hub/PilgrimsBelfryScene.ts)、Game の `updateVrHubPointer` を確認する。
- セーブ・Continue・ルート復元では、[SaveManager](../../../src/engine/save/SaveManager.ts)、[ExpeditionState](../../../src/game/state/ExpeditionState.ts)、[CombatSandboxDirector](../../../src/game/sandbox/CombatSandboxDirector.ts)、[EncounterDirector](../../../src/game/director/EncounterDirector.ts) を確認する。
- biome・mission・room 定義の変更では、`src/game/encounters/` と `src/game/state/` の定義と [コンテンツ検証](../../../scripts/validate-content.mjs) を確認する。

## 検証結果の見方

自動検証のコマンドは [README](../../../README.md#検証と配布ビルド) を参照する。コンテンツ定義の変更は `npm run validate:content` で対象を絞って確認できる。HTTP 200 で確認できるのはサーバーの応答まで。画面、入力、保存の復元はブラウザー上の操作結果を、XR セッションとコントローラーは対応ヘッドセット上の観測を根拠にする。

## デスクトップの操作確認

変更経路に合わせ、`npm run dev` で起動しブラウザーで確認する。既存の進行を保護するため、空きスロットか使い捨てのブラウザープロファイルを使う。

- Main Menu から `Enter Hub` で Hub が開く。初期選択の `Expedition Terminal` は `E` で開き、`Q` は Hub 端末選択を巡回する。選択後の `E` で対応する端末画面へ遷移する。
- `Expedition Prep` で選択中の biome、mission、装備を確認し、`Launch Expedition` で遠征へ入る。入力変更時は該当する接続済み操作を試す。入力の割り当ては README を参照する。報酬選択を変えた場合は `A` / `D` で候補が切り替わり、`E` で選べることを確認する。
- セーブ変更または遠征中の保存変更では、保存間隔（現行実装は約1秒）後にページを再読み込みし、同じスロットを選ぶ。`Continue Expedition` が表示され、選択すると保存済みの biome、room、mission、ルート、体力・資源、relic を使って再開することを確認する。戦闘は再開後も進むため、確認する保存値と画面を分けて記録する。

## 旧セーブと XR

旧セーブ検証は、別ブラウザープロファイルまたは使い捨てスロット上の fixture で行い、元データを上書きしない。`runSeed` 欠落は `1`、`roomId` / `missionId` 欠落は空文字、`relicModifiers` 欠落は既定値、`metaProgress` 欠落は初期値になる形を使う。他の必須フィールドを保った fixture で、ロード後に Continue が表示され、再開できることを確認する。失敗時は必須項目と fallback のどちらで拒否・遷移したかを実装に照らして記録する。

WebXR を変更した場合、対応ブラウザーとヘッドセットをセキュアコンテキストで使い、セッション開始・終了を確認する。Hub 中にコントローラーのレイで端末へ向けると選択表示が変わることを確認する。現行実装では XR コントローラーのボタンによる端末起動と戦闘入力は未接続で、端末選択にはレイ、起動と戦闘にはデスクトップ入力を使う。セッション終了後にデスクトップ操作が戻ることも確認する。
