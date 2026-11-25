# 商業アトリウムの床材

[Marble 01](https://polyhaven.com/a/marble_01) は Rob Tuytel が制作し、Poly Haven が [CC0 1.0](https://polyhaven.com/license) で配布しています。加工・再配布が可能です。

| 配布ファイル | 入力 | 加工 |
| --- | --- | --- |
| `marble-color.webp` | 2K Diffuse JPG | 2,048 px のまま WebP 品質86。色は sRGB で扱う。 |
| `marble-normal.webp` | 2K OpenGL Normal JPG | 1,024 px に縮小し可逆 WebP。 |
| `marble-roughness.webp` | 2K Roughness JPG | 1,024 px に縮小し可逆 WebP。 |

[Poly Haven 公式API](https://api.polyhaven.com/files/marble_01) の `Diffuse`、`nor_gl`、`Rough` の `2k.jpg.url` が原本への入口です。ImageMagick 7.0.10-57 の `magick input.jpg -quality 86 output.webp` または `magick input.jpg -resize 50% -define webp:lossless=true output.webp` で再作成できます。

[床の実装](../../src/coast/world/atrium/atriumFloor.ts) では、元画像の目地を避けた8か所から石目を採ります。色・法線・粗さを同じ位置から読み、1.35 m角の石板と通路沿いの淡い石帯に割り付けます。建築、展示品、枝状照明はコード内の形状です。提示された写真は構図、材の選定、明暗の比較に使いました。
