# 丘陵展望台の出典と採用範囲

## 名称と造形

米国特許商標庁の資料では、参考にした施設の名称は米国商標登録第3,687,943号で、指定商品にはゲームソフトが含まれます。出所・提携・公認の混同を避けるため、画面上の名称は「丘陵展望台」としました。 [米国特許商標庁の資料](https://tmng-al.uspto.gov/resting2/api/casedoc/cms/case/99640852/office-action/OfficeAction8617576.pdf#page=21) · [15 U.S.C. §1125](https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title15-section1125)

公共の場所から見える建築の絵画・写真などを扱う米国著作権法の規定と、図面、写真、彫刻、ロゴやゲーム用モデルの利用条件を確認しました。展望台、パビリオン、市街の建物と窓明かりは独自に造形しました。高層街区の位置・規模と車が走る幹線は、展望台からの眺めに合わせて構成しました。 [17 U.S.C. §120](https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title17-section120) · [米国著作権局の建築著作物の資料](https://www.copyright.gov/circs/circ41.pdf)

夕暮れ時の空と市街の灯り、展望デッキの見え方を検討する際は、Rlumstead の撮影資料（Wikimedia Commons、ファイル記録の版 1173105928）を参照しました。テラスの形状と地表、市街、空は3Dシーンで描画します。 [参照写真のライセンス CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)

## 地形と街路

| ファイル | 出典と条件 | 加工 |
| --- | --- | --- |
| `overlook-elevation.bin`、`overlook-detail.bin` | U.S. Geological Survey, 3DEP の地表標高。利用制限なし。 [3DEP 製品案内](https://www.usgs.gov/3d-elevation-program/about-3dep-products-services) · [標高サービス](https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer) | 広域と展望台周辺を抽出し、標高を 0.25 m 単位で収録。現地座標を原点からのメートルに変換。 |
| `overlook-streets.webp`、`overlook-buildings.bin.gz` | U.S. Census Bureau, 2025 TIGER/Line ROADS、郡 FIPS 06037。パブリックドメイン。 [TIGER/Line](https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html) · [元の配布ファイル](https://www2.census.gov/geo/tiger/TIGER2025/ROADS/tl_2025_06037_roads.zip) | 街路を切り出してラスタ化し、街路沿いの建物と街灯を独自に配置。 |

標高サービスの `exportImage` で WGS 84、無圧縮 Float32 GeoTIFF、バイリニア補間を指定しました。広域は経度 −118.549938〜−118.050862、緯度 33.884090〜34.217574 を 641×513、近景は緯度 34.11843・経度 −118.30040 の周囲約 2.1 km 四方を 321×321 で取得しました。 [標高データの変換](../../scripts/prepare-overlook-elevation.py) · [街路データの変換](../../scripts/prepare-overlook-city.py)

## 環境音

録音は帯域と音量を調整し、モノラル 48 kHz の Ogg Opus に変換してローカルから配信します。

| ファイル | 録音・ライセンス | 加工 |
| --- | --- | --- |
| `distant-traffic.ogg` | 遠方の幹線道路の録音「Distant Highway Sound.」、Tom_Kaszuba。[Freesound](https://freesound.org/people/Tom_Kaszuba/sounds/658451/) · [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 公開試聴音源の 38–149 秒を抽出し、両端を 4 秒重ねて 107 秒のループに加工。 |
| `hillside-crickets.ogg` | 暖かい夜のコオロギの録音「Crickets - Warm Summer Night - Ambient.wav」、Speziax。[Freesound](https://freesound.org/people/Speziax/sounds/645329/) · [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 公開試聴音源の 9–67 秒を抽出し、両端を 4 秒重ねて 54 秒のループに加工。 |
| `hillside-towhee-calls.ogg` | カリフォルニアムジトウヒチョウ (*Melozone crissalis*) の録音「California Towhee」、© Jonathon Jongsma、XC109663。[Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Melozone_crissalis_-_California_Towhee_-_XC109663.ogg) · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 7.1、9.875、29.4、49.56 秒から各 2.5 秒を抽出し、前後にフェードをかけて連結。変換音源は同じ CC BY-SA 3.0 で配布。 |

交通音は複数の道路に沿って分布させ、道路までの距離と丘の地表による遮蔽に応じて音量と高域を落とします。 [FHWA の交通騒音の伝搬資料](https://www.fhwa.dot.gov/environMent/noise/regulations_and_guidance/polguide/polguide02.cfm) · [FHWA の空気吸収と遮蔽の資料](https://www.fhwa.dot.gov/ENVIRonment/noise/noise_barriers/design_construction/design/design03.cfm)
