# 丘陵展望台の出典と採用範囲

## 名称と造形

米国特許商標庁の資料では、参考にした施設の名称は米国商標登録第3,687,943号で、指定商品にはゲームソフトが含まれます。出所・提携・公認の混同を避けるため、画面上の名称は「丘陵展望台」としました。 [米国特許商標庁の資料](https://tmng-al.uspto.gov/resting2/api/casedoc/cms/case/99640852/office-action/OfficeAction8617576.pdf#page=21) · [15 U.S.C. §1125](https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title15-section1125)

公共の場所から見える建築の絵画・写真などを扱う米国著作権法の規定と、図面、写真、彫刻、ロゴやゲーム用モデルの利用条件を確認しました。展望台、パビリオン、市街の建物と窓明かりは独自に造形しました。高層街区の位置・規模と車が走る幹線は、展望台からの眺めに合わせて構成しました。 [17 U.S.C. §120](https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title17-section120) · [米国著作権局の建築著作物の資料](https://www.copyright.gov/circs/circ41.pdf)

## 地形と街路

| ファイル | 出典と条件 | 加工 |
| --- | --- | --- |
| `overlook-elevation.bin`、`overlook-detail.bin` | U.S. Geological Survey, 3DEP の地表標高。利用制限なし。 [3DEP 製品案内](https://www.usgs.gov/3d-elevation-program/about-3dep-products-services) · [標高サービス](https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer) | 広域と展望台周辺を抽出し、標高を 0.25 m 単位で収録。現地座標を原点からのメートルに変換。 |
| `overlook-streets.webp`、`overlook-buildings.bin.gz` | U.S. Census Bureau, 2025 TIGER/Line ROADS、郡 FIPS 06037。パブリックドメイン。 [TIGER/Line](https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html) · [元の配布ファイル](https://www2.census.gov/geo/tiger/TIGER2025/ROADS/tl_2025_06037_roads.zip) | 街路を切り出してラスタ化し、街路沿いの建物と街灯を独自に配置。 |

標高サービスの `exportImage` で WGS 84、無圧縮 Float32 GeoTIFF、バイリニア補間を指定しました。広域は経度 −118.549938〜−118.050862、緯度 33.884090〜34.217574 を 641×513、近景は緯度 34.11843・経度 −118.30040 の周囲約 2.1 km 四方を 321×321 で取得しました。 [標高データの変換](../../scripts/prepare-overlook-elevation.py) · [街路データの変換](../../scripts/prepare-overlook-city.py)
