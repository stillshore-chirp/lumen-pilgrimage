# 展望台の道路と地形の設計

展望台から盆地を見渡す用途を保ち、道路を地盤、橋、坑口から連続した施設として構成します。座標は世界座標のm、主床はY=346 mです。歩行・飛行の許可範囲と上限451 mは [ワールド仕様](../worlds.md#丘陵展望台-overlook) に従います。道路は遠景施設であり、新しい移動先は追加しません。

![道路の局所平面と実断面](figures/road-terrain-plan-section.svg)

図の平面は生成planの折線を同縮尺で表示し、断面はroad 1の実profileです。平面の表示範囲外にも道路は継続します。断面右の支持関係図は寸法を読む模式図で、地盤の実形状や法線の代用にはしません。

## 高さの責務と生成順

| 入力・処理 | 意味とconsumer |
| --- | --- |
| [標高データ](../../public/coast-overlook/ATTRIBUTION.md)と `loadOverlookSurvey` | 元の地勢。配布グリッドの補間。 |
| `gradeBeforeLocalWorks` / `loadOverlookTerrain` | 施設の局所造成後、道路工事前の地表。施設直下のcutを保ち、周囲の元地勢へ2方向に戻す。住戸の共有景観はこの地表を使い、道路のない新しい溝を作らない。 |
| `createOverlookRoadDatum` | 既存道路の縦断を保つ設計用高さ。現在の地盤や橋脚の支持高さとして使わない。 |
| `createOverlookSurface` | Float32頂点、同じ対角線からなる描画地面と `sampleHeight`。都市groundを重ねる順序もここで確定する。 |
| `createOverlookCorridorPlan` | 道路中心線、幅、標高、station、坑口と切土の共通plan。描画・交通・音響が参照する純粋なCPUデータで、GPU資源や音声graphを生成しない。 |
| `createOverlookEarthworks` | 描画地面の実三角形を切り、路床・擁壁・坑口背面の土断面をつなぐ。返す合成 `sampleHeight` を、この造成を持つ展望台の支持へ渡す。 |
| 静的道路 / 構造 / 交通 | [路面](../../src/coast/world/overlook/overlookRoadSurface.ts)、[閉鎖slabとトンネル](../../src/coast/world/overlook/overlookRoadStructures.ts)、[車両・橋脚・音源データ](../../src/coast/world/overlook/overlookTraffic.ts)を同じplanから生成する。 |

組み立ては [OverlookWorld](../../src/coast/world/overlook/OverlookWorld.ts) を正本とします。元地表の描画meshとsamplerを作り、その面でplanを確定し、earthworksを適用してから都市、橋脚、植物、局所音源を配置します。実際に切った面の支持は合成samplerを使い、土被りは掘削前の面との関係を調べます。垂直な擁壁・坑口には同じXZで複数のYがあるため、高さ関数だけで壁の閉鎖を証明しません。

`sampleHeight` は非有限入力・field外で `undefined` を返します。planのfieldはX=−23000..23000、Z=−26000..11000 mで、必要な支持が外へ出た場合は生成を拒否します。毎frameのraycastは加えません。`createOverlookTraffic(heightAt)` のplan省略時は従来の配置を使います。共有consumerは新しい道路構造や音声を暗黙に生成しません。

## 線形、役割と接続

既存16路のXZ線形と幅を保持します。縦断の勾配は実際の描画chordで測り、同じXYZの接点を揃えて5.8%以内へ小さく持ち上げます。現入力の最大持上げは約17.533 mmであり、元のY値を全点で同一に保つ契約ではありません。Float32丸めを含む測定には0.0001 percentage pointの許容を使います。

`CorridorFrame.y` は道路中央のasphalt上面です。端は中央より0.42 m低く、stationは奥の継続部から元道路へ増加します。`originalOffset` と `originalLength` で元区間を追跡します。`corridorRole` は地中継続、坑口前の切土、露出部を区別します。

近側7端を、実際の土被りのある曲がった継続へ接続します。road 0/1/4/5/6は元始点を覆う地形へつなぎ、road 2/3は谷側の低い線形を延ばして坑口を置きます。全線を地表より上へ持ち上げる方式は採りません。坑口から奥には内壁、roof、floorと曲線を置き、端の生の断面や車両の周回切替を開口の正面へ置きません。延長距離だけで端が不可視と判定せず、地形・lining・視線を照合します。

全32端の幾何分類は、近側の地中継続7端、共有XYZの12端、遠方の自由端13端です。共有座標だけでlane、欄干開口、車両経路の連続まで保証しません。遠方13端はroad 0/1/2/7/8/9/10/11/12/13/14のendとroad 15のstart/endで、距離による不可視扱いをせず、通常の合法視点の原寸像・実投影・遮蔽で確認します。

## 地盤、坑口、支持

[Earthworks](../../src/coast/world/overlook/overlookEarthworks.ts) は元のindex付き三角形を切土polygonで分割し、影響しない頂点と属性を保ちます。切土上端は実格子・対角線との交点を含み、連続した擁壁と路床へつなぎます。坑口背面で地表がconcrete crestを越える部分は、実三角形に沿う土断面で閉じます。外挿した数点の最大値や、薄い板だけで地形の切断を隠しません。

トンネルは左右の孔と中央webを持ちます。[断面生成](../../src/coast/world/overlook/overlookTunnel.ts) は0.8 mのliningと実際の厚いheadwallを生成し、floorは路面から40 mm下へ入れます。車体・灯火の包絡、lining外面の土被り、隣接路との3D離隔を別々に検査します。土被りの制作条件は外面から2 m以上です。これは実施工の構造認証ではありません。

道路slabは上面を路面から20 mm下（中央）へ入れ、下面を中央路面−3.52 mまで閉じます。橋脚は実地盤の四隅から下へ入り、上部が実slabへ重なります。公称中心の約2 mの重なりをfootprint全域の最小値へ読み替えず、地盤とslabの両方を全footprintで交差検査します。曲線・勾配・地形の交点で浮きや支持切れがないことが条件です。

## 道路音の到来と範囲

道路音のある8路について、露出部8声と左右の実孔14声の最大22声へ分けます。覆われた各区間の源長を左右へ半分ずつ配り、旧 `soundWeight` を保ちます。保存するのは源長と放射weightであり、位置を変えた受音powerを旧方式へ再正規化しません。

孔の代表点は各bore内の局所路面+1.2 mで、中央のsolid webへ置きません。内側の道のりと各孔から聴取点への距離を一度だけ既存のmanual距離則へ入れ、Pannerの `rolloffFactor=0` とします。外部の地形遮蔽は孔から聴取点までを調べます。この経路長は減衰に使い、車両イベントへ同期する物理的な到達遅延は追加しません。露出部の道路幅は一つの重心音源へ縮約する近似が残ります。

元8路の再生率0.923..1とoffsetを保持し、追加の孔には範囲内の微小な率差とoffset差を与えます。これらは同じPCMの異なる時間・速度であり、統計的に独立した音源とは仮定しません。既存の高域・低域補正を保持しますが、坑内の反射、放射指向性や材料の測定値とは扱いません。実PCMの重なり、定位、音量とHRTF負荷は [検証手順](../verification.md#展望台の道路地形と道路音) で確認します。

## 原典の適用

[FHWA, Technical Manual for Design and Construction of Road Tunnels, 2009](https://www.govinfo.gov/content/pkg/GOVPUB-TD2-PURL-gpo93381/pdf/GOVPUB-TD2-PURL-gpo93381.pdf) の§1.3.5、§2.1とFigure 2-2、cut-and-coverの説明を読み、道路の役割、車両包絡、坑口、覆工と地盤の関係へ適用しました。本ワールドの幅、曲率、lining厚、土被りと勾配は制作値です。資料の道路規格や実物の構造性能を満たすとの主張はしません。

[ASJのトンネル音実験と予測の原著、pp.614–617・620–621](https://www.jstage.jst.go.jp/article/ast/41/3/41_E1947/_pdf/-char/ja) と [NCHRP 25-34 Appendix L、L1–2・L6–12](https://onlinepubs.trb.org/onlinepubs/nchrp/docs/NCHRP25-34_FRAppendixL.pdf) は坑口の位置・指向性と源powerの扱いを照合しました。道路・内面・車種を定めた予測条件を、汎用のPCM low-pass係数や固定の音量倍率へ転用しません。

設計・構造の検査、実画面の眺望、環境音、最終全域判定は分けます。合法視点から手前の地形に遮られる坑口の画像は、口内や地形接点を直接確認した証拠にはしません。版付きの実施結果と残件は関連Issue・PRに記録します。
