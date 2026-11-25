# アトリウム音響の素材

このディレクトリの音響は外部録音を配布せず、`src/coast/world/atrium/atriumAudioSamples.ts` が Web Audio の `AudioBuffer` として実行時に合成します。会話を想起させる帯域制限ノイズ、空調のノイズ、食器の短い共鳴、床材ごとの接触音は、固定 seed の手続き生成です。認識可能な発話、第三者の録音、外部サービスへの通信は含みません。

`createAtriumRoomTail` は 48 kHz など実行時の `BaseAudioContext.sampleRate` に合わせた約1.96秒のステレオ・インパルス応答を生成します。環境ループとイベントも同じサンプルレートのモノラル `AudioBuffer` として作成し、先頭と末尾にフェードを置いてループ境界のクリックを抑えています。

実在施設の写真は配置・寸法の参照にだけ使い、音源や固有の名称は取り込みません。音響の座標と反射面は `src/coast/world/atrium/atriumLayout.ts` の架空アトリウム設計値を参照します。
