# 話者マッピング設計

## 目的

HANAX-Uは、音声合成プロジェクトから取得した韻律情報をOpenUtauのノートへ変換する。話者マッピング機能では、インポート元の話者・スタイルごとに、ローカル環境のOpenUtauで使用するsingerを指定できる。

この機能は、ブラウザからローカルにインストールされた音源を検索したり、互換性のあるUTAU音源を自動推定したりするものではない。

## 変換処理の流れ

```text
Importer（インポート処理） → ProsodyProject（韻律データ）
  → Generator（音高・ノート生成） → NoteSequence（ノート列）
  → Exporter（出力処理） → USTX
```

- Importerは、インポート元の話者情報を各セリフ行とともに保持する。
- Generatorは、singerを選択せずに歌詞・タイミング・音高・休符・ポルタメントを生成する。
- Exporterは、保持された話者マッピングをUSTXトラックへ反映する。

## インポート元の話者ID

COEIROINKからのインポートでは、各セリフ行に以下の情報を保持する。

- `speaker_uuid`
- `style_id`
- `speaker_name`
- `style_name`
- `speaker_id`：安定した識別子 `${speaker_uuid}:${style_id}`

`speaker_id`を話者マッピングのキーとする。話者名・スタイル名はUI表示および補助的な識別にのみ使用する。同じ話者が複数のスタイルを持つ場合や、同名の話者が存在する可能性があるためである。

UIでは次の形式で表示する。

```text
話者（スタイル名）
```

例：`話者A（ノーマル）`

VOICEVOXからのインポートでは、`speakerUuid + styleId`に相当する情報を`speaker_id`として保持する。将来の音声ライブラリ追加との互換性を優先し、話者名・スタイル名の表示にはID文字列をそのまま用いる。

## 話者マッピングの内容

インポート元の`speaker_id`ごとに、1つの出力設定を作成する。

```text
インポート元 speaker_id
  → singer：自由入力のOpenUtau音源名
  → phonemizer：対応する2種類の選択肢のいずれか
  → renderer：対応する2種類の選択肢のいずれか
```

### `singer`

自由入力の文字列である。利用者のローカルOpenUtau環境で認識される、Singersフォルダ内の音源フォルダ名を入力する。ブラウザアプリケーションからローカル環境の音源一覧を安全かつ確実に取得することはできない。

### `phonemizer`

選択肢は以下の2つである。

- `OpenUtau.Core.DefaultPhonemizer`（UI表示：`DEFAULT`）
- `OpenUtau.Plugin.Builtin.JapanesePresampPhonemizer`（UI表示：`JA VCV & CVVC`）

### `renderer`

選択肢は以下の2つである。

- `CLASSIC`
- `WORLDLINE-R`

USTXでは`renderer_settings.renderer`へ出力する。

## USTX出力方針

マッピングが設定されたインポート元話者について、Exporterは利用者が指定した移植性の高い項目だけを出力する。

```yaml
singer: example singer
phonemizer: OpenUtau.Core.DefaultPhonemizer
renderer_settings:
  renderer: CLASSIC
```

`resampler`、`wavtool`、`voice_color_names`は出力しない。これにより、ローカル環境にある音源に適した設定をOpenUtau側で補完できる。

話者マッピングが空欄の場合、Exporterは`singer`を出力せず、音源固有の設定を推測・追加しない。

## 適用範囲

現在の出力設計では、インポートされたセリフ行ごとに1つのOpenUtauトラックを作成する。そのため、ある話者の設定は、同じ`speaker_id`を持つすべての出力トラックへ適用される。

将来、同一話者のセリフ行ごとに異なるsingerを設定する必要が生じた場合は、セリフ行単位の上書き設定を追加する。この上書き設定は話者単位の設定より優先する。

## UI上の挙動

ファイルのインポート後、出力設定には固有の`speaker_id`ごとに1行のマッピング項目を表示する。各行では「話者（スタイル名）」を表示し、singer名の自由入力とphonemizer・rendererの選択を行える。

話者マッピングの変更はGeneratorによる音高再計算を必要としない。入力内容は保持され、`.ustx をダウンロード`または`セリフ付きZIPをダウンロード`を押した時点でExporterが現在のマッピングを反映する。
