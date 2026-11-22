# 景観素材のクレジット

| 配布ファイル | 制作・出典 | 使い方 |
| --- | --- | --- |
| `sand.webp` | Charlotte Baglioni の [Sand 03](https://polyhaven.com/a/sand_03)（Poly Haven、[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)） | 砂浜と海底に使う。1K Diffuse を WebP に変換し、メタデータを除去 |
| `limestone.webp` | Codex の組み込み ImageGen で本プロジェクト向けに制作 | 断崖と海岸の岩に使う白亜灰色の石灰岩。1200 px 四方の WebP |
| `cumulus.webp` | Codex の組み込み ImageGen で本プロジェクト向けに制作 | 積雲4種を収録した透明アトラス。1152 px 四方の WebP |
| `forest-litter.webp` | Rob Tuytel の [Forest Leaves 02](https://polyhaven.com/a/forest_leaves_02)（Poly Haven、CC0 1.0） | 苔と落ち葉の林床。1K Diffuse を WebP に変換 |
| `forest-rock.webp` | Rob Tuytel の [Mossy Rock](https://polyhaven.com/a/mossy_rock)（Poly Haven、CC0 1.0） | 岩間と沢の苔むした岩。1K Diffuse を WebP に変換 |
| `forest-mud.webp` | eye-candy.xyz の [Mud Forest](https://polyhaven.com/a/mud_forest)（Poly Haven、CC0 1.0） | 踏み跡と水際の泥。1K Diffuse を WebP に変換 |
| `forest-relief.webp` | 上記3素材の Displacement（Poly Haven、CC0 1.0） | 赤に林床、緑に岩、青に泥の凹凸を収録。線形データとして読み込む |
| `forest-bark.webp`、`forest-bark-height.webp` | Rob Tuytel の [Bark Brown 01](https://polyhaven.com/a/bark_brown_01)（Poly Haven、CC0 1.0） | 近景の幹と板根。1K Diffuse と640 pxの高さを WebP で配布 |
| `trail-granite.webp`、`trail-granite-normal.webp` | Amal Kumar の [Granite Tile 04](https://polyhaven.com/a/granite_tile_04)（Poly Haven、CC0 1.0） | 朱の参道の石段と石灯籠。1K Diffuse と OpenGL Normal から目地を除いて切り出し、WebP に変換 |
| `scenery/shelf.glb` | Rob Tuytel の [Coast Rocks 05](https://polyhaven.com/a/coast_rocks_05)（Poly Haven、CC0 1.0） | 潮棚と海底。形状を圧縮し、色・法線・粗さ・AO を同梱 |
| `scenery/boulder.glb` | Rico Cilliers の [Boulder 01](https://polyhaven.com/a/boulder_01)（Poly Haven、CC0 1.0） | 露出した割れ岩。形状を圧縮し、表面マップを同梱 |
| `scenery/moss.glb` | Kless Gyzen の [Rock Moss Set 01](https://polyhaven.com/a/rock_moss_set_01)（Poly Haven、CC0 1.0） | 林の岩、沢と岸。岩6種を別のメッシュにし、表面マップを同梱 |
| `scenery/ferns.glb` | Rico Cilliers と Rob Tuytel の [Fern 02](https://polyhaven.com/a/fern_02)（Poly Haven、CC0 1.0） | 林床のシダ4種。葉の透過マスクを色に組み込み、表面マップを同梱 |

## 生成時の指示

### 石灰岩

> Original texture for a 3D tropical limestone cliff wall. Single square high resolution orthographic surface albedo tile, only the gray, blue-gray and subtly buff rock material. A nearly vertical exposed fractured limestone face, straight-on rock scan, 8 meters square. Distinct irregular vertical erosion channels, deep fine cracks shaded graphite blue, prominent angular slabs rising vertically, thin diagonal and occasional horizontal seams cutting across the main vertical weathering, fine granular stone relief at close range. Pale gray mineral streaks, desaturated cool grey walls, warmer ochre only in a few exposed crevices. High frequency mineral detail and branching faults, strongly varied scale from 3cm to 2m. Neutral diffuse daylight, no lighting gradients across the frame, no ground, plants, green moss, sky, overlay, text, edges or borders. Pattern fills frame from all sides and is suitable as a believable repeating base albedo texture for a large game mountain face.

### 積雲

> Create one original 3D video game environment VFX texture atlas, isolated on a genuinely transparent alpha background. Four DIFFERENT summer cumulus cloud formations arranged in a precise 2 by 2 sprite sheet, entirely contained within their own quadrant with at least 6% margin, no silhouettes crossing quadrant borders, no touching. Square atlas. Top left: a grand tropical towering cumulus congestus, bulbous crown and layered cauliflower tops, tall vertical pillar, bright warm whites on the top right, subtle cool slate blue-gray in the underside. Top right: fluffy wide coastal cumulus, low and horizontal, scatter of small folds at the edges. Bottom left: mid-height cumulus cluster with many overlapping sunlit white heads, darker translucent blue-gray at the base. Bottom right: wide partly wispy bank of small distant tropical clouds, elegant wisps. All four with the same high right-sided daylight, viewed slightly upward from a beach, natural complexity, clean variable opacity fading at the edges. Photographic real cloud texture with slightly heightened white-blue contrast to read at PS2 game texture resolution. Give the four clouds ample transparent gutter and show the entire disconnected sprite silhouettes. CLOUDS ONLY. No sky color, checkerboard, text, labels, ground, ocean, border, hard drop shadow, or decorative effects.
