# Talking.word_Cheating_tool

相手にバレずに知ったかをできるよう助けるツール。

オンライン通話（Zoom、Teams、Discord など）の会話をリアルタイムで文字起こしし、
知らない単語を画面の端のパネルでこっそり調べられるようにするデスクトップアプリです。

## いまできること（ステップ1）

- 画面の右端に、常に最前面の縦長パネルを表示する
- 相手の声（PCの再生音）と自分の声（マイク）を別々に取り込み、発話ごとに区切る
- PCの中で動く Whisper で日本語に文字起こしする（音声は外に送らない）
- 各発話について「話し終わってから文字が出るまでの遅れ」と「処理速度」を表示する

モデルは3種類から選べます。どれが自分のPCで実用的かを比べるためのものです。

| 選択肢 | 大きさ | 想定 |
| --- | --- | --- |
| Whisper base | 約80MB | 軽い。精度は低め |
| Whisper small | 約250MB | 中くらい |
| Whisper large-v3-turbo | 約500MB | 高精度。内蔵グラフィックでは遅い可能性あり |

モデルは初回だけインターネットからダウンロードし、以後はPCに保存されたものを使います。

## Windows で動かす

1. [Node.js](https://nodejs.org/ja) の LTS 版をインストールする
2. [Git](https://git-scm.com/download/win) をインストールする
3. PowerShell で次を実行する

   ```powershell
   git clone https://github.com/kono0/Talking.word_Cheating_tool.git
   cd Talking.word_Cheating_tool
   git checkout claude/project-thread-u5pdnk
   npm install
   npm run dev
   ```

   `npm run dev` で「Electron uninstall」と出たときは、`node node_modules/electron/install.js` を一度実行してから、もう一度 `npm run dev` してください。

4. 右端に出たパネルでモデルを選び、「開始」を押す
5. 通話アプリや YouTube などで音声を流し、パネルに文字が出るか確かめる

### 試すときに見てほしいところ

- **メーター**：「相手」は PC の再生音、「自分」はマイクに反応するか
- **遅れ**：話し終わってから文字が出るまでの秒数。2〜3秒以内が目標
- **処理速度**：1倍より小さければ会話に追いつけている。1倍を超えると遅れがどんどん溜まる

### 注意

- スピーカーで聞いていると、マイクが相手の声も拾って「自分」側に重複することがあります。イヤホンを推奨します。
- PCの再生音はすべて取り込むので、通話以外の音（動画など）も文字になります。

## 開発

```sh
npm run dev        # 開発モードで起動
npm run test       # 単体テスト
npm run typecheck  # 型チェック
npm run build      # ビルド
```

構成:

- `src/main` — ウィンドウの作成と、マイク・再生音の取り込み許可
- `src/renderer/src/audio` — 音声の取り込みと発話の区切り（VAD）
- `src/renderer/src/asr` — 文字起こしエンジン（`Transcriber` を実装すれば差し替え可能）
