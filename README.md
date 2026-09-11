# Wcupedia（ワールドカップペディア）

**Wカップ大図鑑** — 1930年から2026年まで、男子FIFAワールドカップ全23大会の
試合・ゴール・国・選手を、子どもが日本語で調べて読めるウェブ図鑑です。

A Japanese-language, kid-friendly encyclopedia of every men's FIFA World Cup,
1930–2026. Static site, no tracking, no accounts.

> 状態: 開発中（データ層と、大会・試合・クレジットの画面ができました。国・選手・検索は次の段階です）

## Features（予定を含む）

- 大会ごとの結果・グループ順位・トーナメント表
- 試合ごとのスコア（延長・PK）とゴール経過
- 国ごとの出場歴・成績、選手ごとのゴール記録
- ひらがな・カタカナ・英字で探せる検索、ふりがな表示

## Data

`public/data/` は次のデータから生成しています。

| Source | Years | License |
|---|---|---|
| [Fjelstul World Cup Database](https://github.com/jfjelstul/worldcup) v1.2.0, © 2023 Joshua C. Fjelstul, Ph.D. | 1930–2022 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/legalcode) |
| [openfootball/worldcup.json](https://github.com/openfootball/worldcup.json) | 2026 | CC0 1.0 |

Modifications: the sources are filtered to men's tournaments, merged by year,
re-keyed, given Japanese names, and restructured into per-tournament JSON. The
generated data in `public/data/` is therefore distributed under **CC BY-SA 4.0**
— see [DATA-LICENSE.md](DATA-LICENSE.md). Code is MIT — see [LICENSE](LICENSE).

## Development

Node.js 24 以上。依存パッケージはありません。

```bash
node tools/fetch-sources.mjs     # 固定コミットのソースを .cache/sources に取得
node tools/build-data.mjs        # public/data を生成（決定的: 同じ入力なら同じ出力）
node tests/run.mjs               # テスト
node tools/diff-sources.mjs      # 2つのソースの突き合わせレポート（reports/）
```

## 変更履歴 / Changelog

### Unreleased

- データ層: 全23大会・1068試合・3028ゴールを検証済みJSONとして生成
- 日本語テキストの正規化（かな・全角半角・アクセント）と、ふりがな記法パーサー
- 画面: ホーム（全23大会）、大会ページ（結果・得点王・賞・グループ順位・トーナメント表）、試合ページ（スコア・延長・PK・ゴールの流れ）、クレジット
- iPad向けレイアウト、国旗（flag-icons MIT / 歴史的国旗はパブリックドメイン）
- 決勝トーナメントをテレビ風のトーナメント表で表示（決勝が中央、左右の山を線でつなぐ）。「はじまり」から各ラウンドのあとまで、状況を切り替えて見られる
- 画面が狭いときはトーナメント表の左右の山を上下に並べ、チーム名を14px以上・横スクロールなしで表示
- トーナメント表の線を修正（準決勝から決勝への線が箱の上を通らない・途切れない／決勝の箱が縦に伸びない）
- 決勝トーナメントをグループリーグより上に表示
- 選手名: 日本の選手は漢字、外国の選手は「カタカナ (アルファベット)」、カタカナがなければアルファベットのみ
- 得点王・大会賞: 賞の名前と得点数を色付きラベルにして、選手名と区別しやすく
- 読みがなは表示しない（漢字のみ）。読みはカナ検索用にデータ内に保持
