# 湖畔の広間の雲と松の素材

このワールド用に Codex の組み込み ImageGen で下記の画像を新規制作した。窓からの眺めの参照画像は構図と形態の照合に使った。黒松の枝ぶり、対生の針葉、樹皮の参考は Oregon State University の植物資料による。 [OpenAI・生成出力の利用条件](https://openai.com/policies/row-terms-of-use/#content) · [Oregon State University・Pinus thunbergii](https://landscapeplants.oregonstate.edu/plants/pinus-thunbergii)

| 配布ファイル | 使用箇所 | 寸法 |
| --- | --- | --- |
| [lake-cumulus-atlas.webp](lake-cumulus-atlas.webp) | 前後左右で移動する積雲と裾の雲。透過付きの4種。 | 1254 × 1254 px |
| [lake-pine-needles.webp](lake-pine-needles.webp) | 松の枝先。透過付きの4種。 | 1254 × 1254 px |
| [lake-pine-bark.webp](lake-pine-bark.webp) | 松の幹と枝の樹皮。 | 640 × 640 px |

変換時は雲のアルファ値と可視部分のRGB、針葉のアルファ値を元PNGと照合した。入力名は各生成出力を表す。成形と着色は[雲の実装](../../src/coast/world/lake/lakeSkyClouds.ts)と[松の実装](../../src/coast/world/lake/lakeBasinPines.ts)を参照する。

```sh
magick clouds.png -define webp:lossless=true -define webp:exact=true -define webp:method=6 lake-cumulus-atlas.webp
magick needles.png -strip -quality 89 -define webp:alpha-quality=100 -define webp:method=6 lake-pine-needles.webp
magick bark.png -strip -resize 640x640 -quality 85 -define webp:method=6 lake-pine-bark.webp
```

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
