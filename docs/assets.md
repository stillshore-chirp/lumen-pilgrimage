# 素材の所在と再現手順

`public/` は配布時にそのまま読み込む完成素材、`src/` は実行時に地形・形状・材質・音響を組み立てる正本です。素材ごとの権利者、ライセンス、クレジット、加工記録は各 `ATTRIBUTION.md` を正本として参照してください。差し替えや新しい出力を加える場合は、同じ変更で該当するクレジットも更新します。

## 現行素材と編集元

| 対象 | 配布物と出典 | 実装の正本 |
| --- | --- | --- |
| 海岸・森・参道 | [`public/coast-materials/`](../public/coast-materials/) の WebP と4つの GLB。出典・利用条件は[景観素材のクレジット](../public/coast-materials/ATTRIBUTION.md)。 | 地形、植物、鳥、海、滝などは [`src/coast/world/`](../src/coast/world/) の TypeScript で生成。画像と3Dモデルの読込は [`coastSurface.ts`](../src/coast/world/coastSurface.ts)、[`coastSceneryAssets.ts`](../src/coast/world/coastSceneryAssets.ts)、[`coastVegetation.ts`](../src/coast/world/coastVegetation.ts)。 |
| 海岸の環境音 | [`public/coast-audio/`](../public/coast-audio/) の録音。出典・ライセンス・記録された編集内容は[環境音素材のクレジット](../public/coast-audio/ATTRIBUTION.md)。 | 再生・配置・音響処理は [`CoastAudio.ts`](../src/coast/CoastAudio.ts) と各ワールドの音響モジュール。録音ファイルはビルド時に同梱し、実行時に外部サービスから取得しません。 |
| 丘陵展望台と共有する街並み | [`public/coast-overlook/`](../public/coast-overlook/) の標高グリッド、街路画像、建物・街灯配置、録音。取得元と利用条件は[展望台の出典](../public/coast-overlook/ATTRIBUTION.md)。 | 変換は [`prepare-overlook-elevation.py`](../scripts/prepare-overlook-elevation.py) と [`prepare-overlook-city.py`](../scripts/prepare-overlook-city.py)。地形・街路・建物の描画は [`overlookTerrain.ts`](../src/coast/world/overlook/overlookTerrain.ts) と [`overlookCity.ts`](../src/coast/world/overlook/overlookCity.ts)。 |
| 都心70階の住戸 | [`public/residence-materials/`](../public/residence-materials/) の仕上げ材と [`public/residence-audio/`](../public/residence-audio/) の電子レンジ完了音。出典と条件は[住戸の仕上げ材](../public/residence-materials/ATTRIBUTION.md)・[住戸の録音](../public/residence-audio/ATTRIBUTION.md)。交通音は展望台と同じ `distant-traffic.ogg` を使います。 | 平面・壁・開口は [`residencePlan.ts`](../src/coast/world/residence/residencePlan.ts)、材料は [`residenceMaterials.ts`](../src/coast/world/residence/residenceMaterials.ts)、都市と交通音は [`residenceCity.ts`](../src/coast/world/residence/residenceCity.ts)・[`residenceAudio.ts`](../src/coast/world/residence/residenceAudio.ts)。 |
| 映画館と仮想モニター | 映画館の設計資料は[平面図](cinema/cinema-floor-plan.pdf)と[光・音の設計](cinema/cinema-light-sound-design.pdf)。仮想モニターの映像は接続した配信元から実行時に受け取ります。 | 映画館の形状・仕上げ・空調音は [`src/coast/world/cinema/`](../src/coast/world/cinema/) で生成。モニターの面と接続映像は [`monitorObject.ts`](../src/monitor/monitorObject.ts) で生成・表示します。 |
| 映画館の測定済みHRTF | [`public/cinema-audio/`](../public/cinema-audio/) のMIT KEMAR由来48 kHz・144 tap配布表。出典・利用条件・加工・バイナリ表仕様は[HRTFのクレジット](../public/cinema-audio/ATTRIBUTION.md)に記録します。 | [`prepare-cinema-hrtf.py`](../scripts/prepare-cinema-hrtf.py) が公式compact archiveから規則的な角度表を再生成します。上映側の読込・畳み込みは映画館の音響実装が所有します。 |
| 商業アトリウム | [床材の取得と加工](../public/atrium-materials/ATTRIBUTION.md) · [合成環境音の内訳](../public/atrium-audio/ATTRIBUTION.md)。 | [建築・展示と音の編集先](worlds.md#商業アトリウム)。環境音の生成は [`atriumAudioSamples.ts`](../src/coast/world/atrium/atriumAudioSamples.ts)。 |
| 湖畔の広間 | [雲と植生の出典・生成と変換](../public/lake-materials/ATTRIBUTION.md)。小葉の[編集元PNG](../assets/lake-materials/lake-broadleaf-clusters.png)を保持。木材と岩は既存の仕上げ材・景観素材を使用。 | [植生の形態と配置](lake/lake-hall-design.md#植生の形態と配置)、[樹木・低木・地被](../src/coast/world/lake/lakeVegetation.ts)、[卓上の有花枝](../src/coast/world/lake/lakeHallArrangement.ts) · [ワールドの編集先](worlds.md#湖畔の広間)。 |

### 画像・3Dモデル・録音の再作成

- 海岸の4つの GLB は `GLTFLoader` で読み込み、各モデルのメッシュ名と `MeshStandardMaterial` を実行時に参照します。`moss.glb` は `moss01`〜`moss06`、`shelf.glb` は `rockShelf`、`boulder.glb` は `rockBoulder`、`ferns.glb` は `fernA`〜`fernD` を持ちます。差し替え時も [`coastSceneryAssets.ts`](../src/coast/world/coastSceneryAssets.ts) にある名前を保ち、メートル単位、X/Z 中央、Y=0 の底面ピボットを使います。現在のファイルでは `EXT_texture_webp` が必須です。メタデータの `glTF-Transform v4.5.1` は確認できますが、編集可能なモデル原本、利用アプリ、変換コマンドはリポジトリにありません。元モデルとライセンスは景観素材のクレジットから確認してください。
- 石灰岩と積雲の画像は本プロジェクト向けに ImageGen で作成され、プロンプトは[景観素材のクレジット](../public/coast-materials/ATTRIBUTION.md)に残っています。生成モデルの版とシードは記録されていないため、同じ画像の再生成は保証できません。Poly Haven 由来の画像も完成 WebP のみがリポジトリにあり、元のテクスチャ一式や画像編集コマンドはありません。
- 録音の原出典とライセンス、記録された切り出し・フィルター処理は各音声クレジットにあります。配布用ファイルは Ogg Opus の完成品ですが、元録音や再変換コマンドは含まれていません。元録音と編集条件から再作成する場合も、完全に同じ波形になるとは限りません。

3Dモデルを差し替えるときは次の順で進めます。

1. [景観素材のクレジット](../public/coast-materials/ATTRIBUTION.md)から対象モデルの出典と利用条件を確認し、取得した元モデルを編集原本にします。現行GLBから元形状や編集レイヤーは復元できません。
2. 編集元からGLBを作り、現行の material map 参照、`EXT_texture_webp`、[`coastSceneryAssets.ts`](../src/coast/world/coastSceneryAssets.ts) が要求するメッシュ名と `MeshStandardMaterial`、メートル単位、X/Z中央とY=0の底面ピボットを保ちます。元の編集アプリと書き出しコマンドは不明です。`glTF-Transform v4.5.1` はファイル内のメタデータとして確認できます。新しい出力では使用ツール、版、設定、コマンドを記録します。
3. `public/coast-materials/scenery/<name>.glb` にステージします。
4. `npm run build` の後に `npm exec -- vite preview` を起動し、表示されたローカルURLの既定の海岸で形状と表面を目視確認します。`COAST_CHROME_CHANNEL=chrome npm run test:coast:browser` でもモデルを含む素材の読込と海岸の操作を確認します。自動試験は視覚的な一致までは保証しません。

### 標高・街路データの再生成

標高の入力 GeoTIFF と Census の ZIP はリポジトリにありません。出典、記録済みの標高取得範囲、道路アーカイブは[展望台の出典](../public/coast-overlook/ATTRIBUTION.md)を参照してください。標高は [USGS 3DEP ImageServer](https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer) の `exportImage` を使います。リクエスト方式と `bbox`、`size`、座標系、画素形式、補間、TIFF 圧縮などの引数は [Esri の REST API リファレンス](https://developers.arcgis.com/rest/services-reference/enterprise/export-image/)に記載されています。

再取得時は `bboxSR=4326`、`imageSR=4326`、`format=tiff`、`pixelType=F32`、`compression=None`、`interpolation=RSP_BilinearInterpolation`、`adjustAspectRatio=false`、`f=image` を指定します。寸法は広域 `641,513`、近景 `321,321` です。広域の元リクエスト範囲は上記クレジットに記録されています。近景の元リクエスト範囲は記録されていません。現行 `HILL` グリッドのヘッダーから求めた近似 pixel-edge 範囲は、広域 `-118.5499380,33.8511237,-118.0508620,34.2505403`、近景 `-118.3117920,34.1070380,-118.2890080,34.1298220` です。これらは出力から推定した範囲で、元の取得範囲を示す証拠ではありません。広域はヘッダー推定値とクレジット記載値で南北範囲が異なります。

ヘッダー推定範囲で行った取得・変換では、両グリッドの範囲は現行ファイルから 0.004 m 以内でしたが、標高値には最大 0.25 m の差があり、バイト列は一致しませんでした。元の GeoTIFF が保存されていないため、同じ出力の再生成は未確認です。取得範囲の食い違いが解消するまでは、生成物を直接上書きしないでください。

```sh
ASSET_STAGE="$(mktemp -d)"
USGS_EXPORT_URL='https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage'
export_image() {
  curl --get --fail --silent --show-error "$USGS_EXPORT_URL" \
    --data-urlencode "bbox=$1" \
    --data-urlencode "size=$2" \
    --data-urlencode 'bboxSR=4326' \
    --data-urlencode 'imageSR=4326' \
    --data-urlencode 'format=tiff' \
    --data-urlencode 'pixelType=F32' \
    --data-urlencode 'compression=None' \
    --data-urlencode 'interpolation=RSP_BilinearInterpolation' \
    --data-urlencode 'adjustAspectRatio=false' \
    --data-urlencode 'f=image' \
    --output "$3"
}

export_image '-118.5499380,33.8511237,-118.0508620,34.2505403' '641,513' "$ASSET_STAGE/overlook-regional.tif"
export_image '-118.3117920,34.1070380,-118.2890080,34.1298220' '321,321' "$ASSET_STAGE/overlook-nearby.tif"
python3 scripts/prepare-overlook-elevation.py "$ASSET_STAGE/overlook-regional.tif" "$ASSET_STAGE/overlook-nearby.tif" --output "$ASSET_STAGE/elevation-check"

# Download the credited archive into the temporary stage; it is not a repo input.
curl --location --fail --silent --show-error \
  'https://www2.census.gov/geo/tiger/TIGER2025/ROADS/tl_2025_06037_roads.zip' \
  --output "$ASSET_STAGE/tl_2025_06037_roads.zip"

# This tested optional environment uses Python 3.14.5, NumPy 2.4.6, and Pillow 13.0.0.
python3 --version
python3 -m venv "$ASSET_STAGE/venv"
"$ASSET_STAGE/venv/bin/python" -m pip install numpy==2.4.6 Pillow==13.0.0

# The city script writes beside its own scripts/ directory, so copy it into the stage.
mkdir -p "$ASSET_STAGE/scripts"
cp scripts/prepare-overlook-city.py "$ASSET_STAGE/scripts/"
"$ASSET_STAGE/venv/bin/python" "$ASSET_STAGE/scripts/prepare-overlook-city.py" "$ASSET_STAGE/tl_2025_06037_roads.zip"

# Compare staged outputs before copying any file into public/.
cmp public/coast-overlook/overlook-streets.webp "$ASSET_STAGE/public/coast-overlook/overlook-streets.webp"
gzip -dc public/coast-overlook/overlook-buildings.bin.gz > "$ASSET_STAGE/tracked-ovc1.bin"
gzip -dc "$ASSET_STAGE/public/coast-overlook/overlook-buildings.bin.gz" > "$ASSET_STAGE/rebuilt-ovc1.bin"
cmp "$ASSET_STAGE/tracked-ovc1.bin" "$ASSET_STAGE/rebuilt-ovc1.bin"
```

GeoTIFF の再生成出力を追跡中の HILL グリッドと照合するには、同じシェルで次を実行します。標準ライブラリだけで、magic・想定寸法・24-byte ヘッダーに対するファイルサイズを検査し、サンプル中心の四辺と 0.25 m 単位の標高差を表示します。

```sh
python3 - "$ASSET_STAGE/elevation-check" <<'PY'
from pathlib import Path
import struct
import sys

staged, tracked = Path(sys.argv[1]), Path("public/coast-overlook")
grids = {"overlook-elevation.bin": (641, 513), "overlook-detail.bin": (321, 321)}

def read_grid(path, shape):
    data = path.read_bytes()
    if len(data) < 24:
        raise ValueError(f"short HILL file: {path}")
    magic, width, height, west, north, dx, dz = struct.unpack_from("<4sHH4f", data)
    if magic != b"HILL" or (width, height) != shape or len(data) != 24 + width * height * 2:
        raise ValueError(f"invalid HILL header, shape, or size: {path}")
    heights = struct.unpack_from(f"<{width * height}h", data, 24)
    extent = (west, north, west + (width - 1) * dx, north - (height - 1) * dz)
    return extent, heights

for filename, shape in grids.items():
    old_extent, old = read_grid(tracked / filename, shape)
    new_extent, new = read_grid(staged / filename, shape)
    deltas = tuple(new_value - old_value for new_value, old_value in zip(new_extent, old_extent))
    height_deltas = tuple(abs(a - b) for a, b in zip(new, old))
    print(f"{filename}: sample-center west/north/east/south delta (m)={deltas}; ")
    print(f"  changed heights={sum(value != 0 for value in height_deltas)}/{len(old)}, max delta={max(height_deltas) * 0.25:.2f} m")
PY
```

標高変換は無圧縮・単一チャンネル Float32 GeoTIFF を読み、`overlook-elevation.bin` と `overlook-detail.bin` を出力します。`--output` で確認用ディレクトリを指定できます。街路変換は ZIP 内の対応する `.shp` と `.dbf` を読みます。出力先は `scripts/prepare-overlook-city.py` の場所から決まるため、確認用の一時ツリーにスクリプトをコピーして実行してください。両変換には Python 3 が必要で、街路変換には Pillow と NumPy も必要です。版を固定する依存ファイルはありません。

標高ファイルは `HILL` ヘッダー（24 bytes）に幅・高さ、座標原点、格子間隔を記録し、その後ろに行優先の符号付き16 bit・0.25 m 刻み標高を格納します。街路画像は RGB のマスクで、赤が開発範囲、緑が道路、青が幹線です。`overlook-buildings.bin.gz` を展開した `OVC1` データは、12-byte ヘッダーの後に8-byteの建物記録と6-byteの街灯記録を続けます。ランタイム側の形式チェックは [`overlookTerrain.ts`](../src/coast/world/overlook/overlookTerrain.ts) と [`overlookCity.ts`](../src/coast/world/overlook/overlookCity.ts) にあります。

街路の実行例では Python 3.14.5、NumPy 2.4.6、Pillow 13.0.0 で `overlook-streets.webp` がバイト単位で一致し、gzip 展開後の OVC1 ペイロードも 2,051,160 バイトで一致しました。gzip ファイル自体は一致しませんでした。この組み合わせは検証済みの環境であり、履歴に記録された必須版や固定済み依存ではありません。出力には固定シードが使われますが、gzip の圧縮結果まで同一とは限らないため、上記のように展開したペイロードを比較します。

## 設計図と現在の実装

| 資料 | 内容と位置づけ |
| --- | --- |
| [映画館の平面図](cinema/cinema-floor-plan.pdf) | 客席、スクリーン、出入口、主要寸法を示す6ページの設計資料。 |
| [映画館の光・音の設計](cinema/cinema-light-sound-design.pdf) | 投影光、室内反射、座席位置ごとの音響を扱う8ページの設計資料。 |
| [70階住戸の設計仕様](residence/residence-70f-design.md) と [図面](residence/residence-70f-drawings.pdf) | 現行住戸の設計正本。図面は平面、眺望断面、街区、茶室と書斎の詳細を収めた4ページです。 |
| [50階住戸の設計案](residence/residence-50f-design.md) と [図面](residence/residence-50f-drawings.pdf) | 過去の設計記録です。現在の住戸実装の正本ではありません。 |

これらの PDF は設計参照資料です。映画館の室内は [`cinemaLayout.ts`](../src/coast/world/cinema/cinemaLayout.ts)・[`cinemaAuditorium.ts`](../src/coast/world/cinema/cinemaAuditorium.ts) が生成し、仕上げ画像も [`cinemaFinishes.ts`](../src/coast/world/cinema/cinemaFinishes.ts) がコードから作ります。住戸の現在の寸法と室配置は `residencePlan.ts` にあります。PDF の生成メタデータには映画館資料の Creator `HeadlessChrome/157`・Producer `Skia/PDF m157`、住戸図面の Producer `ReportLab PDF Library` が記録されていますが、編集用の原稿・図面ファイルや書き出しコマンドは追跡されていません。画面キャプチャ画像もリポジトリにはありません。ブラウザー撮影の入口は[検証手順](verification.md)にあります。

## 差し替え後の確認

`public/` の既存パスを変えずに素材を差し替え、まず `npm run build` で配布用の読込を確認します。開発サーバーは `npm run dev` で起動します。既定 URL で海岸、`?world=overlook` で展望台、`?world=residence` で現行住戸、`?world=cinema` で映画館を開けます。

- 海岸、展望台、共有都市を含む変更: `COAST_CHROME_CHANNEL=chrome npm run test:coast:browser`
- 住戸の変更: `COAST_CHROME_CHANNEL=chrome npm run test:residence:browser`
- 映画館の変更: `COAST_CHROME_CHANNEL=chrome npm run test:cinema:browser`
- 仮想モニターの映像・配置・音声を変えた場合: `COAST_CHROME_CHANNEL=chrome npm run test:monitor:browser`
- 文書だけの変更: `npm run validate:harness`

ブラウザ試験の準備と検証範囲は[検証手順](verification.md)を参照してください。自動試験は読込失敗や操作・音響経路を検出しますが、素材の見た目や音の適合までは証明しません。外観を変えた場合は視点、昼夜、描画品質をそろえた画像を比較し、音を変えた場合は同じ場所と音量で聴いて記録してください。
