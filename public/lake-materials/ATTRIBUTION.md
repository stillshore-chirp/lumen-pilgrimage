# 湖畔の広間の雲と植生の素材

このワールド用に Codex の組み込み ImageGen で下記の画像を新規制作した。窓からの眺めの参照画像は構図と形態の照合に使った。クロマツの枝ぶり、2本ずつ束生する針葉、樹皮の参考は Oregon State University の植物資料による。 [OpenAI・生成出力の利用条件](https://openai.com/policies/row-terms-of-use/#content) · [Oregon State University・Pinus thunbergii](https://landscapeplants.oregonstate.edu/plants/pinus-thunbergii)

| 配布ファイル | 使用箇所 | 寸法 |
| --- | --- | --- |
| [lake-cumulus-atlas.webp](lake-cumulus-atlas.webp) | 前後左右で移動する積雲と裾の雲。透過付きの4種。 | 1254 × 1254 px |
| [lake-pine-needles.webp](lake-pine-needles.webp) | 松の枝先。透過付きの4種。 | 1254 × 1254 px |
| [lake-pine-bark.webp](lake-pine-bark.webp) | 松の幹と枝の樹皮。 | 640 × 640 px |

変換時は雲のアルファ値と可視部分のRGB、針葉のアルファ値を元PNGと照合した。入力名は各生成出力を表す。成形と着色は[雲の実装](../../src/coast/world/lake/lakeSkyClouds.ts)と[松の実装](../../src/coast/world/lake/lakeVegetation.ts)を参照する。

```sh
magick clouds.png -define webp:lossless=true -define webp:exact=true -define webp:method=6 lake-cumulus-atlas.webp
magick needles.png -strip -quality 89 -define webp:alpha-quality=100 -define webp:method=6 lake-pine-needles.webp
magick bark.png -strip -resize 640x640 -quality 85 -define webp:method=6 lake-pine-bark.webp
```

## 植生の形態資料

以下は形態を比較するための大学の植物資料であり、画像中の樹種を同定した根拠ではない。資料の写真、図版、文章、コードは配布素材へ転用していない。生成画像と独自の造形へ反映する判断、原版からの観察、制作上の仮定は[植生の設計](../../docs/lake/lake-hall-design.md#植生の形態と配置)に記す。

| 資料と確認した箇所 | 参照した形態と適用範囲 |
| --- | --- |
| [Oregon State University・Pinus thunbergii](https://landscapeplants.oregonstate.edu/plants/pinus-thunbergii) の冒頭の樹形・針葉・樹皮の記載 | 成木の広がる樹形、不規則な枝、2本ずつ束生する針葉を松型の比較対象にした。原版の樹種や生育環境を確定するものではない。 |
| [同・Zelkova serrata](https://landscapeplants.oregonstate.edu/plants/zelkova-serrata) の樹形・葉の記載 | 低い分岐、杯状の樹形、互生の単葉を、小葉を持つ広葉樹型の骨格と末端素材を分ける参考にした。原版をケヤキと同定したものではない。 |
| [同・Plant Identification: Examining Leaves](https://landscapeplants.oregonstate.edu/plant-identification-examining-leaves) の「Broad vs. narrow leaves」「Leaf attachment」「Needle leaves」 | 広い葉身と針葉、互生・対生・束生を区別した。葉序や花・果実を判読できない参照画像では、樹種名の断定を避ける。 |

## 生成時に使ったプロンプト

### 積雲

```text
Use case: photorealistic-natural. Generate a square, high-resolution 2-by-2 atlas of four ORIGINAL naturally illuminated cloud formations for a real-time 3D lakeside vista. The background is genuine transparent RGBA, including the entire outer margin and the empty gaps, with finely anti-aliased/partly transparent edges and wisps. It is a cloud cutout sheet, seen from near ground level at a shallow angle up toward the clouds. Each independent formation occupies one equal square quadrant; leave at least 8% transparent padding on EVERY side of EACH quadrant. No overlap, no frames or divisions, no sky, no horizon, no blue backdrop, no checkerboard pattern, no text.

Top left quadrant: tall vigorous cumulus congestus with several deep overlapping irregular lobes, its broad lower half masses together and its tallest crown is slightly right of center. Strong, beautifully articulated real cumulus volume. Near-white sunward edge and crowns at upper right, cool blue-grey self-shadow deep in the overlapping pockets at lower left. Lower margin rolls into attached smaller ragged tufts and gentle wisps.
Top right quadrant: a distinct asymmetric chain of substantial fair-weather cumulus, with one dominant tall central-left cluster, a smaller attached cloud cluster to the right and depth separations between their stacked lobes. White sunlit tops, steel-blue grey underside. Horizontal breadth, uneven well-defined upper profile, subtle trailing wisps and scalloped lower rim.
Bottom left quadrant: a single broad low bank of connected low cumulus humilis, with an irregular line of about six overlapping rounded cloud lobes, one prominent front puff just off center and strings of smaller attached tufts on the sides. Broad and low, but enough body to drape visibly in front of rocks. The underside and tails curl and feather into transparency, with a naturally broken irregular profile and no razor-straight crop or base line.
Bottom right quadrant: another distinctive group of low and medium clusters, medium plume to the right and smaller connected scallops on the left; well-developed cloud-on-cloud shadows, lighter patches at the right-hand crown, softer wisps at the underside.

Photographic fine structures embedded in large realistic forms, temperate mountain weather, clean daylight exposure, warm-white highlights from the upper RIGHT and cool grey-blue shadows to the LEFT, finite soft transitions in interior. Full intact cloud edges in all four quadrants, fine alpha preserve density, graceful wisps and small-scale texture. No icons, soft blob illustration, stylized outlines, tinted background pixels, mirrored copy, uniform row of round cotton balls, unrelated scenery, arbitrary detached flecks, or horizontally chopped crop.
```

### 針葉

```text
A square, true transparent-background PNG of four realistically photographed Japanese black pine branch-tip cutouts for a video game 3D foliage material. Exact gallery contact sheet with 2 rows and 2 columns. Each of the four photographs is an isolated original branch on perfect empty TRANSPARENT ALPHA. Each occupies no more than 78% of its cell's width and 68% of its height, centered with wide blank alpha padding. Objects have blank alpha around every side, twelve percent margin between nearest branches, and no object touching any edge. Each branch is naturally irregular and porous, around three to five dense clusters, horizontally stretched with tapered extensions and subtly rising tips. Small twig handle projects LEFT from midheight. Square divisions purely conceptual, no grid. Four different silhouettes: irregular oval fork, tapered double plume, flat skewed fan, and angled tiered spray. Real Pinus thunbergii, with fine several-inch-long sharp dark forest-green needles in pairs, shorter silvery gray-green needles at the tips, tiny random gaps between clusters and at fringes, a few fine gray-brown woody twigs. Closely cropped of the object inside each contained crop, from a lightly elevated broadside angle, 85mm botanical lens with accurate detail. Uniform even diffuse skies light, photorealistic subdued cool green. Useful hard-cut alpha edge retaining individual tapered needles. No decorative objects, artifacts, stray isolated blobs or lens flare, backdrop, bright border, ground, ground shadow, outline, text, drop shadow, faded semiopaque aura. The thin fringe of distinctly separated pine needles is crisp and accurately resolved. No broad leaves or cones. It is an asset sheet, not a tree in a landscape.
```

### 樹皮

```text
Square seamless tileable PBR diffuse albedo material texture of field-photographed real mature Japanese black pine bark. Straight planar orthographic close-up textured surface sample roughly 70 centimeters wide by 70 centimeters tall. Every part of the entire image is covered by mature fissured gray-black pine bark, with deep fine predominantly vertical furrows that branch sparingly, weathered irregular angular elongated overlapping small rough plates, creases of near charcoal-gray, plate faces with subtle neutral ashy gray-brown, lightly washed pale gray edges, almost no orange color, naturally varied scale. Delicate rough granular detail across plate surfaces, photographic scanned texture. Even shadowless overcast cross-polarized illumination. Faces have no hard specular reflection or pronounced side shadow. The pattern is distributed fairly evenly across the whole tile with no trunk curve, all bark to the edges, no frame, no distinctive landmark, no gradient or vignette, no moss, no lichen, no foliage, no sap. Edge-to-edge seamless tiling is essential.
```

## 配布ファイルのSHA-256

```text
94c2b833d335967ff55fdd24c6d51990aae54157c7b06c79c32b9e5ad4781b7e  lake-cumulus-atlas.webp
de88c752a064b84b16e3938cf88ef436c341e4ff9225f201da4ced3d1c371c01  lake-pine-needles.webp
f46ec5e9fae00bceacfd184c261d646c9b3fc260acae8bf50b9e487d08096d77  lake-pine-bark.webp
```

## 小葉の広葉樹型の葉群

[編集元PNG](../../assets/lake-materials/lake-broadleaf-clusters.png)を組み込みImageGenで新規制作した。原版の植物を形態として分析し、小さな単葉と細枝を持つ独自の枝先4種に仕様化した。植物資料の画像は入力・転載していない。特定の樹種を同定・復元した素材ではない。

配布物は [lake-broadleaf-clusters.webp](lake-broadleaf-clusters.webp)、1254 × 1254 pxのRGBA、2 × 2区画。ImageMagick 7.0.10-57 Q16で下記を実行し、拡縮せず変換した。元PNGとWebPを8bit RGBAへ復号して照合し、全画素のアルファとアルファが0以外のRGBは一致した。完全透明画素1731箇所の非可視RGBは変化しているため、RGBA全バイト同一とは扱わない。

```sh
magick assets/lake-materials/lake-broadleaf-clusters.png -define webp:lossless=true -define webp:exact=true -define webp:method=6 public/lake-materials/lake-broadleaf-clusters.webp
```

### 広葉素材の生成プロンプト

```text
Use case: photorealistic-natural. Asset type: ORIGINAL game foliage texture atlas, not an illustration or a landscape. Produce a square true transparent RGBA PNG, an exact conceptual 2 by 2 atlas of four DIFFERENT small-leaved temperate broadleaf branch sprays, all broadside, twig stems entering from LEFT and continuing through each spray. Each single spray is centered strictly inside its own quadrant: leave at least 10 percent clear space on EVERY side of every cell, no foliage touches the image edges or another cell. Occupy about 75% of cell width and 50% of cell height. No grid, labels, text, borders, shadows or background. Actual transparent alpha, NOT a checkered or black backdrop.

Subject morphology: mature temperate deciduous broadleaf-tree crown branches with many small, simple oval to ovate, slightly pointed leaves on fine, branching gray-brown twigs. Leaves are only 2.5–5 centimeters long relative to 50–70 centimeter spray width, subtly serrated, in alternating positions, forming a delicate horizontal shallow canopy. NOT pine needles, NOT fern fronds, NOT giant tropical leaves. Tiny leaves create an irregular softly scalloped fine-grained crown edge. Dense clusters interlock but there are small natural pinholes and slender gaps through which the true transparent background shows. The base twig splits hierarchically into increasingly fine branches, no thick cartoon trunk. Four unique imperfect asymmetric silhouettes: top left a shallow broad elliptical fan; top right a forked horizontal spray with a small central gap; bottom left a wide low crown lobe with a gently rising right tip; bottom right a tapered arching spray with several small clustered ends. Do not duplicate or mirror branches.

Materials and light: realistic photographed fine leaf veins and subtle leaf curls. Quiet mid to deep forest green, small yellow olive touches in young leaves, cooler shaded undersides, gray-brown fine wood. Entire spray under uniform soft diffuse overcast light, no hard baked sunlight or cast drop shadow; physically natural diffuse albedo suitable for relighting in a 3D world. Crisp photographic organic detail, clean antialiased alpha including individual leaf tips. No white edge/halo, no stray detached leaves, no flowers/fruit/cones, no extraneous terrain or sky. This is a newly invented botanical asset, not an excerpt from a photograph.
```

### 広葉素材のSHA-256

```text
f27df9126a46042ed0566405b3583d7359a803ea7261a4d435a2b9ff73b00f58  assets/lake-materials/lake-broadleaf-clusters.png
a06059b179dec60d7a29a45023e86daa8e6937635b50bd57855a309a7ce2d9b9  public/lake-materials/lake-broadleaf-clusters.webp
```
